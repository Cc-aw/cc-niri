/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "WorkspaceSlideAdapter.h"
#include "ViewportClipEffect.h"
#include "core/output.h"
#include "core/renderviewport.h"
#include "effect/effecthandler.h"
#include "scene/scene.h"
#include "virtualdesktops.h"
#include <KConfigGroup>
#include <QJsonArray>
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
    connect(effects, &EffectsHandler::screenRemoved, this, [this](LogicalOutput *output) {
        m_projectionPasses.forget(reinterpret_cast<uintptr_t>(output));
        finish(output);
    });
    for (auto *output : effects->screens()) watchOutput(output);
    connect(effects, &EffectsHandler::screenAdded, this, [this](LogicalOutput *output) {
        watchOutput(output);
        finishAll();
    });
    for (auto *desktop : effects->desktops()) watchDesktop(desktop);
    connect(effects, &EffectsHandler::desktopAdded, this, [this](VirtualDesktop *desktop) {
        watchDesktop(desktop);
        finishAll();
    });
    connect(effects, &EffectsHandler::desktopRemoved, this, [this](VirtualDesktop *) { finishAll(); });
    connect(effects, &EffectsHandler::desktopGridSizeChanged, this, [this](const QSize &) { invalidateProjections(); });
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
        invalidateProjections();
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
    m_projectionCacheEnabled = config.readEntry("WorkspaceProjectionCache", false);
    m_smooth = config.readEntry("AnimationProfile", QStringLiteral("stable")) == QStringLiteral("smooth60");
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
    invalidateProjections();
    auto binding = m_screens.value(output);
    if (!binding) {
        binding = std::make_shared<ScreenBinding>();
        m_screens.insert(output, binding);
        for (auto *window : effects->stackingOrder()) {
            if (window->screen() == output) bindWindow(*binding, window);
        }
    }
    binding->movingWindow = moving;
    ++binding->motionRevision;
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
    const auto now = workspaceNow();
    const auto result = cc_niri_workspace_start_with_policy(binding->motion, desktopPoint(previous), desktopPoint(current),
        ++m_epoch, m_smooth ? now : std::max(now, binding->lastSampleTime), qint64(m_duration) * 1000000, m_smooth);
    workspaceCheck(result.status);
    if (!result.value) { finish(output); return; }
    m_lastOutput = output;
    m_lastState = cc_niri_workspace_state(binding->motion);
    workspaceCheck(m_lastState.status);
    observe(output, *binding, 0);
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
    observe(output, *binding, 3);
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
    const bool real = data.screen && data.frame && data.view && data.view->logicalOutput() == data.screen;
    m_projectionPasses.enter(reinterpret_cast<uintptr_t>(data.screen), real);
    if (m_projectionPasses.nested()) invalidateProjections();
    const auto binding = m_screens.value(data.screen);
    if (!binding) return;
    binding->projections.clear();
    if (m_captureDeadline && workspaceNow() > m_captureDeadline) m_captureDeadline = 0;
    // Use the compositor's predicted presentation time once per output pass.
    const auto now = data.view ? data.view->nextPresentationTimestamp().count() : workspaceNow();
    const auto sample = cc_niri_workspace_advance(binding->motion, now);
    workspaceCheck(sample.status);
    binding->lastSampleTime = std::max(binding->lastSampleTime, now);
    binding->finished = !sample.active;
    binding->painted = false;
    if (m_projectionCacheEnabled && m_projectionPasses.canCache(reinterpret_cast<uintptr_t>(data.screen))) {
        const auto screenRect = data.screen->geometry();
        const auto desktops = effects->desktops();
        const bool complete = binding->projections.prepare(desktops, [&](VirtualDesktop *desktop) {
            if (m_captureDeadline) ++m_captureProjectionCalls;
            const auto projection = cc_niri_workspace_projection(binding->motion, desktopPoint(desktop),
                screenRect.width(), screenRect.height(), m_horizontalGap, m_verticalGap);
            return projection;
        });
        if (complete) {
            binding->projectionGeometry = screenRect;
            binding->projectionScale = data.screen->scale();
            binding->projectionGrid = effects->desktopGridSize();
            binding->projectionRevision = m_projectionRevision;
            if (m_captureDeadline) ++m_captureProjectionFrames;
        }
    }
    data.mask |= Effect::PAINT_SCREEN_TRANSFORMED;
}
void WorkspaceSlideAdapter::prePaintWindow(EffectWindow *window, WindowPrePaintData &data)
{
    if (m_screens.contains(window->screen())) data.setTransformed();
}
void WorkspaceSlideAdapter::postPaintScreen()
{
    auto *output = reinterpret_cast<LogicalOutput *>(m_projectionPasses.leave());
    const auto binding = m_screens.value(output);
    if (!binding) return;
    binding->projections.clear();
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
    const auto alive = [&] { return m_screens.value(output) == binding && binding->windows.contains(window); };
    const auto valid = [&] { return binding->projectionRevision == m_projectionRevision
        && m_projectionPasses.canCache(reinterpret_cast<uintptr_t>(output)); };
    const bool cached = m_projectionCacheEnabled && binding->projections.complete() && valid()
        && binding->projectionGeometry == screenRect && binding->projectionScale == output->scale()
        && binding->projectionGrid == effects->desktopGridSize();
    if (m_captureDeadline && cached) ++m_captureProjectionHits;
    const auto paint = [&](const CcNiriWorkspaceProjection &projection) {
        const auto revision = binding->motionRevision;
        const auto sampleTime = binding->lastSampleTime;
        WindowPaintData translated(data);
        translated.setXTranslation(data.xTranslation() + projection.translation.x);
        translated.setYTranslation(data.yTranslation() + projection.translation.y);
        const RectF clip = RectF(screenRect).translated(projection.translation.x, projection.translation.y).intersected(RectF(screenRect));
        const Region clipped = region & viewport.mapToDeviceCoordinatesAligned(clip);
        m_owner->paintClippedWindow(target, viewport, window, mask | Effect::PAINT_WINDOW_TRANSFORMED, clipped, translated);
        // Cache invalidation (e.g. another output's nested capture) does not
        // invalidate this pose. A retarget or later motion sample does.
        if (revision == binding->motionRevision && sampleTime == binding->lastSampleTime
            && alive() && !binding->painted && !clipped.isEmpty()) {
            const auto marked = cc_niri_workspace_mark_painted(binding->motion);
            workspaceCheck(marked.status);
            binding->painted = true;
            if (marked.value) observe(output, *binding, 1);
        }
    };
    binding->projections.paint(cached, [&] {
        if (m_captureDeadline) ++m_captureProjectionFallbacks;
        return effects->desktops();
    }, [&](VirtualDesktop *desktop) { return window->isOnDesktop(desktop); }, [&](VirtualDesktop *desktop) {
        if (m_captureDeadline) ++m_captureProjectionCalls;
        const auto projection = cc_niri_workspace_projection(binding->motion, desktopPoint(desktop),
            screenRect.width(), screenRect.height(), m_horizontalGap, m_verticalGap);
        workspaceCheck(projection.status);
        return projection;
    }, paint, alive, valid);
    return true;
}

void WorkspaceSlideAdapter::finish(LogicalOutput *output)
{
    invalidateProjections();
    const auto binding = m_screens.take(output);
    if (!binding) return;
    m_lastOutput = output;
    m_lastState = cc_niri_workspace_state(binding->motion);
    workspaceCheck(m_lastState.status);
    observe(output, *binding, 2);
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
void WorkspaceSlideAdapter::invalidateProjections()
{
    ++m_projectionRevision;
    for (const auto &binding : std::as_const(m_screens)) binding->projections.clear();
}
void WorkspaceSlideAdapter::watchDesktop(VirtualDesktop *desktop)
{
    if (desktop) connect(desktop, &VirtualDesktop::aboutToBeDestroyed,
        this, &WorkspaceSlideAdapter::invalidateProjections, Qt::UniqueConnection);
}
void WorkspaceSlideAdapter::watchOutput(LogicalOutput *output)
{
    if (!output) return;
    connect(output, &LogicalOutput::geometryChanged, this, &WorkspaceSlideAdapter::invalidateProjections, Qt::UniqueConnection);
    connect(output, &LogicalOutput::scaleChanged, this, &WorkspaceSlideAdapter::invalidateProjections, Qt::UniqueConnection);
}
static QJsonObject workspaceStateJson(const CcNiriWorkspaceState &s)
{
    const auto point = [](CcNiriPoint p) { return QJsonObject{{QStringLiteral("x"), p.x}, {QStringLiteral("y"), p.y}}; };
    const char *strategies[] = {"rest", "carry-c2", "carry-c1", "brake-c1", "reset", "keep"};
    const char *reasons[] = {"none", "acceleration", "envelope", "hard-boundary", "invalid-math"};
    QJsonArray policy, reason;
    for (int axis = 0; axis < 2; ++axis) {
        policy.append(QString::fromLatin1(s.strategies[axis] < 6 ? strategies[s.strategies[axis]] : "invalid"));
        reason.append(QString::fromLatin1(s.reasons[axis] < 5 ? reasons[s.reasons[axis]] : "invalid"));
    }
    return {{QStringLiteral("point"), point(s.point)}, {QStringLiteral("velocity"), point(s.velocity)},
        {QStringLiteral("acceleration"), point(s.acceleration)}, {QStringLiteral("target"), point(s.target)},
        {QStringLiteral("origin"), point(s.origin)}, {QStringLiteral("initialVelocity"), point(s.initial_velocity)},
        {QStringLiteral("initialAcceleration"), point(s.initial_acceleration)},
        {QStringLiteral("savedVelocity"), point(s.saved_velocity)}, {QStringLiteral("savedAcceleration"), point(s.saved_acceleration)},
        {QStringLiteral("brakeDistanceCells"), point(s.brake_distance)},
        {QStringLiteral("sampleNs"), qint64(s.time_ns)}, {QStringLiteral("startNs"), qint64(s.started_at_ns)},
        {QStringLiteral("durationMs"), s.duration_ns/1000000.0}, {QStringLiteral("brakeXMs"), s.brake_x_ns/1000000.0},
        {QStringLiteral("brakeYMs"), s.brake_y_ns/1000000.0}, {QStringLiteral("epoch"), qint64(s.epoch)},
        {QStringLiteral("strategies"), policy}, {QStringLiteral("reasons"), reason},
        {QStringLiteral("carriedC2"), qint64(s.counts[0])}, {QStringLiteral("carriedC1"), qint64(s.counts[1])},
        {QStringLiteral("brakedC1"), qint64(s.counts[2])}, {QStringLiteral("reset"), qint64(s.counts[3])},
        {QStringLiteral("kept"), qint64(s.counts[4])}, {QStringLiteral("active"), bool(s.active)},
        {QStringLiteral("gesture"), bool(s.gesture)}};
}
QJsonObject WorkspaceSlideAdapter::status() const
{
    auto state = m_lastState;
    const auto binding = m_screens.value(m_lastOutput);
    if (binding) state = cc_niri_workspace_state(binding->motion);
    workspaceCheck(state.status);
    auto row = workspaceStateJson(state);
    row.insert(QStringLiteral("liveBinding"), bool(binding));
    row.insert(QStringLiteral("projectionCacheEnabled"), m_projectionCacheEnabled);
    return row;
}
void WorkspaceSlideAdapter::startCapture(qint64 now)
{
    m_captureStart = now; m_captureDeadline = now+3000000000LL;
    m_captureCount = 0; m_captureTruncated = false; m_captureOutputs.clear();
    m_captureProjectionCalls = 0; m_captureProjectionFrames = 0;
    m_captureProjectionHits = 0; m_captureProjectionFallbacks = 0;
    for (auto *output : effects->screens()) m_captureOutputs.append({output, output->name()});
}
void WorkspaceSlideAdapter::observe(LogicalOutput *output, ScreenBinding &screen, uint32_t kind)
{
    if (!m_captureDeadline) return;
    const auto now = workspaceNow();
    if (now > m_captureDeadline) { m_captureDeadline = 0; return; }
    if (m_captureCount == m_captureRecords.size()) { m_captureTruncated = true; return; }
    const auto state = cc_niri_workspace_state(screen.motion);
    workspaceCheck(state.status);
    for (qsizetype i = 0; i < m_captureOutputs.size(); ++i) {
        if (m_captureOutputs[i].output == output) {
            m_captureRecords[m_captureCount++] = {state, now, uint32_t(i+1), kind};
            return;
        }
    }
}
QJsonObject WorkspaceSlideAdapter::capture() const
{
    QJsonArray outputs, records;
    for (qsizetype i = 0; i < m_captureOutputs.size(); ++i)
        outputs.append(QJsonObject{{QStringLiteral("token"), qint64(i+1)}, {QStringLiteral("name"), m_captureOutputs[i].name}});
    for (size_t i = 0; i < m_captureCount; ++i) {
        const auto &r = m_captureRecords[i];
        auto row = workspaceStateJson(r.state);
        row.insert(QStringLiteral("output"), int(r.output)); row.insert(QStringLiteral("kind"), int(r.kind));
        row.insert(QStringLiteral("atMs"), (r.at-m_captureStart)/1000000.0);
        row.insert(QStringLiteral("sampleMs"), (r.state.time_ns-m_captureStart)/1000000.0);
        row.insert(QStringLiteral("startMs"), (r.state.started_at_ns-m_captureStart)/1000000.0);
        records.append(row);
    }
    return {{QStringLiteral("version"), 1}, {QStringLiteral("active"), m_captureDeadline > workspaceNow()},
        {QStringLiteral("truncated"), m_captureTruncated}, {QStringLiteral("units"), QStringLiteral("workspace-cell-second")},
        {QStringLiteral("projectionAudit"), QJsonObject{
            {QStringLiteral("cacheEnabled"), m_projectionCacheEnabled},
            {QStringLiteral("projectionCalls"), qint64(m_captureProjectionCalls)},
            {QStringLiteral("cachedFrames"), qint64(m_captureProjectionFrames)},
            {QStringLiteral("cachedWindowPasses"), qint64(m_captureProjectionHits)},
            {QStringLiteral("fallbackWindowPasses"), qint64(m_captureProjectionFallbacks)}}},
        {QStringLiteral("outputs"), outputs}, {QStringLiteral("records"), records}};
}
}
