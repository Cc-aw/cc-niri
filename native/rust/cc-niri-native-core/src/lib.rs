//! Platform-independent Native Core. Qt/KWin objects stay in the C++ adapter.

mod ffi;
pub mod spring;

/// Version of the native core, independent of the Script → Native protocol.
pub fn rust_core_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub mod viewport_motion;

pub mod scroll_runtime;

pub mod focus_ring;

#[cfg(test)]
mod allocation_checks;

pub mod focus_ring_context;
pub mod native_protocol;
pub mod workspace_motion;
