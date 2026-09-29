pub const TRACKING_GAP_MS: u64 = 100;

pub fn valid_region(r: [f64; 4]) -> bool {
    r.iter().all(|v| v.is_finite() && *v >= 0.0 && *v <= 1.0)
        && r[2] > 0.01 && r[3] > 0.01 && r[0] + r[2] <= 1.000001 && r[1] + r[3] <= 1.000001
}

// Keep the M-map title and back button, including possible top padding, so
// tracking can reject the full-screen map without decoding a full frame.
pub fn crop_bounds(w: u32, h: u32, mini: Option<[f64; 4]>) -> (u32, u32, u32, u32) {
    let Some(r) = mini else { return (0, 0, w, h) };
    let x = (r[0].min(65.0 / 1920.0) * w as f64).floor() as u32;
    let y = (r[1].min(25.0 / 1080.0) * h as f64).floor() as u32;
    let right = ((r[0] + r[2]).max(203.0 / 1920.0) * w as f64).ceil() as u32;
    let bottom = ((r[1] + r[3]).max(145.0 / 1080.0) * h as f64).ceil() as u32;
    (x, y, right.min(w) - x, bottom.min(h) - y)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_tracking_crops_to_a_small_region() {
        let (x, y, w, h) = crop_bounds(1920, 1080, Some([0.0427, 0.0389, 0.1042, 0.1852]));
        assert!(x <= 65 && y <= 25 && x + w >= 282 && y + h >= 242);
        assert!(w * h < 1920 * 1080 / 30);
        assert_eq!(crop_bounds(1920, 1080, None), (0, 0, 1920, 1080));
    }
    #[test]
    fn custom_minimap_still_contains_map_header() {
        let (x, y, w, h) = crop_bounds(1920, 1080, Some([0.75, 0.03, 0.2, 0.2]));
        assert!(x <= 65 && y <= 25 && x + w >= 1824 && y + h >= 249);
    }
    #[test]
    fn invalid_regions_are_rejected() {
        assert!(valid_region([0.04, 0.03, 0.11, 0.19]));
        for r in [[f64::NAN, 0.0, 0.1, 0.1], [0.9, 0.0, 0.2, 0.1], [0.0, 0.0, 0.0, 0.5]] {
            assert!(!valid_region(r));
        }
    }
}
