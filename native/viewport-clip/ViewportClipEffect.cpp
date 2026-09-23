/* SPDX-License-Identifier: GPL-2.0-or-later */

#include "ViewportClipEffect.h"

#include "core/renderviewport.h"
#include "effect/effecthandler.h"
#include "effect/effectwindow.h"

#include <QLoggingCategory>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QVariantMap>
#include <utility>

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
                if (role == MotionCompleteDataRole) {
                    forwardMotionCompletion(window);
                    return;
                }
                if (role != ViewportClipDataRole) {
                    return;
                }
                updateWindowMarker(window);
                effects->addRepaintFull();
            });
    connect(effects, &EffectsHandler::windowClosed, this,
            [this](EffectWindow *window) {
                m_activeWindows.remove(window);
                m_motionPlanWindows.remove(window);
                if (m_activeWindows.isEmpty()) {
                    m_loggedDeviceClips.clear();
                }
            });
    const bool connected = QDBusConnection::sessionBus().connect(
        QStringLiteral("org.cc.ScrollDockBridge"),
        QStringLiteral("/ScrollDock"),
        QStringLiteral("org.cc.ScrollDockBridge1"),
        QStringLiteral("MotionPlanChanged"),
        this, SLOT(onMotionPlanChanged(QString)));
    if (!connected) {
        qCWarning(CC_NIRI_VIEWPORT_CLIP) << "motion plan signal unavailable";
    }
    const bool parkedConnected = QDBusConnection::sessionBus().connect(
        QStringLiteral("org.cc.ScrollDockBridge"),
        QStringLiteral("/ScrollDock"),
        QStringLiteral("org.cc.ScrollDockBridge1"),
        QStringLiteral("MotionParked"),
        this, SLOT(onMotionParked(QString)));
    if (!parkedConnected) {
        qCWarning(CC_NIRI_VIEWPORT_CLIP) << "motion parked signal unavailable";
    }
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[VIEWPORT_CLIP_NATIVE] READY";
}

CcNiriViewportClipEffect::~CcNiriViewportClipEffect()
{
    for (EffectWindow *window : effects->stackingOrder()) {
        advertiseCapability(window, false);
        window->setData(MotionPlanDataRole, QVariant());
        window->setData(MotionCompleteDataRole, QVariant());
    }
}

void CcNiriViewportClipEffect::onMotionPlanChanged(const QString &json)
{
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return;
    const QJsonObject plan = document.object();
    const QJsonArray entries = plan.value(QStringLiteral("entries")).toArray();
    if (entries.size() != 2) return;

    for (EffectWindow *window : std::as_const(m_motionPlanWindows)) {
        window->setData(MotionPlanDataRole, QVariant());
    }
    m_motionPlanWindows.clear();

    for (EffectWindow *window : effects->stackingOrder()) {
        const QString id = window->internalId()
            .toString(QUuid::WithoutBraces).toLower();
        for (const QJsonValue &value : entries) {
            const QJsonObject entry = value.toObject();
            if (entry.value(QStringLiteral("windowId")).toString().toLower() != id) {
                continue;
            }
            QVariantMap marker = entry.toVariantMap();
            marker.insert(QStringLiteral("type"),
                plan.value(QStringLiteral("type")).toString());
            marker.insert(QStringLiteral("epoch"),
                plan.value(QStringLiteral("epoch")).toInteger());
            marker.insert(QStringLiteral("issuedAt"),
                plan.value(QStringLiteral("issuedAt")).toInteger());
            marker.insert(QStringLiteral("side"),
                plan.value(QStringLiteral("side")).toString());
            marker.insert(QStringLiteral("entries"), entries.toVariantList());
            marker.insert(QStringLiteral("sessionId"),
                plan.value(QStringLiteral("sessionId")).toString());
            marker.insert(QStringLiteral("transitionToken"),
                plan.value(QStringLiteral("transitionToken")).toString());
            marker.insert(QStringLiteral("targetWindowUuid"),
                plan.value(QStringLiteral("targetWindowUuid")).toString());
            window->setData(MotionPlanDataRole, marker);
            m_motionPlanWindows.insert(window);
            break;
        }
    }
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[MOTION_PLAN_NATIVE] ARM"
        << "epoch=" << plan.value(QStringLiteral("epoch")).toInteger()
        << "windows=" << m_motionPlanWindows.size();
    if (m_motionPlanWindows.size() != entries.size()) {
        qCWarning(CC_NIRI_VIEWPORT_CLIP)
            << "motion plan did not resolve every EffectWindow";
    }
}

void CcNiriViewportClipEffect::onMotionParked(const QString &json)
{
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject() ||
            document.object().value(QStringLiteral("type")).toString() !=
                QStringLiteral("PAIR_TO_WIDE")) {
        return;
    }
    for (EffectWindow *window : std::as_const(m_motionPlanWindows)) {
        window->setData(MotionPlanDataRole, QVariant());
    }
    m_motionPlanWindows.clear();
    effects->addRepaintFull();
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[MOTION_PARKED_NATIVE] repaint"
        << document.object().value(QStringLiteral("transitionToken")).toString();
}

void CcNiriViewportClipEffect::forwardMotionCompletion(EffectWindow *window)
{
    const QVariantMap completion = window->data(MotionCompleteDataRole).toMap();
    if (completion.value(QStringLiteral("type")).toString() !=
            QStringLiteral("PAIR_TO_WIDE") ||
            completion.value(QStringLiteral("transitionToken")).toString().isEmpty()) {
        return;
    }
    window->setData(MotionCompleteDataRole, QVariant());
    QDBusMessage message = QDBusMessage::createMethodCall(
        QStringLiteral("org.cc.ScrollDockBridge"),
        QStringLiteral("/ScrollDock"),
        QStringLiteral("org.cc.ScrollDockBridge1"),
        QStringLiteral("ReportMotionComplete"));
    message << QString::fromUtf8(QJsonDocument::fromVariant(completion)
        .toJson(QJsonDocument::Compact));
    QDBusConnection::sessionBus().asyncCall(message);
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
        const QVariantMap motion = window->data(MotionPlanDataRole).toMap();
        if (marker.value(QStringLiteral("role")).toString() ==
                QStringLiteral("outgoing") &&
                motion.value(QStringLiteral("type")).toString() ==
                    QStringLiteral("PAIR_TO_WIDE")) {
            // The logical window remains in its pair slot while KWin paints it
            // translated toward the virtual Wide edge. Its ordinary damage is
            // bounded by the unchanged frame geometry, so explicitly repaint
            // the scene at the start of the compositor-only motion.
            effects->addRepaintFull();
        }
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
    const QVariantMap motion = window->data(MotionPlanDataRole).toMap();
    if (marker.value(QStringLiteral("role")).toString() ==
            QStringLiteral("outgoing") &&
            motion.value(QStringLiteral("type")).toString() ==
                QStringLiteral("PAIR_TO_WIDE")) {
        // Keep invalidating the old and translated bounds for every frame.
        // A click/screenshot previously forced this repaint externally.
        effects->addRepaintFull();
    }
}

} // namespace KWin

#include "moc_ViewportClipEffect.cpp"
