//! The "overdue steps" red dot composited into a coloured tray icon (Windows, and any platform
//! whose tray icon is not a template image). Pure, so every platform compiles and tests it.
//!
//! The dot sits in the icon's top-right corner: a red disc inside a thin white ring (contrast on a
//! red or dark icon), both sized from the icon's shorter side so the dot keeps its proportions when
//! the shell scales the icon down to tray size. Edges are anti-aliased by sub-pixel sampling.

/// Dot fill (the system red of Apple's palette, #FF3B30).
const RED: [u8; 3] = [0xFF, 0x3B, 0x30];
/// Ring around the dot.
const RING: [u8; 3] = [0xFF, 0xFF, 0xFF];
/// Dot diameter, ring included, as a share of the icon's shorter side.
const DOT_RATIO: f64 = 0.42;
/// Ring width as a share of the icon's shorter side (at least one pixel).
const RING_RATIO: f64 = 1.0 / 16.0;
/// Sub-pixel samples per axis for anti-aliased edges.
const SAMPLES: u32 = 4;

/// A copy of `rgba` (`width` × `height`, 4 bytes per pixel, straight alpha) with the red dot drawn
/// over its top-right corner. A buffer whose length does not match the size comes back unchanged.
pub fn with_dot(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 || rgba.len() != w * h * 4 {
        return out;
    }
    let side = f64::from(width.min(height));
    let diameter = (side * DOT_RATIO).clamp(1.0, side);
    let outer = diameter / 2.0;
    let inner = (outer - (side * RING_RATIO).max(1.0)).max(0.0);
    let (cx, cy) = (f64::from(width) - outer, outer);

    let x0 = (f64::from(width) - diameter).floor().max(0.0) as usize;
    let y1 = (diameter.ceil() as usize).min(h);
    let n = f64::from(SAMPLES * SAMPLES);
    for y in 0..y1 {
        for x in x0..w {
            let (mut red, mut white) = (0u32, 0u32);
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let px = x as f64 + (f64::from(sx) + 0.5) / f64::from(SAMPLES);
                    let py = y as f64 + (f64::from(sy) + 0.5) / f64::from(SAMPLES);
                    let dist = (px - cx).hypot(py - cy);
                    if dist <= inner {
                        red += 1;
                    } else if dist <= outer {
                        white += 1;
                    }
                }
            }
            if red + white == 0 {
                continue;
            }
            let covered = f64::from(red + white);
            let src_a = covered / n;
            let src = |i: usize| {
                (f64::from(RED[i]) * f64::from(red) + f64::from(RING[i]) * f64::from(white))
                    / covered
            };
            let p = (y * w + x) * 4;
            let dst_a = f64::from(out[p + 3]) / 255.0;
            let out_a = src_a + dst_a * (1.0 - src_a);
            for i in 0..3 {
                let dst = f64::from(out[p + i]);
                let c = (src(i) * src_a + dst * dst_a * (1.0 - src_a)) / out_a;
                out[p + i] = c.round().clamp(0.0, 255.0) as u8;
            }
            out[p + 3] = (out_a * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(buf: &[u8], w: u32, x: u32, y: u32) -> [u8; 4] {
        let p = ((y * w + x) * 4) as usize;
        [buf[p], buf[p + 1], buf[p + 2], buf[p + 3]]
    }

    fn solid(w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
        rgba.repeat((w * h) as usize)
    }

    #[test]
    fn dot_is_red_inside_a_white_ring_at_the_top_right() {
        // 32 px (the Windows tray source size): diameter 13.44, ring 2 px, centre (25.28, 6.72).
        let icon = solid(32, 32, [0, 0, 0, 0]);
        let out = with_dot(&icon, 32, 32);
        assert_eq!(out.len(), icon.len());
        assert_eq!(
            px(&out, 32, 25, 6),
            [0xFF, 0x3B, 0x30, 255],
            "centre is red"
        );
        assert_eq!(
            px(&out, 32, 25, 0),
            [255, 255, 255, 255],
            "top of the ring is white"
        );
        assert_eq!(
            px(&out, 32, 31, 6),
            [255, 255, 255, 255],
            "right of the ring is white"
        );
    }

    #[test]
    fn the_rest_of_the_icon_is_untouched() {
        let icon = solid(32, 32, [10, 20, 30, 200]);
        let out = with_dot(&icon, 32, 32);
        for (x, y) in [(0, 0), (0, 31), (31, 31), (15, 15), (17, 0), (31, 14)] {
            assert_eq!(px(&out, 32, x, y), [10, 20, 30, 200], "({x}, {y})");
        }
    }

    #[test]
    fn edges_are_anti_aliased_over_transparency() {
        let out = with_dot(&solid(32, 32, [0, 0, 0, 0]), 32, 32);
        let partial = (0..32u32)
            .flat_map(|y| (0..32u32).map(move |x| (x, y)))
            .map(|(x, y)| px(&out, 32, x, y)[3])
            .filter(|a| *a > 0 && *a < 255)
            .count();
        assert!(partial > 0, "the rim blends instead of stair-stepping");
    }

    #[test]
    fn dot_over_an_opaque_icon_stays_opaque() {
        let out = with_dot(&solid(16, 16, [0, 0, 255, 255]), 16, 16);
        assert!(out.chunks(4).all(|p| p[3] == 255));
        // 16 px: diameter 6.72, ring 1 px, centre (12.64, 3.36).
        assert_eq!(px(&out, 16, 12, 3), [0xFF, 0x3B, 0x30, 255]);
        assert_eq!(px(&out, 16, 0, 15), [0, 0, 255, 255]);
    }

    #[test]
    fn wide_icons_use_the_shorter_side() {
        let out = with_dot(&solid(40, 20, [0, 0, 0, 0]), 40, 20);
        // Diameter 8.4 from the 20 px height, hugging the right edge.
        assert_eq!(px(&out, 40, 35, 4)[..3], RED);
        assert_eq!(px(&out, 40, 20, 4)[3], 0);
    }

    #[test]
    fn bad_input_comes_back_unchanged() {
        assert_eq!(with_dot(&[1, 2, 3], 1, 1), vec![1, 2, 3]);
        assert!(with_dot(&[], 0, 0).is_empty());
        // A single pixel still gets a (tiny) dot without panicking.
        assert_eq!(with_dot(&[0, 0, 0, 0], 1, 1).len(), 4);
    }
}
