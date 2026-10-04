/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingEffect.h"
#include "core/output.h"
#include "effect/effecthandler.h"
#include "scene/windowitem.h"
#include "scene/scene.h"
#include "virtualdesktops.h"
#include "window.h"
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QDBusServiceWatcher>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>
#include <KConfigGroup>
#include <KSharedConfig>
#include <algorithm>
#include <cmath>

Q_LOGGING_CATEGORY(CC_NIRI_FOCUS_RING, "cc.niri.focus.ring")
namespace KWin {
static QString windowId(EffectWindow *window) {
    return window->internalId().toString(QUuid::WithoutBraces).toLower();
}
CcNiriFocusRingEffect::CcNiriFocusRingEffect() {
    m_endpointRegistered = QDBusConnection::sessionBus().registerObject(
        QStringLiteral("/ccNiriFocusRing"), this, QDBusConnection::ExportScriptableSlots);
    for (auto *window : effects->stackingOrder()) watchWindow(window);
    connect(effects, &EffectsHandler::windowAdded, this, [this](EffectWindow *window) { watchWindow(window); refresh(); });
    connect(effects, &EffectsHandler::windowActivated, this, [this](EffectWindow *) { refresh(); });
    connect(effects, &EffectsHandler::windowClosed, this, [this](EffectWindow *window) {
        if (m_context.windows.contains(windowId(window))) m_closedIds.insert(windowId(window));
        m_watched.remove(window);
        if (m_owner == window) clearRing();
    });
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        m_watched.remove(window);
        if (m_owner == window) clearRing();
    });
    connect(effects, &EffectsHandler::desktopChanged, this,
        [this](VirtualDesktop *, VirtualDesktop *, EffectWindow *, LogicalOutput *) { refresh(); });
    connect(effects, &EffectsHandler::screenRemoved, this, [this](LogicalOutput *) { clearRing(); });
    connect(effects, &EffectsHandler::currentActivityChanged, this, [this](const QString &) { refresh(); });
    connect(effects, &EffectsHandler::showingDesktopChanged, this, [this](bool) { refresh(); });
    connect(effects, &EffectsHandler::screenLockingChanged, this, [this](bool) { refresh(); });
    connect(effects, &EffectsHandler::hasActiveFullScreenEffectChanged, this, [this] { refresh(); });
    QDBusConnection::sessionBus().connect(QStringLiteral("org.cc.ScrollDockBridge"), QStringLiteral("/ScrollDock"),
        QStringLiteral("org.cc.ScrollDockBridge1"), QStringLiteral("StateChanged"), this, SLOT(onDockStateChanged(QString)));
    auto *watcher = new QDBusServiceWatcher(QStringLiteral("org.cc.ScrollDockBridge"), QDBusConnection::sessionBus(),
        QDBusServiceWatcher::WatchForOwnerChange, this);
    connect(watcher, &QDBusServiceWatcher::serviceOwnerChanged, this, [this](const QString &, const QString &, const QString &owner) {
        ++m_contextRevision; m_context.clear(); clearRing();
        if (!owner.isEmpty()) requestContext();
    });
    reconfigure(ReconfigureAll);
    requestContext();
    qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] READY isolated post-window border";
}
CcNiriFocusRingEffect::~CcNiriFocusRingEffect() {
    ++m_contextRevision;
    clearRing();
    if (m_endpointRegistered) QDBusConnection::sessionBus().unregisterObject(QStringLiteral("/ccNiriFocusRing"));
}
void CcNiriFocusRingEffect::reconfigure(ReconfigureFlags) {
    const auto config = KSharedConfig::openConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals);
    config->reparseConfiguration();
    const qreal overrideRadius = KConfigGroup(config, QStringLiteral("Effect-cc-niri-focus-ring"))
        .readEntry("CornerRadius", -1.0);
    m_configuredRadius = std::isfinite(overrideRadius) && overrideRadius >= 0 ? std::min(overrideRadius, 128.0) : -1;
    // The external shader does not publish its radius on WindowItem. Read its
    // active setting once on effect load/reconfigure; do not poll per frame.
    m_roundCornersRadius = 0;
    if (effects->loadedEffects().contains(QStringLiteral("kwin4_effect_shapecorners"))) {
        const qreal radius = KConfigGroup(config, QStringLiteral("Round-Corners")).readEntry("Size", 12.0);
        if (std::isfinite(radius)) m_roundCornersRadius = std::clamp(radius, 0.0, 128.0);
    }
    refresh();
}
void CcNiriFocusRingEffect::requestContext() {
    const quint64 revision = ++m_contextRevision;
    const auto request = QDBusMessage::createMethodCall(QStringLiteral("org.cc.ScrollDockBridge"), QStringLiteral("/ScrollDock"),
        QStringLiteral("org.cc.ScrollDockBridge1"), QStringLiteral("GetState"));
    auto *watcher = new QDBusPendingCallWatcher(QDBusConnection::sessionBus().asyncCall(request), this);
    connect(watcher, &QDBusPendingCallWatcher::finished, this, [this, watcher, revision] {
        const QDBusPendingReply<QString> reply = *watcher;
        if (revision == m_contextRevision) {
            if (!reply.isError()) onDockStateChanged(reply.value());
            else { m_context.clear(); clearRing(); }
        }
        watcher->deleteLater();
    });
}
void CcNiriFocusRingEffect::onDockStateChanged(const QString &json) {
    ++m_contextRevision;
    m_context.update(json);
    m_closedIds.intersect(m_context.windows);
    refresh();
}
void CcNiriFocusRingEffect::watchWindow(EffectWindow *window) {
    if (!window || m_watched.contains(window)) return;
    m_watched.insert(window);
    const auto update = [this](EffectWindow *) { refresh(); };
    connect(window, &EffectWindow::windowFrameGeometryChanged, this, [this](EffectWindow *, const RectF &) { refresh(); });
    connect(window, &EffectWindow::windowFullScreenChanged, this, update);
    connect(window, &EffectWindow::minimizedChanged, this, update);
    connect(window, &EffectWindow::windowHiddenChanged, this, update);
    connect(window, &EffectWindow::windowDesktopsChanged, this, update);
    connect(window, &EffectWindow::windowOpacityChanged, this, [this](EffectWindow *, qreal, qreal) { refresh(); });
    if (auto *nativeWindow = window->window()) {
        connect(nativeWindow, &Window::outputChanged, this, [this](LogicalOutput *) { refresh(); });
        connect(nativeWindow, &Window::activitiesChanged, this, [this] { refresh(); });
        connect(nativeWindow, &Window::skipTaskbarChanged, this, [this] { refresh(); });
        connect(nativeWindow, &Window::transientChanged, this, [this] { refresh(); });
        connect(nativeWindow, &Window::modalChanged, this, [this] { refresh(); });
    }
}
bool CcNiriFocusRingEffect::eligible(EffectWindow *window) const {
    if (!window || m_closedIds.contains(windowId(window)) || effects->isScreenLocked() || effects->hasActiveFullScreenEffect()) return false;
    const auto *output = window->screen();
    const auto *desktop = output ? effects->currentDesktop(window->screen()) : nullptr;
    if (!output || !desktop || !window->windowItem() || !window->window()
        || window->window()->skipTaskbar() || window->isDialog() || window->isModal()
        || window->isPopupWindow() || window->isSpecialWindow()) return false;
    CcNiri::FocusRingCandidate candidate;
    candidate.id = windowId(window); candidate.output = output->name(); candidate.workspace = desktop->id();
    candidate.active = effects->activeWindow() == window;
    candidate.managed = window->isManaged(); candidate.normal = window->isNormalWindow();
    candidate.visible = window->isVisible() && window->windowItem()->isVisible();
    candidate.onCurrentDesktop = window->isOnCurrentDesktop();
    candidate.onCurrentActivity = window->isOnCurrentActivity();
    candidate.minimized = window->isMinimized(); candidate.deleted = window->isDeleted();
    candidate.fullscreen = window->isFullScreen(); candidate.opacity = window->opacity();
    candidate.insideOutput = window->frameGeometry().isValid() && window->frameGeometry().intersects(output->geometry());
    return m_context.permits(candidate);
}
void CcNiriFocusRingEffect::refresh() {
    auto *active = effects->activeWindow();
    if (!eligible(active)) { clearRing(); return; }
    if (m_owner != active) clearRing();
    auto *item = active->windowItem();
    BorderRadius radius = item->windowContainer()->borderRadius();
    if (m_configuredRadius >= 0 || m_roundCornersRadius > 0) {
        const qreal limit = std::min(active->frameGeometry().width(), active->frameGeometry().height()) / 2;
        radius = BorderRadius(std::min(m_configuredRadius >= 0 ? m_configuredRadius : m_roundCornersRadius, limit));
    }
    if (!m_ring.attach(item, item->windowContainer(), active->frameGeometry().size(), radius)) { clearRing(); return; }
    if (!m_owner) qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] ARM" << windowId(active);
    m_owner = active;
}
void CcNiriFocusRingEffect::clearRing() {
    if (m_owner) qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] CLEAR" << windowId(m_owner.data());
    m_ring.clear(); m_owner = nullptr;
}
int CcNiriFocusRingEffect::requestedEffectChainPosition() const { return 96; }
void CcNiriFocusRingEffect::paintWindow(const RenderTarget &target, const RenderViewport &viewport,
        EffectWindow *window, int mask, const Region &region, WindowPaintData &data) {
    // Native viewport clip (95) has already applied Spring translation and
    // clipping. Finish this window's effects, then draw only its ring, before
    // KWin paints any higher window. This callback is not in drawWindow, so an
    // OffscreenEffect's recursive capture cannot include our colored pixels.
    const WindowPaintData ringData(data);
    effects->paintWindow(target, viewport, window, mask, region, data);
    if (m_owner != window || !eligible(window)) return;
    auto *scene = window->windowItem()->scene();
    if (scene && m_ring.paint(scene->renderer(), target, viewport, mask, region, ringData)) ++m_drawCount;
}
bool CcNiriFocusRingEffect::isActive() const { return m_ring.attached() && eligible(m_owner.data()); }
bool CcNiriFocusRingEffect::blocksDirectScanout() const { return isActive(); }
QString CcNiriFocusRingEffect::GetFocusRingStatus() const {
    return QString::fromUtf8(QJsonDocument(QJsonObject{
        {QStringLiteral("phase"), QStringLiteral("static-isolated-border-poc")},
        {QStringLiteral("renderer"), QStringLiteral("post-window-native-item")},
        {QStringLiteral("drawCount"), double(m_drawCount)},
        {QStringLiteral("windowOpacity"), m_owner ? m_owner->opacity() : 0.0},
        {QStringLiteral("active"), isActive()},
        {QStringLiteral("windowUuid"), m_owner ? windowId(m_owner.data()) : QString()},
        {QStringLiteral("targetOutput"), m_context.output}, {QStringLiteral("workspaceId"), m_context.workspace},
        {QStringLiteral("cornerRadius"), m_ring.attached() ? m_ring.border()->outline().radius().topLeft() : 0.0},
        {QStringLiteral("width"), FocusRingItem::Width}, {QStringLiteral("color"), QStringLiteral("#7FC8FF")}
    }).toJson(QJsonDocument::Compact));
}
}
