/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ViewportMotion.h"
#if defined(CC_NIRI_USE_RUST_VIEWPORT_MOTION) && CC_NIRI_USE_RUST_VIEWPORT_MOTION
#include "RustViewportMotion.h"
namespace CcNiri {
using ViewportMotionBackend = RustViewportMotion;
inline constexpr const char *ViewportMotionBackendName = "Rust";
}
#else
namespace CcNiri {
using ViewportMotionBackend = ViewportMotion;
inline constexpr const char *ViewportMotionBackendName = "C++";
}
#endif
