/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "scene/borderradius.h"
#include <KConfigWatcher>
#include <KSharedConfig>
#include <QObject>
#include <QSizeF>
#include "FocusRingCoreBackend.h"

namespace KWin {
// Configuration/lifecycle only. Painting uses cached values, never config I/O.
class FocusRingCornerStyle : public QObject {
    Q_OBJECT
public:
    explicit FocusRingCornerStyle(QObject *parent = nullptr,
        KSharedConfig::Ptr config = KSharedConfig::openConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals));
    void reconfigure(bool roundCornersLoaded);
    BorderRadius radius(const BorderRadius &nativeRadius, const QSizeF &frameSize) const;
    QString source() const;
    bool roundCornersLoaded() const { return m_roundCornersLoaded; }
Q_SIGNALS:
    void changed();
private:
    KSharedConfig::Ptr m_config;
    KConfigWatcher::Ptr m_watcher;
    bool m_roundCornersLoaded = false;
    CcNiriRingCorners m_corners{-1,0};
};
}
