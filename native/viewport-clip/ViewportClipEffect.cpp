/* SPDX-License-Identifier: GPL-2.0-or-later */

#include "ViewportClipEffect.h"
#include "../common/CompositorFrameContext.h"
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
#include "scene/scene.h"
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
#include <KConfigGroup>

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
    configureAnimationProfile();
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
        if (!m_scrollRuntime.active()) syncScrollOutput();
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
                requestRepaintFull();
            });
    connect(effects, &EffectsHandler::windowClosed, this,
            [this](EffectWindow *window) {
                m_inputClip->restore();
                m_scrollRuntime.remove(scrollWindowId(window));
                if (!m_scrollRuntime.active()) syncScrollOutput();
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
        QStringLiteral("org.cc.CCNiriBridge"),
        QStringLiteral("/CCNiriBridge"),
        QStringLiteral("org.cc.CCNiriBridge1"),
        QStringLiteral("MotionPlanChanged"),
        this, SLOT(onMotionPlanChanged(QString)));
    if (!connected) {
        qCWarning(CC_NIRI_VIEWPORT_CLIP) << "motion plan signal unavailable";
    }
    const bool parkedConnected = QDBusConnection::sessionBus().connect(
        QStringLiteral("org.cc.CCNiriBridge"),
        QStringLiteral("/CCNiriBridge"),
        QStringLiteral("org.cc.CCNiriBridge1"),
        QStringLiteral("MotionParked"),
        this, SLOT(onMotionParked(QString)));
    if (!parkedConnected) {
        qCWarning(CC_NIRI_VIEWPORT_CLIP) << "motion parked signal unavailable";
    }
    const bool stateConnected = QDBusConnection::sessionBus().connect(
        QStringLiteral("org.cc.CCNiriBridge"), QStringLiteral("/CCNiriBridge"),
        QStringLiteral("org.cc.CCNiriBridge1"), QStringLiteral("StateChanged"),
        this, SLOT(onRuntimeStateChanged(QString)));
    if (!stateConnected) qCWarning(CC_NIRI_VIEWPORT_CLIP) << "scroll observer state signal unavailable";
    const auto request = QDBusMessage::createMethodCall(
        QStringLiteral("org.cc.CCNiriBridge"), QStringLiteral("/CCNiriBridge"),
        QStringLiteral("org.cc.CCNiriBridge1"), QStringLiteral("GetState"));
    auto *watcher = new QDBusPendingCallWatcher(QDBusConnection::sessionBus().asyncCall(request), this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, [this, watcher]() {
        const QDBusPendingReply<QString> reply = *watcher;
        // A state signal received during the query is newer than this reply.
        if (!reply.isError() && !m_receivedRuntimeStateSignal) onRuntimeStateChanged(reply.value());
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
    requestRepaintFull();
    qCInfo(CC_NIRI_VIEWPORT_CLIP) << "[WORKSPACE_CLIP_NATIVE] CLEAR";
}

void CcNiriViewportClipEffect::onMotionPlanChanged(const QString &json)
{
    if (json.toUtf8().size() > CcNiri::MaxMotionPlanBytes) return;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return;
    const QJsonObject plan = document.object();
    if (plan.value(QStringLiteral("type")) == QJsonValue(QStringLiteral("SCROLL"))
        || plan.value(QStringLiteral("type")) == QJsonValue(QStringLiteral("COLUMN_REINDEX"))) {
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

void CcNiriViewportClipEffect::onRuntimeStateChanged(const QString &json)
{
    m_receivedRuntimeStateSignal = true;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject() || !m_scrollPlanObserver.updateContext(document.object())) m_scrollPlanObserver = {};
    m_inputClip->restore();
    m_scrollRuntime.updateContext(document.isObject() ? document.object() : QJsonObject());
    m_scrollClipHandoff.updateContext(document.isObject() ? document.object() : QJsonObject());
    syncScrollOutput();
    captureScrollLifecycle(2, m_scrollBoundEpoch);
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
        const auto sourceX = plan.value(QStringLiteral("type")) == QJsonValue(QStringLiteral("COLUMN_REINDEX"))
            ? plan.value(QStringLiteral("sourceLogicalX")).toDouble() : entry.value(QStringLiteral("logicalX")).toDouble();
        const QRectF oldRect(viewport.value(QStringLiteral("x")).toDouble() + sourceX
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
    const auto eventTime = motionNow();
    auto startTime = eventTime;
    if (m_animationProfile == CcNiri::AnimationProfile::Smooth60) {
        const auto painted = m_scrollRuntime.frameSample(true);
        if (painted.valid) startTime = std::max(startTime, CcNiri::ViewportMotionBackend::TimePoint(painted.time_ns));
    }
    if (!m_scrollRuntime.arm(plan, startTime, frames, m_animationProfile == CcNiri::AnimationProfile::Smooth60)) return false;
    if (m_scrollRuntime.status().value(QStringLiteral("epoch")).toInteger() != m_scrollBoundEpoch)
        m_scrollEventTime = eventTime.count();
    syncScrollOutput();
    captureScrollLifecycle(0, m_scrollBoundEpoch);
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
    requestRepaintFull();
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
            if (m_scrollCapture.recording)
                m_scrollCapture.presented(captureOutputToken(output), timestamp.count());
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
    m_workspaceSlide->startCapture(m_frameCaptureStart);
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
        {QStringLiteral("motionCapture"), m_workspaceSlide->capture()},
        {QStringLiteral("desktopChanges"), desktops}, {QStringLiteral("outputs"), outputs}};
    return QString::fromUtf8(QJsonDocument(capture).toJson(QJsonDocument::Compact));
}

void CcNiriViewportClipEffect::StartScrollFrameCapture()
{
    m_scrollCaptureOutputs.clear();
    const auto outputs = effects->screens();
    m_scrollCaptureOutputs.reserve(outputs.size());
    for (auto *output : outputs) {
        auto *backend = output->backendOutput();
        auto *loop = backend ? backend->renderLoop() : nullptr;
        m_scrollCaptureOutputs.push_back({output, output->name(), m_scrollCaptureOutputs.size() + 1,
            loop ? loop->refreshRate() / 1000.0 : 0, output->scale()});
    }
    m_scrollCapturedSerial = 0;
    m_scrollCapture.start(motionNow().count());
}

QString CcNiriViewportClipEffect::GetScrollFrameCapture() const
{
    QJsonArray outputs, frames, presentations, lifecycles;
    for (const auto &entry : m_scrollCaptureOutputs) {
        outputs.append(QJsonObject{{QStringLiteral("token"), qint64(entry.token)},
            {QStringLiteral("name"), entry.name}, {QStringLiteral("refreshHz"), entry.refreshHz},
            {QStringLiteral("scale"), entry.scale}, {QStringLiteral("removed"), entry.output.isNull()},
            {QStringLiteral("fullRepaintRequests"), qint64(entry.fullRepaintRequests)},
            {QStringLiteral("targetRepaintRequests"), qint64(entry.targetRepaintRequests)}});
    }
    const auto atMs = [this](qint64 ns) { return double(ns - m_scrollCapture.startNs) / 1000000.0; };
    for (size_t i = 0; i < m_scrollCapture.frameCount; ++i) {
        const auto &r = m_scrollCapture.frames[i];
        frames.append(QJsonObject{{QStringLiteral("frame"), qint64(r.frame)},
            {QStringLiteral("output"), qint64(r.output)}, {QStringLiteral("revision"), qint64(r.revision)},
            {QStringLiteral("epoch"), qint64(r.epoch)}, {QStringLiteral("eventMs"), atMs(r.eventNs)},
            {QStringLiteral("predictedMs"), r.predictedNs > 0 ? QJsonValue(atMs(r.predictedNs)) : QJsonValue()},
            {QStringLiteral("sampleMs"), atMs(r.sampleNs)}, {QStringLiteral("paintMs"), atMs(r.paintNs)},
            {QStringLiteral("x"), r.position}, {QStringLiteral("v"), r.velocity}, {QStringLiteral("target"), r.target},
            {QStringLiteral("scale"), r.scale}, {QStringLiteral("refreshHz"), r.refreshHz},
            {QStringLiteral("fallback"), int(r.fallback)}, {QStringLiteral("numericalCompleted"), r.completed},
            {QStringLiteral("ownershipActive"), r.ownership}, {QStringLiteral("initialX"), r.initialPosition},
            {QStringLiteral("startMs"), atMs(r.startNs)}, {QStringLiteral("initialVelocity"), r.initialVelocity},
            {QStringLiteral("profile"), r.profile == CcNiri::AnimationProfile::Smooth60 ? QStringLiteral("smooth60") : QStringLiteral("stable")}});
    }
    for (size_t i = 0; i < m_scrollCapture.presentationCount; ++i) {
        const auto &r = m_scrollCapture.presentations[i];
        presentations.append(QJsonObject{{QStringLiteral("output"), qint64(r.output)}, {QStringLiteral("atMs"), atMs(r.timeNs)}});
    }
    for (size_t i = 0; i < m_scrollCapture.lifecycleCount; ++i) {
        const auto &r = m_scrollCapture.lifecycles[i];
        lifecycles.append(QJsonObject{{QStringLiteral("output"), qint64(r.output)}, {QStringLiteral("revision"), qint64(r.revision)},
            {QStringLiteral("epoch"), qint64(r.epoch)}, {QStringLiteral("atMs"), atMs(r.timeNs)}, {QStringLiteral("kind"), int(r.kind)},
            {QStringLiteral("retargetStrategy"), int(r.strategy)}, {QStringLiteral("retargetReason"), int(r.reason)},
            {QStringLiteral("initialVelocity"), r.initialVelocity}, {QStringLiteral("savedVelocity"), r.savedVelocity},
            {QStringLiteral("brakeMs"), r.brakeMs}, {QStringLiteral("brakeDistance"), r.brakeDistance}});
    }
    return QString::fromUtf8(QJsonDocument(QJsonObject{
        {QStringLiteral("version"), 1}, {QStringLiteral("durationMs"), 10000},
        {QStringLiteral("captureId"), qint64(m_scrollCapture.captureId)},
        {QStringLiteral("active"), m_scrollCapture.active(motionNow().count())},
        {QStringLiteral("truncated"), m_scrollCapture.truncated},
        {QStringLiteral("association"), QStringLiteral("output-only-no-paint-to-present-join")},
        {QStringLiteral("positionUnit"), QStringLiteral("logical-px")},
        {QStringLiteral("velocityUnit"), QStringLiteral("logical-px-per-second")},
        {QStringLiteral("clockDomain"), QStringLiteral("steady-clock-monotonic-relative-ms")},
        {QStringLiteral("repaintScope"), QStringLiteral("ViewportClipEffect-full-events-and-profile-dependent-continuation-excludes-workspace-adapter")},
        {QStringLiteral("repaintFullRequests"), qint64(m_scrollCapture.repaintFullCount)},
        {QStringLiteral("repaintOutputRequests"), qint64(m_scrollCapture.repaintOutputCount)},
        {QStringLiteral("continuousRepaintFullRequests"), qint64(m_scrollCapture.continuousFullCount)},
        {QStringLiteral("continuousRepaintFallbackFullRequests"), qint64(m_scrollCapture.fallbackFullCount)},
        {QStringLiteral("outputs"), outputs}, {QStringLiteral("paintedFrames"), frames},
        {QStringLiteral("presentations"), presentations}, {QStringLiteral("lifecycle"), lifecycles}}).toJson(QJsonDocument::Compact));
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
    status.insert(QStringLiteral("animationProfile"), m_animationProfile == CcNiri::AnimationProfile::Smooth60
        ? QStringLiteral("smooth60") : QStringLiteral("stable"));
    status.insert(QStringLiteral("animationProfileFallback"), m_invalidAnimationProfile ? QStringLiteral("invalid-profile") : QString());
    status.insert(QStringLiteral("scrollClockSource"), m_animationProfile == CcNiri::AnimationProfile::Stable
        ? QStringLiteral("steady-clock-execution")
        : (m_scrollFrameContext.fallback() == CcNiri::ClockFallback::None
            ? QStringLiteral("predicted-presentation") : QStringLiteral("steady-clock-fallback")));
    status.insert(QStringLiteral("scrollTargetOutput"), m_scrollTargetName);
    status.insert(QStringLiteral("scrollRepaintScope"), m_animationProfile == CcNiri::AnimationProfile::Smooth60
        ? QStringLiteral("target-output-continuation") : QStringLiteral("full-continuation"));
    status.insert(QStringLiteral("scrollOutputRepaintRequests"), qint64(m_scrollOutputRepaintRequests));
    status.insert(QStringLiteral("scrollContinuousFullRepaintRequests"), qint64(m_scrollContinuousFullRequests));
    status.insert(QStringLiteral("scrollRepaintFallbackFullRequests"), qint64(m_scrollRepaintFallbackFullRequests));
    status.insert(QStringLiteral("scrollRetargetPolicy"), m_animationProfile == CcNiri::AnimationProfile::Smooth60 && !m_scrollRuntime.clipsPartial()
        ? QStringLiteral("bounded-last-painted-position-and-velocity") : QStringLiteral("last-painted-position-zero-velocity"));
    const auto tuning = m_scrollRuntime.tuningStatus(m_animationProfile == CcNiri::AnimationProfile::Smooth60);
    status.insert(QStringLiteral("scrollSpringStiffness"), tuning.stiffness);
    status.insert(QStringLiteral("scrollVisualSettlePhysicalPx"), tuning.threshold_px > 0 ? QJsonValue(tuning.threshold_px) : QJsonValue());
    const char *visualFallbacks[] = {"disabled", "none", "missing-output", "invalid-scale", "unknown-refresh", "awaiting-frame"};
    status.insert(QStringLiteral("scrollVisualSettleEnabled"), tuning.fallback == 1);
    status.insert(QStringLiteral("scrollVisualSettleFallback"), QString::fromLatin1(tuning.fallback < 6 ? visualFallbacks[tuning.fallback] : "invalid"));
    status.insert(QStringLiteral("scrollVisualSettleOutputScale"), tuning.output_scale);
    status.insert(QStringLiteral("scrollVisualSettleRefreshHz"), tuning.refresh_hz);
    status.insert(QStringLiteral("scrollVisualCompletedCount"), qint64(tuning.visual_completed));
    status.insert(QStringLiteral("scrollVisualSettleFallbackReasons"), QJsonObject{
        {QStringLiteral("missingOutput"), qint64(tuning.missing_output)},
        {QStringLiteral("invalidScale"), qint64(tuning.invalid_scale)},
        {QStringLiteral("unknownRefresh"), qint64(tuning.unknown_refresh)}});
    status.insert(QStringLiteral("workspaceRetargetPolicy"), m_workspaceSlide->smoothEnabled()
        ? QStringLiteral("bounded-last-painted-quintic-derivatives") : QStringLiteral("last-painted-position-quintic-zero-velocity"));
    status.insert(QStringLiteral("workspaceMotion"), m_workspaceSlide->status());
    status.insert(QStringLiteral("clockFallbackCount"), qint64(m_scrollFrameContext.fallbackCount()));
    status.insert(QStringLiteral("clockFallbackReasons"), QJsonObject{
        {QStringLiteral("missingPrediction"), qint64(m_scrollFrameContext.fallbackCount(CcNiri::ClockFallback::MissingPrediction))},
        {QStringLiteral("invalidPrediction"), qint64(m_scrollFrameContext.fallbackCount(CcNiri::ClockFallback::InvalidPrediction))},
        {QStringLiteral("regressedPrediction"), qint64(m_scrollFrameContext.fallbackCount(CcNiri::ClockFallback::RegressedPrediction))}});
    const auto retarget = m_scrollRuntime.retargetStatus();
    const char *strategies[] = {"rest", "carry", "brake", "reset", "keep"};
    const char *reasons[] = {"none", "no-brake-space", "invalid-math", "coverage"};
    status.insert(QStringLiteral("retargetDegradedCount"), qint64(retarget.degraded));
    status.insert(QStringLiteral("retargetCarriedCount"), qint64(retarget.carried));
    status.insert(QStringLiteral("retargetBrakedCount"), qint64(retarget.braked));
    status.insert(QStringLiteral("retargetKeptCount"), qint64(retarget.kept));
    status.insert(QStringLiteral("retargetDegradedReasons"), QJsonObject{{QStringLiteral("noBrakeSpace"), qint64(retarget.no_space)},
        {QStringLiteral("invalidMath"), qint64(retarget.invalid_math)}, {QStringLiteral("coverage"), qint64(retarget.coverage)}});
    status.insert(QStringLiteral("lastRetarget"), QJsonObject{
        {QStringLiteral("strategy"), QString::fromLatin1(retarget.strategy < 5 ? strategies[retarget.strategy] : "invalid")},
        {QStringLiteral("reason"), QString::fromLatin1(retarget.reason < 4 ? reasons[retarget.reason] : "invalid")},
        {QStringLiteral("initialVelocity"), retarget.initial_velocity}, {QStringLiteral("savedVelocity"), retarget.saved_velocity},
        {QStringLiteral("brakeMs"), retarget.brake_ms}, {QStringLiteral("brakeDistance"), retarget.brake_distance},
        {QStringLiteral("lower"), retarget.lower}, {QStringLiteral("upper"), retarget.upper}});
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
    captureScrollLifecycle(1, epoch);
    syncScrollOutput();
    updateScrollOwnership();
    m_inputClip->refreshPointer();
    requestRepaintFull();
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
    captureScrollLifecycle(3, m_scrollBoundEpoch);
    m_scrollRuntime.clear();
    syncScrollOutput();
    updateScrollOwnership();
    if (m_inputClip) m_inputClip->refreshPointer();
    requestRepaintFull();
}
void CcNiriViewportClipEffect::configureAnimationProfile()
{
    const KConfigGroup config(effects->config(), QStringLiteral("Effect-cc-niri-viewport-clip"));
    const auto value = config.readEntry("AnimationProfile", QStringLiteral("stable"));
    const auto profile = CcNiri::animationProfile(value.toStdString());
    m_invalidAnimationProfile = value != QStringLiteral("stable") && value != QStringLiteral("smooth60");
    if (profile != m_animationProfile) clearScrollState();
    m_animationProfile = profile;
}
void CcNiriViewportClipEffect::syncScrollOutput()
{
    if (!m_scrollRuntime.active()) {
        m_scrollTargetOutput.clear(); m_scrollTargetName.clear();
        m_scrollBoundEpoch = -1;
        m_scrollFrameContext.clear();
        ++m_scrollRevision;
        return;
    }
    const auto status = m_scrollRuntime.status(); // Event boundary only.
    const auto name = status.value(QStringLiteral("targetOutput")).toString();
    const auto epoch = status.value(QStringLiteral("epoch")).toInteger();
    if (name != m_scrollTargetName || epoch != m_scrollBoundEpoch) ++m_scrollRevision;
    m_scrollBoundEpoch = epoch;
    m_scrollTargetName = name;
    m_scrollTargetOutput.clear();
    for (auto *output : effects->screens()) {
        if (output->name() == name) { m_scrollTargetOutput = output; break; }
    }
    m_scrollFrameContext.bind(reinterpret_cast<uintptr_t>(m_scrollTargetOutput.data()), m_scrollRevision, m_scrollEventTime);
}
uint64_t CcNiriViewportClipEffect::captureOutputToken(LogicalOutput *output) const
{
    if (!output) return 0;
    for (const auto &entry : m_scrollCaptureOutputs) if (entry.output == output) return entry.token;
    return 0; // Outputs added during capture are explicitly unregistered.
}
void CcNiriViewportClipEffect::captureScrollLifecycle(uint32_t kind, qint64 epoch)
{
    if (!m_scrollCapture.recording) return;
    const auto r = kind == 0 ? m_scrollRuntime.retargetStatus() : CcNiriScrollRetargetStatus{};
    m_scrollCapture.lifecycle({captureOutputToken(m_scrollTargetOutput.data()), m_scrollRevision, epoch, motionNow().count(), kind,
        r.initial_velocity, r.saved_velocity, r.brake_ms, r.brake_distance, r.strategy, r.reason});
}
void CcNiriViewportClipEffect::requestRepaintFull()
{
    if (m_scrollCapture.recording) {
        const auto now = motionNow().count();
        m_scrollCapture.expire(now);
        if (m_scrollCapture.active(now)) {
            m_scrollCapture.repaint(now);
            for (auto &entry : m_scrollCaptureOutputs) if (entry.output) ++entry.fullRepaintRequests;
        }
    }
    effects->addRepaintFull(); // Event damage and stable continuation stay conservative.
}
void CcNiriViewportClipEffect::requestScrollContinuationRepaint()
{
    CcNiri::ScrollRepaintPass facts;
    const bool tracked = m_scrollPaintDepth && m_scrollPaintDepth <= m_scrollPaintPasses.size();
    if (tracked) {
        const auto &pass = m_scrollPaintPasses[m_scrollPaintDepth - 1];
        facts = {reinterpret_cast<uintptr_t>(pass.output.data()), pass.revision, pass.real, pass.sampled};
    }
    // LogicalOutput is lifetime guarded. Request the whole output, including
    // background, shadow and Ring, using KWin's logical-coordinate damage API.
    const Rect damage = m_scrollTargetOutput ? m_scrollTargetOutput->geometry() : Rect();
    const auto scope = CcNiri::scrollContinuationRepaint(m_animationProfile,
        m_scrollRuntime.active() && !m_scrollRuntime.completed(),
        reinterpret_cast<uintptr_t>(m_scrollTargetOutput.data()), m_scrollRevision,
        !damage.isEmpty(), tracked ? &facts : nullptr);
    if (scope == CcNiri::ScrollRepaintScope::None) return;
    const bool full = scope != CcNiri::ScrollRepaintScope::TargetOutput;
    const bool fallback = scope == CcNiri::ScrollRepaintScope::ConservativeFull;
    if (full) ++m_scrollContinuousFullRequests; else ++m_scrollOutputRepaintRequests;
    if (fallback) ++m_scrollRepaintFallbackFullRequests;
    if (m_scrollCapture.recording) {
        const auto now = motionNow().count();
        m_scrollCapture.expire(now);
        if (m_scrollCapture.active(now)) {
            if (full) ++m_scrollCapture.continuousFullCount; else ++m_scrollCapture.repaintOutputCount;
            if (fallback) ++m_scrollCapture.fallbackFullCount;
            if (!full) for (auto &entry : m_scrollCaptureOutputs)
                if (entry.output == m_scrollTargetOutput) ++entry.targetRepaintRequests;
        }
    }
    if (full) requestRepaintFull(); else effects->addRepaint(damage);
}
void CcNiriViewportClipEffect::prePaintScreen(ScreenPrePaintData &data)
{
    const bool realFrame = data.screen && data.frame && (!data.view || data.view->logicalOutput() == data.screen);
    // Reuse the compositor prediction for static passes and the actual Scroll
    // sample below when motion is running. Ring never samples another clock.
    const auto prediction = data.view ? data.view->nextPresentationTimestamp().count() : 0;
    auto sharedTime = prediction > 0 ? prediction : motionNow().count();
    if (m_scrollCapture.recording) m_scrollCapture.expire(motionNow().count());
    const auto passIndex = m_scrollPaintDepth++;
    if (passIndex < m_scrollPaintPasses.size()) {
        auto &pass = m_scrollPaintPasses[passIndex];
        pass = {};
        if (m_animationProfile == CcNiri::AnimationProfile::Smooth60 || m_scrollCapture.recording) {
            pass.output = data.screen;
            // Offscreen captures have no OutputFrame. A view on another output must
            // never advance or commit this output's scroll state.
            pass.real = data.screen && data.frame && (!data.view || data.view->logicalOutput() == data.screen);
            pass.revision = m_scrollRevision;
            pass.predictedNs = data.view ? data.view->nextPresentationTimestamp().count() : 0;
            pass.refreshHz = data.view ? data.view->refreshRate() / 1000.0 : 0;
        }
    }
    m_inputClip->restore();
    m_workspaceSlide->prePaintScreen(data);
    // Sample once per compositor paint pass. All continuing columns share it.
    if (m_scrollRuntime.active()) {
        if (m_animationProfile == CcNiri::AnimationProfile::Stable) {
            const auto sampleTime = motionNow();
            sharedTime = sampleTime.count();
            if (!m_scrollRuntime.advance(sampleTime)) updateScrollOwnership();
            ++m_scrollFrameSerial;
            if (passIndex < m_scrollPaintPasses.size()) m_scrollPaintPasses[passIndex].serial = m_scrollFrameSerial;
        } else if (passIndex < m_scrollPaintPasses.size()) {
            auto &pass = m_scrollPaintPasses[passIndex];
            const bool nested = std::any_of(m_scrollPaintPasses.cbegin(), m_scrollPaintPasses.cbegin() + passIndex,
                [&pass](const auto &parent) { return parent.real && parent.output == pass.output && parent.revision == pass.revision; });
            const auto decision = m_scrollFrameContext.select(reinterpret_cast<uintptr_t>(data.screen),
                pass.real, data.view != nullptr, pass.predictedNs, motionNow().count(), reinterpret_cast<uintptr_t>(data.frame), nested);
            pass.sampleNs = decision.timeNs;
            if (pass.real && pass.output == m_scrollTargetOutput && decision.timeNs >= 0) sharedTime = decision.timeNs;
            pass.fallback = decision.fallback;
            if (decision.advance) {
                pass.sampled = m_scrollRuntime.prepareFrame(CcNiri::ViewportMotionBackend::TimePoint(decision.timeNs),
                    pass.real && pass.output == m_scrollTargetOutput,
                    data.screen ? data.screen->scale() : 0, pass.refreshHz);
                ++m_scrollFrameSerial;
            }
            pass.serial = m_scrollFrameSerial;
        }
        if (m_scrollRuntime.active()) data.mask |= PAINT_SCREEN_WITH_TRANSFORMED_WINDOWS;
    }
    if (m_scrollClipHandoff.active()) data.mask |= PAINT_SCREEN_WITH_TRANSFORMED_WINDOWS;
    const CcNiri::ScopedCompositorFrame sharedFrame(effects,
        {reinterpret_cast<uintptr_t>(data.screen), sharedTime, realFrame});
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
    requestScrollContinuationRepaint();
    if (m_scrollPaintDepth) --m_scrollPaintDepth;
    if (!m_scrollPaintDepth) m_scrollFrameContext.endPass();
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
    requestRepaintFull();
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
        QStringLiteral("org.cc.CCNiriBridge"),
        QStringLiteral("/CCNiriBridge"),
        QStringLiteral("org.cc.CCNiriBridge1"),
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
        || m_scrollClipHandoff.active() || !m_activeWindows.isEmpty()
        || effects->property(CcNiri::CompositorFrameDemandProperty).value<quintptr>() != 0;
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
    configureAnimationProfile();
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
            requestRepaintFull();
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
        const bool track = m_scrollPaintDepth && m_scrollPaintDepth <= m_scrollPaintPasses.size()
            && (m_animationProfile == CcNiri::AnimationProfile::Smooth60 || m_scrollCapture.recording);
        const auto sample = track ? m_scrollRuntime.frameSample() : CcNiriScrollSample{};
        const size_t passIndex = m_scrollPaintDepth ? m_scrollPaintDepth - 1 : 0;
        // Script Pair/Wide supplies the paint transform while the same Native
        // handle protects a partially visible surface's viewport and input.
        // Pure Scroll ownership clears the Script marker before committing.
        if (!scriptPaint && !m_activeWindows.contains(window)) {
            data.setXTranslation(data.xTranslation() + projection->translationX);
        }
        const auto rect = departure ? projection->viewport.translated(0, data.yTranslation()) : projection->viewport;
        const Region clipped = viewportPaintClip(window->windowItem(), viewport,
            RectF(rect.x(), rect.y(), rect.width(), rect.height()), deviceRegion);
        const ScopedViewportPaintContext decorationContext(window->windowItem(), viewport,
            RectF(rect.x(), rect.y(), rect.width(), rect.height()), deviceRegion);
        effects->paintWindow(renderTarget, viewport, window, mask | PAINT_WINDOW_TRANSFORMED, clipped, data);
        if (track && !departure && sample.valid && !clipped.isEmpty()) {
            auto &pass = m_scrollPaintPasses[passIndex];
            if (pass.real && pass.output == m_scrollTargetOutput && pass.output == window->screen()
                && pass.revision == m_scrollRevision && !pass.recorded
                && (m_animationProfile == CcNiri::AnimationProfile::Stable || pass.sampleNs == sample.time_ns)) {
                const bool painted = m_animationProfile == CcNiri::AnimationProfile::Stable
                    || m_scrollRuntime.markPainted(sample.epoch, sample.time_ns);
                if (painted) {
                    pass.recorded = true;
                    const auto now = m_scrollCapture.recording ? motionNow().count() : 0;
                    if (m_scrollCapture.active(now) && m_scrollCapturedSerial != pass.serial) {
                        const auto origin = m_scrollRuntime.originSample();
                        m_scrollCapture.record({pass.serial, captureOutputToken(pass.output), pass.revision,
                            sample.epoch, m_scrollEventTime, pass.predictedNs, sample.time_ns, now,
                            sample.position, sample.velocity, sample.target, viewport.scale(), pass.refreshHz,
                            pass.fallback, sample.completed != 0, m_scrollRuntime.active(), origin.position, origin.time_ns, m_animationProfile, origin.velocity});
                        m_scrollCapturedSerial = pass.serial;
                    }
                }
            }
        }
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
    const ScopedViewportPaintContext decorationContext(window->windowItem(), viewport, logicalClip, deviceRegion);
    effects->paintWindow(renderTarget, viewport, window, mask, clipped, data);
    const QVariantMap motion = window->data(MotionPlanDataRole).toMap();
    if (marker.value(QStringLiteral("role")).toString() ==
            QStringLiteral("outgoing") &&
            motion.value(QStringLiteral("type")).toString() ==
                QStringLiteral("PAIR_TO_WIDE")) {
        // Keep invalidating the old and translated bounds for every frame.
        // A click/screenshot previously forced this repaint externally.
        requestRepaintFull();
    }
}

} // namespace KWin

#include "moc_ViewportClipEffect.cpp"
