//! Platform-independent Native Core. Qt/KWin objects stay in the C++ adapter.

mod ffi;

/// Native Core version, independent of the Script protocol.
pub fn rust_core_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub mod native_protocol;
pub mod spring;
pub mod viewport_motion;

#[cfg(test)]
mod allocation_checks;
pub mod scroll_runtime;

pub mod focus_ring;

pub mod focus_ring_context;
