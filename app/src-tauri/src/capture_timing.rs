pub const BURST_MS: u64 = 2400;
pub const CAPTURE_GAP_MS: u64 = 200;
pub const KEY_POLL_MS: u64 = 30;

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
        assert!(BURST_MS / CAPTURE_GAP_MS <= 12);
        assert_eq!(KEY_POLL_MS, 30);
    }
}
