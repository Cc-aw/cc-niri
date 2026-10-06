use crate::spring::{Spring, SpringParams, SpringSample};
use std::ffi::c_char;
use std::sync::Arc;

const OK: u32 = 0;
const INVALID_HANDLE: u32 = 1;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiSpringParams {
    damping_ratio: f64,
    stiffness: f64,
    epsilon: f64,
    mass: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiSpringSample {
    position: f64,
    velocity: f64,
}

#[repr(C)]
pub struct FfiSpringSampleResult {
    value: FfiSpringSample,
    status: u32,
    reserved: u32,
}

#[repr(C)]
pub struct FfiSpringBoolResult {
    value: u32,
    status: u32,
}

/// Opaque immutable state. Each create/clone owns one Arc reference.
pub struct SpringHandle(Spring);

#[no_mangle]
pub extern "C" fn cc_niri_spring_create(
    from: f64,
    target: f64,
    velocity: f64,
    params: FfiSpringParams,
) -> *const SpringHandle {
    Arc::into_raw(Arc::new(SpringHandle(Spring::new(
        from,
        target,
        velocity,
        SpringParams {
            damping_ratio: params.damping_ratio,
            stiffness: params.stiffness,
            epsilon: params.epsilon,
            mass: params.mass,
        },
    ))))
}

/// # Safety
/// A non-null handle must be a live create/clone reference from this library.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_spring_clone(handle: *const SpringHandle) -> *const SpringHandle {
    if !handle.is_null() {
        // SAFETY: Caller guarantees a live Arc allocation and retained reference.
        unsafe {
            Arc::increment_strong_count(handle);
        }
    }
    handle
}

/// # Safety
/// Each non-null owned reference must be destroyed once, after its last use.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_spring_destroy(handle: *const SpringHandle) {
    if !handle.is_null() {
        // SAFETY: Caller transfers one live owned Arc reference to this function.
        unsafe {
            Arc::decrement_strong_count(handle);
        }
    }
}

/// # Safety
/// A non-null handle must remain alive throughout the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_spring_is_valid(
    handle: *const SpringHandle,
) -> FfiSpringBoolResult {
    // SAFETY: Non-null pointers are live aligned allocations by caller contract.
    match unsafe { handle.as_ref() } {
        Some(handle) => FfiSpringBoolResult {
            value: u32::from(handle.0.is_valid()),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}

/// # Safety
/// A non-null handle must remain alive throughout the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_spring_sample(
    handle: *const SpringHandle,
    elapsed_ns: i64,
) -> FfiSpringSampleResult {
    // SAFETY: Non-null pointers are live aligned allocations by caller contract.
    match unsafe { handle.as_ref() } {
        Some(handle) => {
            let sample = handle.0.sample(elapsed_ns);
            FfiSpringSampleResult {
                value: FfiSpringSample {
                    position: sample.position,
                    velocity: sample.velocity,
                },
                status: OK,
                reserved: 0,
            }
        }
        None => FfiSpringSampleResult {
            value: FfiSpringSample {
                position: 0.0,
                velocity: 0.0,
            },
            status: INVALID_HANDLE,
            reserved: 0,
        },
    }
}

/// # Safety
/// A non-null handle must remain alive throughout the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_spring_is_settled(
    handle: *const SpringHandle,
    sample: FfiSpringSample,
) -> FfiSpringBoolResult {
    // SAFETY: Non-null pointers are live aligned allocations by caller contract.
    match unsafe { handle.as_ref() } {
        Some(handle) => FfiSpringBoolResult {
            value: u32::from(handle.0.is_settled(SpringSample {
                position: sample.position,
                velocity: sample.velocity,
            })),
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}

// Static NUL-terminated storage: no allocation, caller buffer or fallible work.
const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "\0");

/// Returns a borrowed immutable string valid for the library's lifetime.
/// The caller must not free or modify it. This entry point cannot panic.
#[no_mangle]
pub extern "C" fn cc_niri_rust_core_version() -> *const c_char {
    VERSION.as_ptr().cast()
}

#[cfg(test)]
mod tests {
    #[test]
    fn null_handles_return_errors() {
        // SAFETY: Null is explicitly supported by all entries.
        unsafe {
            let null = std::ptr::null();
            assert_eq!(
                super::cc_niri_spring_is_valid(null).status,
                super::INVALID_HANDLE
            );
            assert_eq!(
                super::cc_niri_spring_sample(null, 0).status,
                super::INVALID_HANDLE
            );
            assert_eq!(
                super::cc_niri_spring_is_settled(
                    null,
                    super::FfiSpringSample {
                        position: 0.0,
                        velocity: 0.0
                    }
                )
                .status,
                super::INVALID_HANDLE
            );
            assert!(super::cc_niri_spring_clone(null).is_null());
            super::cc_niri_spring_destroy(null);
        }
    }

    #[test]
    fn cloned_handle_outlives_original_reference() {
        let original = super::cc_niri_spring_create(
            0.0,
            1260.0,
            0.0,
            super::FfiSpringParams {
                damping_ratio: 1.0,
                stiffness: 800.0,
                epsilon: 0.0001,
                mass: 1.0,
            },
        );
        // SAFETY: Create and clone each own one reference; each is destroyed once.
        unsafe {
            let clone = super::cc_niri_spring_clone(original);
            super::cc_niri_spring_destroy(original);
            assert_eq!(super::cc_niri_spring_is_valid(clone).value, 1);
            let sample = super::cc_niri_spring_sample(clone, 1_000_000_000);
            assert_eq!(sample.status, super::OK);
            assert_eq!(
                super::cc_niri_spring_is_settled(clone, sample.value).value,
                1
            );
            super::cc_niri_spring_destroy(clone);
        }
    }
    #[test]
    fn ffi_version_matches_core() {
        let version = std::ffi::CStr::from_bytes_with_nul(super::VERSION.as_bytes()).unwrap();
        assert_eq!(version.to_str().unwrap(), crate::rust_core_version());
        assert_eq!(super::cc_niri_rust_core_version(), version.as_ptr());
    }
}

#[path = "ffi_motion.rs"]
mod motion;

#[path = "ffi_protocol_views.rs"]
mod protocol_views;
#[path = "ffi_scroll.rs"]
mod scroll;

#[path = "ffi_ring.rs"]
mod ring;

#[path = "ffi_protocol.rs"]
mod protocol;
