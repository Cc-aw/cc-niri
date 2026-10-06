/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "Spring.h"

#if defined(CC_NIRI_USE_RUST_SPRING) && CC_NIRI_USE_RUST_SPRING
#include "RustSpring.h"
#endif

namespace CcNiri
{
#if defined(CC_NIRI_USE_RUST_SPRING) && CC_NIRI_USE_RUST_SPRING
using SpringBackend = RustSpring;
inline constexpr const char *SpringBackendName = "Rust";
#else
using SpringBackend = Spring;
inline constexpr const char *SpringBackendName = "C++";
#endif
}
