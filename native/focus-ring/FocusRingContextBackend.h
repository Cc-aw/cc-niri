/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "FocusRingContext.h"
#if defined(CC_NIRI_USE_RUST_NATIVE_PROTOCOL) && CC_NIRI_USE_RUST_NATIVE_PROTOCOL
#include "RustFocusRingContext.h"
namespace CcNiri { using FocusRingContextBackend = RustFocusRingContext; inline constexpr const char *FocusRingProtocolBackendName = "Rust"; }
#else
namespace CcNiri { using FocusRingContextBackend = FocusRingContext; inline constexpr const char *FocusRingProtocolBackendName = "C++"; }
#endif
