/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "WorkspaceSlideAdapter.h"
#include "ViewportClipEffect.h"
#include "core/output.h"
#include "core/renderviewport.h"
#include "effect/effecthandler.h"
#include "scene/scene.h"
#include "virtualdesktops.h"
#include <KConfigGroup>
#include <algorithm>
#include <chrono>
#include <cstdlib>

namespace KWin {
static qint64 workspaceNow()
{
    return std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
static CcNiriPoint desktopPoint(VirtualDesktop *desktop)
{
    const auto point = effects->desktopGridCoords(desktop);
    return {double(point.x()), double(point.y())};
}
static void workspaceCheck(uint32_t status)
{
    if (status != CC_NIRI_FFI_OK) std::abort();
}
WorkspaceSlideAdapter::ScreenBinding::ScreenBinding() : motion(cc_niri_workspace_create())
{
    if (!motion) std::abort();
}
WorkspaceSlideAdapter::ScreenBinding::~ScreenBinding() { cc_niri_workspace_destroy(motion); }

WorkspaceSlideAdapter::WorkspaceSlideAdapter(CcNiriViewportClipEffect *owner) : QObject(owner), m_owner(owner)
{
    reconfigure();
    connect(effects, &EffectsHandler::desktopChanged, this, &WorkspaceSlideAdapter::desktopChanged);
    connect(effects, &EffectsHandler::desktopChanging, this, &WorkspaceSlideAdapter::desktopChanging);
    connect(effects, QOverload<>::of(&EffectsHandler::desktopChangingCancelled), this, &WorkspaceSlideAdapter::cancelGesture);
    connect(effects, &EffectsHandler::screenRemoved, this, &WorkspaceSlideAdapter::finish);
    connect(effects, &EffectsHandler::screenAdded, this, [this](LogicalOutput *) { finishAll(); });
    connect(effects, &EffectsHandler::desktopAdded, this, [this](VirtualDesktop *) { finishAll(); });
    connect(effects, &EffectsHandler::desktopRemoved, this, [this](VirtualDesktop *) { finishAll(); });
    connect(effects, &EffectsHandler::currentActivityAboutToChange, this, [this]() {
        m_switchingActivity = true;
        finishAll();
    });
    connect(effects, &EffectsHandler::currentActivityChanged, this, [this]() { m_switchingActivity = false; });
    connect(effects, &EffectsHandler::activeFullScreenEffectChanged, this, [this]() {
        if (active() && effects->activeFullScreenEffect() != m_owner) finishAll();
    });
    connect(effects, &EffectsHandler::windowAdded, this, [this](EffectWindow *window) {
        if (auto binding = m_screens.value(window->screen())) bindWindow(*binding, window);
    });
    connect(effects, &EffectsHandler::windowDeleted, this, [this](EffectWindow *window) {
        for (const auto &binding : std::as_const(m_screens)) unbindWindow(*binding, window);
    });
}
WorkspaceSlideAdapter::~WorkspaceSlideAdapter() { finishAll(); }

void WorkspaceSlideAdapter::reconfigure()
{
    const KConfigGroup config(effects->config(), QStringLiteral("Effect-cc-niri-viewport-clip"));
    const bool enabled = config.readEntry("OptimizedWorkspaceAnimation", false);
    finishAll();
    m_enabled = enabled;
    m_duration = std::clamp(config.readEntry("WorkspaceDuration", 420), 240, 800);
    const KConfigGroup slide(effects->config(), QStringLiteral("Effect-slide"));
    m_horizontalGap = slide.readEntry("HorizontalGap", 45u);
    m_verticalGap = slide.readEntry("VerticalGap", 20u);
    m_slideBackground = slide.readEntry("SlideBackground", true);
}

void WorkspaceSlideAdapter::bindWindow(ScreenBinding &screen, EffectWindow *window)
{
    if (screen.windows.contains(window)) return;
    screen.windows.insert(window, {EffectWindowVisibleRef(window, EffectWindow::PAINT_DISABLED_BY_DESKTOP),
        window->data(WindowForceBlurRole), window->data(WindowForceBackgroundContrastRole), window->isDock()});
    if (window->isDock()) effects->setElevatedWindow(window, true);
    window->setData(WindowForceBlurRole, true);
    window->setData(WindowForceBackgroundContrastRole, true);
}
void WorkspaceSlideAdapter::unbindWindow(ScreenBinding &screen, EffectWindow *window)
{
    auto it = screen.windows.find(window);
    if (it == screen.windows.end()) return;
    if (it->elevated) effects->setElevatedWindow(window, false);
    if (window->data(WindowForceBlurRole) == QVariant(true)) window->setData(WindowForceBlurRole, it->blur);
    if (window->data(WindowForceBackgroundContrastRole) == QVariant(true)) window->setData(WindowForceBackgroundContrastRole, it->contrast);
    screen.windows.erase(it);
}

std::shared_ptr<WorkspaceSlideAdapter::ScreenBinding> WorkspaceSlideAdapter::prepare(LogicalOutput *output, EffectWindow *moving)
{
    if (!m_enabled || m_switchingActivity || !output || (effects->activeFullScreenEffect() && effects->activeFullScreenEffect() != m_owner)) return {};
    auto binding = m_screens.value(output);
    if (!binding) {
        binding = std::make_shared<ScreenBinding>();
        m_screens.insert(output, binding);
        for (auto *window : effects->stackingOrder()) {
            if (window->screen() == output) bindWindow(*binding, window);
        }
    }
    binding->movingWindow = moving;
    binding->finished = false;
    const auto grid = cc_niri_workspace_configure(binding->motion, effects->desktopGridWidth(),
        effects->desktopGridHeight(), effects->optionRollOverDesktops());
    workspaceCheck(grid.status);
    if (!grid.value) { finish(output); return {}; }
    // This connection precedes Clip's desktop barrier and the Script Guard.
    // They therefore preserve the departing Pair/Wide pose under one owner.
    effects->setActiveFullScreenEffect(m_owner);
    return binding;
}
void WorkspaceSlideAdapter::desktopChanged(VirtualDesktop *previous, VirtualDesktop *current, EffectWindow *moving, LogicalOutput *output)
{
    if (!previous || !current) return;
    auto binding = prepare(output, moving);
    if (!binding) return;
    const auto result = cc_niri_workspace_start(binding->motion, desktopPoint(previous), desktopPoint(current),
        ++m_epoch, std::max(workspaceNow(), binding->lastSampleTime), qint64(m_duration) * 1000000);
    workspaceCheck(result.status);
    if (!result.value) { finish(output); return; }
    effects->addRepaint(output->geometry());
}
void WorkspaceSlideAdapter::desktopChanging(VirtualDesktop *desktop, QPointF offset, EffectWindow *moving, LogicalOutput *output)
{
    if (!desktop) return;
    auto binding = prepare(output, moving);
    if (!binding) return;
    auto point = desktopPoint(desktop);
    point.x += offset.x(); point.y += offset.y();
    const auto result = cc_niri_workspace_gesture(binding->motion, point, ++m_epoch,
        std::max(workspaceNow(), binding->lastSampleTime));
    workspaceCheck(result.status);
    if (!result.value) { finish(output); return; }
    effects->addRepaint(output->geometry());
}
void WorkspaceSlideAdapter::cancelGesture()
{
    const auto outputs = m_screens.keys();
    for (auto *output : outputs) {
        auto *desktop = effects->currentDesktop(output);
        desktopChanged(desktop, desktop, nullptr, output);
    }
}

void WorkspaceSlideAdapter::prePaintScreen(ScreenPrePaintData &data)
{
    m_paintedScreen = data.screen;
    const auto binding = m_screens.value(data.screen);
    if (!binding) return;
    // Use the compositor's predicted presentation time once per output pass.
    const auto now = data.view ? data.view->nextPresentationTimestamp().count() : workspaceNow();
    const auto sample = cc_niri_workspace_advance(binding->motion, now);
    workspaceCheck(sample.status);
    binding->lastSampleTime = std::max(binding->lastSampleTime, now);
    binding->finished = !sample.active;
    data.mask |= Effect::PAINT_SCREEN_TRANSFORMED;
}
void WorkspaceSlideAdapter::prePaintWindow(EffectWindow *window, WindowPrePaintData &data)
{
    if (m_screens.contains(window->screen())) data.setTransformed();
}
void WorkspaceSlideAdapter::postPaintScreen()
{
    auto *output = m_paintedScreen.data();
    const auto binding = m_screens.value(output);
    if (!binding) return;
    if (binding->finished) finish(output);
    else effects->addRepaint(output->geometry());
}

bool WorkspaceSlideAdapter::paintWindow(const RenderTarget &target, const RenderViewport &viewport,
    EffectWindow *window, int mask, const Region &region, WindowPaintData &data)
{
    auto *output = window->screen();
    const auto binding = m_screens.value(output);
    if (!binding) return false;
    if (window == binding->movingWindow || (window->isOnAllDesktops() && (!window->isDesktop() || !m_slideBackground))) return false;
    const auto screenRect = output->geometry();
    for (auto *desktop : effects->desktops()) {
        if (!window->isOnDesktop(desktop)) continue;
        const auto projection = cc_niri_workspace_projection(binding->motion, desktopPoint(desktop),
            screenRect.width(), screenRect.height(), m_horizontalGap, m_verticalGap);
        workspaceCheck(projection.status);
        if (!projection.visible) continue;
        WindowPaintData translated(data);
        translated.setXTranslation(data.xTranslation() + projection.translation.x);
        translated.setYTranslation(data.yTranslation() + projection.translation.y);
        const RectF clip = RectF(screenRect).translated(projection.translation.x, projection.translation.y).intersected(RectF(screenRect));
        const Region clipped = region & viewport.mapToDeviceCoordinatesAligned(clip);
        m_owner->paintClippedWindow(target, viewport, window, mask | Effect::PAINT_WINDOW_TRANSFORMED, clipped, translated);
    }
    return true;
}

void WorkspaceSlideAdapter::finish(LogicalOutput *output)
{
    const auto binding = m_screens.take(output);
    if (!binding) return;
    const auto windows = binding->windows.keys();
    for (auto *window : windows) unbindWindow(*binding, window);
    if (output) effects->addRepaint(output->geometry());
    if (!active() && effects->activeFullScreenEffect() == m_owner) effects->setActiveFullScreenEffect(nullptr);
}
void WorkspaceSlideAdapter::finishAll()
{
    const auto outputs = m_screens.keys();
    for (auto *output : outputs) finish(output);
}
}
