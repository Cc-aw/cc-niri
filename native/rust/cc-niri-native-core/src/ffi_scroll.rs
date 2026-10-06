// SPDX-License-Identifier: GPL-2.0-or-later
use super::protocol_views::{slice, text, ByteView, FfiIdResult, FfiRect, FfiTextResult, U16View};
use super::{FfiSpringBoolResult, INVALID_HANDLE, OK};
use crate::native_protocol::{
    Placement, Rect, RuntimeContext, ScrollEntry, ScrollPlan, WindowId, WindowRole,
};
use crate::scroll_runtime::ScrollViewportRuntime;
use std::collections::HashMap;
const INVALID_DTO: u32 = 2;
#[repr(C)]
pub struct FfiContext {
    pub(super) protocol: f64,
    pub(super) generation: f64,
    pub(super) session: U16View,
    pub(super) workspace: U16View,
    pub(super) output: U16View,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiEntry {
    window_id: u64,
    column_id: f64,
    logical_x: f64,
    pixel_width: f64,
    old_placement: u32,
    new_placement: u32,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiWindowFrame {
    window_id: u64,
    rect: FfiRect,
}
#[repr(C)]
pub struct FfiPlan {
    protocol: f64,
    epoch: f64,
    issued_at: f64,
    old_offset: f64,
    new_offset: f64,
    kind: U16View,
    session: U16View,
    workspace: U16View,
    output: U16View,
    viewport: FfiRect,
    entries: *const FfiEntry,
    entries_len: u64,
    fingerprint: ByteView,
    shape_valid: u32,
    retarget_only: u32,
}
#[repr(C)]
pub struct FfiScrollStatus {
    epoch: i64,
    active: u32,
    completed: u32,
    status: u32,
    reserved: u32,
}

#[repr(C)]
pub struct FfiProjection {
    viewport: FfiRect,
    translation_x: f64,
    active: u32,
    status: u32,
}

/// Unique owned state; no concurrent mutation or aliasing with borrowed output.
pub struct ScrollHandle(ScrollViewportRuntime);
// SAFETY contract for all exported entries: slices are aligned live buffers of
// the stated size for the call; non-null handles are live library allocations.
fn bool_result(value: Result<bool, u32>) -> FfiSpringBoolResult {
    match value {
        Ok(value) => FfiSpringBoolResult {
            value: u32::from(value),
            status: OK,
        },
        Err(status) => FfiSpringBoolResult { value: 0, status },
    }
}
fn placement(value: u32) -> Placement {
    match value {
        1 => Placement::Visible,
        2 => Placement::Parked,
        _ => Placement::Invalid,
    }
}
#[no_mangle]
pub extern "C" fn cc_niri_scroll_create(fuzzy_zero: u32) -> *mut ScrollHandle {
    Box::into_raw(Box::new(ScrollHandle(ScrollViewportRuntime::new(
        fuzzy_zero != 0,
    ))))
}
/// # Safety
/// Handle must be live and shared-borrowed for this call; null is supported.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_clone(handle: *const ScrollHandle) -> *mut ScrollHandle {
    match unsafe { handle.as_ref() } {
        Some(h) => Box::into_raw(Box::new(ScrollHandle(h.0.clone()))),
        None => std::ptr::null_mut(),
    }
}
/// # Safety
/// Transfer each uniquely-owned handle once, after all borrows end.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_destroy(handle: *mut ScrollHandle) {
    if !handle.is_null() {
        unsafe {
            drop(Box::from_raw(handle));
        }
    }
}
/// # Safety
/// Live handles, exclusive destination borrow; self-copy supported.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_copy(
    destination: *mut ScrollHandle,
    source: *const ScrollHandle,
) -> u32 {
    if destination.is_null() || source.is_null() {
        return INVALID_HANDLE;
    }
    if !std::ptr::eq(destination, source) {
        unsafe {
            (*destination).0 = (*source).0.clone();
        }
    }
    OK
}
/// # Safety
/// Live exclusively-borrowed handle and valid borrowed UTF-16 input.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_intern(
    handle: *mut ScrollHandle,
    name: U16View,
) -> FfiIdResult {
    let result = (|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let name = unsafe { text(name)? };
        Ok::<_, u32>(h.0.intern(name).0)
    })();
    match result {
        Ok(value) => FfiIdResult {
            value,
            status: OK,
            reserved: 0,
        },
        Err(status) => FfiIdResult {
            value: 0,
            status,
            reserved: 0,
        },
    }
}
/// # Safety
/// Live exclusively-borrowed handle, context and all nested buffers for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_update_context(
    handle: *mut ScrollHandle,
    context: *const FfiContext,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let c = unsafe { context.as_ref() }.ok_or(INVALID_DTO)?;
        let c = RuntimeContext {
            protocol: c.protocol,
            generation: c.generation,
            session: unsafe { text(c.session)? },
            workspace: unsafe { text(c.workspace)? },
            output: unsafe { text(c.output)? },
        };
        Ok(h.0.update_context(c))
    })())
}
pub(super) unsafe fn decode_plan(p: &FfiPlan) -> Result<ScrollPlan, u32> {
    let entries = unsafe { slice(p.entries, p.entries_len)? }
        .iter()
        .map(|e| ScrollEntry {
            window_id: WindowId(e.window_id),
            column_id: e.column_id,
            logical_x: e.logical_x,
            pixel_width: e.pixel_width,
            old_placement: placement(e.old_placement),
            new_placement: placement(e.new_placement),
        })
        .collect();
    let plan = ScrollPlan {
        shape_valid: p.shape_valid != 0,
        protocol: p.protocol,
        kind: unsafe { text(p.kind)? },
        session: unsafe { text(p.session)? },
        workspace: unsafe { text(p.workspace)? },
        output: unsafe { text(p.output)? },
        epoch: p.epoch,
        issued_at: p.issued_at,
        old_offset: p.old_offset,
        new_offset: p.new_offset,
        retarget_only: p.retarget_only,
        viewport: p.viewport.into(),
        entries,
        fingerprint: unsafe { slice(p.fingerprint.data, p.fingerprint.len)? }.to_vec(),
    };
    Ok(plan)
}
/// # Safety
/// Live exclusively-borrowed handle, plan, entries, frames and nested buffers.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_arm(
    handle: *mut ScrollHandle,
    plan: *const FfiPlan,
    now: i64,
    frames: *const FfiWindowFrame,
    frames_len: u64,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let p = unsafe { plan.as_ref() }.ok_or(INVALID_DTO)?;
        let p = unsafe { decode_plan(p)? };
        let frames: HashMap<_, _> = unsafe { slice(frames, frames_len)? }
            .iter()
            .map(|f| (WindowId(f.window_id), f.rect.into()))
            .collect();
        Ok(h.0.arm(p, now, &frames))
    })())
}
/// # Safety
/// Live exclusively-borrowed handle and borrowed UTF-16 input.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_cancel(
    handle: *mut ScrollHandle,
    session: U16View,
    epoch: i64,
) -> u32 {
    let result = (|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        h.0.cancel(&unsafe { text(session)? }, epoch);
        Ok::<_, u32>(())
    })();
    result.err().unwrap_or(OK)
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_clear(handle: *mut ScrollHandle) -> u32 {
    match unsafe { handle.as_mut() } {
        Some(h) => {
            h.0.clear();
            OK
        }
        None => INVALID_HANDLE,
    }
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_remove(handle: *mut ScrollHandle, id: u64) -> u32 {
    match unsafe { handle.as_mut() } {
        Some(h) => {
            h.0.remove(WindowId(id));
            OK
        }
        None => INVALID_HANDLE,
    }
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_advance(
    handle: *mut ScrollHandle,
    now: i64,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_mut() }
            .map(|h| h.0.advance(now))
            .ok_or(INVALID_HANDLE),
    )
}
/// # Safety
/// Live shared-borrowed handle, no concurrent mutation or destruction.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_status(handle: *const ScrollHandle) -> FfiScrollStatus {
    match unsafe { handle.as_ref() } {
        Some(h) => FfiScrollStatus {
            epoch: h.0.epoch(),
            active: u32::from(h.0.active()),
            completed: u32::from(h.0.completed()),
            status: OK,
            reserved: 0,
        },
        None => FfiScrollStatus {
            epoch: -1,
            active: 0,
            completed: 0,
            status: INVALID_HANDLE,
            reserved: 0,
        },
    }
}
/// # Safety
/// Live shared-borrowed handle; return view valid until the next mutation/destroy.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_context_text(
    handle: *const ScrollHandle,
    field: u32,
) -> FfiTextResult {
    let empty = U16View {
        data: std::ptr::null(),
        len: 0,
    };
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiTextResult {
            value: empty,
            status: INVALID_HANDLE,
            reserved: 0,
        };
    };
    if field > 2 {
        return FfiTextResult {
            value: empty,
            status: INVALID_DTO,
            reserved: 0,
        };
    }
    let value = h.0.context().and_then(|c| c.text(field));
    FfiTextResult {
        value: value
            .map(|t| U16View {
                data: t.0.as_ptr(),
                len: t.0.len() as u64,
            })
            .unwrap_or(empty),
        status: OK,
        reserved: 0,
    }
}
/// # Safety
/// Live shared-borrowed handle, no concurrent mutation or destruction.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_projection(
    handle: *const ScrollHandle,
    id: u64,
    geometry: FfiRect,
) -> FfiProjection {
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiProjection {
            viewport: Rect::default().into(),
            translation_x: 0.0,
            active: 0,
            status: INVALID_HANDLE,
        };
    };
    match h.0.projection(WindowId(id), geometry.into()) {
        Some(p) => FfiProjection {
            viewport: p.viewport.into(),
            translation_x: p.translation_x,
            active: 1,
            status: OK,
        },
        None => FfiProjection {
            viewport: Rect::default().into(),
            translation_x: 0.0,
            active: 0,
            status: OK,
        },
    }
}
/// # Safety
/// Live shared-borrowed handle, no concurrent mutation or destruction.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_role(
    handle: *const ScrollHandle,
    id: u64,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_ref() } {
        Some(h) => FfiSpringBoolResult {
            value: match h.0.role(WindowId(id)) {
                None => 0,
                Some(WindowRole::Continuing) => 1,
                Some(WindowRole::Incoming) => 2,
                Some(WindowRole::Outgoing) => 3,
            },
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Live shared-borrowed handle; out points to capacity writable initialized DTOs.
/// No mutation between the count query and fill call. Null/zero queries the count.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_frames(
    handle: *const ScrollHandle,
    kind: u32,
    out: *mut FfiWindowFrame,
    capacity: u64,
) -> FfiIdResult {
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiIdResult {
            value: 0,
            status: INVALID_HANDLE,
            reserved: 0,
        };
    };
    let map = match kind {
        0 => h.0.targets(),
        1 => h.0.source_frames(),
        _ => {
            return FfiIdResult {
                value: 0,
                status: INVALID_DTO,
                reserved: 0,
            }
        }
    };
    let count = map.len() as u64;
    if capacity == 0 {
        return FfiIdResult {
            value: count,
            status: OK,
            reserved: 0,
        };
    }
    if out.is_null() || capacity < count {
        return FfiIdResult {
            value: count,
            status: INVALID_DTO,
            reserved: 0,
        };
    }
    for (index, (id, rect)) in map.iter().enumerate() {
        unsafe {
            out.add(index).write(FfiWindowFrame {
                window_id: id.0,
                rect: (*rect).into(),
            });
        }
    }
    FfiIdResult {
        value: count,
        status: OK,
        reserved: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_protocol::Text;
    #[test]
    fn ffi_null_buffers_ownership_and_counts() {
        // SAFETY: Explicitly supported nulls and owned handles; valid DTO buffers.
        unsafe {
            let null = std::ptr::null_mut();
            let empty = U16View {
                data: std::ptr::null(),
                len: 0,
            };
            assert!(cc_niri_scroll_clone(null).is_null());
            cc_niri_scroll_destroy(null);
            assert_eq!(cc_niri_scroll_copy(null, null), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_intern(null, empty).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_update_context(null, std::ptr::null()).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_scroll_arm(null, std::ptr::null(), 0, std::ptr::null(), 0).status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_scroll_cancel(null, empty, 0), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_clear(null), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_remove(null, 0), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_advance(null, 0).status, INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_status(null).status, INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_context_text(null, 0).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_projection(null, 0, Rect::default().into()).status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_scroll_role(null, 0).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_frames(null, 0, std::ptr::null_mut(), 0).status,
                INVALID_HANDLE
            );
            let h = cc_niri_scroll_create(1);
            assert_eq!(
                cc_niri_scroll_intern(
                    h,
                    U16View {
                        data: std::ptr::null(),
                        len: 1
                    }
                )
                .status,
                INVALID_DTO
            );
            assert_eq!(
                cc_niri_scroll_update_context(h, std::ptr::null()).status,
                INVALID_DTO
            );
            assert_eq!(
                cc_niri_scroll_arm(h, std::ptr::null(), 0, std::ptr::null(), 0).status,
                INVALID_DTO
            );
            assert_eq!(cc_niri_scroll_context_text(h, 3).status, INVALID_DTO);
            assert_eq!(
                cc_niri_scroll_frames(h, 2, std::ptr::null_mut(), 0).status,
                INVALID_DTO
            );
            let label = Text::from_utf8("window");
            let name = U16View {
                data: label.0.as_ptr(),
                len: label.0.len() as u64,
            };
            let token = cc_niri_scroll_intern(h, name).value;
            let t = Text::from_utf8("s");
            (*h).0.update_context(RuntimeContext {
                protocol: 2.0,
                generation: 1.0,
                session: t.clone(),
                workspace: t.clone(),
                output: t.clone(),
            });
            (*h).0.arm(
                ScrollPlan {
                    shape_valid: true,
                    protocol: 2.0,
                    kind: Text::from_utf8("SCROLL"),
                    session: t.clone(),
                    workspace: t.clone(),
                    output: t,
                    epoch: 0.0,
                    issued_at: 0.0,
                    old_offset: 0.0,
                    new_offset: 100.0,
                    retarget_only: 0,
                    viewport: Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 100.0,
                    },
                    fingerprint: vec![1],
                    entries: vec![ScrollEntry {
                        window_id: WindowId(token),
                        column_id: 0.0,
                        logical_x: 0.0,
                        pixel_width: 100.0,
                        old_placement: Placement::Visible,
                        new_placement: Placement::Parked,
                    }],
                },
                0,
                &HashMap::new(),
            );
            assert_eq!(
                cc_niri_scroll_frames(h, 0, std::ptr::null_mut(), 0).value,
                1
            );
            assert_eq!(
                cc_niri_scroll_frames(h, 0, std::ptr::null_mut(), 1).status,
                INVALID_DTO
            );
            let mut output = FfiWindowFrame {
                window_id: 0,
                rect: Rect::default().into(),
            };
            assert_eq!(cc_niri_scroll_frames(h, 0, &mut output, 1).status, OK);
            assert_eq!(output.window_id, token);
            let allocations = crate::allocation_checks::count(|| {
                for frame in 0..1000 {
                    std::hint::black_box(cc_niri_scroll_advance(h, frame * 1_000_000));
                    std::hint::black_box(cc_niri_scroll_projection(h, token, output.rect));
                    std::hint::black_box(cc_niri_scroll_status(h));
                    std::hint::black_box(cc_niri_scroll_role(h, token));
                    std::hint::black_box(cc_niri_scroll_context_text(h, 0));
                    std::hint::black_box(cc_niri_scroll_frames(h, 0, &mut output, 1));
                }
            });
            assert_eq!(allocations, 0);
            let clone = cc_niri_scroll_clone(h);
            assert_ne!(h, clone);
            cc_niri_scroll_remove(clone, token);
            assert!((*h).0.label(WindowId(token)).is_some());
            assert_eq!(cc_niri_scroll_copy(h, clone), OK);
            assert_eq!(cc_niri_scroll_copy(h, h), OK);
            cc_niri_scroll_destroy(clone);
            assert!((*h).0.label(WindowId(token)).is_none());
            assert_eq!(
                cc_niri_scroll_frames(h, 0, std::ptr::null_mut(), 0).value,
                0
            );
            cc_niri_scroll_destroy(h);
        }
    }
}
