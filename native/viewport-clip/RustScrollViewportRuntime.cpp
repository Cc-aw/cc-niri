/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "RustScrollViewportRuntime.h"
#include "../common/NativeProtocolDto.h"
#include <QJsonDocument>
#include <cstdlib>
#include <limits>
#include <vector>
namespace CcNiri {
using namespace ProtocolAdapter;
void checkStatus(std::uint32_t status) { check(status); }
RustScrollViewportRuntime::RustScrollViewportRuntime()
    : m_handle(cc_niri_scroll_create(QRectF(0,0,1,1)==QRectF(1e-13,0,1,1))) {
    if (!m_handle) std::abort();
}
RustScrollViewportRuntime::RustScrollViewportRuntime(const RustScrollViewportRuntime &other)
    : m_handle(cc_niri_scroll_clone(other.m_handle)), m_ids(other.m_ids), m_names(other.m_names) {
    if (!m_handle) std::abort();
}
RustScrollViewportRuntime &RustScrollViewportRuntime::operator=(const RustScrollViewportRuntime &other) {
    if (this != &other) {
        checkStatus(cc_niri_scroll_copy(m_handle,other.m_handle)); m_ids=other.m_ids; m_names=other.m_names;
    }
    return *this;
}
RustScrollViewportRuntime::~RustScrollViewportRuntime() { cc_niri_scroll_destroy(m_handle); }
std::uint64_t RustScrollViewportRuntime::intern(const QString &id) {
    const auto found=m_ids.constFind(id);
    if (found != m_ids.cend()) return found.value();
    const auto result=cc_niri_scroll_intern(m_handle,text(id)); checkStatus(result.status);
    m_ids.insert(id,result.value); m_names.insert(result.value,id); return result.value;
}
bool RustScrollViewportRuntime::updateContext(const QJsonObject &state) {
    const ProtocolAdapter::ScrollContext decoded(state);
    return accepted(cc_niri_scroll_update_context(m_handle,&decoded.dto));
}
bool RustScrollViewportRuntime::arm(const QJsonObject &plan,ViewportMotionBackend::TimePoint now,const QHash<QString,QRectF> &frames) {
    const ProtocolAdapter::ScrollPlan decoded(plan,[this](const QString &id) { return intern(id); });
    std::vector<CcNiriWindowFrame> physical; physical.reserve(frames.size());
    for (auto it=frames.cbegin();it!=frames.cend();++it) physical.push_back({intern(it.key()),rect(it.value())});
    return accepted(cc_niri_scroll_arm(m_handle,&decoded.dto,now.count(),physical.data(),physical.size()));
}
void RustScrollViewportRuntime::cancel(const QString &session,qint64 epoch) { checkStatus(cc_niri_scroll_cancel(m_handle,text(session),epoch)); }
void RustScrollViewportRuntime::clear() { checkStatus(cc_niri_scroll_clear(m_handle)); }
void RustScrollViewportRuntime::remove(const QString &id) {
    const auto found=m_ids.constFind(id);
    if (found != m_ids.cend()) {
        const auto token=found.value(); checkStatus(cc_niri_scroll_remove(m_handle,token));
        m_ids.remove(id); m_names.remove(token);
    }
}
bool RustScrollViewportRuntime::active() const { const auto result=cc_niri_scroll_status(m_handle);checkStatus(result.status);return result.active!=0; }
bool RustScrollViewportRuntime::completed() const { const auto result=cc_niri_scroll_status(m_handle);checkStatus(result.status);return result.completed!=0; }
QString RustScrollViewportRuntime::contextText(std::uint32_t field) const {
    const auto result=cc_niri_scroll_context_text(m_handle,field); checkStatus(result.status);
    return QString::fromUtf16(reinterpret_cast<const char16_t*>(result.value.data),static_cast<qsizetype>(result.value.len));
}
QJsonObject RustScrollViewportRuntime::status() const {
    const auto result=cc_niri_scroll_status(m_handle); checkStatus(result.status);
    return {{QStringLiteral("sessionId"),contextText(0)},{QStringLiteral("workspaceId"),contextText(1)},
        {QStringLiteral("targetOutput"),contextText(2)},{QStringLiteral("epoch"),static_cast<qint64>(result.epoch)},
        {QStringLiteral("active"),result.active!=0},{QStringLiteral("completed"),result.completed!=0}};
}
bool RustScrollViewportRuntime::advance(ViewportMotionBackend::TimePoint now) { return accepted(cc_niri_scroll_advance(m_handle,now.count())); }
std::optional<ScrollProjection> RustScrollViewportRuntime::projection(const QString &id,const QRectF &geometry) const {
    const auto found=m_ids.constFind(id); if (found==m_ids.cend()) return std::nullopt;
    const auto result=cc_niri_scroll_projection(m_handle,found.value(),rect(geometry)); checkStatus(result.status);
    if (!result.active) return std::nullopt;
    return ScrollProjection{result.translation_x,rect(result.viewport)};
}
QHash<QString,QRectF> RustScrollViewportRuntime::frames(std::uint32_t kind) const {
    const auto count=cc_niri_scroll_frames(m_handle,kind,nullptr,0); checkStatus(count.status);
    std::vector<CcNiriWindowFrame> rows(count.value);
    const auto filled=cc_niri_scroll_frames(m_handle,kind,rows.data(),rows.size()); checkStatus(filled.status);
    QHash<QString,QRectF> result;
    for (const auto &r:rows) result.insert(m_names.value(r.window_id),rect(r.rect));
    return result;
}
QHash<QString,QRectF> RustScrollViewportRuntime::targets() const { return frames(0); }
QHash<QString,QRectF> RustScrollViewportRuntime::sourceFrames() const { return frames(1); }
QString RustScrollViewportRuntime::role(const QString &id) const {
    const auto found=m_ids.constFind(id); if (found==m_ids.cend()) return {};
    const auto result=cc_niri_scroll_role(m_handle,found.value()); checkStatus(result.status);
    switch (result.value) { case 0:return {};case 1:return QStringLiteral("continuing");case 2:return QStringLiteral("incoming");case 3:return QStringLiteral("outgoing");default:std::abort(); }
}
}
