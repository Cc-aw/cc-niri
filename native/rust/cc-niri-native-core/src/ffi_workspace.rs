// SPDX-License-Identifier: GPL-2.0-or-later
use super::{FfiSpringBoolResult, INVALID_HANDLE, OK};
use crate::native_protocol::Epoch;
use crate::workspace_clock::{ClockState, WorkspaceClock};
use crate::workspace_motion::{Point, WorkspaceMotion, WorkspaceState};

pub struct WorkspaceHandle(WorkspaceMotion, WorkspaceClock);
#[repr(C)]
pub struct WorkspaceSample {
    point: Point,
    active: u32,
    status: u32,
}
#[repr(C)]
pub struct WorkspaceProjection {
    translation: Point,
    visible: u32,
    status: u32,
}

#[no_mangle]
pub extern "C" fn cc_niri_workspace_create() -> *mut WorkspaceHandle {
    Box::into_raw(Box::new(WorkspaceHandle(
        WorkspaceMotion::default(),
        WorkspaceClock::default(),
    )))
}
/// # Safety
/// Live exclusively borrowed handle. Configuration is allowed only when idle;
/// destruction/reset of the binding drops all accumulated clock lag.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_clock_configure(
    handle: *mut WorkspaceHandle,
    enabled: u32,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_mut() } {
        Some(h) if enabled <= 1 && h.0.state().active == 0 => {
            h.1.configure(enabled != 0);
            FfiSpringBoolResult {
                value: 1,
                status: OK,
            }
        }
        Some(_) => FfiSpringBoolResult {
            value: 0,
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Live exclusively borrowed handle. Maps a control event to this binding's
/// logical domain; pass the result to start/gesture, never mix wall time into it.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_clock_event(
    handle: *mut WorkspaceHandle,
    now: i64,
) -> ClockState {
    match unsafe { handle.as_mut() } {
        Some(h) => h.1.event(now),
        None => ClockState {
            status: INVALID_HANDLE,
            ..ClockState::default()
        },
    }
}
/// # Safety
/// Live exclusively borrowed handle. Caller supplies outer real output passes
/// only, compositor prediction and monotonic fallback (ns), integer milli-Hz.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_clock_frame(
    handle: *mut WorkspaceHandle,
    prediction: i64,
    monotonic: i64,
    refresh_millihz: u32,
) -> ClockState {
    match unsafe { handle.as_mut() } {
        Some(h) => h.1.frame(prediction, monotonic, refresh_millihz),
        None => ClockState {
            status: INVALID_HANDLE,
            ..ClockState::default()
        },
    }
}
/// # Safety
/// Live shared borrowed handle without concurrent mutation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_clock_state(
    handle: *const WorkspaceHandle,
) -> ClockState {
    match unsafe { handle.as_ref() } {
        Some(h) => h.1.state(),
        None => ClockState {
            status: INVALID_HANDLE,
            ..ClockState::default()
        },
    }
}
/// # Safety
/// Non-null handle transfers one live owned allocation, destroyed exactly once.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_destroy(handle: *mut WorkspaceHandle) {
    if !handle.is_null() {
        unsafe {
            drop(Box::from_raw(handle));
        }
    }
}
/// # Safety
/// Non-null handle must be live and exclusively borrowed for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_configure(
    handle: *mut WorkspaceHandle,
    width: u32,
    height: u32,
    wrap: u32,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_mut() } {
        Some(h) => FfiSpringBoolResult {
            value: u32::from(wrap <= 1 && h.0.configure(width, height, wrap != 0).is_ok()),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Non-null handle must be live and exclusively borrowed for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_start(
    handle: *mut WorkspaceHandle,
    from: Point,
    target: Point,
    epoch: i64,
    now: i64,
    duration: i64,
) -> FfiSpringBoolResult {
    unsafe { cc_niri_workspace_start_with_policy(handle, from, target, epoch, now, duration, 0) }
}
/// # Safety
/// Non-null handle must be live and exclusively borrowed for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_start_with_policy(
    handle: *mut WorkspaceHandle,
    from: Point,
    target: Point,
    epoch: i64,
    now: i64,
    duration: i64,
    smooth: u32,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_mut() } {
        Some(_) if smooth > 1 => FfiSpringBoolResult {
            value: 0,
            status: 2,
        },
        Some(h) => FfiSpringBoolResult {
            value: u32::from(
                h.0.start_with_policy(from, target, Epoch(epoch), now, duration, smooth != 0)
                    .is_ok(),
            ),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Non-null handle must be live and exclusively borrowed for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_mark_painted(
    handle: *mut WorkspaceHandle,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_mut() } {
        Some(h) => FfiSpringBoolResult {
            value: u32::from(h.0.mark_painted()),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Non-null handle must be live and shared-borrowed without concurrent mutation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_state(handle: *const WorkspaceHandle) -> WorkspaceState {
    match unsafe { handle.as_ref() } {
        Some(h) => h.0.state(),
        None => WorkspaceState {
            status: INVALID_HANDLE,
            ..WorkspaceState::default()
        },
    }
}
/// # Safety
/// Non-null handle must be live and exclusively borrowed for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_gesture(
    handle: *mut WorkspaceHandle,
    point: Point,
    epoch: i64,
    now: i64,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_mut() } {
        Some(h) => FfiSpringBoolResult {
            value: u32::from(h.0.gesture(point, Epoch(epoch), now).is_ok()),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Non-null handle must be live and exclusively borrowed for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_advance(
    handle: *mut WorkspaceHandle,
    now: i64,
) -> WorkspaceSample {
    match unsafe { handle.as_mut() } {
        Some(h) => {
            let (point, active) = h.0.advance(now);
            WorkspaceSample {
                point,
                active: u32::from(active),
                status: OK,
            }
        }
        None => WorkspaceSample {
            point: Point::default(),
            active: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Non-null handle must be live and shared-borrowed without concurrent mutation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_workspace_projection(
    handle: *const WorkspaceHandle,
    desktop: Point,
    width: f64,
    height: f64,
    gap_x: f64,
    gap_y: f64,
) -> WorkspaceProjection {
    match unsafe { handle.as_ref() } {
        Some(h) => {
            let value = h.0.project(desktop, width, height, gap_x, gap_y);
            WorkspaceProjection {
                translation: value.unwrap_or_default(),
                visible: u32::from(value.is_some()),
                status: OK,
            }
        }
        None => WorkspaceProjection {
            translation: Point::default(),
            visible: 0,
            status: INVALID_HANDLE,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clock_ffi_null_idle_configure_and_frame_queries_allocate_nothing() {
        assert_eq!(std::mem::size_of::<ClockState>(), 64);
        unsafe {
            let null = std::ptr::null_mut();
            assert_eq!(
                cc_niri_workspace_clock_configure(null, 1).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_clock_event(null, 0).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_clock_frame(null, 1, 0, 60_000).status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_workspace_clock_state(null).status, INVALID_HANDLE);
            let h = cc_niri_workspace_create();
            assert_eq!(cc_niri_workspace_clock_configure(h, 2).value, 0);
            assert_eq!(cc_niri_workspace_clock_state(h).enabled, 0);
            assert_eq!(cc_niri_workspace_clock_configure(h, 1).value, 1);
            let start = cc_niri_workspace_clock_event(h, 0).logical_ns;
            assert_eq!(
                cc_niri_workspace_start_with_policy(
                    h,
                    Point::default(),
                    Point { x: 0.0, y: 1.0 },
                    1,
                    start,
                    420_000_000,
                    1
                )
                .value,
                1
            );
            assert_eq!(cc_niri_workspace_clock_configure(h, 0).value, 0);
            assert_eq!(cc_niri_workspace_clock_state(h).enabled, 1);
            assert_eq!(
                crate::allocation_checks::count(|| {
                    for n in 1..1001 {
                        let real = n * 16_666_667;
                        let c = cc_niri_workspace_clock_frame(h, real, real - 1, 60_000);
                        cc_niri_workspace_advance(h, c.logical_ns);
                        cc_niri_workspace_mark_painted(h);
                        cc_niri_workspace_clock_state(h);
                        cc_niri_workspace_clock_event(h, real);
                    }
                }),
                0
            );
            assert_eq!(cc_niri_workspace_clock_configure(h, 0).value, 1);
            assert_eq!(cc_niri_workspace_clock_state(h).lag_ns, 0);
            cc_niri_workspace_destroy(h);
        }
    }
    #[test]
    fn ffi_ownership_null_and_zero_allocation_contract() {
        assert_eq!(std::mem::size_of::<Point>(), 16);
        assert_eq!(std::mem::size_of::<WorkspaceSample>(), 24);
        assert_eq!(std::mem::size_of::<WorkspaceProjection>(), 24);
        assert_eq!(std::mem::size_of::<WorkspaceState>(), 280);
        unsafe {
            assert_eq!(
                cc_niri_workspace_state(std::ptr::null()).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_mark_painted(std::ptr::null_mut()).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_start_with_policy(
                    std::ptr::null_mut(),
                    Point::default(),
                    Point::default(),
                    1,
                    0,
                    420_000_000,
                    1
                )
                .status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_advance(std::ptr::null_mut(), 0).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_projection(
                    std::ptr::null(),
                    Point::default(),
                    1.0,
                    1.0,
                    0.0,
                    0.0
                )
                .status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_start(
                    std::ptr::null_mut(),
                    Point::default(),
                    Point::default(),
                    1,
                    0,
                    1
                )
                .status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_workspace_gesture(std::ptr::null_mut(), Point::default(), 1, 0).status,
                INVALID_HANDLE
            );
            cc_niri_workspace_destroy(std::ptr::null_mut());
            assert_eq!(
                cc_niri_workspace_configure(std::ptr::null_mut(), 1, 2, 0).status,
                INVALID_HANDLE
            );
            let handle = cc_niri_workspace_create();
            assert_eq!(
                cc_niri_workspace_start_with_policy(
                    handle,
                    Point::default(),
                    Point::default(),
                    1,
                    0,
                    420_000_000,
                    2
                )
                .status,
                2
            );
            assert_eq!(cc_niri_workspace_configure(handle, 0, 2, 0).value, 0);
            assert_eq!(cc_niri_workspace_configure(handle, 1, 2, 2).value, 0);
            assert_eq!(cc_niri_workspace_configure(handle, 1, 2, 0).value, 1);
            assert_eq!(
                crate::allocation_checks::count(|| {
                    for i in 1..1001 {
                        assert_eq!(
                            cc_niri_workspace_start(
                                handle,
                                Point::default(),
                                Point { x: 0.0, y: 1.0 },
                                i,
                                i * 500_000_000,
                                420_000_000
                            )
                            .value,
                            1
                        );
                        assert_eq!(
                            cc_niri_workspace_advance(handle, i * 500_000_000 + 210_000_000).active,
                            1
                        );
                        assert_eq!(cc_niri_workspace_mark_painted(handle).value, 1);
                        cc_niri_workspace_state(handle);
                        assert_eq!(
                            cc_niri_workspace_projection(
                                handle,
                                Point { x: 0.0, y: 1.0 },
                                2560.0,
                                1440.0,
                                45.0,
                                20.0
                            )
                            .visible,
                            1
                        );
                        assert_eq!(
                            cc_niri_workspace_advance(handle, i * 500_000_000 + 420_000_000).active,
                            0
                        );
                    }
                }),
                0
            );
            cc_niri_workspace_destroy(handle);
        }
    }
}
