// SPDX-License-Identifier: GPL-2.0-or-later
use super::protocol_views::{
    id_result, slice, text, text_result, FfiIdResult, FfiTextResult, U16View,
};
use super::scroll::{decode_plan, FfiContext, FfiPlan};
use super::{FfiSpringBoolResult, INVALID_HANDLE, OK};
use crate::focus_ring_context::{Candidate, EligibilitySnapshot, FocusRingContext};
use crate::native_protocol::{
    NativeError, PlanDisposition, RuntimeContext, ScrollSequence, ValidatedScrollPlan,
    WindowRegistry,
};
const INVALID_DTO: u32 = 2;

#[repr(C)]
pub struct ProtocolResult {
    value: u32,
    status: u32,
    error: u32,
    reserved: u32,
}
fn result(value: Result<Result<u32, NativeError>, u32>) -> ProtocolResult {
    match value {
        Ok(Ok(value)) => ProtocolResult {
            value,
            status: OK,
            error: 0,
            reserved: 0,
        },
        Ok(Err(error)) => ProtocolResult {
            value: 0,
            status: OK,
            error: error as u32,
            reserved: 0,
        },
        Err(status) => ProtocolResult {
            value: 0,
            status,
            error: 0,
            reserved: 0,
        },
    }
}
#[derive(Clone, Default)]
pub struct SequenceHandle {
    sequence: ScrollSequence,
    windows: WindowRegistry,
}
#[no_mangle]
pub extern "C" fn cc_niri_scroll_sequence_create() -> *mut SequenceHandle {
    Box::into_raw(Box::default())
}
/// # Safety
/// Live owned handle or null. Release exactly once, without concurrent access.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_sequence_destroy(handle: *mut SequenceHandle) {
    if !handle.is_null() {
        drop(unsafe { Box::from_raw(handle) });
    }
}
/// # Safety
/// Live exclusively borrowed handle and borrowed name units for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_sequence_intern(
    handle: *mut SequenceHandle,
    name: U16View,
) -> FfiIdResult {
    let value = (|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        Ok::<_, u32>(h.windows.intern(unsafe { text(name)? }).0)
    })();
    id_result(value)
}
/// # Safety
/// Live exclusive handle and DTO including all nested buffers.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_sequence_update(
    handle: *mut SequenceHandle,
    context: *const FfiContext,
) -> ProtocolResult {
    result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let c = unsafe { context.as_ref() }.ok_or(INVALID_DTO)?;
        Ok(h.sequence
            .update(RuntimeContext {
                protocol: c.protocol,
                generation: c.generation,
                session: unsafe { text(c.session)? },
                workspace: unsafe { text(c.workspace)? },
                output: unsafe { text(c.output)? },
            })
            .map(|()| 1))
    })())
}
/// # Safety
/// Live exclusive handle and valid DTO buffers; validation does not consume epoch.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_sequence_plan(
    handle: *mut SequenceHandle,
    plan: *const FfiPlan,
    observe: u32,
) -> ProtocolResult {
    result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let plan = unsafe { decode_plan(plan.as_ref().ok_or(INVALID_DTO)?)? };
        let validation = ValidatedScrollPlan::new(plan, &h.windows);
        let result = validation.and_then(|mut validated| {
            if observe != 0 {
                h.sequence
                    .observe_validated(&mut validated)
                    .map(|d| d as u32)
            } else {
                Ok(PlanDisposition::Accepted as u32)
            }
        });
        // Observer tokens are local to one envelope; retain no closed-window
        // registry across publications. Runtime tokens remain stable per handle.
        h.windows = WindowRegistry::default();
        Ok(result)
    })())
}
/// # Safety
/// Live shared handle with no concurrent mutation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_sequence_authority(
    handle: *const SequenceHandle,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_ref() } {
        Some(h) => FfiSpringBoolResult {
            value: u32::from(h.sequence.context.is_some()),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
#[repr(C)]
pub struct FfiEligibility {
    protocol: f64,
    generation: f64,
    kind: U16View,
    session: U16View,
    workspace: U16View,
    output: U16View,
    windows: *const U16View,
    windows_len: u64,
    message_bytes: u64,
    shape_valid: u32,
    enabled: u32,
}
#[repr(C)]
pub struct FfiCandidate {
    window: U16View,
    workspace: U16View,
    output: U16View,
    opacity: f64,
    flags: u32,
    reserved: u32,
}
#[repr(C)]
pub struct EligibilityStatus {
    generation: i64,
    windows: u64,
    retired_sessions: u64,
    enabled: u32,
    status: u32,
}
pub struct EligibilityHandle(FocusRingContext);
#[no_mangle]
pub extern "C" fn cc_niri_eligibility_create() -> *mut EligibilityHandle {
    Box::into_raw(Box::new(EligibilityHandle(FocusRingContext::default())))
}
/// # Safety
/// Live shared handle or null, without concurrent mutation. Clone is independently owned.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_eligibility_clone(
    handle: *const EligibilityHandle,
) -> *mut EligibilityHandle {
    unsafe { handle.as_ref() }.map_or(std::ptr::null_mut(), |h| {
        Box::into_raw(Box::new(EligibilityHandle(h.0.clone())))
    })
}
/// # Safety
/// Live owned handle or null. Destroy exactly once, without concurrent access.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_eligibility_destroy(handle: *mut EligibilityHandle) {
    if !handle.is_null() {
        drop(unsafe { Box::from_raw(handle) });
    }
}
/// # Safety
/// Live exclusively borrowed handle and all snapshot buffers for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_eligibility_update(
    handle: *mut EligibilityHandle,
    snapshot: *const FfiEligibility,
) -> ProtocolResult {
    result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let p = unsafe { snapshot.as_ref() }.ok_or(INVALID_DTO)?;
        let windows = unsafe { slice(p.windows, p.windows_len)? }
            .iter()
            .map(|name| unsafe { text(*name) })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(h.0
            .update(EligibilitySnapshot {
                shape_valid: p.shape_valid == 1 && p.enabled <= 1,
                message_bytes: p.message_bytes,
                protocol: p.protocol,
                generation: p.generation,
                kind: unsafe { text(p.kind)? },
                session: unsafe { text(p.session)? },
                workspace: unsafe { text(p.workspace)? },
                output: unsafe { text(p.output)? },
                enabled: p.enabled != 0,
                windows,
            })
            .map(u32::from))
    })())
}
/// # Safety
/// Live shared handle and candidate buffers, without concurrent mutation. No allocation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_eligibility_permits(
    handle: *const EligibilityHandle,
    candidate: *const FfiCandidate,
) -> FfiSpringBoolResult {
    let value = (|| {
        let h = unsafe { handle.as_ref() }.ok_or(INVALID_HANDLE)?;
        let c = unsafe { candidate.as_ref() }.ok_or(INVALID_DTO)?;
        Ok::<_, u32>(h.0.permits(Candidate {
            window: unsafe { slice(c.window.data, c.window.len)? },
            workspace: unsafe { slice(c.workspace.data, c.workspace.len)? },
            output: unsafe { slice(c.output.data, c.output.len)? },
            flags: c.flags,
            opacity: c.opacity,
        }))
    })();
    match value {
        Ok(v) => FfiSpringBoolResult {
            value: u32::from(v),
            status: OK,
        },
        Err(status) => FfiSpringBoolResult { value: 0, status },
    }
}
/// # Safety
/// Live exclusively borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_eligibility_clear(handle: *mut EligibilityHandle) -> u32 {
    match unsafe { handle.as_mut() } {
        Some(h) => {
            h.0.clear();
            OK
        }
        None => INVALID_HANDLE,
    }
}
/// # Safety
/// Live shared handle without concurrent mutation. No allocation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_eligibility_status(
    handle: *const EligibilityHandle,
) -> EligibilityStatus {
    match unsafe { handle.as_ref() } {
        Some(h) => EligibilityStatus {
            generation: h.0.context.as_ref().map_or(-1, |c| c.generation.0),
            windows: h.0.windows.len() as u64,
            retired_sessions: h.0.retired_sessions.len() as u64,
            enabled: u32::from(h.0.enabled),
            status: OK,
        },
        None => EligibilityStatus {
            generation: -1,
            windows: 0,
            retired_sessions: 0,
            enabled: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Live shared handle. Returned units are borrowed until mutation/destroy.
/// Fields 0..2 = session/workspace/output; 3 = window, 4 = retired session at index.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_eligibility_text(
    handle: *const EligibilityHandle,
    field: u32,
    index: u64,
) -> FfiTextResult {
    let value = (|| {
        let h = unsafe { handle.as_ref() }.ok_or(INVALID_HANDLE)?;
        let index = usize::try_from(index).map_err(|_| INVALID_DTO)?;
        match field {
            0..=2 => Ok(h.0.context.as_ref().and_then(|c| c.text(field))),
            3 => {
                h.0.windows
                    .iter()
                    .nth(index)
                    .map(|name| Some(&name.0))
                    .ok_or(INVALID_DTO)
            }
            4 => {
                h.0.retired_sessions
                    .iter()
                    .nth(index)
                    .map(|id| Some(&id.0))
                    .ok_or(INVALID_DTO)
            }
            _ => Err(INVALID_DTO),
        }
    })();
    text_result(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn view(value: &[u16]) -> U16View {
        U16View {
            data: value.as_ptr(),
            len: value.len() as u64,
        }
    }
    #[test]
    fn abi_errors_unique_clone_and_allocation_contract() {
        assert_eq!(std::mem::size_of::<ProtocolResult>(), 16);
        assert_eq!(std::mem::size_of::<FfiEligibility>(), 112);
        assert_eq!(std::mem::size_of::<FfiCandidate>(), 64);
        assert_eq!(std::mem::size_of::<EligibilityStatus>(), 32);
        let kind: Vec<_> = "focus-ring-eligibility".encode_utf16().collect();
        let session: Vec<_> = "s".encode_utf16().collect();
        let workspace: Vec<_> = "w".encode_utf16().collect();
        let output: Vec<_> = "eDP-1".encode_utf16().collect();
        let window: Vec<_> = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            .encode_utf16()
            .collect();
        let windows = [view(&window)];
        let mut dto = FfiEligibility {
            protocol: 1.0,
            generation: 1.0,
            kind: view(&kind),
            session: view(&session),
            workspace: view(&workspace),
            output: view(&output),
            windows: windows.as_ptr(),
            windows_len: 1,
            message_bytes: 100,
            shape_valid: 1,
            enabled: 1,
        };
        let candidate = FfiCandidate {
            window: view(&window),
            workspace: view(&workspace),
            output: view(&output),
            opacity: 1.0,
            flags: 0x7f,
            reserved: 0,
        };
        // SAFETY: All handles are owned live allocations and buffers remain live
        // for calls. Explicit invalid DTOs use null (never arbitrary pointers).
        unsafe {
            assert_eq!(
                cc_niri_eligibility_update(std::ptr::null_mut(), &dto).status,
                INVALID_HANDLE
            );
            assert!(cc_niri_eligibility_clone(std::ptr::null()).is_null());
            cc_niri_eligibility_destroy(std::ptr::null_mut());
            let handle = cc_niri_eligibility_create();
            assert_eq!(
                cc_niri_eligibility_update(handle, std::ptr::null()).status,
                INVALID_DTO
            );
            dto.windows = std::ptr::null();
            assert_eq!(cc_niri_eligibility_update(handle, &dto).status, INVALID_DTO);
            dto.windows = windows.as_ptr();
            assert_eq!(cc_niri_eligibility_update(handle, &dto).value, 1);
            let clone = cc_niri_eligibility_clone(handle);
            dto.protocol = 2.0;
            let invalid = cc_niri_eligibility_update(handle, &dto);
            assert_eq!(invalid.status, OK);
            assert_eq!(invalid.error, NativeError::InvalidProtocol as u32);
            assert_eq!(cc_niri_eligibility_permits(handle, &candidate).value, 0);
            cc_niri_eligibility_destroy(handle);
            assert_eq!(cc_niri_eligibility_text(clone, 3, 1).status, INVALID_DTO);
            assert_eq!(
                cc_niri_eligibility_permits(clone, std::ptr::null()).status,
                INVALID_DTO
            );
            assert_eq!(
                crate::allocation_checks::count(|| {
                    for _ in 0..1000 {
                        assert_eq!(cc_niri_eligibility_permits(clone, &candidate).value, 1);
                        assert_eq!(cc_niri_eligibility_status(clone).windows, 1);
                        assert_eq!(cc_niri_eligibility_text(clone, 3, 0).value.len, 36);
                    }
                }),
                0
            );
            assert_eq!(cc_niri_eligibility_clear(clone), OK);
            assert_eq!(cc_niri_eligibility_status(clone).generation, -1);
            cc_niri_eligibility_destroy(clone);
        }
    }
    #[test]
    fn observer_transport_errors_and_bounded_window_registry() {
        // SAFETY: DTOs contain zeroed primitive C fields and null empty buffers;
        // owned handles are released once, without concurrent access.
        unsafe {
            assert_eq!(
                cc_niri_scroll_sequence_plan(std::ptr::null_mut(), std::ptr::null(), 1).status,
                INVALID_HANDLE
            );
            cc_niri_scroll_sequence_destroy(std::ptr::null_mut());
            let handle = cc_niri_scroll_sequence_create();
            assert_eq!(
                cc_niri_scroll_sequence_update(handle, std::ptr::null()).status,
                INVALID_DTO
            );
            let invalid: FfiPlan = std::mem::zeroed();
            for i in 0..1000 {
                let label: Vec<_> = format!("window-{i}").encode_utf16().collect();
                assert_eq!(
                    cc_niri_scroll_sequence_intern(handle, view(&label)).value,
                    1
                );
                assert_eq!(
                    cc_niri_scroll_sequence_plan(handle, &invalid, 1).error,
                    NativeError::InvalidProtocol as u32
                );
            }
            assert_eq!(cc_niri_scroll_sequence_authority(handle).value, 0);
            cc_niri_scroll_sequence_destroy(handle);
        }
    }
}
