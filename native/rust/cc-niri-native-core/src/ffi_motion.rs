// SPDX-License-Identifier: GPL-2.0-or-later
use super::{FfiSpringBoolResult, FfiSpringParams, INVALID_HANDLE, OK};
use crate::spring::SpringParams;
use crate::viewport_motion::{MotionKind, ViewportMotion};

/// Unique mutable state; clones own independent allocations.
pub struct MotionHandle(ViewportMotion);
#[repr(C)]
pub struct FfiMotionSample {
    current: f64,
    target: f64,
    velocity: f64,
    epoch: i64,
    kind: u32,
    status: u32,
}

#[no_mangle]
pub extern "C" fn cc_niri_motion_create(params: FfiSpringParams) -> *mut MotionHandle {
    Box::into_raw(Box::new(MotionHandle(ViewportMotion::new(SpringParams {
        damping_ratio: params.damping_ratio,
        stiffness: params.stiffness,
        epsilon: params.epsilon,
        mass: params.mass,
    }))))
}
/// # Safety
/// Non-null handle must be live and not concurrently mutated.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_clone(handle: *const MotionHandle) -> *mut MotionHandle {
    // SAFETY: Caller guarantees shared access to live state for this call.
    match unsafe { handle.as_ref() } {
        Some(handle) => Box::into_raw(Box::new(MotionHandle(handle.0.clone()))),
        None => std::ptr::null_mut(),
    }
}
/// # Safety
/// Destroy each owned handle once, after all borrows end; null is supported.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_destroy(handle: *mut MotionHandle) {
    if !handle.is_null() {
        // SAFETY: Caller transfers unique ownership of the Box allocation.
        unsafe {
            drop(Box::from_raw(handle));
        }
    }
}
/// # Safety
/// Both handles must be live, destination uniquely borrowed; self-copy is allowed.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_copy(
    destination: *mut MotionHandle,
    source: *const MotionHandle,
) -> u32 {
    if destination.is_null() || source.is_null() {
        return INVALID_HANDLE;
    }
    if std::ptr::eq(destination, source) {
        return OK;
    }
    // SAFETY: Distinct uniquely-owned handles, no overlapping references.
    unsafe {
        (*destination).0 = (*source).0.clone();
    }
    OK
}
fn result(value: Option<bool>) -> FfiSpringBoolResult {
    match value {
        Some(value) => FfiSpringBoolResult {
            value: u32::from(value),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Non-null handle must be live and uniquely borrowed throughout the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_start(
    handle: *mut MotionHandle,
    from: f64,
    target: f64,
    epoch: i64,
    now: i64,
) -> FfiSpringBoolResult {
    // SAFETY: Caller guarantees exclusive access to live state.
    result(unsafe { handle.as_mut() }.map(|h| h.0.start(from, target, epoch, now)))
}
/// # Safety
/// Non-null handle must be live and uniquely borrowed throughout the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_retarget(
    handle: *mut MotionHandle,
    target: f64,
    epoch: i64,
    now: i64,
) -> FfiSpringBoolResult {
    // SAFETY: Caller guarantees exclusive access to live state.
    result(unsafe { handle.as_mut() }.map(|h| h.0.retarget(target, epoch, now)))
}
/// # Safety
/// Non-null handle must be live and uniquely borrowed throughout the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_finish(
    handle: *mut MotionHandle,
    epoch: i64,
    now: i64,
) -> FfiSpringBoolResult {
    // SAFETY: Caller guarantees exclusive access to live state.
    result(unsafe { handle.as_mut() }.map(|h| h.0.finish(epoch, now)))
}
/// # Safety
/// Non-null handle must be live and uniquely borrowed throughout the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_snap(
    handle: *mut MotionHandle,
    offset: f64,
) -> FfiSpringBoolResult {
    // SAFETY: Caller guarantees exclusive access to live state.
    result(unsafe { handle.as_mut() }.map(|h| h.0.snap(offset)))
}
/// # Safety
/// Non-null handle must be live and not concurrently mutated.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_motion_sample(
    handle: *const MotionHandle,
    now: i64,
) -> FfiMotionSample {
    // SAFETY: Caller guarantees shared access to live state for this call.
    match unsafe { handle.as_ref() } {
        Some(handle) => {
            let s = handle.0.sample(now);
            FfiMotionSample {
                current: s.current,
                target: s.target,
                velocity: s.velocity,
                epoch: s.epoch,
                kind: u32::from(s.kind == MotionKind::Animation),
                status: OK,
            }
        }
        None => FfiMotionSample {
            current: 0.0,
            target: 0.0,
            velocity: 0.0,
            epoch: -1,
            kind: 0,
            status: INVALID_HANDLE,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn null_entries_and_unique_clone_lifetime() {
        // SAFETY: Null is explicitly supported by every entry.
        unsafe {
            let null = std::ptr::null_mut();
            assert!(cc_niri_motion_clone(null).is_null());
            cc_niri_motion_destroy(null);
            assert_eq!(cc_niri_motion_copy(null, null), INVALID_HANDLE);
            assert_eq!(
                cc_niri_motion_start(null, 0.0, 10.0, 0, 0).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_motion_retarget(null, 10.0, 0, 0).status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_motion_finish(null, 0, 0).status, INVALID_HANDLE);
            assert_eq!(cc_niri_motion_snap(null, 0.0).status, INVALID_HANDLE);
            assert_eq!(cc_niri_motion_sample(null, 0).status, INVALID_HANDLE);
        }
        let handle = cc_niri_motion_create(FfiSpringParams {
            damping_ratio: 1.0,
            stiffness: 800.0,
            epsilon: 0.0001,
            mass: 1.0,
        });
        // SAFETY: Each handle is uniquely owned and destroyed once; no borrows overlap.
        unsafe {
            assert_eq!(cc_niri_motion_start(handle, 0.0, 100.0, 1, 0).value, 1);
            let clone = cc_niri_motion_clone(handle);
            assert_ne!(handle, clone);
            assert_eq!(cc_niri_motion_snap(clone, 42.0).value, 1);
            assert_eq!(cc_niri_motion_sample(handle, 0).target, 100.0);
            assert_eq!(cc_niri_motion_copy(handle, clone), OK);
            assert_eq!(cc_niri_motion_copy(handle, handle), OK);
            cc_niri_motion_destroy(clone);
            assert_eq!(cc_niri_motion_sample(handle, 0).target, 42.0);
            cc_niri_motion_destroy(handle);
        }
    }
}
