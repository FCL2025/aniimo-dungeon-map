//! Match the completed objective's white strokes against their dark outlines.
//! This deliberately requires positive text evidence; disappearing counters are not completion.
use image::{GrayImage, imageops::{resize, FilterType}};
use serde::Deserialize;

pub const ROI: [u32; 4] = [24, 235, 400, 220];
pub const INTERVAL_MS: u64 = 2000;
// WGC's 2 s delivery can arrive a few milliseconds early. Do not discard it and wait 4 s.
pub const MIN_INTERVAL_MS: u64 = INTERVAL_MS - 100;

#[derive(Deserialize)]
struct TextTemplate { pairs: Vec<[i32; 4]> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reference { heading: TextTemplate, complete: TextTemplate, heading_offset: [i32; 2] }
struct Variant { heading: Vec<[i32; 4]>, complete: Vec<[i32; 4]>, offset: [i32; 2] }
pub struct Detector { variants: Vec<Variant> }

impl Detector {
    pub fn new() -> Self {
        let reference: Reference = serde_json::from_str(include_str!("../../evacuation-template.json")).expect("valid bundled objective template");
        let variants = (0..=12).map(|i| {
            let scale = 0.85 + i as f64 * 0.025;
            let scaled = |points: &Vec<[i32; 4]>| points.iter().map(|p| p.map(|v| (v as f64 * scale).round() as i32)).collect();
            Variant { heading: scaled(&reference.heading.pairs), complete: scaled(&reference.complete.pairs),
                offset: reference.heading_offset.map(|v| (v as f64 * scale).round() as i32) }
        }).collect();
        Self { variants }
    }

    pub fn inspect(&self, crop: &GrayImage) -> bool {
        let normalized = resize(crop, ROI[2], ROI[3], FilterType::Triangle);
        for variant in &self.variants {
            for y in 45..185 {
                for x in 20..110 {
                    // Cheap, distributed anchors eliminate scenery and unrelated text early.
                    let anchors = variant.complete.iter().step_by(9);
                    let count = anchors.clone().count();
                    if anchors.filter(|p| contrast(&normalized, x, y, p)).count() * 100 < count * 62 { continue; }
                    if !matches(&normalized, x, y, &variant.complete, 76) { continue; }
                    if matches(&normalized, x + variant.offset[0], y + variant.offset[1], &variant.heading, 72) { return true; }
                }
            }
        }
        false
    }
}

fn contrast(image: &GrayImage, x: i32, y: i32, p: &[i32; 4]) -> bool {
    let [ax, ay, bx, by] = [x+p[0], y+p[1], x+p[2], y+p[3]];
    if ax < 0 || bx < 0 || ay < 0 || by < 0 || ax >= image.width() as i32 || bx >= image.width() as i32
        || ay >= image.height() as i32 || by >= image.height() as i32 { return false; }
    let light = image.get_pixel(ax as u32, ay as u32)[0] as i32;
    let dark = image.get_pixel(bx as u32, by as u32)[0] as i32;
    light >= 150 && light - dark >= 24
}

fn matches(image: &GrayImage, x: i32, y: i32, points: &[[i32; 4]], threshold: usize) -> bool {
    // Every quarter of the phrase must agree; partial/occluded text cannot finish a round.
    let mut total = 0;
    for group in points.chunks(points.len().div_ceil(4)) {
        let good = group.iter().filter(|p| contrast(image, x, y, p)).count();
        if good * 100 < group.len() * 65 { return false; }
        total += good;
    }
    total * 100 >= points.len() * threshold
}

#[derive(Default)]
pub struct Confirmation { last_match: Option<u64> }
impl Confirmation {
    pub fn observe(&mut self, matched: bool, now: u64) -> bool {
        if !matched { self.last_match = None; return false; }
        let confirmed = self.last_match.is_some_and(|last| (MIN_INTERVAL_MS..=INTERVAL_MS*3).contains(&now.saturating_sub(last)));
        self.last_match = Some(now);
        confirmed
    }
    pub fn reset(&mut self) { self.last_match = None; }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(complete: bool) -> GrayImage {
        let bytes: &[u8] = if complete { include_bytes!("../../../scripts/tests/fixtures/evacuation-complete.jpg") }
            else { include_bytes!("../../../scripts/tests/fixtures/evacuation-incomplete.jpg") };
        image::load_from_memory(bytes).unwrap().into_luma8()
    }
    #[test]
    fn supplied_screenshots_and_missing_hud() {
        let detector = Detector::new();
        assert!(detector.inspect(&fixture(true)), "completed objective");
        assert!(!detector.inspect(&fixture(false)), "coin counter is still incomplete");
        for value in [0, 128, 220, 255] { assert!(!detector.inspect(&GrayImage::from_pixel(400,220,image::Luma([value])))); }
    }
    #[test]
    fn resolution_brightness_and_occlusion() {
        let detector = Detector::new();
        for factor in [2.0/3.0, 1.0, 4.0/3.0, 2.0] {
            for complete in [false, true] {
                let crop = fixture(complete);
                let scaled = resize(&crop, (400.0*factor) as u32, (220.0*factor) as u32, FilterType::Triangle);
                assert_eq!(detector.inspect(&scaled), complete, "resolution factor {factor}");
            }
        }
        let crop = fixture(true);
        let dark = image::imageops::brighten(&crop, -30);
        assert!(detector.inspect(&dark), "dimmed text");
        let mut hidden = crop.clone();
        for y in 105..135 { for x in 150..270 { hidden.put_pixel(x,y,image::Luma([210])); } }
        assert!(!detector.inspect(&hidden), "partially hidden completion phrase");
        let mut no_heading = crop;
        for y in 60..100 { for x in 0..150 { no_heading.put_pixel(x,y,image::Luma([210])); } }
        assert!(!detector.inspect(&no_heading), "heading required");
    }
    #[test]
    fn confirmation_requires_two_fresh_consecutive_samples() {
        let mut state = Confirmation::default();
        assert!(!state.observe(true, 1000));
        assert!(!state.observe(true, 1000));
        assert!(state.observe(true, 3000));
        state.reset();
        assert!(!state.observe(true, 5000));
        assert!(!state.observe(false, 7000));
        assert!(!state.observe(true, 9000));
        assert!(!state.observe(true, 19000));
        assert!(state.observe(true, 21000));
        state.reset();
        assert!(!state.observe(true, 23000));
        assert!(state.observe(true, 24999), "normal capture jitter must not double the confirmation delay");
    }
    #[test]
    fn modest_hud_scaling_and_offset() {
        let detector = Detector::new();
        for scale in [0.9_f64, 0.95, 1.05, 1.1] {
            let scaled = resize(&fixture(true), (400.0*scale) as u32, (220.0*scale) as u32, FilterType::Triangle);
            let mut canvas = GrayImage::from_pixel(400,220,image::Luma([140]));
            image::imageops::overlay(&mut canvas,&scaled,(24.0*scale-24.0).round() as i64,(235.0*scale-235.0).round() as i64);
            assert!(detector.inspect(&canvas), "HUD scale {scale}");
        }
        let mut shifted = GrayImage::from_pixel(400,220,image::Luma([140]));
        image::imageops::overlay(&mut shifted,&fixture(true),7,11);
        assert!(detector.inspect(&shifted));
    }
}
