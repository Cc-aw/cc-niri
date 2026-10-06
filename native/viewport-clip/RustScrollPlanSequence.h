/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "../../src/protocol/ViewportScrollPlan.h"
#include "cc_niri_native_core.h"
namespace CcNiri {
class RustScrollPlanSequence {
public:
    RustScrollPlanSequence();
    ~RustScrollPlanSequence();
    RustScrollPlanSequence(const RustScrollPlanSequence &) = delete;
    RustScrollPlanSequence &operator=(const RustScrollPlanSequence &) = delete;
    RustScrollPlanSequence(RustScrollPlanSequence &&other) noexcept;
    RustScrollPlanSequence &operator=(RustScrollPlanSequence &&other) noexcept;
    bool updateContext(const QJsonObject &state);
    bool hasAuthority() const;
    bool validPlan(const QJsonObject &plan) const;
    ScrollPlanDisposition observe(const QJsonObject &plan);
private:
    CcNiriProtocolResult plan(const QJsonObject &plan,bool observe) const;
    CcNiriScrollSequence *m_handle;
};
}
