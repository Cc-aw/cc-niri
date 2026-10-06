// SPDX-License-Identifier: GPL-2.0-or-later
//! Numeric paint snapshots and geometry. No focus authority, clock or platform objects.
use crate::native_protocol::Rect;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Corners {
    pub configured: f64,
    pub rounded: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Radius {
    pub values: [f64; 4],
    pub source: u32,
    pub status: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Frame {
    pub inner: Rect,
    pub thickness: f64,
    pub radii: [f64; 4],
    pub item_opacity: f64,
    pub effect_opacity: f64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    pub frame: Frame,
    pub device_scale: f64,
    pub matrix: [f64; 16],
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Metrics {
    pub scale_x: f64,
    pub scale_y: f64,
    pub device_scale: f64,
    pub thickness: f64,
    pub width: f64,
    pub height: f64,
    pub radii: [f64; 8],
    pub border_thickness: f64,
    pub compensated: u32,
    pub reserved: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Patch {
    pub rect: Rect,
    pub geometry: Rect,
    pub translate_x: f64,
    pub translate_y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub texture_width: u32,
    pub texture_height: u32,
    pub visible: u32,
    pub reserved: u32,
}

// Preserve std::min/max ordering, including NaN and signed zero. Rust f64::min
// intentionally has different NaN semantics from the C++ reference.
fn min(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}
fn max(a: f64, b: f64) -> f64 {
    if a < b {
        b
    } else {
        a
    }
}
pub fn corners(configured: f64, rounded: f64, loaded: bool) -> Corners {
    Corners {
        configured: if configured.is_finite() && configured >= 0.0 {
            min(configured, 128.0)
        } else {
            -1.0
        },
        rounded: if loaded && rounded.is_finite() {
            rounded.clamp(0.0, 128.0)
        } else {
            0.0
        },
    }
}
pub fn radius(c: Corners, native: [f64; 4], w: f64, h: f64) -> Radius {
    let source = if c.configured >= 0.0 {
        2
    } else {
        u32::from(c.rounded > 0.0)
    };
    let values = if c.configured < 0.0 && c.rounded <= 0.0 {
        native
    } else {
        [min(
            if c.configured >= 0.0 {
                c.configured
            } else {
                c.rounded
            },
            max(0.0, min(w, h) / 2.0),
        ); 4]
    };
    Radius {
        values,
        source,
        status: 0,
    }
}
pub fn geometry_valid(w: f64, h: f64, radii: [f64; 4]) -> bool {
    w.is_finite()
        && h.is_finite()
        && w > 0.0
        && h > 0.0
        && radii
            .iter()
            .all(|r| r.is_finite() && *r >= 0.0 && *r <= min(w, h) / 2.0)
}
pub fn capture(frame: Frame) -> Option<Frame> {
    (frame.item_opacity.is_finite()
        && frame.item_opacity > 0.0
        && frame.effect_opacity.is_finite()
        && frame.effect_opacity > 0.0)
        .then_some(frame)
}
pub fn metrics(input: Input) -> Option<Metrics> {
    let f = input.frame;
    let s = input.device_scale;
    if !s.is_finite()
        || s <= 0.0
        || !(f.inner.width > 0.0 && f.inner.height > 0.0)
        || !input.matrix.iter().all(|v| v.is_finite())
    {
        return None;
    }
    let a = input.matrix;
    let mut m = Metrics {
        scale_x: 1.0,
        scale_y: 1.0,
        device_scale: s,
        thickness: 3.0,
        width: f.inner.width,
        height: f.inner.height,
        radii: [-1.0; 8],
        border_thickness: 3.0,
        ..Metrics::default()
    };
    let axis = [1, 4, 2, 6, 8, 9, 12, 13, 14].iter().all(|i| a[*i] == 0.0) && a[15] == 1.0;
    if !axis || a[0] < 0.0 || a[5] < 0.0 {
        return Some(m);
    }
    m.scale_x = a[0];
    m.scale_y = a[5];
    if m.scale_x < 0.0001 || m.scale_y < 0.0001 || m.scale_x > 64.0 || m.scale_y > 64.0 {
        return None;
    }
    m.thickness = (f.thickness * s).round() / s;
    m.width = (f.inner.width * s).round() * m.scale_x / s;
    m.height = (f.inner.height * s).round() * m.scale_y / s;
    for i in 0..4 {
        let r = (f.radii[i] * s).round() / s;
        m.radii[2 * i] = min(r * m.scale_x, m.width / 2.0);
        m.radii[2 * i + 1] = min(r * m.scale_y, m.height / 2.0);
    }
    m.compensated = u32::from(m.scale_x != 1.0 || m.scale_y != 1.0);
    m.border_thickness = if m.compensated == 0 {
        m.thickness
    } else {
        f.thickness
    };
    Some(m)
}
pub fn layout(m: Metrics) -> Option<[Patch; 8]> {
    let (w, h, t, s) = (m.width, m.height, m.thickness, m.device_scale);
    if ![w, h, t].iter().all(|v| v.is_finite() && *v >= 0.0)
        || ![s, m.scale_x, m.scale_y]
            .iter()
            .all(|v| v.is_finite() && *v > 0.0)
        || !m.radii.iter().all(|v| v.is_finite() && *v >= 0.0)
    {
        return None;
    }
    let mut x = [0.0; 4];
    let mut y = [0.0; 4];
    for i in 0..4 {
        x[i] = min((m.radii[2 * i] * s).ceil() / s, w / 2.0);
        y[i] = min((m.radii[2 * i + 1] * s).ceil() / s, h / 2.0);
    }
    let rect = |x, y, width, height| Rect {
        x,
        y,
        width,
        height,
    };
    let rects = [
        rect(-t, -t, x[0] + t, y[0] + t),
        rect(w - x[1], -t, x[1] + t, y[1] + t),
        rect(w - x[2], h - y[2], x[2] + t, y[2] + t),
        rect(-t, h - y[3], x[3] + t, y[3] + t),
        rect(x[0], -t, max(0.0, w - x[0] - x[1]), t),
        rect(w, y[1], t, max(0.0, h - y[1] - y[2])),
        rect(x[3], h, max(0.0, w - x[3] - x[2]), t),
        rect(-t, y[0], t, max(0.0, h - y[0] - y[3])),
    ];
    let mut patches = [Patch::default(); 8];
    for (i, r) in rects.into_iter().enumerate() {
        if ![r.x * s, r.y * s, r.width * s, r.height * s]
            .iter()
            .all(|v| v.is_finite())
            || (i < 4 && ((r.width * s).ceil() > 1024.0 || (r.height * s).ceil() > 1024.0))
        {
            return None;
        }
        let g = rect(
            (r.x * s).round() / s,
            (r.y * s).round() / s,
            max(1.0, (r.width * s).round()) / s,
            max(1.0, (r.height * s).round()) / s,
        );
        patches[i] = Patch {
            rect: r,
            geometry: g,
            translate_x: r.x - g.x,
            translate_y: r.y - g.y,
            scale_x: r.width / g.width,
            scale_y: r.height / g.height,
            texture_width: if i < 4 {
                max(1.0, (r.width * s).ceil()) as u32
            } else {
                0
            },
            texture_height: if i < 4 {
                max(1.0, (r.height * s).ceil()) as u32
            } else {
                0
            },
            visible: u32::from(r.width > 0.0 && r.height > 0.0),
            reserved: 0,
        };
    }
    Some(patches)
}
pub fn damage(r: Rect, m: Metrics) -> Rect {
    let x = if m.compensated != 0 {
        m.thickness / m.scale_x
    } else {
        m.border_thickness
    };
    let y = if m.compensated != 0 {
        m.thickness / m.scale_y
    } else {
        m.border_thickness
    };
    Rect {
        x: r.x - x,
        y: r.y - y,
        width: r.width + x + x,
        height: r.height + y + y,
    }
}
pub fn padding(requested: f64) -> f64 {
    if requested.is_finite() {
        requested.clamp(0.0, 128.0)
    } else {
        0.0
    }
}
pub fn device_padding(requested: f64, scale: f64) -> f64 {
    (padding(requested) * scale).ceil()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> Input {
        Input {
            frame: Frame {
                inner: Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 932.0,
                    height: 701.0,
                },
                thickness: 3.0,
                radii: [12.0; 4],
                item_opacity: 0.5,
                effect_opacity: 0.8,
            },
            device_scale: 1.5,
            matrix: [
                0.713, 0.0, 0.0, -200.0, 0.0, 0.973, 0.0, 5.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
                1.0,
            ],
        }
    }
    #[test]
    fn geometry_corners_and_transparent_frames() {
        assert_eq!(corners(f64::NAN, 900.0, true).rounded, 128.0);
        assert_eq!(
            radius(corners(0.0, 12.0, true), [9.0; 4], 10.0, 10.0).values,
            [0.0; 4]
        );
        assert_eq!(
            radius(corners(-1.0, 12.0, true), [9.0; 4], 10.0, 10.0).values,
            [5.0; 4]
        );
        assert!(geometry_valid(10.0, 10.0, [5.0; 4]));
        assert!(!geometry_valid(10.0, 10.0, [5.001; 4]));
        let mut f = input().frame;
        assert!(capture(f).is_some());
        f.effect_opacity = 0.0;
        assert!(capture(f).is_none());
    }
    #[test]
    fn fixed_device_stroke_and_frozen_retarget_sample() {
        let i = input();
        let f = capture(i.frame).unwrap();
        let m = metrics(i).unwrap();
        let p = layout(m).unwrap();
        assert_eq!(m.thickness * m.device_scale, 5.0);
        assert_eq!(p[4].rect.height, m.thickness);
        assert_eq!(p[5].rect.x, m.width);
        assert_eq!(p[4].rect.x + p[4].rect.width, p[1].rect.x);
        let mut next = i;
        next.frame.inner.width = 1500.0;
        next.matrix[0] = 1.317;
        let _ = metrics(next).unwrap();
        assert_eq!(f.inner.width, 932.0);
        assert_eq!(metrics(i).unwrap().width, m.width);
    }
    #[test]
    fn boundaries_fallback_and_zero_allocation() {
        let mut i = input();
        i.matrix[1] = 0.1;
        assert_eq!(metrics(i).unwrap().compensated, 0);
        i.matrix[1] = 0.0;
        i.matrix[0] = 0.00009;
        assert!(metrics(i).is_none());
        i = input();
        i.matrix[7] = f64::NAN;
        assert!(metrics(i).is_none());
        let mut m = metrics(input()).unwrap();
        m.radii[0] = 2000.0;
        m.width = 5000.0;
        assert!(layout(m).is_none());
        assert_eq!(device_padding(3.0, 1.5), 5.0);
        let count = crate::allocation_checks::count(|| {
            for _ in 0..1000 {
                let m = metrics(input()).unwrap();
                let p = layout(m).unwrap();
                std::hint::black_box((p, damage(input().frame.inner, m), capture(input().frame)));
            }
        });
        assert_eq!(count, 0);
    }
}
