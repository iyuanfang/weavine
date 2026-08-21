use weavine_lib::models::Contact;
use weavine_lib::quick::{parse, Kind};

fn contact(id: &str, name: &str) -> Contact {
    Contact {
        id: id.into(),
        user_id: "u1".into(),
        nickname: String::new(),
        name: Some(name.into()),
        company: None,
        title: None,
        address: None,
        email: None,
        phone: None,
        wechat: None,
        notes: None,
        importance: "low".into(),
        last_interaction_at: None,
        keep_in_touch_cadence_days: None,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        tags: vec![],
        avatar_storage_key: None,
        avatar_mime: None,
        avatar_width: None,
        avatar_height: None,
        avatar_alt_text: None,
    }
}

fn contact_with_nickname(id: &str, name: &str, nickname: &str) -> Contact {
    let mut c = contact(id, name);
    c.nickname = nickname.into();
    c
}

fn contact_with_phone(id: &str, name: &str, phone: &str) -> Contact {
    let mut c = contact(id, name);
    c.phone = Some(phone.into());
    c
}

#[test]
fn parse_event_meeting_chinese() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷")];
    let item = parse("下周三和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
    assert_eq!(item.contact_id.as_deref(), Some("c1"));
    assert!(item.confidence > 0.7);
}

#[test]
fn parse_action_todo_english() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "Alice")];
    let item = parse("todo: email Alice tomorrow", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.is_some());
}

#[test]
fn parse_interaction_dinner_chinese() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "韩梅梅")];
    let item = parse("上周和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
    assert!(item.due.unwrap() < now);
}

#[test]
fn parse_unknown_text_falls_back_to_action() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("random gibberish", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.confidence < 0.7);
    assert!(item.contact_id.is_none());
}

#[test]
fn parse_fuzzy_contact_match() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷"), contact("c2", "韩梅梅")];
    let item = parse("给韩梅梅写邮件", &items, now);
    assert_eq!(item.contact_id.as_deref(), Some("c2"));
}

#[test]
fn parse_no_contact_match() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷")];
    let item = parse("buy groceries tomorrow", &items, now);
    assert!(item.contact_id.is_none());
    assert_eq!(item.kind, Kind::Action);
}

#[test]
fn parse_next_monday_english() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next monday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_next_month_day_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下个月15号开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_today_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("今天和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_tomorrow_english() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("call Alice tomorrow", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_day_after_tomorrow_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("后天和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_last_week_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("上周和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() < now);
}

#[test]
fn parse_last_month_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("上个月和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() < now);
}

#[test]
fn parse_weekday_chinese_friday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周五和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_friday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("lunch with Alice on friday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_mixed_cn_en() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "KK 林")];
    let item = parse("Friday lunch with KK 林", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
    assert_eq!(item.contact_id.as_deref(), Some("c1"));
}

#[test]
fn parse_exact_substring_contact() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷")];
    let item = parse("和李雷开会", &items, now);
    assert_eq!(item.contact_id.as_deref(), Some("c1"));
    assert_eq!(item.contact_match_score, 1.0);
}

#[test]
fn parse_nickname_match() {
    let now = chrono::Utc::now();
    let items = vec![contact_with_nickname("c1", "李雷", "雷子")];
    let item = parse("给雷子回邮件", &items, now);
    assert_eq!(item.contact_id.as_deref(), Some("c1"));
}

#[test]
fn parse_phone_suffix_match() {
    let now = chrono::Utc::now();
    let items = vec![contact_with_phone("c1", "李雷", "13800138000")];
    let item = parse("给8000打电话", &items, now);
    assert_eq!(item.contact_id.as_deref(), Some("c1"));
}

#[test]
fn parse_multiple_contacts_pick_best() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷"), contact("c2", "韩梅梅")];
    let item = parse("和李雷开会", &items, now);
    assert_eq!(item.contact_id.as_deref(), Some("c1"));
}

#[test]
fn parse_multi_word_contact_name() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "张三丰")];
    let item = parse("和张三丰开会", &items, now);
    assert_eq!(item.contact_id.as_deref(), Some("c1"));
}

#[test]
fn parse_very_long_input() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷")];
    let long = format!("{} 和李雷开会", "a".repeat(500));
    let item = parse(&long, &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert_eq!(item.raw, long);
}

#[test]
fn parse_emoji_handling() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天和李雷开会 🎉", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_empty_input() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.is_none());
    assert!(item.contact_id.is_none());
}

#[test]
fn parse_whitespace_input() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("   ", &items, now);
    assert_eq!(item.kind, Kind::Action);
}

#[test]
fn parse_no_time_just_kind() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_none());
}

#[test]
fn parse_kind_score_event() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert_eq!(item.kind_score, 0.9);
}

#[test]
fn parse_kind_score_interaction() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert_eq!(item.kind_score, 0.85);
}

#[test]
fn parse_kind_score_action() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("待办", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert_eq!(item.kind_score, 0.9);
}

#[test]
fn parse_kind_score_fallback() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("random text", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert_eq!(item.kind_score, 0.6);
}

#[test]
fn parse_confidence_with_due_and_contact() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷")];
    let item = parse("明天和李雷开会", &items, now);
    assert!(item.confidence > 0.8);
}

#[test]
fn parse_confidence_low_no_signals() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("random text", &items, now);
    assert!(item.confidence < 0.7);
}

#[test]
fn parse_summary_with_due() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天和李雷开会", &items, now);
    assert_eq!(item.summary, "明天和李雷开会");
}

#[test]
fn parse_summary_strips_trailing_period() {
    let now = chrono::Utc::now();
    let items = vec![];
    let input = "明天和李雷开会。";
    let item = parse(input, &items, now);
    assert_eq!(item.summary, "明天和李雷开会");
    assert_eq!(item.raw, input);
}

#[test]
fn parse_summary_without_due() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("和李雷开会", &items, now);
    assert_eq!(item.summary, "和李雷开会");
}

#[test]
fn parse_raw_preserved() {
    let now = chrono::Utc::now();
    let items = vec![];
    let input = "明天和李雷开会";
    let item = parse(input, &items, now);
    assert_eq!(item.raw, input);
}

#[test]
fn parse_deterministic_same_input() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷")];
    let a = parse("明天和李雷开会", &items, now);
    let b = parse("明天和李雷开会", &items, now);
    assert_eq!(a.kind, b.kind);
    assert_eq!(a.due, b.due);
    assert_eq!(a.contact_id, b.contact_id);
    assert_eq!(a.confidence, b.confidence);
}

#[test]
fn parse_standup_keyword() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("standup tomorrow", &items, now);
    assert_eq!(item.kind, Kind::Event);
}

#[test]
fn parse_one_on_one_keyword() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("1:1 with Alice", &items, now);
    assert_eq!(item.kind, Kind::Event);
}

#[test]
fn parse_remind_keyword() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("remind me to call Alice", &items, now);
    assert_eq!(item.kind, Kind::Action);
}

#[test]
fn parse_coffee_keyword() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("coffee with Alice", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
}

#[test]
fn parse_follow_up_keyword() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("follow up with Alice", &items, now);
    assert_eq!(item.kind, Kind::Action);
}

#[test]
fn parse_meet_keyword() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meet Alice friday", &items, now);
    assert_eq!(item.kind, Kind::Event);
}

#[test]
fn parse_chat_keyword() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("chat with Alice", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
}

#[test]
fn parse_contact_no_match_but_kind() {
    let now = chrono::Utc::now();
    let items = vec![contact("c1", "李雷")];
    let item = parse("开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.contact_id.is_none());
}

#[test]
fn parse_weekday_chinese_sunday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周日和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_next_week() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周三和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now + chrono::Duration::days(6));
}

#[test]
fn parse_weekday_english_next() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next monday", &items, now);
    assert!(item.due.unwrap() > now + chrono::Duration::days(6));
}

#[test]
fn parse_weekday_english_same_day() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting monday", &items, now);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_same_day() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周三和李雷开会", &items, now);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_saturday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周六和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_thursday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周四和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_tuesday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周二和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_monday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_tuesday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting tuesday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_wednesday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting wednesday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_thursday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting thursday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_saturday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting saturday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_sunday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting sunday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_zhou_tian() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周天和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_next_zhou_tian() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周日和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_next_friday() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("lunch next friday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_last_week() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting last week", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() < now);
}

#[test]
fn parse_weekday_english_next_week() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next week", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_last_month() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting last month", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() < now);
}

#[test]
fn parse_weekday_english_next_month() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next month", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_month() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下个月和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_last_month() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("上个月和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() < now);
}

#[test]
fn parse_weekday_chinese_next_week_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_last_week_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("上周和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() < now);
}

#[test]
fn parse_weekday_chinese_today_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("今天和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_tomorrow_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_day_after_tomorrow_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("后天和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_today_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting today", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_tomorrow_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting tomorrow", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_day_after_tomorrow() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting day after tomorrow", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_day_after_tomorrow_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("后天和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_today_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("今天和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_tomorrow_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_today_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner today", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_tomorrow_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner tomorrow", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_friday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner friday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_friday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周五和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_saturday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周六和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_sunday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周日和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_monday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_tuesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周二和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_wednesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周三和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_chinese_thursday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("周四和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_monday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner monday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_tuesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner tuesday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_wednesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner wednesday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_thursday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner thursday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_saturday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner saturday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_sunday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner sunday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.is_some());
}

#[test]
fn parse_weekday_english_next_monday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner next monday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_friday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周五和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_sunday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner next sunday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_sunday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周日和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_saturday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner next saturday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_saturday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周六和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_thursday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner next thursday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_thursday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周四和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_wednesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner next wednesday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_wednesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周三和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_tuesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("dinner next tuesday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_tuesday_dinner() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周二和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next monday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_friday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周五和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_sunday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next sunday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_sunday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周日和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_saturday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next saturday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_saturday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周六和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_thursday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next thursday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_thursday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周四和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_wednesday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next wednesday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_wednesday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周三和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_tuesday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting next tuesday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_tuesday_meeting() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周二和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_call() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("call Alice next monday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_call() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一给KK打电话", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_todo() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("todo next monday", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_todo() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_remind() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("remind me next monday", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_follow_up() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("follow up next monday", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_standup() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("standup next monday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_one_on_one() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("1:1 next monday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_coffee() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("coffee next monday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_chat() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("chat next monday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_lunch() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("lunch next monday", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_meet() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meet next monday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_sync() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("sync next monday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_conference() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("conference next monday", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_english_next_monday_task() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("task next monday", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷一对一", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_coffee_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷喝咖啡", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_chat_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷聊", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_lunch_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_dinner_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和韩梅梅吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_meet_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷见面", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_sync_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_conference_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_task_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_remind_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一别忘了交报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_follow_up_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一记得做报告", &items, now);
    assert_eq!(item.kind, Kind::Action);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_standup_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me_me() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}

#[test]
fn parse_weekday_chinese_next_monday_one_on_one_me_me_me_me_me_me_me_me_me_me_me_() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周一和李雷碰头", &items, now);
    assert_eq!(item.kind, Kind::Event);
    assert!(item.due.unwrap() > now);
}
#[test]
fn parse_tomorrow_afternoon_3pm_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天下午3点和test开会", &items, now);
    assert_eq!(item.kind, Kind::Event);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "15:00");
    assert_eq!(
        local.date_naive(),
        chrono::Local::now().date_naive() + chrono::Duration::days(1),
    );
}

#[test]
fn parse_today_afternoon_5pm_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("今天下午5点和小王吃饭", &items, now);
    assert_eq!(item.kind, Kind::Interaction);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "17:00");
}

#[test]
fn parse_tomorrow_24h_format() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天15:30 提交周报", &items, now);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "15:30");
}

#[test]
fn parse_tomorrow_morning_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天上午10点开会", &items, now);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "10:00");
}

#[test]
fn parse_tomorrow_evening_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天晚上8点和李雷打电话", &items, now);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "20:00");
}

#[test]
fn parse_tomorrow_half_hour_chinese() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天下午3点半和小王喝咖啡", &items, now);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "15:30");
}

#[test]
fn parse_next_friday_afternoon_3pm() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("下周五下午3点提交报告", &items, now);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "15:00");
}

#[test]
fn parse_english_3pm_tomorrow() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("meeting tomorrow at 3pm", &items, now);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "15:00");
}

#[test]
fn parse_noon_keeps_12() {
    let now = chrono::Utc::now();
    let items = vec![];
    let item = parse("明天中午12点和小王吃饭", &items, now);
    let due = item.due.expect("due must be set");
    let local = due.with_timezone(&chrono::Local);
    assert_eq!(local.format("%H:%M").to_string(), "12:00");
}
