/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "RustScrollPlanSequence.h"
#include "../common/NativeProtocolDto.h"
#include <utility>
namespace CcNiri {
using namespace ProtocolAdapter;
RustScrollPlanSequence::RustScrollPlanSequence() : m_handle(cc_niri_scroll_sequence_create()) { if (!m_handle) std::abort(); }
RustScrollPlanSequence::~RustScrollPlanSequence() { cc_niri_scroll_sequence_destroy(m_handle); }
RustScrollPlanSequence::RustScrollPlanSequence(RustScrollPlanSequence &&other) noexcept : m_handle(std::exchange(other.m_handle,nullptr)) {}
RustScrollPlanSequence &RustScrollPlanSequence::operator=(RustScrollPlanSequence &&other) noexcept {
    if (this != &other) { cc_niri_scroll_sequence_destroy(m_handle); m_handle=std::exchange(other.m_handle,nullptr); } return *this;
}
bool RustScrollPlanSequence::updateContext(const QJsonObject &state) {
    const ProtocolAdapter::ScrollContext decoded(state);
    const auto result=cc_niri_scroll_sequence_update(m_handle,&decoded.dto); check(result.status); return result.value!=0;
}
bool RustScrollPlanSequence::hasAuthority() const { return accepted(cc_niri_scroll_sequence_authority(m_handle)); }
CcNiriProtocolResult RustScrollPlanSequence::plan(const QJsonObject &plan,bool observe) const {
    const ProtocolAdapter::ScrollPlan decoded(plan,[this](const QString &id) {
        const auto result=cc_niri_scroll_sequence_intern(m_handle,text(id)); check(result.status); return result.value;
    });
    const auto result=cc_niri_scroll_sequence_plan(m_handle,&decoded.dto,observe); check(result.status); return result;
}
bool RustScrollPlanSequence::validPlan(const QJsonObject &value) const { return plan(value,false).value!=0; }
ScrollPlanDisposition RustScrollPlanSequence::observe(const QJsonObject &value) {
    switch (plan(value,true).value) { case 1: return ScrollPlanDisposition::Duplicate; case 2: return ScrollPlanDisposition::Accepted; default: return ScrollPlanDisposition::Rejected; }
}
}
