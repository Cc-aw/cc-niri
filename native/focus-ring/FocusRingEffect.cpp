/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingEffect.h"
#include "FocusRingPaintFrame.h"
#include "FocusRingStrokeItem.h"
#include "../common/CompositorFrameContext.h"
#include "../common/LoadedComponentPath.h"
#include "core/output.h"
#include "effect/effecthandler.h"
#include "scene/windowitem.h"
#include "scene/scene.h"
#include "virtualdesktops.h"
#include "window.h"
#include "workspace.h"
#include <algorithm>
#include <QJsonArray>
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
        if (m_context.windows.contains(m_watched.value(window))) m_closedIds.insert(m_watched.value(window));
        removeWindow(window);
        m_watched.remove(window);
        refresh();
    });
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        removeWindow(window);
        m_watched.remove(window);
        refresh();
    });
    connect(effects, &EffectsHandler::desktopChanged, this,
        [this](VirtualDesktop *, VirtualDesktop *, EffectWindow *, LogicalOutput *) { clearRing(); refresh(); });
    connect(effects, &EffectsHandler::screenRemoved, this, [this](LogicalOutput *) { clearRing(); });
    connect(effects, &EffectsHandler::currentActivityChanged, this, [this](const QString &) { clearRing(); refresh(); });
    connect(effects, &EffectsHandler::showingDesktopChanged, this, [this](bool) { clearRing(); refresh(); });
    connect(effects, &EffectsHandler::screenLockingChanged, this, [this](bool) { clearRing(); refresh(); });
    connect(effects, &EffectsHandler::hasActiveFullScreenEffectChanged, this, [this] { clearRing(); refresh(); });
    reconfigure(ReconfigureAll);
    requestEligibility();
    qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] READY isolated post-window border coreBackend=" << CcNiri::FocusRingCoreBackendName;
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
    const auto session = m_context.session, workspace = m_context.workspace, output = m_context.output;
    const bool accepted = m_context.update(json);
    if (!m_context.enabled || session != m_context.session || workspace != m_context.workspace || output != m_context.output) clearRing();
    m_closedIds.intersect(m_context.windows);
    refresh();
    return accepted;
}
bool CcNiriFocusRingEffect::SetGlowOnlyDiagnostic(bool enabled) {
    if (m_glowOnlyDiagnostic != enabled) {
        m_glowOnlyDiagnostic = enabled;
        for (const auto &visual : m_visuals)
            if (auto *damage = visual->ring.damageItem()) damage->scheduleRepaint(damage->rect());
    }
    return true;
}
void CcNiriFocusRingEffect::watchWindow(EffectWindow *window) {
    if (!window || m_watched.contains(window)) return;
    m_watched.insert(window, windowId(window));
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
bool CcNiriFocusRingEffect::eligible(EffectWindow *window, bool decoration) const {
    if (!window || !m_watched.contains(window) || m_closedIds.contains(m_watched.value(window))
        || effects->isScreenLocked() || effects->hasActiveFullScreenEffect() || workspace()->showingDesktop()) return false;
    const auto *output = window->screen();
    const auto *desktop = output ? effects->currentDesktop(window->screen()) : nullptr;
    if (!output || !desktop || !window->windowItem() || !window->window()
        || window->window()->skipTaskbar() || window->window()->isTransient()
        || window->isUtility() || window->isToolbar() || window->isDialog() || window->isModal()
        || window->isPopupWindow() || window->isSpecialWindow()) return false;
    CcNiri::FocusRingCandidate candidate;
    candidate.id = m_watched.value(window); candidate.output = output->name(); candidate.workspace = desktop->id();
    candidate.active = effects->activeWindow() == window;
    candidate.managed = window->isManaged(); candidate.normal = window->isNormalWindow();
    candidate.visible = window->isVisible() && window->windowItem()->isVisible();
    candidate.onCurrentDesktop = window->isOnCurrentDesktop();
    candidate.onCurrentActivity = window->isOnCurrentActivity();
    candidate.minimized = window->isMinimized(); candidate.deleted = window->isDeleted();
    candidate.fullscreen = window->isFullScreen(); candidate.opacity = window->opacity();
    candidate.insideOutput = window->frameGeometry().isValid() && window->frameGeometry().intersects(output->geometry());
    return decoration ? m_context.permitsDecoration(candidate) : m_context.permits(candidate);
}
std::shared_ptr<CcNiriFocusRingEffect::Visual> CcNiriFocusRingEffect::visualFor(EffectWindow *window) const {
    for (const auto &visual : m_visuals) if (visual->window == window) return visual;
    return {};
}
void CcNiriFocusRingEffect::removeWindow(EffectWindow *window) {
    std::erase_if(m_visuals, [window](const auto &visual) {
        if (visual->window != window) return false;
        // Invalidate captured attachments even when downstream paint retains
        // the Visual itself. QPointer also guards actual window destruction.
        visual->ring.clear();
        return true;
    });
    if (m_owner == window) m_owner = nullptr;
    updateFrameDemand();
}
void CcNiriFocusRingEffect::updateFrameDemand() {
    const auto token = reinterpret_cast<quintptr>(this);
    const bool pending = std::any_of(m_visuals.begin(), m_visuals.end(), [](const auto &visual) {
        return visual->fade.sample().active != 0;
    });
    if (pending) {
        if (effects->property(CcNiri::CompositorFrameDemandProperty).value<quintptr>() != token)
            effects->setProperty(CcNiri::CompositorFrameDemandProperty, QVariant::fromValue(token));
    } else if (effects->property(CcNiri::CompositorFrameDemandProperty).value<quintptr>() == token) {
        effects->setProperty(CcNiri::CompositorFrameDemandProperty, QVariant());
    }
}
void CcNiriFocusRingEffect::refresh() {
    auto *active = effects->activeWindow();
    if (!m_context.enabled || effects->isScreenLocked() || effects->hasActiveFullScreenEffect()
        || workspace()->showingDesktop() || (active && active->isFullScreen())) {
        clearRing();
        return;
    }
    std::erase_if(m_visuals, [this](const auto &visual) {
        if (eligible(visual->window.data(), true)) return false;
        visual->ring.clear();
        return true;
    });
    auto *desired = eligible(active) ? active : nullptr;
    const bool changed = m_owner != desired;
    m_owner = desired; // Only the actual KWin active window can own focus.
    if (desired && !visualFor(desired)) m_visuals.push_back(std::make_shared<Visual>(desired));
    std::erase_if(m_visuals, [this, changed](const auto &visual) {
        auto *window = visual->window.data();
        auto *item = window->windowItem();
        const auto radius = m_cornerStyle.radius(item->windowContainer()->borderRadius(), window->frameGeometry().size());
        if (!visual->ring.attach(item, item->windowContainer(), window->frameGeometry().size(), radius)
            || visual->fade.retarget(window == m_owner).retired) {
            visual->ring.clear();
            if (m_owner == window) m_owner = nullptr;
            return true;
        }
        if (changed) if (auto *damage = visual->ring.damageItem()) damage->scheduleRepaint(damage->rect());
        return false;
    });
    if (changed) qCInfo(CC_NIRI_FOCUS_RING) << "[FOCUS_RING] FOCUS" << (m_owner ? m_watched.value(m_owner.data()) : QString());
    updateFrameDemand();
}
void CcNiriFocusRingEffect::clearRing() {
    for (const auto &visual : m_visuals) visual->ring.clear();
    m_visuals.clear();
    m_owner = nullptr;
    updateFrameDemand();
}
void CcNiriFocusRingEffect::prePaintScreen(ScreenPrePaintData &data) {
    const bool rounded = effects->findEffect(QStringLiteral("kwin4_effect_shapecorners")) != nullptr;
    if (rounded != m_cornerStyle.roundCornersLoaded()) m_cornerStyle.reconfigure(rounded);
    refresh();
    const auto frame = CcNiri::ScopedCompositorFrame::snapshot(effects);
    const auto output = reinterpret_cast<uintptr_t>(data.screen);
    const size_t depth = m_paintDepth++;
    bool real = depth < m_paintPasses.size() && frame && frame->real && frame->output == output;
    for (size_t i = 0; i < std::min(depth, m_paintPasses.size()); ++i)
        if (m_paintPasses[i].real && m_paintPasses[i].output == output) real = false;
    if (depth < m_paintPasses.size()) m_paintPasses[depth] = {output, real};
    if (real) {
        ++m_sharedFrameSamples;
        std::erase_if(m_visuals, [&frame, output](const auto &visual) {
            if (reinterpret_cast<uintptr_t>(visual->window->screen()) != output) return false;
            if (!visual->fade.advance(frame->presentationNs).retired) return false;
            visual->ring.clear();
            return true;
        });
        updateFrameDemand();
    }
    effects->prePaintScreen(data);
}
void CcNiriFocusRingEffect::postPaintScreen() {
    effects->postPaintScreen();
    if (!m_paintDepth) return;
    const size_t depth = --m_paintDepth;
    if (depth >= m_paintPasses.size()) return;
    const auto pass = m_paintPasses[depth];
    m_paintPasses[depth] = {};
    if (!pass.real) return;
    for (const auto &visual : m_visuals) {
        if (!visual->window || reinterpret_cast<uintptr_t>(visual->window->screen()) != pass.output
            || !visual->fade.sample().active) continue;
        if (auto *damage = visual->ring.damageItem()) {
            damage->scheduleRepaint(damage->rect());
            ++m_fadeRepaintRequests;
        }
    }
}
int CcNiriFocusRingEffect::requestedEffectChainPosition() const { return 96; }
void CcNiriFocusRingEffect::paintWindow(const RenderTarget &target, const RenderViewport &viewport,
        EffectWindow *window, int mask, const Region &region, WindowPaintData &data) {
    // Native viewport clip (95) has already applied Spring translation and
    // clipping. Finish this window's effects, then draw only its ring, before
    // KWin paints any higher window. This callback is not in drawWindow, so an
    // OffscreenEffect's recursive capture cannot include our colored pixels.
    const auto visual = visualFor(window);
    const auto frame = visual && eligible(window, true)
        ? visual->ring.capture(mask, region, data, visual->fade.sample().opacity, visual->fade.glowMix()) : std::nullopt;
    effects->paintWindow(target, viewport, window, mask, region, data);
    if (!frame || !visual->window || !eligible(window, true)) return;
    const Region outputRegion = Region(viewport.mapToDeviceCoordinates(window->screen()->geometry()).rounded())
        & viewport.deviceRect();
    if (outputRegion.isEmpty()) ++m_otherOutputPaintSkips;
    auto *scene = window->windowItem()->scene();
    if (scene && visual->ring.paint(scene->renderer(), target, viewport, *frame, m_glowOnlyDiagnostic, outputRegion)) {
        ++m_drawCount;
        if (frame->hasViewportContext()) ++m_separateGlowClipDrawCount;
    }
}
bool CcNiriFocusRingEffect::isActive() const {
    return std::any_of(m_visuals.begin(), m_visuals.end(), [this](const auto &visual) {
        return visual->ring.attached() && eligible(visual->window.data(), true);
    });
}
bool CcNiriFocusRingEffect::blocksDirectScanout() const { return isActive(); }
QString CcNiriFocusRingEffect::GetFocusRingStatus() const {
    static const char component[]="cc-niri-focus-ring/component";
    const auto owner = visualFor(m_owner.data());
    int rasterizations = 0, transitions = 0;
    QJsonArray visuals;
    for (const auto &visual : m_visuals) {
        const auto sample = visual->fade.sample();
        transitions += sample.active != 0;
        if (visual->ring.glow()) rasterizations += visual->ring.glow()->rasterizations();
        if (visual->ring.gainGlow()) rasterizations += visual->ring.gainGlow()->rasterizations();
        visuals.append(QJsonObject{{QStringLiteral("windowUuid"), m_watched.value(visual->window.data())},
            {QStringLiteral("opacity"), sample.opacity}, {QStringLiteral("glowGainMix"), visual->fade.glowMix()}, {QStringLiteral("transitionActive"), bool(sample.active)},
            {QStringLiteral("focused"), visual->window == m_owner}});
    }
    return QString::fromUtf8(QJsonDocument(QJsonObject{
        {QStringLiteral("coreBackend"), QString::fromLatin1(CcNiri::FocusRingCoreBackendName)},
        {QStringLiteral("binaryPath"), CcNiri::loadedComponentPath(component)},
        {QStringLiteral("phase"), QStringLiteral("focus-gain-f3")},
        {QStringLiteral("eligibilitySource"), QStringLiteral("layout-script")},
        {QStringLiteral("eligibilityEnabled"), m_context.enabled},
        {QStringLiteral("nativeProtocolBackend"), QString::fromLatin1(CcNiri::FocusRingProtocolBackendName)},
        {QStringLiteral("sessionId"), m_context.session},
        {QStringLiteral("generation"), double(m_context.generation)},
        {QStringLiteral("eligibleCount"), m_context.windows.size()},
        {QStringLiteral("renderer"), QStringLiteral("post-window-native-item")},
        {QStringLiteral("paintSource"), QStringLiteral("window-paint-pass")},
        {QStringLiteral("frameLifetime"), QStringLiteral("scene-attachment")},
        {QStringLiteral("strokeGeometry"), QStringLiteral("paint-frame-fixed-width")},
        {QStringLiteral("pixelAlignment"), QStringLiteral("native-child-rounding-compensated")},
        {QStringLiteral("drawCount"), double(m_drawCount)},
        {QStringLiteral("separateGlowClipDrawCount"), double(m_separateGlowClipDrawCount)},
        {QStringLiteral("paintOutputScope"), QStringLiteral("owner-output-region")},
        {QStringLiteral("otherOutputPaintSkips"), double(m_otherOutputPaintSkips)},
        {QStringLiteral("windowOpacity"), m_owner ? m_owner->opacity() : 0.0},
        {QStringLiteral("active"), isActive()},
        {QStringLiteral("windowUuid"), m_owner ? windowId(m_owner.data()) : QString()},
        {QStringLiteral("targetOutput"), m_context.output}, {QStringLiteral("workspaceId"), m_context.workspace},
        {QStringLiteral("cornerSource"), m_cornerStyle.source()},
        {QStringLiteral("cornerRadius"), owner && owner->ring.attached() ? owner->ring.border()->outline().radius().topLeft() : 0.0},
        {QStringLiteral("width"), FocusRingItem::Width}, {QStringLiteral("color"), QStringLiteral("#7FC8FF")},
        {QStringLiteral("borderAlpha"), FocusRingItem::BorderAlpha},
        {QStringLiteral("glowRadius"), FocusRingItem::GlowRadius},
        {QStringLiteral("glowExtent"), FocusRingItem::GlowExtent},
        {QStringLiteral("glowAlpha"), FocusRingItem::GlowAlpha},
        {QStringLiteral("glowFalloff"), QStringLiteral("gaussian-three-sigma")},
        {QStringLiteral("glowClip"), QStringLiteral("separate-viewport-native-occlusion")},
        {QStringLiteral("glowOnlyDiagnostic"), m_glowOnlyDiagnostic},
        {QStringLiteral("paintOutset"), FocusRingItem::PaintOutset},
        {QStringLiteral("viewportOutset"), FocusRingItem::ViewportOutset},
        {QStringLiteral("glowRasterizations"), rasterizations},
        {QStringLiteral("focusAnimation"), true},
        {QStringLiteral("focusDurationMs"), 140},
        {QStringLiteral("glowGain"), true},
        {QStringLiteral("glowGainStartExtent"), FocusRingItem::GainGlowExtent},
        {QStringLiteral("glowGainEndExtent"), FocusRingItem::GlowExtent},
        {QStringLiteral("glowGainRenderer"), QStringLiteral("cached-profile-blend")},
        {QStringLiteral("focusClock"), QStringLiteral("clip-shared-presentation")},
        {QStringLiteral("sharedFrameSamples"), double(m_sharedFrameSamples)},
        {QStringLiteral("fadeRepaintRequests"), double(m_fadeRepaintRequests)},
        {QStringLiteral("activeTransitionCount"), transitions},
        {QStringLiteral("outgoingDecorationCount"), int(m_visuals.size()) - int(bool(owner))},
        {QStringLiteral("visuals"), visuals}
    }).toJson(QJsonDocument::Compact));
}
}
