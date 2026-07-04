pub mod action;
pub mod archive;
pub mod auth;
pub mod contact;
pub mod diagnostic;
pub mod event;
pub mod interaction;
pub mod project;
pub mod project_contact;
pub mod reminder;
pub mod search;
pub mod setting;
pub mod sync;
pub mod tag;

use std::sync::OnceLock;
use crate::auth_keys::Keys;

pub static JWT_KEYS: OnceLock<Keys> = OnceLock::new();

pub fn now_str() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}
