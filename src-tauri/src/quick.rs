// spec: Weavine-产品需求Spec.md §3.5.3

use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Utc};
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

fn chrono_parse(s: &str, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let local_now = Local::now();
    let lower = s.to_lowercase();

    if lower.contains("今天") || lower.contains("today") {
        return Some(now);
    }
    if lower.contains("明天") || lower.contains("tomorrow") {
        return Some(now + Duration::days(1));
    }
    if lower.contains("后天") {
        return Some(now + Duration::days(2));
    }
    if lower.contains("下周") || lower.contains("next week") {
        return Some(now + Duration::days(7));
    }
    if lower.contains("上周") || lower.contains("last week") {
        return Some(now - Duration::days(7));
    }
    if lower.contains("下个月") || lower.contains("next month") {
        return Some(now + Duration::days(30));
    }
    if lower.contains("上个月") || lower.contains("last month") {
        return Some(now - Duration::days(30));
    }
    let weekdays_cn = [
        ("周一", 1), ("周二", 2), ("周三", 3), ("周四", 4),
        ("周五", 5), ("周六", 6), ("周日", 0), ("周天", 0),
    ];
    for (name, target) in weekdays_cn.iter() {
        if lower.contains(name) {
            let current = local_now.weekday().num_days_from_monday() as i64;
            let diff = (*target as i64 - current + 7) % 7;
            let offset = if lower.contains("下") { diff + 7 } else if diff == 0 { 7 } else { diff };
            return Some(now + Duration::days(offset));
        }
    }
    let weekdays_en = [
        ("monday", 0), ("tuesday", 1), ("wednesday", 2), ("thursday", 3),
        ("friday", 4), ("saturday", 5), ("sunday", 6),
    ];
    for (name, target) in weekdays_en.iter() {
        if lower.contains(name) {
            let current = local_now.weekday().num_days_from_sunday() as i64;
            let diff = (*target as i64 - current + 7) % 7;
            let offset = if lower.contains("next") { diff + 7 } else if diff == 0 { 7 } else { diff };
            return Some(now + Duration::days(offset));
        }
    }
    let day_re = regex::Regex::new(r"(\d{1,2})号").ok()?;
    if let Some(cap) = day_re.captures(s) {
        if let Ok(day) = cap[1].parse::<u32>() {
            let mut date = local_now.date_naive();
            if lower.contains("下个月") || lower.contains("next month") {
                date = date + Duration::days(30);
            } else if day <= date.day() {
                date = date + Duration::days(30);
            }
            let naive = date.with_day(day).unwrap_or(date);
            let local_dt = Local.from_local_datetime(&naive.and_hms_opt(9, 0, 0)?).single()?;
            return Some(local_dt.with_timezone(&Utc));
        }
    }
    None
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
    let summary = if due.is_some() {
        format!("{}: {}", kind.as_str(), input)
    } else {
        input.to_string()
    };
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