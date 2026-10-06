use std::ffi::c_char;

// Static NUL-terminated storage: no allocation, caller buffer or fallible work.
const VERSION: &str = concat!(env!("CARGO_PKG_VERSION"), "\0");

/// Returns a borrowed immutable string valid for the library's lifetime.
/// The caller must not free or modify it. This entry point cannot panic.
#[no_mangle]
pub extern "C" fn cc_niri_rust_core_version() -> *const c_char {
    VERSION.as_ptr().cast()
}
