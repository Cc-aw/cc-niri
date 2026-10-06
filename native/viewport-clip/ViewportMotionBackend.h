/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "RustViewportMotion.h"
namespace CcNiri {
using ViewportMotionBackend = RustViewportMotion;
inline constexpr const char *ViewportMotionBackendName = "Rust";
}
