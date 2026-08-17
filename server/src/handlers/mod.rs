pub mod action;
pub mod activation;
pub mod api_key;
pub mod archive;
pub mod auth;
pub mod contact;
pub mod diagnostic;
pub mod event;
pub mod graph;
pub mod interaction;
pub mod media;
#[cfg(feature = "ocr")]
pub mod ocr;
#[cfg(feature = "stt")]
pub mod voice;
pub mod project;
pub mod project_contact;
pub mod quick;
pub mod reminder;
pub mod search;
pub mod setting;
pub mod sync;
pub mod storage;
pub mod tag;

use std::sync::OnceLock;
use crate::auth_keys::Keys;

pub static JWT_KEYS: OnceLock<Keys> = OnceLock::new();

pub fn now_str() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}
