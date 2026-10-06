// SPDX-License-Identifier: GPL-2.0-or-later
use crate::focus_ring::{self as core, Corners, Frame, Input, Metrics, Patch, Radius};
use crate::native_protocol::Rect;

#[repr(C)]
#[derive(Default)]
pub struct FrameResult {
    frame: Frame,
    valid: u32,
    status: u32,
}
#[repr(C)]
#[derive(Default)]
pub struct MetricsResult {
    value: Metrics,
    valid: u32,
    status: u32,
}
#[repr(C)]
#[derive(Default)]
pub struct Layout {
    patches: [Patch; 8],
    valid: u32,
    status: u32,
}

#[no_mangle]
pub extern "C" fn cc_niri_ring_corners(configured: f64, rounded: f64, loaded: u32) -> Corners {
    core::corners(configured, rounded, loaded != 0)
}
/// # Safety
/// Non-null native must reference four aligned readable f64 values for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_ring_radius(
    c: Corners,
    native: *const [f64; 4],
    w: f64,
    h: f64,
) -> Radius {
    // SAFETY: Caller supplies the documented borrowed array.
    match unsafe { native.as_ref() } {
        Some(values) => core::radius(c, *values, w, h),
        None => Radius {
            status: 1,
            ..Radius::default()
        },
    }
}
/// # Safety
/// Non-null radii must reference four aligned readable f64 values for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_ring_geometry_valid(
    w: f64,
    h: f64,
    radii: *const [f64; 4],
) -> u32 {
    // SAFETY: Caller supplies the documented borrowed array.
    unsafe { radii.as_ref() }.map_or(0, |r| u32::from(core::geometry_valid(w, h, *r)))
}
/// # Safety
/// Non-null frame must reference an aligned readable Frame for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_ring_capture(frame: *const Frame) -> FrameResult {
    // SAFETY: Caller supplies the documented borrowed DTO.
    let Some(frame) = (unsafe { frame.as_ref() }) else {
        return FrameResult {
            status: 1,
            ..FrameResult::default()
        };
    };
    match core::capture(*frame) {
        Some(frame) => FrameResult {
            frame,
            valid: 1,
            status: 0,
        },
        None => FrameResult::default(),
    }
}
/// # Safety
/// Non-null input must reference an aligned readable Input for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_ring_metrics(input: *const Input) -> MetricsResult {
    // SAFETY: Caller supplies the documented borrowed DTO.
    let Some(input) = (unsafe { input.as_ref() }) else {
        return MetricsResult {
            status: 1,
            ..MetricsResult::default()
        };
    };
    match core::metrics(*input) {
        Some(value) => MetricsResult {
            value,
            valid: 1,
            status: 0,
        },
        None => MetricsResult::default(),
    }
}
/// # Safety
/// Non-null metrics must reference an aligned readable Metrics for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_ring_layout(metrics: *const Metrics) -> Layout {
    // SAFETY: Caller supplies the documented borrowed DTO.
    let Some(metrics) = (unsafe { metrics.as_ref() }) else {
        return Layout {
            status: 1,
            ..Layout::default()
        };
    };
    match core::layout(*metrics) {
        Some(patches) => Layout {
            patches,
            valid: 1,
            status: 0,
        },
        None => Layout::default(),
    }
}
#[no_mangle]
pub extern "C" fn cc_niri_ring_damage(inner: Rect, metrics: Metrics) -> Rect {
    core::damage(inner, metrics)
}
#[no_mangle]
pub extern "C" fn cc_niri_ring_padding(requested: f64) -> f64 {
    core::padding(requested)
}
#[no_mangle]
pub extern "C" fn cc_niri_ring_device_padding(requested: f64, scale: f64) -> f64 {
    core::device_padding(requested, scale)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn null_inputs_and_stack_dto_no_allocation() {
        // SAFETY: Null inputs are explicitly supported and return errors.
        unsafe {
            assert_eq!(cc_niri_ring_capture(std::ptr::null()).status, 1);
            assert_eq!(cc_niri_ring_metrics(std::ptr::null()).status, 1);
            assert_eq!(cc_niri_ring_layout(std::ptr::null()).status, 1);
            assert_eq!(
                cc_niri_ring_radius(Corners::default(), std::ptr::null(), 10.0, 10.0).status,
                1
            );
            assert_eq!(cc_niri_ring_geometry_valid(10.0, 10.0, std::ptr::null()), 0);
        }
        let input = Input {
            frame: Frame {
                inner: Rect {
                    width: 932.0,
                    height: 701.0,
                    ..Rect::default()
                },
                thickness: 3.0,
                radii: [12.0; 4],
                item_opacity: 1.0,
                effect_opacity: 1.0,
            },
            device_scale: 1.5,
            matrix: [
                0.7, 0.0, 0.0, -200.0, 0.0, 0.9, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
        };
        let count = crate::allocation_checks::count(|| {
            for _ in 0..1000 {
                // SAFETY: Fixed stack DTOs stay readable throughout each call.
                unsafe {
                    assert_eq!(cc_niri_ring_capture(&input.frame).valid, 1);
                    let metrics = cc_niri_ring_metrics(&input);
                    assert_eq!(metrics.valid, 1);
                    assert_eq!(cc_niri_ring_layout(&metrics.value).valid, 1);
                    std::hint::black_box(cc_niri_ring_damage(input.frame.inner, metrics.value));
                }
            }
        });
        assert_eq!(count, 0);
    }
}
