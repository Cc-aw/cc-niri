/* SPDX-License-Identifier: GPL-2.0-or-later */

#include "ViewportClipEffect.h"

#include "core/renderviewport.h"
#include "core/output.h"
#include "virtualdesktops.h"
#include "effect/effecthandler.h"
#include "effect/effectwindow.h"

#include <QLoggingCategory>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QVariantMap>
#include <QDateTime>
#include "WorkspaceClipBarrier.h"
#include <utility>
#include <chrono>

Q_LOGGING_CATEGORY(CC_NIRI_VIEWPORT_CLIP, "cc.niri.viewport.clip")

namespace KWin
{

static CcNiri::ViewportMotion::TimePoint motionNow()
{
    return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch());
}
static QString scrollWindowId(EffectWindow *window)
{
    return window->internalId().toString(QUuid::WithoutBraces).toLower();
}
static QRectF scrollGeometry(EffectWindow *window)
{
    const auto rect = window->frameGeometry();
    return QRectF(rect.x(), rect.y(), rect.width(), rect.height());
}

CcNiriViewportClipEffect::CcNiriViewportClipEffect()
{
    m_scrollEndpointRegistered = QDBusConnection::sessionBus().registerObject(
        QStringLiteral("/ccNiriViewportMotion"), this, QDBusConnection::ExportScriptableSlots);
    if (!m_scrollEndpointRegistered) qCWarning(CC_NIRI_VIEWPORT_CLIP) << "scroll arm endpoint unavailable";
    connect(effects, &EffectsHandler::screenRemoved, this, [this](LogicalOutput *) { clearScrollState(); });
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        m_scrollRuntime.remove(scrollWindowId(window));
        m_activeWindows.remove(window); m_motionPlanWindows.remove(window);
    });
    connect(effects, &EffectsHandler::desktopChanged, this,
            [this](VirtualDesktop *, VirtualDesktop *, EffectWindow *, LogicalOutput *output) {
                clearWorkspaceState(output);
            });
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
                m_scrollRuntime.remove(scrollWindowId(window));
                window->setData(ScrollOwnershipDataRole, QVariant());
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
    const bool stateConnected = QDBusConnection::sessionBus().connect(
        QStringLiteral("org.cc.ScrollDockBridge"), QStringLiteral("/ScrollDock"),
        QStringLiteral("org.cc.ScrollDockBridge1"), QStringLiteral("StateChanged"),
        this, SLOT(onDockStateChanged(QString)));
    if (!stateConnected) qCWarning(CC_NIRI_VIEWPORT_CLIP) << "scroll observer state signal unavailable";
    const auto request = QDBusMessage::createMethodCall(
        QStringLiteral("org.cc.ScrollDockBridge"), QStringLiteral("/ScrollDock"),
        QStringLiteral("org.cc.ScrollDockBridge1"), QStringLiteral("GetState"));
    auto *watcher = new QDBusPendingCallWatcher(QDBusConnection::sessionBus().asyncCall(request), this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, [this, watcher]() {
        const QDBusPendingReply<QString> reply = *watcher;
        // A state signal received during the query is newer than this reply.
        if (!reply.isError() && !m_receivedDockStateSignal) onDockStateChanged(reply.value());
        watcher->deleteLater();
    });
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[VIEWPORT_CLIP_NATIVE] READY";
}

CcNiriViewportClipEffect::~CcNiriViewportClipEffect()
{
    if (m_scrollEndpointRegistered) QDBusConnection::sessionBus().unregisterObject(QStringLiteral("/ccNiriViewportMotion"));
    clearScrollState();
    for (EffectWindow *window : effects->stackingOrder()) {
        advertiseCapability(window, false);
        window->setData(ViewportClipDataRole, QVariant());
        window->setData(MotionPlanDataRole, QVariant());
        window->setData(MotionCompleteDataRole, QVariant());
    }
}

void CcNiriViewportClipEffect::clearWorkspaceState(LogicalOutput *output)
{
    clearScrollState();
    m_workspaceBarriers.insert(output, QDateTime::currentMSecsSinceEpoch());
    clearWorkspaceClipWindows(effects->stackingOrder(), output, m_activeWindows,
        m_motionPlanWindows, ViewportClipDataRole, MotionPlanDataRole, MotionCompleteDataRole);
    m_loggedDeviceClips.clear();
    effects->addRepaintFull();
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[WORKSPACE_CLIP_NATIVE] CLEAR";
}

void CcNiriViewportClipEffect::onMotionPlanChanged(const QString &json)
{
    if (json.toUtf8().size() > CcNiri::MaxMotionPlanBytes) return;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return;
    const QJsonObject plan = document.object();
    if (plan.value(QStringLiteral("type")).toString() == QStringLiteral("SCROLL")) {
        observeScrollPlan(plan);
        return;
    }
    const QJsonArray entries = plan.value(QStringLiteral("entries")).toArray();
    if (entries.size() != 2) return;

    // Reject a queued pre-switch plan before clearing a newer valid marker.
    QSet<EffectWindow *> resolved;
    for (EffectWindow *window : effects->stackingOrder()) {
        const QString id = window->internalId().toString(QUuid::WithoutBraces).toLower();
        for (const QJsonValue &value : entries) {
            if (value.toObject().value(QStringLiteral("windowId")).toString().toLower() != id) continue;
            const qint64 barrier = qMax(m_workspaceBarriers.value(nullptr),
                m_workspaceBarriers.value(window->screen()));
            if (!acceptsWorkspaceMotion(plan.value(QStringLiteral("issuedAt")).toInteger(),
                barrier, window->isOnCurrentDesktop())) return;
            resolved.insert(window);
        }
    }
    if (resolved.size() != entries.size()) return;

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

void CcNiriViewportClipEffect::onDockStateChanged(const QString &json)
{
    m_receivedDockStateSignal = true;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject() || !m_scrollPlanObserver.updateContext(document.object())) m_scrollPlanObserver = {};
    m_scrollRuntime.updateContext(document.isObject() ? document.object() : QJsonObject());
    updateScrollOwnership();
}

void CcNiriViewportClipEffect::observeScrollPlan(const QJsonObject &plan)
{
    if (!resolveScrollPlan(plan)) return;
    if (m_scrollPlanObserver.observe(plan) != CcNiri::ScrollPlanDisposition::Accepted) return;
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[SCROLL_PLAN_NATIVE] OBSERVE"
        << QJsonDocument(plan).toJson(QJsonDocument::Compact);
}

bool CcNiriViewportClipEffect::resolveScrollPlan(const QJsonObject &plan) const
{
    if (!CcNiri::validViewportScrollPlan(plan)) return false;
    const auto entries = plan.value(QStringLiteral("entries")).toArray();
    QSet<QString> resolved;
    for (EffectWindow *window : effects->stackingOrder()) {
        const auto id = window->internalId().toString(QUuid::WithoutBraces).toLower();
        for (const auto &value : entries) {
            if (value.toObject().value(QStringLiteral("windowId")).toString() != id) continue;
            auto *output = window->screen();
            auto *desktop = effects->currentDesktop(output);
            const auto barrier = qMax(m_workspaceBarriers.value(nullptr), m_workspaceBarriers.value(output));
            if (!output || !desktop || output->name() != plan.value(QStringLiteral("targetOutput")).toString()
                || desktop->id() != plan.value(QStringLiteral("workspaceId")).toString()
                || !acceptsWorkspaceMotion(plan.value(QStringLiteral("issuedAt")).toInteger(),
                                           barrier, window->isOnCurrentDesktop())) return false;
            resolved.insert(id);
        }
    }
    return resolved.size() == entries.size();
}

bool CcNiriViewportClipEffect::ArmScrollPlan(const QString &json)
{
    if (json.toUtf8().size() > CcNiri::MaxMotionPlanBytes) return false;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject() || !resolveScrollPlan(document.object())) return false;
    const auto plan = document.object();
    const auto viewport = plan.value(QStringLiteral("viewport")).toObject();
    const auto previousTargets = m_scrollRuntime.targets();
    for (const auto &value : plan.value(QStringLiteral("entries")).toArray()) {
        const auto entry = value.toObject();
        if (entry.value(QStringLiteral("oldPlacement")) != QJsonValue(QStringLiteral("visible"))
            || entry.value(QStringLiteral("newPlacement")) != QJsonValue(QStringLiteral("visible"))) continue;
        const auto id = entry.value(QStringLiteral("windowId")).toString();
        const QRectF oldRect(viewport.value(QStringLiteral("x")).toDouble() + entry.value(QStringLiteral("logicalX")).toDouble()
            - plan.value(QStringLiteral("oldScrollOffsetX")).toDouble(), viewport.value(QStringLiteral("y")).toDouble(),
            entry.value(QStringLiteral("pixelWidth")).toDouble(), viewport.value(QStringLiteral("height")).toDouble());
        const auto near = [](const QRectF &a, const QRectF &b) {
            return std::abs(a.x() - b.x()) <= 0.5 && std::abs(a.y() - b.y()) <= 0.5
                && std::abs(a.width() - b.width()) <= 0.5 && std::abs(a.height() - b.height()) <= 0.5;
        };
        for (auto *window : effects->stackingOrder()) {
            if (scrollWindowId(window) != id) continue;
            if (!near(scrollGeometry(window), oldRect)
                && (!previousTargets.contains(id) || !near(scrollGeometry(window), previousTargets.value(id)))) return false;
        }
    }
    if (!m_scrollRuntime.arm(plan, motionNow())) return false;
    updateScrollOwnership();
    effects->addRepaintFull();
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[SCROLL_PLAN_NATIVE] ARM continuing=" << m_scrollRuntime.targets().size();
    return true;
}

void CcNiriViewportClipEffect::CancelScrollPlan(const QString &json)
{
    if (json.toUtf8().size() > CcNiri::MaxMotionPlanBytes) return;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return;
    const auto object = document.object();
    if (!CcNiri::scrollPlanInteger(object.value(QStringLiteral("epoch")))) return;
    m_scrollRuntime.cancel(object.value(QStringLiteral("sessionId")).toString(), object.value(QStringLiteral("epoch")).toInteger());
    updateScrollOwnership();
    effects->addRepaintFull();
}

void CcNiriViewportClipEffect::updateScrollOwnership()
{
    const auto targets = m_scrollRuntime.targets();
    for (auto *window : effects->stackingOrder()) {
        const auto id = scrollWindowId(window);
        if (!targets.contains(id)) {
            if (window->data(ScrollOwnershipDataRole).isValid()) window->setData(ScrollOwnershipDataRole, QVariant());
            continue;
        }
        const auto rect = targets.value(id);
        const QVariantMap marker{{QStringLiteral("x"), rect.x()}, {QStringLiteral("y"), rect.y()},
            {QStringLiteral("width"), rect.width()}, {QStringLiteral("height"), rect.height()}};
        if (window->data(ScrollOwnershipDataRole).toMap() != marker) window->setData(ScrollOwnershipDataRole, marker);
    }
}
void CcNiriViewportClipEffect::clearScrollState()
{
    m_scrollRuntime.clear(); updateScrollOwnership(); effects->addRepaintFull();
}
void CcNiriViewportClipEffect::prePaintScreen(ScreenPrePaintData &data)
{
    // Sample once per compositor paint pass. All continuing columns share it.
    if (m_scrollRuntime.active()) {
        if (!m_scrollRuntime.advance(motionNow())) updateScrollOwnership();
        else data.mask |= PAINT_SCREEN_WITH_TRANSFORMED_WINDOWS;
    }
    effects->prePaintScreen(data);
}
void CcNiriViewportClipEffect::prePaintWindow(RenderView *view, EffectWindow *window, WindowPrePaintData &data)
{
    if (m_scrollRuntime.projection(scrollWindowId(window), scrollGeometry(window))) data.setTransformed();
    effects->prePaintWindow(view, window, data);
}
void CcNiriViewportClipEffect::postPaintScreen()
{
    effects->postPaintScreen();
    if (m_scrollRuntime.active()) effects->addRepaintFull();
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
    return m_scrollRuntime.active() || !m_activeWindows.isEmpty();
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
    const auto projection = m_scrollRuntime.projection(scrollWindowId(window), scrollGeometry(window));
    if (projection) {
        data.setXTranslation(data.xTranslation() + projection->translationX);
        const auto &rect = projection->viewport;
        Region clipped = deviceRegion;
        clipped &= viewport.mapToDeviceCoordinates(RectF(rect.x(), rect.y(), rect.width(), rect.height())).rounded();
        effects->paintWindow(renderTarget, viewport, window, mask | PAINT_WINDOW_TRANSFORMED, clipped, data);
        return;
    }
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
