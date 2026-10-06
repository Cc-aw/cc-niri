/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingCornerStyle.h"
#include <KConfigGroup>
#include <algorithm>
#include <cmath>
#include <utility>
namespace KWin {
FocusRingCornerStyle::FocusRingCornerStyle(QObject *parent, KSharedConfig::Ptr config)
    : QObject(parent), m_config(std::move(config)), m_watcher(KConfigWatcher::create(m_config)) {
    connect(m_watcher.data(), &KConfigWatcher::configChanged, this,
        [this](const KConfigGroup &group, const QByteArrayList &) {
            if (group.name() == QStringLiteral("Round-Corners") || group.name() == QStringLiteral("Effect-cc-niri-focus-ring")) {
                reconfigure(m_roundCornersLoaded);
            }
        });
}
void FocusRingCornerStyle::reconfigure(bool roundCornersLoaded) {
    m_config->reparseConfiguration();
    m_roundCornersLoaded = roundCornersLoaded;
    const qreal configured = KConfigGroup(m_config, QStringLiteral("Effect-cc-niri-focus-ring")).readEntry("CornerRadius", -1.0);
    const qreal rounded = KConfigGroup(m_config, QStringLiteral("Round-Corners")).readEntry("Size", 12.0);
    m_corners = CcNiri::FocusRingCore::corners(configured,rounded,roundCornersLoaded);
    Q_EMIT changed();
}
BorderRadius FocusRingCornerStyle::radius(const BorderRadius &nativeRadius, const QSizeF &frameSize) const {
    const double native[4]{nativeRadius.topLeft(),nativeRadius.topRight(),nativeRadius.bottomRight(),nativeRadius.bottomLeft()};
    const auto r=CcNiri::FocusRingCore::radius(m_corners,native,frameSize.width(),frameSize.height());
    return BorderRadius(r.values[0],r.values[1],r.values[2],r.values[3]);
}
QString FocusRingCornerStyle::source() const {
    const double native[4]{};
    const auto r=CcNiri::FocusRingCore::radius(m_corners,native,0,0);
    if(r.source==2) return QStringLiteral("override");
    return r.source==1 ? QStringLiteral("round-corners") : QStringLiteral("native-item");
}
}
