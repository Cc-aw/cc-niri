/* SPDX-License-Identifier: GPL-2.0-or-later */

#include "ViewportClipEffect.h"
#include "../common/ViewportPaintClip.h"
#include "../common/NativeProtocolDto.h"

#include "core/renderviewport.h"
#include "core/output.h"
#include "core/backendoutput.h"
#include "core/renderloop.h"
#include "virtualdesktops.h"
#include "effect/effecthandler.h"
#include "effect/effectwindow.h"
#include "scene/windowitem.h"
#include "window.h"
#include "input.h"
#include "input_event.h"
#include "pointer_input.h"
#include "touch_input.h"
#include "tablet_input.h"
#include "workspace.h"
#include "wayland/seat.h"
#include "wayland_server.h"
#include <QTimer>
#include <QPointer>
#include <QScopedValueRollback>
#include <vector>

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
#include "WorkspaceSlideAdapter.h"
#include <utility>
#include <chrono>

Q_LOGGING_CATEGORY(CC_NIRI_VIEWPORT_CLIP, "cc.niri.viewport.clip", QtInfoMsg)

namespace KWin
{

static CcNiri::ViewportMotionBackend::TimePoint motionNow()
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

// KWin exposes no per-window input-region override. During native hit testing,
// exclude clipped surfaces with its public hidden-by-desktop predicate, while a
// visibility reference keeps their scene items and clients unsuspended. Restore
// before painting / at event-loop idle; this is never persistent window state.
// Every event continues down KWin's native chain: no injected clicks, synthetic
// surfaces, activation policy, or duplicated decoration/drag handling.
class ViewportInputClip final : public QObject, public InputEventFilter
{
public:
    explicit ViewportInputClip(CcNiriViewportClipEffect *owner)
        : QObject(owner), InputEventFilter(InputFilterOrder::ScreenEdge), m_owner(owner)
    {
        input()->installInputEventFilter(this);
        connect(input(), &InputRedirection::globalPointerChanged, this, [this](const QPointF &p) { apply(p); });
        connect(input(), &InputRedirection::pointerButtonStateChanged, this, [this]() { apply(input()->globalPointer()); });
        connect(input(), &InputRedirection::pointerAxisChanged, this, [this]() { if (apply(input()->globalPointer())) input()->pointer()->update(); });
        connect(workspace(), &Workspace::showingDesktopChanged, this, [this]() { restore(); });
        connect(workspace(), &Workspace::stackingOrderChanged, this, &ViewportInputClip::refreshPointer);
        connect(workspace(), &Workspace::windowMinimizedChanged, this, &ViewportInputClip::refreshPointer);
        connect(workspace(), &Workspace::outputsChanged, this, &ViewportInputClip::refreshPointer);
        connect(waylandServer()->seat(), &SeatInterface::dragEnded, this, &ViewportInputClip::refreshPointer);
        m_restore.setSingleShot(true);
        connect(&m_restore, &QTimer::timeout, this, &ViewportInputClip::restore);
    }
    ~ViewportInputClip() override { restore(); }
    void restore()
    {
        if (m_changing) return;
        QScopedValueRollback<bool> changing(m_changing, true);
        restoreMasks();
    }
    void restoreMasks()
    {
        m_restore.stop();
        // Showing Desktop may have independently hidden these same windows.
        // Its authority wins; only release our painting references in that case.
        const bool showing = workspace()->showingDesktop();
        for (const auto &entry : m_masked)
            if (entry.window && !showing) entry.window->setHiddenByShowDesktop(false);
        m_masked.clear();
    }
    bool apply(const QPointF &point)
    {
        if (m_changing) return false;
        QScopedValueRollback<bool> changing(m_changing, true);
        restoreMasks();
        if ((!m_owner->m_scrollRuntime.clipsPartial() && !m_owner->m_scrollClipHandoff.active()) || workspace()->showingDesktop() ||
            waylandServer()->isScreenLocked() ||
            (effects->hasActiveFullScreenEffect() && effects->activeFullScreenEffect() != m_owner)) return false;
        for (auto *window : effects->stackingOrder()) {
            auto *client = window->window();
            if (!client || !window->isOnCurrentDesktop() || window->isMinimized() ||
                client->isHidden() || client->isHiddenByShowDesktop() ||
                client->isInteractiveMove() || client->isInteractiveResize()) continue;
            const auto id = scrollWindowId(window);
            if (!m_owner->m_scrollRuntime.inputBlocked(id, point)
                && !m_owner->m_scrollClipHandoff.inputBlocked(id, point)) continue;
            m_masked.push_back({client, EffectWindowVisibleRef(window, WindowItem::PAINT_DISABLED_BY_HIDDEN)});
            client->setHiddenByShowDesktop(true);
        }
        if (!m_masked.empty()) m_restore.start(0);
        return true;
    }
    void refreshPointer()
    {
        if (apply(input()->globalPointer())) input()->pointer()->update();
    }
    QString hitTest(const QPointF &point)
    {
        apply(point);
        auto *window = input()->findToplevel(point);
        const auto id = window ? window->internalId().toString(QUuid::WithoutBraces).toLower() : QString();
        restore();
        return id;
    }
    bool pointerMotion(PointerMotionEvent *event) override { if (apply(event->position)) input()->pointer()->update(); return false; }
    bool pointerAxis(PointerAxisEvent *event) override { if (apply(event->position)) input()->pointer()->update(); return false; }
    bool pointerButton(PointerButtonEvent *event) override
    {
        if (!apply(event->position)) return false;
        auto *pointer = input()->pointer();
        auto *previousHover = pointer->hover();
        pointer->update(); // Updates native hover even during an implicit grab.
        if (previousHover != pointer->hover() && event->state == PointerButtonState::Pressed && event->buttons == event->button &&
            !waylandServer()->seat()->isDragPointer() && !waylandServer()->seat()->isTouchSequence() &&
            !input()->isSelectingWindow() &&
            (!effects->hasActiveFullScreenEffect() || effects->activeFullScreenEffect() == m_owner))
            focusNative(pointer, event->position);
        return false;
    }
    bool touchDown(TouchDownEvent *event) override
    {
        if (!apply(event->pos)) return false;
        if (input()->touch()->touchPointCount() == 1) {
            input()->touch()->update();
            focusNative(input()->touch(), event->pos);
        }
        return false;
    }
    bool pointerFrame() override { restore(); return false; }
    bool touchFrame() override { restore(); return false; }
    bool keyboardKey(KeyboardKeyEvent *) override { restore(); return false; }
    bool touchMotion(TouchMotionEvent *event) override { apply(event->pos); return false; }
    bool tabletToolProximityEvent(TabletToolProximityEvent *event) override { if (apply(event->position)) input()->tablet()->update(); return false; }
    bool tabletToolAxisEvent(TabletToolAxisEvent *event) override { if (apply(event->position)) input()->tablet()->update(); return false; }
    bool tabletToolTipEvent(TabletToolTipEvent *event) override { if (apply(event->position)) input()->tablet()->update(); return false; }
private:
    static void focusNative(InputDeviceHandler *handler, const QPointF &point)
    {
        auto *window = input()->findToplevel(point);
        auto *decoration = window && !window->clientGeometry().contains(point) ? window->decoratedWindow() : nullptr;
        handler->setDecoration(decoration);
        handler->setFocus(decoration || (window && !window->surface() && !window->isInternal()) ? nullptr : window);
    }
    struct Mask { QPointer<Window> window; EffectWindowVisibleRef visible; };
    CcNiriViewportClipEffect *m_owner;
    std::vector<Mask> m_masked;
    QTimer m_restore;
    bool m_changing = false;
};

CcNiriViewportClipEffect::CcNiriViewportClipEffect()
{
    // Connect the workspace renderer first, so the existing barriers and Wide
    // freeze guard see the active fullscreen owner on desktopChanged.
    m_workspaceSlide = std::make_unique<WorkspaceSlideAdapter>(this);
    m_inputClip = std::make_unique<ViewportInputClip>(this);
    m_scrollEndpointRegistered = QDBusConnection::sessionBus().registerObject(
        QStringLiteral("/ccNiriViewportMotion"), this, QDBusConnection::ExportScriptableSlots);
    if (!m_scrollEndpointRegistered) qCWarning(CC_NIRI_VIEWPORT_CLIP) << "scroll arm endpoint unavailable";
    connect(effects, &EffectsHandler::screenRemoved, this, [this](LogicalOutput *) { clearScrollState(); });
    for (auto *output : effects->screens()) observeWorkspaceFrames(output);
    connect(effects, &EffectsHandler::screenAdded, this, &CcNiriViewportClipEffect::observeWorkspaceFrames);
    connect(effects, &EffectsHandler::screenRemoved, this, [this](LogicalOutput *output) {
        disconnect(m_frameConnections.take(output));
        m_frameSamples.remove(output);
    });
    connect(effects, &EffectsHandler::hasActiveFullScreenEffectChanged, this, [this]() {
        if (m_inputClip) m_inputClip->refreshPointer();
        if (!effects->hasActiveFullScreenEffect()) {
            m_workspaceDepartures.clear();
            m_workspaceDepartureScriptPaint.clear();
        }
        const auto now = motionNow().count();
        if (m_frameDesktopEventCount && now < m_frameCaptureDeadline && !effects->hasActiveFullScreenEffect()) {
            m_frameTransitionEnd = now;
        }
    });
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        m_inputClip->restore();
        m_scrollRuntime.remove(scrollWindowId(window));
        m_scrollClipHandoff.remove(scrollWindowId(window));
        for (auto &runtime : m_workspaceDepartures) runtime.remove(scrollWindowId(window));
        m_activeWindows.remove(window); m_motionPlanWindows.remove(window);
    });
    connect(effects, &EffectsHandler::desktopChanged, this,
            [this](VirtualDesktop *previous, VirtualDesktop *current, EffectWindow *, LogicalOutput *output) {
                const auto now = motionNow().count();
                if (now < m_frameCaptureDeadline) {
                    if (m_frameDesktopEventCount < m_frameDesktopEvents.size()) {
                        m_frameDesktopEvents[m_frameDesktopEventCount++] = {
                            output ? output->name() : QString(), previous ? previous->id() : QString(),
                            current ? current->id() : QString(), now};
                    } else {
                        m_frameEventsTruncated = true;
                    }
                    m_frameTransitionEnd = 0;
                }
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
                m_inputClip->restore();
                m_scrollRuntime.remove(scrollWindowId(window));
                m_scrollClipHandoff.remove(scrollWindowId(window));
                for (auto &runtime : m_workspaceDepartures) runtime.remove(scrollWindowId(window));
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
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[VIEWPORT_CLIP_NATIVE] READY scrollRuntimeBackend=" << CcNiri::scrollRuntimeBackendName();
}

CcNiriViewportClipEffect::~CcNiriViewportClipEffect()
{
    // Relinquishing fullscreen ownership synchronously calls the Script Guard.
    // Keep the adapter alive until those callbacks have released the Wide pose.
    m_inputClip.reset();
    m_workspaceSlide->stop();
    m_workspaceSlide.reset();
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
    const auto &departing = m_scrollRuntime.active() ? m_scrollRuntime : m_scrollClipHandoff.runtime();
    if (effects->hasActiveFullScreenEffect() && departing.clipsPartial()) {
        const auto context = departing.status();
        if (!output || context.value(QStringLiteral("targetOutput")).toString() == output->name()) {
            m_workspaceDepartures.insert(context.value(QStringLiteral("workspaceId")).toString(), departing);
            m_workspaceDepartureScriptPaint.insert(context.value(QStringLiteral("workspaceId")).toString(),
                m_scrollRuntime.active() ? m_scrollPaintFromScript : m_scrollClipHandoff.scriptPaint());
        }
    }
    clearScrollState();
    m_workspaceBarriers.insert(output, QDateTime::currentMSecsSinceEpoch());
    clearWorkspaceClipWindows(effects->stackingOrder(), output, m_activeWindows,
        m_motionPlanWindows, ViewportClipDataRole, MotionPlanDataRole, MotionCompleteDataRole,
        effects->hasActiveFullScreenEffect());
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
    if (entries.size() != 1 && entries.size() != 2) return;
    if (entries.size() == 1 && entries.first().toObject()
            .value(QStringLiteral("role")).toString() != QStringLiteral("target")) return;

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
            marker.insert(QStringLiteral("protocol"), plan.value(QStringLiteral("protocol")).toInt());
            marker.insert(QStringLiteral("type"),
                plan.value(QStringLiteral("type")).toString());
            marker.insert(QStringLiteral("epoch"),
                plan.value(QStringLiteral("epoch")).toInteger());
            marker.insert(QStringLiteral("issuedAt"),
                plan.value(QStringLiteral("issuedAt")).toInteger());
            marker.insert(QStringLiteral("side"),
                plan.value(QStringLiteral("side")).toString());
            marker.insert(QStringLiteral("viewport"),
                plan.value(QStringLiteral("viewport")).toObject().toVariantMap());
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
    m_inputClip->restore();
    m_scrollRuntime.updateContext(document.isObject() ? document.object() : QJsonObject());
    m_scrollClipHandoff.updateContext(document.isObject() ? document.object() : QJsonObject());
    updateScrollOwnership();
    m_inputClip->refreshPointer();
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
    if (!m_scrollPlanObserver.validPlan(plan)) return false;
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
    const auto previousSources = m_scrollRuntime.sourceFrames();
    QHash<QString, QRectF> frames;
    for (auto *window : effects->stackingOrder()) {
        if (window->isOnCurrentDesktop() && window->screen()
            && window->screen()->name() == plan.value(QStringLiteral("targetOutput")).toString())
            frames.insert(scrollWindowId(window), scrollGeometry(window));
    }
    for (const auto &value : plan.value(QStringLiteral("entries")).toArray()) {
        const auto entry = value.toObject();
        // Equal-offset snapshots can hydrate previously parked platform windows.
        // Rust validates the complete geometry and placement before ownership.
        if (plan.value(QStringLiteral("retargetOnly")) == QJsonValue(true)) continue;
        if (entry.value(QStringLiteral("oldPlacement")) != QJsonValue(QStringLiteral("visible"))) continue;
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
                && (!previousTargets.contains(id) || !near(scrollGeometry(window), previousTargets.value(id)))
                && (!previousSources.contains(id) || !near(scrollGeometry(window), previousSources.value(id)))) return false;
        }
    }
    m_inputClip->restore();
    if (!m_scrollRuntime.arm(plan, motionNow(), frames)) return false;
    m_scrollClipHandoff.clear();
    m_scrollPaintFromScript = false;
    if (plan.value(QStringLiteral("clipPartial")) == QJsonValue(true)
        && plan.value(QStringLiteral("retargetOnly")) == QJsonValue(true)) {
        for (auto *window : std::as_const(m_motionPlanWindows)) {
            const auto marker = window->data(MotionPlanDataRole).toMap();
            if (marker.value(QStringLiteral("protocol")).toInt() == 1
                && marker.value(QStringLiteral("epoch")).toLongLong() == plan.value(QStringLiteral("epoch")).toInteger()
                && marker.value(QStringLiteral("sessionId")).toString() == plan.value(QStringLiteral("sessionId")).toString()) {
                m_scrollPaintFromScript = true;
                break;
            }
        }
    }
    updateScrollOwnership();
    m_inputClip->refreshPointer();
    effects->addRepaintFull();
    int incoming = 0, outgoing = 0;
    const auto targets = m_scrollRuntime.targets();
    for (auto it = targets.cbegin(); it != targets.cend(); ++it) {
        if (m_scrollRuntime.role(it.key()) == QStringLiteral("incoming")) ++incoming;
        if (m_scrollRuntime.role(it.key()) == QStringLiteral("outgoing")) ++outgoing;
    }
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[SCROLL_PLAN_NATIVE] ARM continuing=" << targets.size() - incoming - outgoing
        << "incoming=" << incoming << "outgoing=" << outgoing;
    return true;
}

QString CcNiriViewportClipEffect::GetViewportHitTest(double x, double y) const
{
    if (!std::isfinite(x) || !std::isfinite(y)) return {};
    return m_inputClip->hitTest(QPointF(x, y));
}

bool CcNiriViewportClipEffect::WorkspaceTransitionActive() const
{
    // Slide clears this flag only after its Spring has settled. Removing a
    // desktop while it is active forces finishedSwitching() prematurely.
    // Other compositor fullscreen effects also protect topology changes.
    return effects->hasActiveFullScreenEffect();
}

void CcNiriViewportClipEffect::observeWorkspaceFrames(LogicalOutput *output)
{
    auto *backend = output->backendOutput();
    auto *loop = backend ? backend->renderLoop() : nullptr;
    if (!loop || m_frameConnections.contains(output)) return;
    m_frameConnections.insert(output, connect(loop, &RenderLoop::framePresented, this,
        [this, output](RenderLoop *, std::chrono::nanoseconds timestamp, PresentationMode) {
            // KWin supplies actual monotonic presentation timestamps. Recording
            // stops after three seconds and allocates nothing in this callback.
            if (!m_frameCaptureDeadline || timestamp.count() < m_frameCaptureStart ||
                    timestamp.count() > m_frameCaptureDeadline) return;
            auto entry = m_frameSamples.find(output);
            if (entry == m_frameSamples.end()) return;
            auto &samples = entry.value();
            if (samples.count < samples.timestamps.size()) {
                samples.timestamps[samples.count++] = timestamp.count();
            } else {
                samples.truncated = true;
            }
        }));
}

void CcNiriViewportClipEffect::StartWorkspaceFrameCapture()
{
    m_frameCaptureStart = motionNow().count();
    m_frameCaptureDeadline = m_frameCaptureStart + 3000000000LL;
    m_frameTransitionEnd = 0;
    m_frameDesktopEventCount = 0;
    m_frameEventsTruncated = false;
    m_frameSamples.clear();
    for (auto *output : effects->screens()) {
        auto *backend = output->backendOutput();
        auto *loop = backend ? backend->renderLoop() : nullptr;
        if (!loop) continue;
        WorkspaceFrameSamples samples;
        samples.refreshRate = loop->refreshRate();
        m_frameSamples.insert(output, samples);
    }
}

QString CcNiriViewportClipEffect::GetWorkspaceFrameCapture() const
{
    QJsonArray outputs;
    for (auto it = m_frameSamples.cbegin(); it != m_frameSamples.cend(); ++it) {
        QJsonArray timestamps;
        const auto &samples = it.value();
        for (size_t i = 0; i < samples.count; ++i) {
            timestamps.append(double(samples.timestamps[i] - m_frameCaptureStart) / 1000000.0);
        }
        outputs.append(QJsonObject{{QStringLiteral("outputName"), it.key()->name()},
            {QStringLiteral("refreshHz"), samples.refreshRate / 1000.0},
            {QStringLiteral("presentedMs"), timestamps}, {QStringLiteral("truncated"), samples.truncated}});
    }
    QJsonArray desktops;
    for (size_t i = 0; i < m_frameDesktopEventCount; ++i) {
        const auto &event = m_frameDesktopEvents[i];
        desktops.append(QJsonObject{{QStringLiteral("outputName"), event.outputName},
            {QStringLiteral("previousId"), event.previousId}, {QStringLiteral("currentId"), event.currentId},
            {QStringLiteral("atMs"), double(event.timestamp - m_frameCaptureStart) / 1000000.0}});
    }
    const QJsonObject capture{{QStringLiteral("source"), QStringLiteral("KWin::RenderLoop::framePresented")},
        {QStringLiteral("active"), m_frameCaptureDeadline > motionNow().count()},
        {QStringLiteral("transitionEndMs"), m_frameTransitionEnd ?
            QJsonValue(double(m_frameTransitionEnd - m_frameCaptureStart) / 1000000.0) : QJsonValue()},
        {QStringLiteral("desktopEventsTruncated"), m_frameEventsTruncated},
        {QStringLiteral("desktopChanges"), desktops}, {QStringLiteral("outputs"), outputs}};
    return QString::fromUtf8(QJsonDocument(capture).toJson(QJsonDocument::Compact));
}

QString CcNiriViewportClipEffect::GetScrollMotionStatus() const
{
    auto status = m_scrollRuntime.status();
    status.insert(QStringLiteral("scrollRuntimeBackend"), CcNiri::scrollRuntimeBackendName());
    status.insert(QStringLiteral("nativeProtocolBackend"), QString::fromLatin1(CcNiri::NativeProtocolBackendName));
    status.insert(QStringLiteral("decorationGeometryBackend"), QString::fromLatin1(CcNiri::FocusRingCoreBackendName));
    status.insert(QStringLiteral("workspaceRemovalGate"), QStringLiteral("compositor-idle"));
    status.insert(QStringLiteral("workspaceDepartureVisual"), QStringLiteral("freeze-wide-until-compositor-idle"));
    status.insert(QStringLiteral("workspaceAnimationBackend"), QStringLiteral("RustFiniteCurve"));
    status.insert(QStringLiteral("workspaceAnimationEnabled"), m_workspaceSlide->enabled());
    status.insert(QStringLiteral("workspaceAnimationActive"), m_workspaceSlide->active());
    status.insert(QStringLiteral("workspaceAnimationDuration"), m_workspaceSlide->duration());
    status.insert(QStringLiteral("paintClip"), QStringLiteral("viewport-with-decoration-outsets"));
    status.insert(QStringLiteral("clipHandoffActive"), m_scrollClipHandoff.active());
    return QString::fromUtf8(QJsonDocument(status).toJson(QJsonDocument::Compact));
}

void CcNiriViewportClipEffect::CancelScrollPlan(const QString &json)
{
    if (json.toUtf8().size() > CcNiri::MaxMotionPlanBytes) return;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return;
    const auto object = document.object();
    if (!CcNiri::ProtocolAdapter::integer(object.value(QStringLiteral("epoch")))) return;
    m_inputClip->restore();
    const auto session = object.value(QStringLiteral("sessionId")).toString();
    const auto epoch = object.value(QStringLiteral("epoch")).toInteger();
    const auto &source = m_scrollRuntime.active() ? m_scrollRuntime : m_scrollClipHandoff.runtime();
    const auto context = source.status();
    if (source.clipsPartial() && context.value(QStringLiteral("sessionId")).toString() == session
        && epoch >= context.value(QStringLiteral("epoch")).toInteger()) {
        QSet<QString> windows;
        qint64 nextEpoch = 0;
        for (auto *window : std::as_const(m_motionPlanWindows)) {
            const auto marker = window->data(MotionPlanDataRole).toMap();
            const auto candidate = marker.value(QStringLiteral("epoch")).toLongLong();
            auto *output = window->screen();
            auto *desktop = output ? effects->currentDesktop(output) : nullptr;
            if (marker.value(QStringLiteral("protocol")).toInt() != 1 || candidate <= epoch
                || marker.value(QStringLiteral("sessionId")).toString() != session
                || !window->isOnCurrentDesktop() || !output || !desktop
                || desktop->id() != context.value(QStringLiteral("workspaceId")).toString()
                || output->name() != context.value(QStringLiteral("targetOutput")).toString()) continue;
            const auto id = scrollWindowId(window);
            if (!source.projection(id, scrollGeometry(window))) continue;
            windows.insert(id);
            nextEpoch = candidate;
        }
        if (!windows.isEmpty()) {
            m_scrollClipHandoff.retain(source, nextEpoch, windows,
                m_scrollRuntime.active() ? m_scrollPaintFromScript : m_scrollClipHandoff.scriptPaint());
            qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[VIEWPORT_CLIP_NATIVE] HANDOFF epoch=" << nextEpoch
                << "windows=" << windows.size();
        }
    }
    m_scrollClipHandoff.cancel(session, epoch);
    m_scrollRuntime.cancel(session, epoch);
    updateScrollOwnership();
    m_inputClip->refreshPointer();
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
        const auto status = m_scrollRuntime.status();
        const QVariantMap marker{{QStringLiteral("protocol"), 2}, {QStringLiteral("type"), QStringLiteral("SCROLL")},
            {QStringLiteral("sessionId"), status.value(QStringLiteral("sessionId")).toString()},
            {QStringLiteral("workspaceId"), status.value(QStringLiteral("workspaceId")).toString()},
            {QStringLiteral("targetOutput"), status.value(QStringLiteral("targetOutput")).toString()},
            {QStringLiteral("epoch"), status.value(QStringLiteral("epoch")).toInteger()},
            {QStringLiteral("x"), rect.x()}, {QStringLiteral("y"), rect.y()},
            {QStringLiteral("width"), rect.width()}, {QStringLiteral("height"), rect.height()},
            {QStringLiteral("role"), m_scrollRuntime.role(id)}};
        if (window->data(ScrollOwnershipDataRole).toMap() != marker) window->setData(ScrollOwnershipDataRole, marker);
    }
}
void CcNiriViewportClipEffect::clearScrollState()
{
    if (m_inputClip) m_inputClip->restore();
    m_scrollPaintFromScript = false;
    m_scrollClipHandoff.clear();
    m_scrollRuntime.clear(); updateScrollOwnership();
    if (m_inputClip) m_inputClip->refreshPointer();
    effects->addRepaintFull();
}
void CcNiriViewportClipEffect::prePaintScreen(ScreenPrePaintData &data)
{
    m_inputClip->restore();
    m_workspaceSlide->prePaintScreen(data);
    // Sample once per compositor paint pass. All continuing columns share it.
    if (m_scrollRuntime.active()) {
        if (!m_scrollRuntime.advance(motionNow())) updateScrollOwnership();
        else data.mask |= PAINT_SCREEN_WITH_TRANSFORMED_WINDOWS;
    }
    if (m_scrollClipHandoff.active()) data.mask |= PAINT_SCREEN_WITH_TRANSFORMED_WINDOWS;
    effects->prePaintScreen(data);
}
void CcNiriViewportClipEffect::prePaintWindow(RenderView *view, EffectWindow *window, WindowPrePaintData &data)
{
    m_workspaceSlide->prePaintWindow(window, data);
    if (m_scrollRuntime.active() || m_scrollClipHandoff.active()) {
        const auto id = scrollWindowId(window);
        const auto frame = scrollGeometry(window);
        if ((m_scrollRuntime.active() && m_scrollRuntime.projection(id, frame))
            || m_scrollClipHandoff.projection(id, frame)) data.setTransformed();
    }
    effects->prePaintWindow(view, window, data);
}
void CcNiriViewportClipEffect::postPaintScreen()
{
    effects->postPaintScreen();
    m_workspaceSlide->postPaintScreen();
    if (m_scrollRuntime.active() && !m_scrollRuntime.completed()) effects->addRepaintFull();
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
    const auto type = completion.value(QStringLiteral("type")).toString();
    if ((type != QStringLiteral("PAIR_TO_WIDE") && type != QStringLiteral("WIDE_TO_PAIR")) ||
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
    // Clip support alone does not promise native Spring ownership.
    window->setData(ScrollMotionCapabilityDataRole, available && m_scrollEndpointRegistered ? QVariant(true) : QVariant());
}

bool CcNiriViewportClipEffect::isActive() const
{
    return (m_workspaceSlide && m_workspaceSlide->active()) || m_scrollRuntime.active()
        || m_scrollClipHandoff.active() || !m_activeWindows.isEmpty();
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

void CcNiriViewportClipEffect::reconfigure(ReconfigureFlags)
{
    m_workspaceSlide->reconfigure();
}

void CcNiriViewportClipEffect::updateWindowMarker(EffectWindow *window)
{
    const QVariantMap marker = window->data(ViewportClipDataRole).toMap();
    if (marker.value(QStringLiteral("enabled")).toBool()) {
        m_activeWindows.insert(window);
        m_scrollClipHandoff.release(scrollWindowId(window), marker.value(QStringLiteral("transactionEpoch")).toLongLong());
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
    if (m_workspaceSlide->paintWindow(renderTarget, viewport, window, mask, deviceRegion, data)) return;
    paintClippedWindow(renderTarget, viewport, window, mask, deviceRegion, data);
}

void CcNiriViewportClipEffect::paintClippedWindow(const RenderTarget &renderTarget,
    const RenderViewport &viewport, EffectWindow *window, int mask,
    const Region &deviceRegion, WindowPaintData &data)
{
    const auto id = m_scrollRuntime.active() || m_scrollClipHandoff.active() || !m_workspaceDepartures.isEmpty()
        ? scrollWindowId(window) : QString();
    auto projection = m_scrollRuntime.active() && window->isOnCurrentDesktop()
        ? m_scrollRuntime.projection(id, scrollGeometry(window)) : std::nullopt;
    bool departure = false;
    bool scriptPaint = m_scrollPaintFromScript;
    if (!projection && m_scrollClipHandoff.active() && window->isOnCurrentDesktop()) {
        projection = m_scrollClipHandoff.projection(id, scrollGeometry(window));
        if (projection) scriptPaint = m_scrollClipHandoff.scriptPaint();
    }
    if (!projection && !window->isOnCurrentDesktop()) {
        for (auto it = m_workspaceDepartures.cbegin(); it != m_workspaceDepartures.cend(); ++it) {
            projection = it.value().projection(id, scrollGeometry(window));
            if (projection) {
                departure = true;
                scriptPaint = m_workspaceDepartureScriptPaint.value(it.key());
                break;
            }
        }
    }
    if (projection) {
        // Script Pair/Wide supplies the paint transform while the same Native
        // handle protects a partially visible surface's viewport and input.
        // Pure Scroll ownership clears the Script marker before committing.
        if (!scriptPaint && !m_activeWindows.contains(window)) {
            data.setXTranslation(data.xTranslation() + projection->translationX);
        }
        const auto rect = departure ? projection->viewport.translated(0, data.yTranslation()) : projection->viewport;
        const Region clipped = viewportPaintClip(window->windowItem(), viewport,
            RectF(rect.x(), rect.y(), rect.width(), rect.height()), deviceRegion);
        effects->paintWindow(renderTarget, viewport, window, mask | PAINT_WINDOW_TRANSFORMED, clipped, data);
        return;
    }
    const QVariantMap marker = window->data(ViewportClipDataRole).toMap();
    if (!marker.value(QStringLiteral("enabled")).toBool()) {
        effects->paintWindow(renderTarget, viewport, window, mask, deviceRegion, data);
        return;
    }

    RectF logicalClip(marker.value(QStringLiteral("x")).toDouble(),
                            marker.value(QStringLiteral("y")).toDouble(),
                            marker.value(QStringLiteral("width")).toDouble(),
                            marker.value(QStringLiteral("height")).toDouble());
    if (marker.value(QStringLiteral("workspaceDeparture")).toBool()) {
        // Pair/Wide channels have no vertical movement. Slide's downstream
        // translation must move the viewport with its departing desktop.
        logicalClip = logicalClip.translated(0, data.yTranslation());
    }
    if (!logicalClip.isValid()) {
        effects->paintWindow(renderTarget, viewport, window, mask, deviceRegion, data);
        return;
    }

    // Moving workspace clips change every frame. Keep device mapping diagnostics
    // opt-in; ordinary paint must not format strings or write to the journal.
    if (CC_NIRI_VIEWPORT_CLIP().isDebugEnabled()) {
        const Rect deviceClip = viewport.mapToDeviceCoordinates(logicalClip).rounded();
        const QString logKey = QStringLiteral("%1:%2:%3:%4")
            .arg(marker.value(QStringLiteral("transactionId")).toString())
            .arg(marker.value(QStringLiteral("role")).toString())
            .arg(viewport.scale())
            .arg(marker.value(QStringLiteral("workspaceDeparture")).toBool());
        if (m_loggedDeviceClips.size() < 256 && !m_loggedDeviceClips.contains(logKey)) {
            m_loggedDeviceClips.insert(logKey);
            qCDebug(CC_NIRI_VIEWPORT_CLIP)
                << "[VIEWPORT_CLIP_NATIVE] MAP"
                << "logical=" << logicalClip
                << "device=" << deviceClip;
        }
    }

    const Region clipped = viewportPaintClip(window->windowItem(), viewport, logicalClip, deviceRegion);
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
