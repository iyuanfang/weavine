use weavine_lib::cadence::{
    make_invitation_token, threshold_for, CadenceConfig, Importance,
};

#[test]
fn threshold_for_high_is_14() {
    assert_eq!(threshold_for(Importance::High), Some(14));
}

#[test]
fn threshold_for_medium_is_45() {
    assert_eq!(threshold_for(Importance::Medium), Some(45));
}

#[test]
fn threshold_for_low_is_none() {
    assert_eq!(threshold_for(Importance::Low), None);
}

#[test]
fn invitation_token_format_is_deterministic() {
    assert_eq!(make_invitation_token("u1", "c1", 14), "u1:c1:14");
    assert_eq!(make_invitation_token("u2", "c2", 45), "u2:c2:45");
}

#[test]
fn cadence_config_defaults_match_spec() {
    let cfg = CadenceConfig::default();
    assert_eq!(cfg.high_days, 14);
    assert_eq!(cfg.medium_days, 45);
}

#[test]
fn importance_as_str_round_trip() {
    for imp in [Importance::Low, Importance::Medium, Importance::High] {
        assert_eq!(Importance::parse(imp.as_str()), Some(imp));
    }
    assert_eq!(Importance::parse("garbage"), None);
}

#[test]
fn invitation_token_handles_unicode_contact_ids() {
    let tok = make_invitation_token("用户-1", "联系人-甲", 14);
    assert_eq!(tok, "用户-1:联系人-甲:14");
}