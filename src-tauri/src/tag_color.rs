pub const PALETTE: &[&str] = &[
    "#3b82f6", // blue
    "#22c55e", // green
    "#f59e0b", // amber
    "#ef4444", // red
    "#a855f7", // purple
    "#06b6d4", // cyan
    "#ec4899", // pink
    "#84cc16", // lime
    "#f97316", // orange
    "#14b8a6", // teal
    "#6366f1", // indigo
    "#f43f5e", // rose
];

pub fn color_for(name: &str) -> String {
    let hash: u32 = name
        .bytes()
        .fold(2166136261u32, |acc, b| (acc ^ b as u32).wrapping_mul(16777619));
    PALETTE[(hash as usize) % PALETTE.len()].to_string()
}
