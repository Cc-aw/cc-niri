/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "RustFocusRingContext.h"
#include "../common/NativeProtocolDto.h"
#include <QUuid>
namespace CcNiri {
using ProtocolAdapter::check;
RustFocusRingContext::RustFocusRingContext() : m_handle(cc_niri_eligibility_create()) { if (!m_handle) std::abort(); }
RustFocusRingContext::~RustFocusRingContext() { cc_niri_eligibility_destroy(m_handle); }
RustFocusRingContext::RustFocusRingContext(const RustFocusRingContext &other) : m_handle(cc_niri_eligibility_clone(other.m_handle)) {
    if (!m_handle) std::abort();
    synchronize();
}
RustFocusRingContext &RustFocusRingContext::operator=(const RustFocusRingContext &other) {
    if (this != &other) {
        auto *next=cc_niri_eligibility_clone(other.m_handle); if (!next) std::abort();
        cc_niri_eligibility_destroy(m_handle); m_handle=next; synchronize();
    } return *this;
}
bool RustFocusRingContext::update(const QString &json) {
    const auto bytes=json.toUtf8();
    // Bound parser work before decoding. Rust also enforces the message limit.
    const auto document=bytes.size() <= 256*1024 ? QJsonDocument::fromJson(bytes) : QJsonDocument();
    const auto state=document.object();
    const auto kind=state.value(QStringLiteral("type")).toString();
    const auto session=state.value(QStringLiteral("sessionId")).toString();
    const auto workspace=state.value(QStringLiteral("workspaceId")).toString();
    const auto output=state.value(QStringLiteral("targetOutput")).toString();
    bool shape=document.isObject() && state.value(QStringLiteral("sessionId")).isString()
        && state.value(QStringLiteral("workspaceId")).isString() && state.value(QStringLiteral("targetOutput")).isString()
        && state.value(QStringLiteral("enabled")).isBool() && state.value(QStringLiteral("windows")).isArray();
    const auto rows=state.value(QStringLiteral("windows")).toArray();
    std::vector<QString> names; names.reserve(rows.size());
    for (const auto &entry:rows) {
        shape=shape && entry.isString();
        // QUuid representation conversion stays in Qt; null UUID is represented
        // by its canonical zero string and rejected by Rust.
        names.push_back(QUuid(entry.toString()).toString(QUuid::WithoutBraces).toLower());
    }
    std::vector<CcNiriU16View> windows; windows.reserve(names.size());
    for (const auto &name:names) windows.push_back(ProtocolAdapter::text(name));
    const CcNiriEligibilitySnapshot dto{ProtocolAdapter::number(state.value(QStringLiteral("protocol"))),ProtocolAdapter::number(state.value(QStringLiteral("generation"))),
        ProtocolAdapter::text(kind),ProtocolAdapter::text(session),ProtocolAdapter::text(workspace),ProtocolAdapter::text(output),windows.data(),static_cast<std::uint64_t>(windows.size()),
        static_cast<std::uint64_t>(bytes.size()),static_cast<std::uint32_t>(shape),static_cast<std::uint32_t>(state.value(QStringLiteral("enabled")).toBool())};
    const auto result=cc_niri_eligibility_update(m_handle,&dto); check(result.status); synchronize(); return result.value!=0;
}
void RustFocusRingContext::clear() { check(cc_niri_eligibility_clear(m_handle)); synchronize(); }
bool RustFocusRingContext::permits(const FocusRingCandidate &candidate) const {
    const std::uint32_t flags=std::uint32_t(candidate.active) | (std::uint32_t(candidate.managed)<<1) | (std::uint32_t(candidate.normal)<<2)
        | (std::uint32_t(candidate.visible)<<3) | (std::uint32_t(candidate.onCurrentActivity)<<4) | (std::uint32_t(candidate.onCurrentDesktop)<<5)
        | (std::uint32_t(candidate.insideOutput)<<6) | (std::uint32_t(candidate.minimized)<<7) | (std::uint32_t(candidate.deleted)<<8) | (std::uint32_t(candidate.fullscreen)<<9);
    const CcNiriEligibilityCandidate dto{ProtocolAdapter::text(candidate.id),ProtocolAdapter::text(candidate.workspace),ProtocolAdapter::text(candidate.output),candidate.opacity,flags,0};
    return ProtocolAdapter::accepted(cc_niri_eligibility_permits(m_handle,&dto));
}
QString RustFocusRingContext::text(std::uint32_t field,std::uint64_t index) const {
    const auto result=cc_niri_eligibility_text(m_handle,field,index); check(result.status); return ProtocolAdapter::text(result.value);
}
void RustFocusRingContext::synchronize() {
    const auto status=cc_niri_eligibility_status(m_handle); check(status.status);
    session=text(0); workspace=text(1); output=text(2); generation=status.generation; enabled=status.enabled!=0;
    windows.clear(); retiredSessions.clear();
    for (std::uint64_t i=0;i<status.windows;++i) windows.insert(text(3,i));
    for (std::uint64_t i=0;i<status.retired_sessions;++i) retiredSessions.insert(text(4,i));
}
}
