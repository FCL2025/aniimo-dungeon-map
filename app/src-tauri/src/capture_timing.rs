pub const BURST_MS: u64 = 2400;
pub const CAPTURE_GAP_MS: u64 = 200;
// Right after M the map may still be opening; ~15 frames per second lets the
// first fully drawn frame reach recognition quickly. Only during the burst.
pub const BURST_GAP_MS: u64 = 66;
pub const KEY_POLL_MS: u64 = 15;

// `normal` is the gap outside the burst (CAPTURE_GAP_MS, or the tracking gap).
pub fn capture_gap(now: u64, burst_until: u64, normal: u64) -> u64 {
    if now < burst_until { normal.min(BURST_GAP_MS) } else { normal }
}

#[derive(Default)]
pub struct MapKeyTrigger { down: bool }
impl MapKeyTrigger {
    pub fn observe(&mut self, foreground: bool, key_down: bool) -> bool {
        let down = foreground && key_down;
        let pressed = down && !self.down;
        self.down = down;
        pressed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_game_foreground_can_trigger() {
        let mut key = MapKeyTrigger::default();
        assert!(!key.observe(false, true));
        assert!(!key.observe(false, false));
        assert!(key.observe(true, true));
    }
    #[test]
    fn held_key_does_not_extend_burst_and_new_press_retriggers() {
        let mut key = MapKeyTrigger::default();
        assert!(key.observe(true, true));
        for _ in 0..100 { assert!(!key.observe(true, true)); }
        assert!(!key.observe(true, false));
        assert!(key.observe(true, true));
        assert!(BURST_MS / BURST_GAP_MS <= 40);
        assert_eq!(KEY_POLL_MS, 15);
    }
    #[test]
    fn only_the_map_burst_captures_faster() {
        assert_eq!(capture_gap(1_000, 0, CAPTURE_GAP_MS), CAPTURE_GAP_MS);
        assert_eq!(capture_gap(1_000, 0, 100), 100);
        assert_eq!(capture_gap(1_000, 1_001, CAPTURE_GAP_MS), BURST_GAP_MS);
        assert_eq!(capture_gap(1_000, 1_001, 40), 40);
        assert_eq!(capture_gap(1_001, 1_001, CAPTURE_GAP_MS), CAPTURE_GAP_MS);
    }
}
