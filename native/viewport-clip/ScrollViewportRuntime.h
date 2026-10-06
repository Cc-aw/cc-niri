/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ViewportMotionBackend.h"
#include "../../src/protocol/ViewportScrollPlan.h"
#include <QHash>
#include <QRectF>
#include <optional>

namespace CcNiri {
struct ScrollProjection { double translationX; QRectF viewport; };
class ScrollViewportRuntime {
public:
    bool updateContext(const QJsonObject &state);
    bool arm(const QJsonObject &plan, ViewportMotionBackend::TimePoint now, const QHash<QString, QRectF> &frames = {});
    void cancel(const QString &session, qint64 epoch);
    void clear();
    void remove(const QString &id) { m_columns.remove(id); m_sourceFrames.remove(id); m_visualTargets.remove(id); m_roles.remove(id); }
    bool active() const { return !m_columns.isEmpty(); }
    bool completed() const { return m_completed; }
    QJsonObject status() const;
    bool advance(ViewportMotionBackend::TimePoint now);
    std::optional<ScrollProjection> projection(const QString &id, const QRectF &geometry) const;
    QHash<QString, QRectF> targets() const { return m_columns; }
    QHash<QString, QRectF> sourceFrames() const { return m_sourceFrames; }
    QString role(const QString &id) const { return m_roles.value(id); }
private:
    ViewportScrollPlanSequence m_sequence;
    ViewportMotionBackend m_motion;
    QString m_session, m_workspace, m_output;
    qint64 m_cancelledEpoch = -1;
    QHash<QString, QRectF> m_columns;
    QHash<QString, QRectF> m_visualTargets;
    QHash<QString, QRectF> m_sourceFrames;
    QHash<QString, QString> m_roles;
    QRectF m_viewport;
    double m_frameOffset = 0.0;
    bool m_completed = false;
};
}
