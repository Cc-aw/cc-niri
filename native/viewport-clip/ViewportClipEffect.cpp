/* SPDX-License-Identifier: GPL-2.0-or-later */

#include "ViewportClipEffect.h"

#include "core/renderviewport.h"
#include "effect/effecthandler.h"
#include "effect/effectwindow.h"

#include <QLoggingCategory>
#include <QVariantMap>

Q_LOGGING_CATEGORY(CC_NIRI_VIEWPORT_CLIP, "cc.niri.viewport.clip")

namespace KWin
{

CcNiriViewportClipEffect::CcNiriViewportClipEffect()
{
    for (EffectWindow *window : effects->stackingOrder()) {
        advertiseCapability(window, true);
    }
    connect(effects, &EffectsHandler::windowAdded, this,
            [this](EffectWindow *window) {
                advertiseCapability(window, true);
            });
    connect(effects, &EffectsHandler::windowDataChanged, this,
            [this](EffectWindow *window, int role) {
                if (role != ViewportClipDataRole) {
                    return;
                }
                updateWindowMarker(window);
                effects->addRepaintFull();
            });
    connect(effects, &EffectsHandler::windowClosed, this,
            [this](EffectWindow *window) {
                m_activeWindows.remove(window);
                if (m_activeWindows.isEmpty()) {
                    m_loggedDeviceClips.clear();
                }
            });
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[VIEWPORT_CLIP_NATIVE] READY";
}

CcNiriViewportClipEffect::~CcNiriViewportClipEffect()
{
    for (EffectWindow *window : effects->stackingOrder()) {
        advertiseCapability(window, false);
    }
}

void CcNiriViewportClipEffect::advertiseCapability(EffectWindow *window, bool available)
{
    window->setData(CapabilityDataRole, available ? QVariant(true) : QVariant());
}

bool CcNiriViewportClipEffect::isActive() const
{
    return !m_activeWindows.isEmpty();
}

bool CcNiriViewportClipEffect::blocksDirectScanout() const
{
    return isActive();
}

int CcNiriViewportClipEffect::requestedEffectChainPosition() const
{
    // The scripted motion effect uses the default position 0. Clip after it
    // has applied paint translation, immediately before the scene renderer.
    return 95;
}

void CcNiriViewportClipEffect::updateWindowMarker(EffectWindow *window)
{
    const QVariantMap marker = window->data(ViewportClipDataRole).toMap();
    if (marker.value(QStringLiteral("enabled")).toBool()) {
        m_activeWindows.insert(window);
        qCInfo(CC_NIRI_VIEWPORT_CLIP)
            << "[VIEWPORT_CLIP_NATIVE] ARM"
            << "transaction=" << marker.value(QStringLiteral("transactionId"))
            << "epoch=" << marker.value(QStringLiteral("transactionEpoch"))
            << "role=" << marker.value(QStringLiteral("role"))
            << "viewport="
            << RectF(marker.value(QStringLiteral("x")).toDouble(),
                     marker.value(QStringLiteral("y")).toDouble(),
                     marker.value(QStringLiteral("width")).toDouble(),
                     marker.value(QStringLiteral("height")).toDouble());
    } else {
        m_activeWindows.remove(window);
        if (m_activeWindows.isEmpty()) {
            m_loggedDeviceClips.clear();
        }
        qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[VIEWPORT_CLIP_NATIVE] CLEAR";
    }
}

void CcNiriViewportClipEffect::paintWindow(const RenderTarget &renderTarget,
                                            const RenderViewport &viewport,
                                            EffectWindow *window,
                                            int mask,
                                            const Region &deviceRegion,
                                            WindowPaintData &data)
{
    const QVariantMap marker = window->data(ViewportClipDataRole).toMap();
    if (!marker.value(QStringLiteral("enabled")).toBool()) {
        effects->paintWindow(renderTarget, viewport, window, mask, deviceRegion, data);
        return;
    }

    const RectF logicalClip(marker.value(QStringLiteral("x")).toDouble(),
                            marker.value(QStringLiteral("y")).toDouble(),
                            marker.value(QStringLiteral("width")).toDouble(),
                            marker.value(QStringLiteral("height")).toDouble());
    if (!logicalClip.isValid()) {
        effects->paintWindow(renderTarget, viewport, window, mask, deviceRegion, data);
        return;
    }

    const Rect deviceClip = viewport.mapToDeviceCoordinates(logicalClip).rounded();
    const QString logKey = QStringLiteral("%1:%2,%3,%4,%5")
        .arg(marker.value(QStringLiteral("transactionId")).toString())
        .arg(deviceClip.x())
        .arg(deviceClip.y())
        .arg(deviceClip.width())
        .arg(deviceClip.height());
    if (!m_loggedDeviceClips.contains(logKey)) {
        m_loggedDeviceClips.insert(logKey);
        qCInfo(CC_NIRI_VIEWPORT_CLIP)
            << "[VIEWPORT_CLIP_NATIVE] MAP"
            << "logical=" << logicalClip
            << "device=" << deviceClip;
    }

    Region clipped = deviceRegion;
    clipped &= deviceClip;
    effects->paintWindow(renderTarget, viewport, window, mask, clipped, data);
}

} // namespace KWin

#include "moc_ViewportClipEffect.cpp"
