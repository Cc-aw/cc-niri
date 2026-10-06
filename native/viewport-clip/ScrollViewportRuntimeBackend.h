/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ScrollViewportRuntime.h"
#if defined(CC_NIRI_USE_RUST_SCROLL_RUNTIME) && CC_NIRI_USE_RUST_SCROLL_RUNTIME
#include "RustScrollViewportRuntime.h"
namespace CcNiri {
using ScrollViewportRuntimeBackend = RustScrollViewportRuntime;
inline QString scrollRuntimeBackendName() { return QStringLiteral("Rust"); }
}
#else
namespace CcNiri {
using ScrollViewportRuntimeBackend = ScrollViewportRuntime;
inline QString scrollRuntimeBackendName() { return QStringLiteral("C++"); }
}
#endif
