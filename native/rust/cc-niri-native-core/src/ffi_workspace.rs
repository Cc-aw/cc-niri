// SPDX-License-Identifier: GPL-2.0-or-later
use super::{FfiSpringBoolResult, INVALID_HANDLE, OK};
use crate::native_protocol::Epoch;
use crate::workspace_motion::{Point, WorkspaceMotion};

pub struct WorkspaceHandle(WorkspaceMotion);
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
    Box::into_raw(Box::new(WorkspaceHandle(WorkspaceMotion::default())))
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
    match unsafe { handle.as_mut() } {
        Some(h) => FfiSpringBoolResult {
            value: u32::from(h.0.start(from, target, Epoch(epoch), now, duration).is_ok()),
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
    fn ffi_ownership_null_and_zero_allocation_contract() {
        assert_eq!(std::mem::size_of::<Point>(), 16);
        assert_eq!(std::mem::size_of::<WorkspaceSample>(), 24);
        assert_eq!(std::mem::size_of::<WorkspaceProjection>(), 24);
        unsafe {
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
