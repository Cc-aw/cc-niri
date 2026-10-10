// SPDX-License-Identifier: GPL-2.0-or-later
use crate::focus_fade::{FocusFade, Sample};

#[repr(C)]
pub struct GlowSample {
    pub mix: f64,
    pub status: u32,
    pub reserved: u32,
}

/// # Safety
/// A non-null handle remains live during this synchronous shared borrow.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_focus_fade_glow(handle: *const FocusFade) -> GlowSample {
    // SAFETY: Same unique-handle lifetime contract as the opacity query.
    match unsafe { handle.as_ref() } {
        Some(state) => GlowSample {
            mix: state.glow_mix(),
            status: 0,
            reserved: 0,
        },
        None => GlowSample {
            mix: 0.0,
            status: 1,
            reserved: 0,
        },
    }
}

#[no_mangle]
pub extern "C" fn cc_niri_focus_fade_create() -> *mut FocusFade {
    Box::into_raw(Box::new(FocusFade::default()))
}
/// # Safety
/// Each non-null unique handle is destroyed once, after its last use.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_focus_fade_destroy(handle: *mut FocusFade) {
    if !handle.is_null() {
        // SAFETY: Caller transfers the unique live Box allocation.
        drop(unsafe { Box::from_raw(handle) });
    }
}
/// # Safety
/// Non-null handle is live and exclusively borrowed. Target is 0 or 1.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_focus_fade_retarget(
    handle: *mut FocusFade,
    focused: u32,
) -> Sample {
    // SAFETY: Caller guarantees exclusive aligned live state.
    match unsafe { handle.as_mut() } {
        Some(state) if focused <= 1 => state.retarget(focused != 0),
        Some(state) => Sample {
            status: 2,
            ..state.sample()
        },
        None => Sample {
            status: 1,
            ..Sample::default()
        },
    }
}
/// # Safety
/// Non-null handle is live and exclusively borrowed. Timestamp is from the shared compositor pass.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_focus_fade_advance(
    handle: *mut FocusFade,
    presentation_ns: i64,
) -> Sample {
    // SAFETY: Caller guarantees exclusive aligned live state.
    match unsafe { handle.as_mut() } {
        Some(state) => state.advance(presentation_ns),
        None => Sample {
            status: 1,
            ..Sample::default()
        },
    }
}
/// # Safety
/// Non-null handle remains live throughout this synchronous shared borrow.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_focus_fade_sample(handle: *const FocusFade) -> Sample {
    // SAFETY: Caller guarantees aligned live state without concurrent mutation.
    match unsafe { handle.as_ref() } {
        Some(state) => state.sample(),
        None => Sample {
            status: 1,
            ..Sample::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ownership_invalid_inputs_and_no_allocation_in_queries() {
        // SAFETY: Null is supported; the created unique handle stays live and is destroyed once.
        unsafe {
            assert_eq!(cc_niri_focus_fade_sample(std::ptr::null()).status, 1);
            assert_eq!(cc_niri_focus_fade_glow(std::ptr::null()).status, 1);
            assert_eq!(
                cc_niri_focus_fade_retarget(std::ptr::null_mut(), 1).status,
                1
            );
            assert_eq!(
                cc_niri_focus_fade_advance(std::ptr::null_mut(), 0).status,
                1
            );
            cc_niri_focus_fade_destroy(std::ptr::null_mut());
            let handle = cc_niri_focus_fade_create();
            assert_eq!(cc_niri_focus_fade_retarget(handle, 2).status, 2);
            assert_eq!(cc_niri_focus_fade_retarget(handle, 1).active, 1);
            let count = crate::allocation_checks::count(|| {
                for i in 0..1000 {
                    assert_eq!(cc_niri_focus_fade_advance(handle, i * 1_000_000).status, 0);
                    std::hint::black_box(cc_niri_focus_fade_sample(handle));
                    assert_eq!(cc_niri_focus_fade_glow(handle).status, 0);
                }
            });
            assert_eq!(count, 0);
            assert_eq!(cc_niri_focus_fade_sample(handle).opacity, 1.0);
            assert_eq!(cc_niri_focus_fade_glow(handle).mix, 0.0);
            cc_niri_focus_fade_destroy(handle);
        }
    }
}
