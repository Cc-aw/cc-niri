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
    m_configuredRadius = std::isfinite(configured) && configured >= 0 ? std::min(configured, 128.0) : -1;
    const qreal rounded = KConfigGroup(m_config, QStringLiteral("Round-Corners")).readEntry("Size", 12.0);
    m_roundCornersRadius = roundCornersLoaded && std::isfinite(rounded) ? std::clamp(rounded, 0.0, 128.0) : 0;
    Q_EMIT changed();
}
BorderRadius FocusRingCornerStyle::radius(const BorderRadius &nativeRadius, const QSizeF &frameSize) const {
    if (m_configuredRadius < 0 && m_roundCornersRadius <= 0) return nativeRadius;
    const qreal limit = std::max(0.0, std::min(frameSize.width(), frameSize.height()) / 2);
    return BorderRadius(std::min(m_configuredRadius >= 0 ? m_configuredRadius : m_roundCornersRadius, limit));
}
QString FocusRingCornerStyle::source() const {
    if (m_configuredRadius >= 0) return QStringLiteral("override");
    return m_roundCornersRadius > 0 ? QStringLiteral("round-corners") : QStringLiteral("native-item");
}
}
