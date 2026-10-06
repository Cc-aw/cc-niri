//! Platform-independent Native Core. Qt/KWin objects stay in the C++ adapter.

mod ffi;

/// Native Core version, independent of the Script protocol.
pub fn rust_core_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
