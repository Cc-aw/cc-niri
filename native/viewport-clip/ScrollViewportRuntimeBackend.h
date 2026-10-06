/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "RustScrollViewportRuntime.h"
namespace CcNiri {
using ScrollViewportRuntimeBackend = RustScrollViewportRuntime;
inline QString scrollRuntimeBackendName() { return QStringLiteral("Rust"); }
}
