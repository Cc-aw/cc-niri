/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ViewportMotion.h"
#include "../../src/protocol/ViewportScrollPlan.h"
#include <QHash>
#include <QRectF>
#include <optional>

namespace CcNiri {
struct ScrollProjection { double translationX; QRectF viewport; };
class ScrollViewportRuntime {
public:
    bool updateContext(const QJsonObject &state);
    bool arm(const QJsonObject &plan, ViewportMotion::TimePoint now);
    void cancel(const QString &session, qint64 epoch);
    void clear();
    void remove(const QString &id) { m_columns.remove(id); m_roles.remove(id); }
    bool active() const { return !m_columns.isEmpty(); }
    bool advance(ViewportMotion::TimePoint now);
    std::optional<ScrollProjection> projection(const QString &id, const QRectF &geometry) const;
    QHash<QString, QRectF> targets() const { return m_columns; }
    QString role(const QString &id) const { return m_roles.value(id); }
private:
    ViewportScrollPlanSequence m_sequence;
    ViewportMotion m_motion;
    QString m_session, m_workspace, m_output;
    qint64 m_cancelledEpoch = -1;
    QHash<QString, QRectF> m_columns;
    QHash<QString, QString> m_roles;
    QRectF m_viewport;
    double m_frameOffset = 0.0;
};
}
