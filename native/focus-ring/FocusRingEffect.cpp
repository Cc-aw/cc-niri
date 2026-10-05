/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingEffect.h"
#include "FocusRingPaintFrame.h"
#include "core/output.h"
#include "effect/effecthandler.h"
#include "scene/windowitem.h"
#include "scene/scene.h"
#include "virtualdesktops.h"
#include "window.h"
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>

Q_LOGGING_CATEGORY(CC_NIRI_FOCUS_RING, "cc.niri.focus.ring")
namespace KWin {
static QString windowId(EffectWindow *window) {
    return window->internalId().toString(QUuid::WithoutBraces).toLower();
}
CcNiriFocusRingEffect::CcNiriFocusRingEffect() {
    connect(&m_cornerStyle, &FocusRingCornerStyle::changed, this, [this] { refresh(); });
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
    reconfigure(ReconfigureAll);
    requestEligibility();
    qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] READY isolated post-window border";
}
CcNiriFocusRingEffect::~CcNiriFocusRingEffect() {
    clearRing();
    if (m_endpointRegistered) QDBusConnection::sessionBus().unregisterObject(QStringLiteral("/ccNiriFocusRing"));
}
void CcNiriFocusRingEffect::reconfigure(ReconfigureFlags) {
    m_cornerStyle.reconfigure(effects->loadedEffects().contains(QStringLiteral("kwin4_effect_shapecorners")));
}
void CcNiriFocusRingEffect::requestEligibility() {
    // The dedicated no-key shortcut answers after effect load/on with current
    // script membership. There is no Dock cache, polling or late GetState reply.
    auto request = QDBusMessage::createMethodCall(QStringLiteral("org.kde.kglobalaccel"),
        QStringLiteral("/component/kwin"), QStringLiteral("org.kde.kglobalaccel.Component"),
        QStringLiteral("invokeShortcut"));
    request << QStringLiteral("CCScrollPublishFocusRingState");
    QDBusConnection::sessionBus().asyncCall(request);
}
bool CcNiriFocusRingEffect::PublishEligibility(const QString &json) {
    const bool accepted = m_context.update(json);
    m_closedIds.intersect(m_context.windows);
    refresh();
    return accepted;
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
        || window->window()->skipTaskbar() || window->window()->isTransient()
        || window->isUtility() || window->isToolbar() || window->isDialog() || window->isModal()
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
    const BorderRadius radius = m_cornerStyle.radius(item->windowContainer()->borderRadius(), active->frameGeometry().size());
    if (!m_ring.attach(item, item->windowContainer(), active->frameGeometry().size(), radius)) { clearRing(); return; }
    if (!m_owner) qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] ARM" << windowId(active);
    m_owner = active;
}
void CcNiriFocusRingEffect::clearRing() {
    if (m_owner) qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] CLEAR" << windowId(m_owner.data());
    m_ring.clear(); m_owner = nullptr;
}
void CcNiriFocusRingEffect::prePaintScreen(ScreenPrePaintData &data) {
    // KWin has no public effect-load-change signal. A cheap presence check in
    // an existing paint pass catches late startup loads and runtime unloads;
    // configuration is reparsed only on a state transition, never every frame.
    const bool rounded = effects->findEffect(QStringLiteral("kwin4_effect_shapecorners")) != nullptr;
    if (rounded != m_cornerStyle.roundCornersLoaded()) m_cornerStyle.reconfigure(rounded);
    effects->prePaintScreen(data);
}
int CcNiriFocusRingEffect::requestedEffectChainPosition() const { return 96; }
void CcNiriFocusRingEffect::paintWindow(const RenderTarget &target, const RenderViewport &viewport,
        EffectWindow *window, int mask, const Region &region, WindowPaintData &data) {
    // Native viewport clip (95) has already applied Spring translation and
    // clipping. Finish this window's effects, then draw only its ring, before
    // KWin paints any higher window. This callback is not in drawWindow, so an
    // OffscreenEffect's recursive capture cannot include our colored pixels.
    const auto frame = m_owner == window && eligible(window)
        ? m_ring.capture(mask, region, data) : std::nullopt;
    effects->paintWindow(target, viewport, window, mask, region, data);
    if (!frame || m_owner != window || !eligible(window)) return;
    auto *scene = window->windowItem()->scene();
    if (scene && m_ring.paint(scene->renderer(), target, viewport, *frame)) ++m_drawCount;
}
bool CcNiriFocusRingEffect::isActive() const { return m_ring.attached() && eligible(m_owner.data()); }
bool CcNiriFocusRingEffect::blocksDirectScanout() const { return isActive(); }
QString CcNiriFocusRingEffect::GetFocusRingStatus() const {
    return QString::fromUtf8(QJsonDocument(QJsonObject{
        {QStringLiteral("phase"), QStringLiteral("hidpi")},
        {QStringLiteral("eligibilitySource"), QStringLiteral("layout-script")},
        {QStringLiteral("eligibilityEnabled"), m_context.enabled},
        {QStringLiteral("sessionId"), m_context.session},
        {QStringLiteral("generation"), double(m_context.generation)},
        {QStringLiteral("eligibleCount"), m_context.windows.size()},
        {QStringLiteral("renderer"), QStringLiteral("post-window-native-item")},
        {QStringLiteral("paintSource"), QStringLiteral("window-paint-pass")},
        {QStringLiteral("frameLifetime"), QStringLiteral("scene-attachment")},
        {QStringLiteral("strokeGeometry"), QStringLiteral("paint-frame-fixed-width")},
        {QStringLiteral("pixelAlignment"), QStringLiteral("native-child-rounding-compensated")},
        {QStringLiteral("drawCount"), double(m_drawCount)},
        {QStringLiteral("windowOpacity"), m_owner ? m_owner->opacity() : 0.0},
        {QStringLiteral("active"), isActive()},
        {QStringLiteral("windowUuid"), m_owner ? windowId(m_owner.data()) : QString()},
        {QStringLiteral("targetOutput"), m_context.output}, {QStringLiteral("workspaceId"), m_context.workspace},
        {QStringLiteral("cornerSource"), m_cornerStyle.source()},
        {QStringLiteral("cornerRadius"), m_ring.attached() ? m_ring.border()->outline().radius().topLeft() : 0.0},
        {QStringLiteral("width"), FocusRingItem::Width}, {QStringLiteral("color"), QStringLiteral("#7FC8FF")}
    }).toJson(QJsonDocument::Compact));
}
}
