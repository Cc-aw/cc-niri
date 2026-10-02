/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "ScrollViewportRuntime.h"
#include <cmath>
namespace CcNiri {
void ScrollViewportRuntime::clear() { m_columns.clear(); m_roles.clear(); m_motion.snap(m_motion.target()); }
bool ScrollViewportRuntime::updateContext(const QJsonObject &state) {
    const auto session = state.value(QStringLiteral("sessionId")).toString();
    const auto workspace = state.value(QStringLiteral("workspaceId")).toString();
    const auto output = state.value(QStringLiteral("targetOutput")).toString();
    if (!m_sequence.updateContext(state) || !m_sequence.hasAuthority()) {
        clear(); m_sequence = {}; m_session.clear(); m_workspace.clear(); m_output.clear();
        m_motion = ViewportMotion(); m_cancelledEpoch = -1; return false;
    }
    if (session != m_session || workspace != m_workspace || output != m_output) {
        clear();
        if (session != m_session) { m_motion = ViewportMotion(); m_cancelledEpoch = -1; }
    }
    m_session = session; m_workspace = workspace; m_output = output;
    return true;
}
bool ScrollViewportRuntime::arm(const QJsonObject &plan, ViewportMotion::TimePoint now) {
    if (!validViewportScrollPlan(plan) || plan.value(QStringLiteral("epoch")).toInteger() <= m_cancelledEpoch) return false;
    const auto disposition = m_sequence.observe(plan);
    if (disposition == ScrollPlanDisposition::Rejected) return false;
    if (disposition == ScrollPlanDisposition::Duplicate) return active();
    QHash<QString, QRectF> columns;
    QHash<QString, QString> roles;
    const auto viewport = plan.value(QStringLiteral("viewport")).toObject();
    const QRectF rect(viewport.value(QStringLiteral("x")).toDouble(), viewport.value(QStringLiteral("y")).toDouble(),
        viewport.value(QStringLiteral("width")).toDouble(), viewport.value(QStringLiteral("height")).toDouble());
    const double target = plan.value(QStringLiteral("newScrollOffsetX")).toDouble();
    for (const auto &value : plan.value(QStringLiteral("entries")).toArray()) {
        const auto entry = value.toObject();
        if (entry.value(QStringLiteral("newPlacement")) != QJsonValue(QStringLiteral("visible"))) continue;
        const auto id = entry.value(QStringLiteral("windowId")).toString();
        roles.insert(id, entry.value(QStringLiteral("oldPlacement")) == QJsonValue(QStringLiteral("parked"))
            ? QStringLiteral("incoming") : QStringLiteral("continuing"));
        columns.insert(id,
            QRectF(rect.x() + entry.value(QStringLiteral("logicalX")).toDouble() - target, rect.y(),
                   entry.value(QStringLiteral("pixelWidth")).toDouble(), rect.height()));
    }
    // All newly visible columns, including non-overlapping jumps, share the offset.
    if (columns.isEmpty()) { clear(); return false; }
    const auto epoch = plan.value(QStringLiteral("epoch")).toInteger();
    const bool continuing = active() && m_viewport == rect && m_motion.target() == plan.value(QStringLiteral("oldScrollOffsetX")).toDouble();
    // Retarget from the last painted sample, including requests between frames.
    const bool started = continuing ? m_motion.start(m_frameOffset, target, epoch, now)
        : m_motion.start(plan.value(QStringLiteral("oldScrollOffsetX")).toDouble(), target, epoch, now);
    if (!started) return false;
    m_columns = columns; m_roles = roles; m_viewport = rect; m_frameOffset = m_motion.current(now);
    return true;
}
void ScrollViewportRuntime::cancel(const QString &session, qint64 epoch) {
    if (session != m_session || epoch < 0) return;
    m_cancelledEpoch = qMax(m_cancelledEpoch, epoch);
    if (m_motion.epoch() <= epoch) clear();
}
bool ScrollViewportRuntime::advance(ViewportMotion::TimePoint now) {
    if (!active()) return false;
    m_frameOffset = m_motion.current(now);
    if (m_motion.isDone(now)) { m_motion.finish(m_motion.epoch(), now); clear(); return false; }
    return true;
}
std::optional<ScrollProjection> ScrollViewportRuntime::projection(const QString &id, const QRectF &geometry) const {
    const auto it = m_columns.constFind(id);
    if (it == m_columns.cend()) return std::nullopt;
    const auto &target = it.value();
    // Before the geometry ACK commits, paint the real old frame without a transform.
    // Resizes and unrelated layout changes also never inherit scroll ownership.
    if (std::abs(geometry.x() - target.x()) > 0.5 || std::abs(geometry.y() - target.y()) > 0.5
        || std::abs(geometry.width() - target.width()) > 0.5 || std::abs(geometry.height() - target.height()) > 0.5) return std::nullopt;
    return ScrollProjection{m_motion.target() - m_frameOffset, m_viewport};
}
}
