/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "../../src/protocol/ViewportScrollPlan.h"
#if defined(CC_NIRI_USE_RUST_NATIVE_PROTOCOL) && CC_NIRI_USE_RUST_NATIVE_PROTOCOL
#include "RustScrollPlanSequence.h"
namespace CcNiri { using NativeScrollPlanSequence = RustScrollPlanSequence; inline constexpr const char *NativeProtocolBackendName = "Rust"; }
#else
namespace CcNiri {
class NativeScrollPlanSequence : public ViewportScrollPlanSequence {
public: bool validPlan(const QJsonObject &plan) const { return validViewportScrollPlan(plan); }
};
inline constexpr const char *NativeProtocolBackendName = "C++";
}
#endif
