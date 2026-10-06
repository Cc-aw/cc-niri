/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ScrollViewportRuntimeBackend.h"
#if defined(CC_NIRI_TEST_RUST_SCROLL_RUNTIME) && CC_NIRI_TEST_RUST_SCROLL_RUNTIME
#include "RustScrollViewportRuntime.h"
namespace CcNiri { using ScrollRuntimeTestBackend = RustScrollViewportRuntime; }
#else
namespace CcNiri { using ScrollRuntimeTestBackend = ScrollViewportRuntimeBackend; }
#endif
