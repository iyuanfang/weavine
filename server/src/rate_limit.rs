//! In-process sliding-window rate limiter keyed by `(route, scope, value)`.
//!
//! Used by `forgot-password` to enforce per-email and per-IP caps. State
//! is in-memory only; a server restart resets all counters. Acceptable for
//! v1 — a multi-replica deploy would need a Redis-backed limiter, but we
//! don't ship multi-replica yet.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use dashmap::DashMap;

type Key = (String, String, String);

#[derive(Default, Debug)]
pub struct RateLimiter {
    hits: DashMap<Key, VecDeque<Instant>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return `true` if the request is allowed; `false` if the limit has
    /// been reached within the rolling window. In either case, the call
    /// is recorded when it is allowed.
    pub fn check(&self, route: &str, scope: &str, value: &str, limit: usize, window: Duration) -> bool {
        let key = (route.to_string(), scope.to_string(), value.to_string());
        let now = Instant::now();
        let cutoff = now.checked_sub(window).unwrap_or(now);
        let mut entry = self.hits.entry(key).or_default();
        // Drop expired timestamps from the front.
        let buf = entry.value_mut();
        while buf.front().is_some_and(|t| *t < cutoff) {
            buf.pop_front();
        }
        if buf.len() >= limit {
            return false;
        }
        buf.push_back(now);
        true
    }

    /// Approximate total entry count. Used by tests; production code
    /// should not care.
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.hits.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_up_to_limit_then_blocks() {
        let rl = RateLimiter::new();
        let window = Duration::from_secs(60);
        for _ in 0..3 {
            assert!(rl.check("fp", "email", "a@x", 3, window));
        }
        assert!(!rl.check("fp", "email", "a@x", 3, window));
    }

    #[test]
    fn isolates_keys() {
        let rl = RateLimiter::new();
        let window = Duration::from_secs(60);
        for _ in 0..3 {
            assert!(rl.check("fp", "email", "a@x", 3, window));
        }
        assert!(rl.check("fp", "ip", "1.1.1.1", 3, window));
        assert!(rl.check("fp", "email", "b@x", 3, window));
    }

    #[test]
    fn window_releases_capacity() {
        let rl = RateLimiter::new();
        let window = Duration::from_millis(20);
        for _ in 0..2 {
            assert!(rl.check("fp", "email", "a@x", 2, window));
        }
        assert!(!rl.check("fp", "email", "a@x", 2, window));
        std::thread::sleep(Duration::from_millis(40));
        assert!(rl.check("fp", "email", "a@x", 2, window));
    }
}
