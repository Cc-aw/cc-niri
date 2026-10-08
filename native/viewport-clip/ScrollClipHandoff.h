/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ScrollViewportRuntimeBackend.h"
#include <QSet>

namespace CcNiri {
// A frozen Rust handle covers the event-loop gap between old clip cancellation
// and the replacement Native/Script clip. It never advances a clock; paint
// composition and membership follow the existing owners and JS transaction.
class ScrollClipHandoff {
public:
    void retain(const ScrollViewportRuntimeBackend &runtime, qint64 epoch, const QSet<QString> &windows, bool scriptPaint = false) {
        m_runtime = runtime;
        m_epoch = epoch;
        m_windows = windows;
        m_scriptPaint = scriptPaint;
    }
    bool active() const { return !m_windows.isEmpty(); }
    const ScrollViewportRuntimeBackend &runtime() const { return m_runtime; }
    bool scriptPaint() const { return m_scriptPaint; }
    std::optional<ScrollProjection> projection(const QString &id, const QRectF &frame) const {
        return m_windows.contains(id) ? m_runtime.projection(id, frame) : std::nullopt;
    }
    bool inputBlocked(const QString &id, const QPointF &point) const {
        return m_windows.contains(id) && m_runtime.inputBlocked(id, point);
    }
    void remove(const QString &id) {
        m_windows.remove(id);
        if (m_windows.isEmpty()) clear();
    }
    void release(const QString &id, qint64 epoch) {
        if (epoch >= m_epoch) remove(id);
    }
    void cancel(const QString &session, qint64 epoch) {
        if (active() && epoch >= m_epoch && m_runtime.status().value(QStringLiteral("sessionId")).toString() == session) clear();
    }
    void updateContext(const QJsonObject &state) {
        if (!active()) return;
        m_runtime.updateContext(state);
        if (!m_runtime.active()) clear();
    }
    void clear() { m_windows.clear(); m_runtime.clear(); m_epoch = 0; m_scriptPaint = false; }
private:
    ScrollViewportRuntimeBackend m_runtime;
    QSet<QString> m_windows;
    qint64 m_epoch = 0;
    bool m_scriptPaint = false;
};
}
