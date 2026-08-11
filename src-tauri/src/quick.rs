// spec: Weavine-产品需求Spec.md §3.5.3

use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Timelike, Utc};
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

use crate::models::Contact;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Event,
    Action,
    Interaction,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QuickItem {
    pub kind: Kind,
    pub kind_score: f32,
    pub due: Option<DateTime<Utc>>,
    pub contact_id: Option<String>,
    pub contact_match_score: f32,
    pub summary: String,
    pub raw: String,
    pub confidence: f32,
}

const KIND_KEYWORDS_EVENT: &[&str] = &[
    "开会", "约", "meeting", "meet", "conference", "sync",
    "standup", "1:1", "一对一", "碰头",
];
const KIND_KEYWORDS_ACTION: &[&str] = &[
    "待办", "记得", "要", "todo", "task", "remind", "follow up",
    "别忘了", "记得做",
];
const KIND_KEYWORDS_INTERACTION: &[&str] = &[
    "吃饭", "通话", "打电话", "聊", "call", "dinner", "lunch", "chat",
    "coffee", "喝咖啡", "见面", "联系",
];

fn classify_kind(s: &str) -> (Kind, f32) {
    let event_hits = KIND_KEYWORDS_EVENT.iter().filter(|k| s.contains(*k)).count();
    let action_hits = KIND_KEYWORDS_ACTION.iter().filter(|k| s.contains(*k)).count();
    let interaction_hits = KIND_KEYWORDS_INTERACTION.iter().filter(|k| s.contains(*k)).count();
    let max = event_hits.max(action_hits).max(interaction_hits);
    if max == 0 {
        return (Kind::Action, 0.6);
    }
    if event_hits == max {
        (Kind::Event, 0.9)
    } else if action_hits == max {
        (Kind::Action, 0.9)
    } else {
        (Kind::Interaction, 0.85)
    }
}

fn parse_time(s: &str) -> Option<(u32, u32)> {
    let lower = s.to_lowercase();

    if let Some(cap) = regex::Regex::new(r"(\d{1,2}):(\d{2})").ok()?.captures(s) {
        let h: u32 = cap[1].parse().ok()?;
        let m: u32 = cap[2].parse().ok()?;
        if (1..=23).contains(&h) && m <= 59 {
            return Some((h, m));
        }
    }

    if let Some(cap) = regex::Regex::new(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)").ok()?.captures(&lower) {
        let mut h: u32 = cap[1].parse().ok()?;
        let m: u32 = cap.get(2)
            .map(|x| x.as_str().parse().unwrap_or(0))
            .unwrap_or(0);
        if cap[3].eq_ignore_ascii_case("pm") && h < 12 {
            h += 12;
        }
        if cap[3].eq_ignore_ascii_case("am") && h == 12 {
            h = 0;
        }
        if h <= 23 && m <= 59 {
            return Some((h, m));
        }
    }

    let cn_re = regex::Regex::new(
        r"(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|早)?\s?(\d{1,2})\s*点(\s*半|\s*一刻|\s*三刻|\s*(\d{1,2})\s*分)?",
    )
    .ok()?;
    if let Some(cap) = cn_re.captures(s) {
        let prefix = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let h_raw: u32 = cap[2].parse().ok()?;
        if !(1..=12).contains(&h_raw) {
            return None;
        }
        let mut h = h_raw;
        let mut m: u32 = 0;
if let Some(suffix) = cap.get(3).map(|m| m.as_str()) {
            if suffix.contains("半") {
                m = 30;
            } else if suffix.contains("一刻") {
                m = 15;
            } else if suffix.contains("三刻") {
                m = 45;
            } else if suffix.contains('分') {
                if let Some(mm) = regex::Regex::new(r"(\d{1,2})").ok().and_then(|re| re.find(suffix)) {
                    m = mm.as_str().parse().unwrap_or(0);
                }
            }
        }
        match prefix {
            "凌晨" | "清晨" | "早上" | "早晨" | "上午" | "早" => {
                if h == 12 {
                    h = 0;
                }
            }
            "中午" => {}
            "下午" | "傍晚" | "晚上" | "夜里" => {
                if h < 12 {
                    h += 12;
                }
            }
            _ => {}
        }
        if h <= 23 && m <= 59 {
            return Some((h, m));
        }
    }

    None
}

fn chrono_parse(s: &str, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let local_now = Local::now();
    let local_today = local_now.date_naive();
    let lower = s.to_lowercase();

    let (base_date, default_hour): (chrono::NaiveDate, u32) =
        if lower.contains("今天") || lower.contains("today") {
            (local_today, local_now.hour())
        } else if lower.contains("明天") || lower.contains("tomorrow") {
            (local_today + Duration::days(1), local_now.hour())
        } else if lower.contains("后天") {
            (local_today + Duration::days(2), local_now.hour())
        } else if lower.contains("下周") || lower.contains("next week") {
            (local_today + Duration::days(7), 9)
        } else if lower.contains("上周") || lower.contains("last week") {
            (local_today - Duration::days(7), 9)
        } else if lower.contains("下个月") || lower.contains("next month") {
            (local_today + Duration::days(30), 9)
        } else if lower.contains("上个月") || lower.contains("last month") {
            (local_today - Duration::days(30), 9)
        } else {
            let weekdays_cn = [
                ("周一", 1), ("周二", 2), ("周三", 3), ("周四", 4),
                ("周五", 5), ("周六", 6), ("周日", 0), ("周天", 0),
            ];
            let mut matched_cn: Option<(i64, u32)> = None;
            for (name, target) in weekdays_cn.iter() {
                if lower.contains(*name) {
                    let current = local_now.weekday().num_days_from_monday() as i64;
                    let diff = (*target as i64 - current + 7) % 7;
                    let offset = if lower.contains("下") {
                        diff + 7
                    } else if diff == 0 {
                        7
                    } else {
                        diff
                    };
                    matched_cn = Some((offset, 9));
                    break;
                }
            }
            if let Some((offset, h)) = matched_cn {
                (local_today + Duration::days(offset), h)
            } else {
                let weekdays_en = [
                    ("monday", 0), ("tuesday", 1), ("wednesday", 2), ("thursday", 3),
                    ("friday", 4), ("saturday", 5), ("sunday", 6),
                ];
                let mut matched_en: Option<(i64, u32)> = None;
                for (name, target) in weekdays_en.iter() {
                    if lower.contains(*name) {
                        let current = local_now.weekday().num_days_from_sunday() as i64;
                        let diff = (*target as i64 - current + 7) % 7;
                        let offset = if lower.contains("next") {
                            diff + 7
                        } else if diff == 0 {
                            7
                        } else {
                            diff
                        };
                        matched_en = Some((offset, 9));
                        break;
                    }
                }
                if let Some((offset, h)) = matched_en {
                    (local_today + Duration::days(offset), h)
                } else {
                    let day_re = regex::Regex::new(r"(\d{1,2})号").ok()?;
                    if let Some(cap) = day_re.captures(s) {
                        if let Ok(day) = cap[1].parse::<u32>() {
                            let mut date = local_today;
                            if lower.contains("下个月") || lower.contains("next month") {
                                date = date + Duration::days(30);
                            } else if day <= date.day() {
                                date = date + Duration::days(30);
                            }
                            let resolved = date.with_day(day).unwrap_or(date);
                            (resolved, 9)
                        } else {
                            return None;
                        }
                    } else {
                        return None;
                    }
                }
            }
        };

    let (hour, minute) = match parse_time(s) {
        Some((h, m)) => (h, m),
        None => (default_hour, 0),
    };

    let naive = base_date.and_hms_opt(hour, minute, 0)?;
    let local_dt = Local.from_local_datetime(&naive).single()?;
    Some(local_dt.with_timezone(&Utc))
}

fn match_contact(s: &str, contacts: &[Contact]) -> Option<(String, f32)> {
    let matcher = SkimMatcherV2::default();
    let mut best: Option<(String, f32)> = None;
    for c in contacts {
        let candidates = [c.name.as_deref().unwrap_or(""), c.nickname.as_str()];
        for cand in candidates.iter().filter(|x| !x.is_empty()) {
            if let Some(score) = matcher.fuzzy_match(s, cand) {
                let normalized = (score as f32 / 100.0).clamp(0.0, 1.0);
                if best.as_ref().map_or(true, |(_, s)| normalized > *s) {
                    best = Some((c.id.clone(), normalized));
                }
            }
            if s.contains(cand) {
                best = Some((c.id.clone(), 1.0));
                break;
            }
        }
        if let Some(phone) = &c.phone {
            if phone.len() >= 4 && s.contains(&phone[phone.len() - 4..]) {
                best = Some((c.id.clone(), 0.95));
            }
        }
    }
    best
}

fn compute_confidence(has_due: bool, contact_score: f32, kind_score: f32) -> f32 {
    let due_factor = if has_due { 0.4 } else { 0.0 };
    let contact_factor = contact_score * 0.3;
    let kind_factor = kind_score * 0.3;
    (due_factor + contact_factor + kind_factor).clamp(0.0, 1.0)
}

pub fn parse(input: &str, contacts: &[Contact], now: DateTime<Utc>) -> QuickItem {
    let (kind, kind_score) = classify_kind(input);
    let due = chrono_parse(input, now);
    let (contact_id, contact_match_score) = match_contact(input, contacts)
        .map(|(id, score)| (Some(id), score))
        .unwrap_or((None, 0.0));
    let confidence = compute_confidence(due.is_some(), contact_match_score, kind_score);
    let summary = input.trim_end_matches(['。', '．', '.']).trim().to_string();
    QuickItem {
        kind,
        kind_score,
        due,
        contact_id,
        contact_match_score,
        summary,
        raw: input.to_string(),
        confidence,
    }
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Event => "event",
            Self::Action => "action",
            Self::Interaction => "interaction",
        }
    }
}