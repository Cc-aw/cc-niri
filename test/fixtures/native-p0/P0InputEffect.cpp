/* SPDX-License-Identifier: GPL-2.0-or-later */
// KWin platform experiment. NEVER installed or linked into production.
// Geometry comes from the test controller; no layout/Spring/workspace owner.
#include "core/output.h"
#include "core/outputconfiguration.h"
#include "core/renderviewport.h"
#include "core/rendertarget.h"
#include "opengl/glframebuffer.h"
#include "opengl/gltexture.h"
#include "effect/effect.h"
#include "effect/effecthandler.h"
#include "effect/effectwindow.h"
#include "input.h"
#include "input_event.h"
#include "pointer_input.h"
#include "keyboard_input.h"
#include "touch_input.h"
#include "scene/windowitem.h"
#include "wayland/seat.h"
#include "wayland/display.h"
#include "wayland_server.h"
#include "window.h"
#include "internalwindow.h"
#include "workspace.h"
#include "../../../native/common/CompositorFrameContext.h"
#include "../../../native/common/ViewportPaintClip.h"
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointer>
#include <QSet>
#include <QScopedValueRollback>
#include <QSaveFile>
#include <QBackingStore>
#include <QPainter>
#include <QWindow>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <vector>
#include <linux/input-event-codes.h>
#include <sys/prctl.h>
#include <memory>

namespace KWin {
class P0InputEffect final : public Effect {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.CCNiriP0Input1")
public:
    class Filter final : public InputEventFilter {
    public:
        explicit Filter(P0InputEffect &owner) : InputEventFilter(InputFilterOrder::ScreenEdge), m_owner(owner) {}
        bool pointerMotion(PointerMotionEvent *event) override { return m_owner.onPointerMotion(event); }
        bool pointerButton(PointerButtonEvent *event) override { return m_owner.onPointerButton(event); }
        bool pointerAxis(PointerAxisEvent *event) override { return m_owner.onPointerAxis(event); }
        bool touchDown(TouchDownEvent *event) override { return m_owner.onTouchDown(event); }
        bool touchMotion(TouchMotionEvent *event) override { return m_owner.onTouchMotion(event); }
        bool touchUp(TouchUpEvent *event) override { return m_owner.onTouchUp(event); }
        bool touchCancel() override { return m_owner.onTouchCancel(); }
    private:
        P0InputEffect &m_owner;
    };
    static bool isolated() {
        const auto root = qEnvironmentVariable("CC_NIRI_P0_ISOLATED_ROOT");
        if (!root.startsWith(QStringLiteral("/tmp/cc-niri-p0-")) || !QDir(root).exists()
            || qEnvironmentVariable("XDG_RUNTIME_DIR") != root + QStringLiteral("/runtime")
            || qEnvironmentVariable("XDG_CONFIG_HOME") != root + QStringLiteral("/config")
            || !qEnvironmentVariableIsEmpty("DISPLAY")
            || (!qEnvironmentVariableIsEmpty("WAYLAND_DISPLAY") && qEnvironmentVariable("WAYLAND_DISPLAY") != QStringLiteral("cc-niri-p0"))
            || !qEnvironmentVariableIsSet("DBUS_SESSION_BUS_ADDRESS") || !workspace()) return false;
        const auto outputs = workspace()->outputs();
        return outputs.size() == 2 && std::all_of(outputs.begin(), outputs.end(), [](auto *output) {
            return output->name() == QStringLiteral("Virtual-0") || output->name() == QStringLiteral("Virtual-1");
        });
    }
    P0InputEffect() : m_filter(std::make_unique<Filter>(*this)) {
        if (!isolated()) qFatal("P0 fixture refuses a non-isolated compositor");
        if (qEnvironmentVariableIsSet("CC_NIRI_P0_NO_CORE") && prctl(PR_SET_DUMPABLE, 0) != 0)
            qFatal("cannot suppress core dumps for isolated crash regression");
        m_originalPointer = waylandServer()->seat()->hasPointer();
        m_originalTouch = waylandServer()->seat()->hasTouch();
        m_originalKeyboard = waylandServer()->seat()->hasKeyboard();
        // Test input enters Pointer/TouchInputRedirection and its normal filters;
        // the fixture does not call Seat notifyPointerButton/notifyTouchDown.
        waylandServer()->seat()->setHasPointer(true);
        waylandServer()->seat()->setHasTouch(true);
        waylandServer()->seat()->setHasKeyboard(true);
        input()->installInputEventFilter(m_filter.get());
        connect(input(), &InputRedirection::globalPointerChanged, this, [this](const QPointF &point) { mask(point); });
        connect(effects, &EffectsHandler::windowAdded, this, [this](EffectWindow *window) {
            auto *internal = qobject_cast<InternalWindow *>(window->window());
            if (internal && internal->handle() == m_internalWindow.get()) m_internalEffect = window;
        });
        connect(effects, &EffectsHandler::windowClosed, this, [this](EffectWindow *window) {
            if (window == m_internalEffect) m_internalDeleted = EffectWindowDeletedRef(window);
        });
        QDBusConnection::sessionBus().registerObject(QStringLiteral("/ccNiriP0Input"), this,
            QDBusConnection::ExportScriptableSlots);
    }
    ~P0InputEffect() override {
        m_internalBacking.reset();
        m_internalWindow.reset();
        m_internalDeleted = EffectWindowDeletedRef();
        m_filter.reset();
        QDBusConnection::sessionBus().unregisterObject(QStringLiteral("/ccNiriP0Input"));
        restore();
        int hidden = 0;
        for (const auto &item : m_entries) if (item.window && item.window->isHiddenByShowDesktop()) ++hidden;
        m_entries.clear();
        auto message = QDBusMessage::createMethodCall(QStringLiteral("org.cc.CCNiriP0Fixture"),
            QStringLiteral("/P0"), QStringLiteral("org.cc.CCNiriP0Fixture1"), QStringLiteral("Record"));
        message << QString::fromUtf8(QJsonDocument(QJsonObject{{QStringLiteral("kind"), QStringLiteral("native-fixture-unloaded")},
            {QStringLiteral("masked"), int(m_masked.size())}, {QStringLiteral("hiddenTestWindows"), hidden},
            {QStringLiteral("entries"), int(m_entries.size())}}).toJson(QJsonDocument::Compact));
        QDBusConnection::sessionBus().asyncCall(message);
        waylandServer()->seat()->setHasPointer(m_originalPointer);
        waylandServer()->seat()->setHasTouch(m_originalTouch);
        waylandServer()->seat()->setHasKeyboard(m_originalKeyboard);
    }
    bool isActive() const override { return m_rawInput || !m_entries.empty(); }
    bool blocksDirectScanout() const override { return isActive(); }
    int requestedEffectChainPosition() const override { return 20; }
    void prePaintScreen(ScreenPrePaintData &data) override {
        if (!m_entries.empty()) data.mask |= PAINT_SCREEN_WITH_TRANSFORMED_WINDOWS;
        // Platform paint timestamp for the existing Ring's shared-frame ABI.
        // This fixture has no animation timer or independent Ring motion.
        const auto time = std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
        const CcNiri::ScopedCompositorFrame frame(effects,
            {reinterpret_cast<uintptr_t>(data.screen), time, data.screen && data.view && data.frame});
        effects->prePaintScreen(data);
    }
    void paintScreen(const RenderTarget &target, const RenderViewport &viewport, int flags,
            const Region &region, LogicalOutput *screen) override {
        effects->paintScreen(target, viewport, flags, region, screen);
        // One explicit test capture borrows the virtual backend's existing
        // framebuffer. No extra render target, retained frame or idle capture.
        if (!m_capture.isEmpty() && !m_capturedOutputs.contains(screen->name())) {
            const auto directory = qEnvironmentVariable("CC_NIRI_P0_ISOLATED_ROOT") + QStringLiteral("/screens");
            QDir().mkpath(directory);
            QSaveFile file(directory + QLatin1Char('/') + m_capture + QLatin1Char('-') + screen->name() + QStringLiteral(".png"));
            // Explicit, bounded test readback; no new GL texture/FBO. QPainter
            // borrows its image, GL reads the existing color attachment.
            QImage readback;
            const QImage *image = target.image();
            if (!image && target.framebuffer() && target.framebuffer()->colorAttachment()) {
                readback = target.framebuffer()->colorAttachment()->toImage(); image = &readback;
            }
            if (image && !image->isNull() && file.open(QIODevice::WriteOnly) && image->save(&file, "PNG") && file.commit()) {
                m_capturedOutputs.insert(screen->name());
                if (m_capturedOutputs.size() == 2) m_capture.clear();
            }
        }
    }
    void prePaintWindow(RenderView *view, EffectWindow *window, WindowPrePaintData &data) override {
        if (entry(window->window())) data.setTransformed();
        effects->prePaintWindow(view, window, data);
    }
    void paintWindow(const RenderTarget &target, const RenderViewport &viewport, EffectWindow *window,
            int flags, const Region &region, WindowPaintData &data) override {
        auto *item = entry(window->window());
        if (!item) { effects->paintWindow(target, viewport, window, flags, region, data); return; }
        const auto outputClip = viewport.mapToDeviceCoordinates(RectF(m_output)).rounded();
        const Region clipped = region & outputClip & viewport.deviceRect();
        data.setXTranslation(data.xTranslation() + item->delta);
        if (!clipped.isEmpty()) ++item->painted;
        else ++item->emptyOutputPasses;
        const ScopedViewportPaintContext context(window->windowItem(), viewport, RectF(m_output), clipped);
        effects->paintWindow(target, viewport, window, flags | PAINT_WINDOW_TRANSFORMED, clipped, data);
    }
public Q_SLOTS:
    // Synthetic KWin lifecycle events on the disposable Virtual compositor.
    // This does not implement or bypass a real screen locker.
    Q_SCRIPTABLE bool ObserveSessionLockForTest(bool locked) {
        if (!isolated()) return false;
        if (locked) Q_EMIT effects->screenAboutToLock();
        Q_EMIT effects->screenLockingChanged(locked);
        return true;
    }
    // Retain the real closed InternalWindow exactly as a closing animation can.
    // The backing QWindow must be destroyed, not just hidden. One bounded test
    // object at a time; none of this is linked or installed into production.
    Q_SCRIPTABLE bool OpenInternalWindow() {
        if (!isolated() || !m_rawInput || m_internalWindow || m_internalEffect || ++m_internalCycles > 32) return false;
        m_internalWindow = std::make_unique<QWindow>();
        m_internalWindow->setFlags(Qt::ToolTip | Qt::FramelessWindowHint);
        m_internalWindow->setTitle(QStringLiteral("CC_NIRI_P0_INTERNAL"));
        m_internalWindow->setGeometry(800, 150, 240, 120);
        m_internalWindow->setSurfaceType(QSurface::RasterSurface);
        m_internalWindow->show();
        m_internalBacking = std::make_unique<QBackingStore>(m_internalWindow.get());
        m_internalBacking->resize(m_internalWindow->size());
        const QRegion region(QRect(QPoint(), m_internalWindow->size()));
        m_internalBacking->beginPaint(region);
        QPainter painter(m_internalBacking->paintDevice());
        painter.fillRect(region.boundingRect(), Qt::yellow);
        painter.end();
        m_internalBacking->endPaint();
        m_internalBacking->flush(region);
        return true;
    }
    Q_SCRIPTABLE bool CloseInternalWindow() {
        if (!isolated() || !m_internalWindow) return false;
        m_internalBacking.reset();
        m_internalWindow.reset();
        return true;
    }
    Q_SCRIPTABLE bool ReleaseInternalWindow() {
        if (!isolated() || m_internalWindow) return false;
        m_internalDeleted = EffectWindowDeletedRef();
        return true;
    }
    Q_SCRIPTABLE QString InternalWindowStatus() const {
        const auto *window = m_internalEffect.data();
        const auto *internal = window ? qobject_cast<InternalWindow *>(window->window()) : nullptr;
        return QString::fromUtf8(QJsonDocument(QJsonObject{
            {QStringLiteral("effectWindow"), bool(window)},
            {QStringLiteral("inStackingOrder"), window && effects->stackingOrder().contains(m_internalEffect)},
            {QStringLiteral("deleted"), window && window->isDeleted()},
            {QStringLiteral("handlePresent"), internal && internal->handle()},
            {QStringLiteral("held"), !m_internalDeleted.isNull()},
            {QStringLiteral("cycles"), int(m_internalCycles)}}).toJson(QJsonDocument::Compact));
    }
    Q_SCRIPTABLE bool SetVirtualScale(double scale) {
        if (!isolated() || !m_entries.empty() || (scale != 1.0 && scale != 1.5)) return false;
        OutputConfiguration configuration;
        for (auto *output : workspace()->outputs()) {
            auto changes = configuration.changeSet(output->backendOutput());
            changes->scale = scale; changes->scaleSetting = scale;
            changes->pos = QPoint(output->name() == QStringLiteral("Virtual-0") ? 0 : 2560, 0);
        }
        return workspace()->applyOutputConfiguration(configuration) == OutputConfigurationError::None;
    }
    Q_SCRIPTABLE bool Capture(const QString &name) {
        if (!isolated() || name.isEmpty() || name.size() > 40 || !m_capture.isEmpty()
            || !std::all_of(name.begin(), name.end(), [](QChar letter) {
                return (letter >= QLatin1Char('a') && letter <= QLatin1Char('z')) || letter == QLatin1Char('-');
            })) return false;
        m_capture = name; m_capturedOutputs.clear(); effects->addRepaintFull(); return true;
    }
    Q_SCRIPTABLE bool Configure(const QString &json) {
        if (!isolated() || json.size() > 4096) return false;
        const auto document = QJsonDocument::fromJson(json.toUtf8());
        if (!document.isObject()) return false;
        const auto value = document.object();
        const int epoch = value.value(QStringLiteral("epoch")).toInt(-1);
        const auto mode = value.value(QStringLiteral("mode")).toString();
        const auto list = value.value(QStringLiteral("entries")).toArray();
        if (epoch <= m_epoch || (mode != QStringLiteral("raw") && mode != QStringLiteral("seat-map")
            && mode != QStringLiteral("two-click")) || list.isEmpty() || list.size() > 3) return false;
        std::vector<Entry> candidate;
        QSet<QString> seen;
        const auto outputs = workspace()->outputs();
        auto *primary = *std::find_if(outputs.begin(), outputs.end(),
            [](auto *output) { return output->name() == QStringLiteral("Virtual-0"); });
        const QRectF bounds(primary->geometry());
        for (const auto &element : list) {
            const auto requested = element.toObject();
            const auto title = requested.value(QStringLiteral("title")).toString();
            const auto xValue = requested.value(QStringLiteral("visualX"));
            if (!xValue.isDouble() || !std::isfinite(xValue.toDouble()) || seen.contains(title)
                || (title != QStringLiteral("CC_NIRI_P0_A") && title != QStringLiteral("CC_NIRI_P0_B")
                    && title != QStringLiteral("CC_NIRI_P0_C") && title != QStringLiteral("CC_NIRI_P0_D"))) return false;
            auto windows = workspace()->windows();
            const auto found = std::find_if(windows.begin(), windows.end(), [&title](auto *window) { return window->caption() == title; });
            if (found == windows.end() || (*found)->output() != primary) return false;
            auto *client = *found;
            const QRectF frame(client->frameGeometry());
            if (!bounds.contains(frame)) return false;
            QRectF visual(frame); visual.moveLeft(xValue.toDouble());
            if (!visual.intersects(bounds)) return false;
            candidate.push_back({client, visual, visual.x() - frame.x(), 0, 0});
            seen.insert(title);
        }
        restore();
        m_entries = std::move(candidate); m_output = bounds; m_epoch = epoch; m_mode = mode;
        mask(input()->globalPointer());
        effects->addRepaintFull(); // Once per fixture change, never an idle loop.
        return true;
    }
    // P3 reuses only the virtual input/capture adapter. No P0 paint or input
    // model is configured in this mode; production Clip owns those policies.
    Q_SCRIPTABLE bool EnableRawInput() {
        if (!isolated() || !m_entries.empty() || input()->qtButtonStates() != Qt::NoButton) return false;
        m_rawInput = true;
        return true;
    }
    Q_SCRIPTABLE bool Input(const QString &json) {
        if (!isolated() || json.size() > 1024) return false;
        const auto document = QJsonDocument::fromJson(json.toUtf8());
        if (!document.isObject()) return false;
        const auto value = document.object();
        if (value.value(QStringLiteral("epoch")).toInt(-1) != m_epoch || (!m_rawInput && m_entries.empty())) return false;
        const auto kind = value.value(QStringLiteral("kind")).toString();
        const auto now = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch());
        if (kind == QStringLiteral("move") || kind == QStringLiteral("touch-down") || kind == QStringLiteral("touch-move")) {
            const auto x = value.value(QStringLiteral("x")), y = value.value(QStringLiteral("y"));
            if (!x.isDouble() || !y.isDouble() || !std::isfinite(x.toDouble()) || !std::isfinite(y.toDouble())) return false;
            const QPointF point(x.toDouble(), y.toDouble());
            if (point.x() < 0 || point.x() >= 5120 || point.y() < 0 || point.y() >= 1440) return false;
            if (kind == QStringLiteral("move")) input()->pointer()->processMotionAbsolute(point, now);
            else {
                const int id = value.value(QStringLiteral("id")).toInt(-1);
                if (id < 0 || id > 4) return false;
                if (kind == QStringLiteral("touch-down")) input()->touch()->processDown(id, point, now);
                else input()->touch()->processMotion(id, point, now);
                input()->touch()->frame();
            }
        } else if (kind == QStringLiteral("press") || kind == QStringLiteral("release")) {
            const int button = value.value(QStringLiteral("button")).toInt(BTN_LEFT);
            if (button != BTN_LEFT && button != BTN_RIGHT) return false;
            input()->pointer()->processButton(button, kind == QStringLiteral("press") ? PointerButtonState::Pressed : PointerButtonState::Released, now);
        } else if (kind == QStringLiteral("axis")) {
            input()->pointer()->processAxis(PointerAxis::Vertical, 15, 120, PointerAxisSource::Wheel, false, now);
        } else if (kind == QStringLiteral("key")) {
            const int code = value.value(QStringLiteral("code")).toInt(-1);
            const auto pressed = value.value(QStringLiteral("pressed"));
            if (code < 1 || code > 127 || !pressed.isBool()) return false;
            input()->keyboard()->processKey(code, pressed.toBool() ? KeyboardKeyState::Pressed : KeyboardKeyState::Released, now);
        } else if (kind == QStringLiteral("touch-up")) {
            const int id = value.value(QStringLiteral("id")).toInt(-1);
            if (id < 0 || id > 4) return false;
            input()->touch()->processUp(id, now); input()->touch()->frame();
        } else return false;
        input()->pointer()->processFrame();
        return true;
    }
    Q_SCRIPTABLE QString Status() const {
        QJsonArray entries;
        const auto focus = input()->pointer()->focus();
        const auto hover = input()->findToplevel(input()->globalPointer());
        QJsonArray auxiliary;
        for (auto *window : workspace()->windows()) {
            if (auxiliary.size() == 8) break;
            if (!window->isInputMethod() && !window->isPopupWindow()) continue;
            const auto frame = window->frameGeometry();
            auxiliary.append(QJsonObject{{QStringLiteral("title"), window->caption()},
                {QStringLiteral("inputMethod"), window->isInputMethod()},
                {QStringLiteral("x"), frame.x()}, {QStringLiteral("y"), frame.y()},
                {QStringLiteral("width"), frame.width()}, {QStringLiteral("height"), frame.height()}});
        }
        for (const auto &item : m_entries) if (item.window) {
            entries.append(QJsonObject{{QStringLiteral("title"), item.window->caption()},
                {QStringLiteral("realX"), item.window->frameGeometry().x()},
                {QStringLiteral("width"), item.window->frameGeometry().width()},
                {QStringLiteral("delta"), item.delta}, {QStringLiteral("output"), item.window->output()->name()},
                {QStringLiteral("hidden"), item.window->isHiddenByShowDesktop()},
                {QStringLiteral("interactiveMove"), item.window->isInteractiveMove()},
                {QStringLiteral("interactiveResize"), item.window->isInteractiveResize()},
                {QStringLiteral("painted"), item.painted}, {QStringLiteral("emptyOutputPasses"), item.emptyOutputPasses}});
        }
        return QString::fromUtf8(QJsonDocument(QJsonObject{{QStringLiteral("epoch"), m_epoch},
            {QStringLiteral("mode"), m_mode}, {QStringLiteral("entries"), entries},
            {QStringLiteral("auxiliary"), auxiliary},
            {QStringLiteral("masked"), int(m_masked.size())}, {QStringLiteral("pendingButtons"), m_suppressedButtons.size()},
            {QStringLiteral("pendingTouches"), m_suppressedTouches.size()},
            {QStringLiteral("nativeButtons"), int(input()->qtButtonStates())},
            {QStringLiteral("pointerFocusClass"), focus ? focus->resourceClass() : QString()},
            {QStringLiteral("nativeHitClass"), hover ? hover->resourceClass() : QString()},
            {QStringLiteral("nativeDrag"), waylandServer()->seat()->isDragPointer()},
            {QStringLiteral("activeModal"), workspace()->activeWindow() && workspace()->activeWindow()->isModal()},
            {QStringLiteral("consumed"), m_consumed},
            {QStringLiteral("seatSerial"), int(waylandServer()->seat()->display()->serial())}}).toJson(QJsonDocument::Compact));
    }
    Q_SCRIPTABLE bool Reset() {
        if (input()->qtButtonStates() != Qt::NoButton || !m_suppressedTouches.isEmpty()) return false;
        restore(); m_entries.clear(); m_suppressedButtons.clear(); effects->addRepaintFull(); return true;
    }
private:
    struct Entry { QPointer<Window> window; QRectF visual; double delta; int painted; int emptyOutputPasses; };
    struct Mask { QPointer<Window> window; EffectWindowVisibleRef visible; };
    Entry *entry(Window *window) {
        if (!window) return nullptr;
        const auto found = std::find_if(m_entries.begin(), m_entries.end(), [window](const auto &value) { return value.window == window; });
        return found == m_entries.end() ? nullptr : &*found;
    }
    Entry *visualHit(const QPointF &point) {
        if (point.x() < m_output.left() || point.x() >= m_output.right()
            || point.y() < m_output.top() || point.y() >= m_output.bottom()) return nullptr;
        const auto found = std::find_if(m_entries.rbegin(), m_entries.rend(), [&point](const auto &value) {
            return value.window && value.visual.contains(point);
        });
        return found == m_entries.rend() ? nullptr : &*found;
    }
    void restore() {
        QScopedValueRollback<bool> changing(m_changing, true);
        for (const auto &item : m_masked) if (item.window) item.window->setHiddenByShowDesktop(false);
        m_masked.clear();
    }
    void mask(const QPointF &point) {
        if (m_changing || m_mode == QStringLiteral("raw")) return;
        QScopedValueRollback<bool> changing(m_changing, true);
        for (const auto &item : m_entries) {
            if (!item.window) continue;
            const bool blocked = m_mode == QStringLiteral("two-click") ? item.delta != 0 : !item.visual.contains(point) || !m_output.contains(point);
            auto found = std::find_if(m_masked.begin(), m_masked.end(), [&item](const auto &value) { return value.window == item.window; });
            if (blocked && found == m_masked.end()) {
                m_masked.push_back({item.window, EffectWindowVisibleRef(item.window->effectWindow(), WindowItem::PAINT_DISABLED_BY_HIDDEN)});
                item.window->setHiddenByShowDesktop(true);
            } else if (!blocked && found != m_masked.end()) {
                item.window->setHiddenByShowDesktop(false); m_masked.erase(found);
            }
        }
    }
    void seatMap(const QPointF &point) {
        if (m_mode != QStringLiteral("seat-map")) return;
        auto *item = visualHit(point);
        if (!item) return;
        input()->pointer()->setFocus(item->window);
        auto transform = item->window->inputTransformation();
        transform.translate(-item->delta, 0);
        waylandServer()->seat()->setFocusedPointerSurfaceTransformation(transform);
    }
    void requestFocus(Entry *item) {
        auto message = QDBusMessage::createMethodCall(QStringLiteral("org.cc.CCNiriP0Fixture"),
            QStringLiteral("/P0"), QStringLiteral("org.cc.CCNiriP0Fixture1"), QStringLiteral("FocusRequested"));
        message << item->window->caption() << m_epoch;
        QDBusConnection::sessionBus().asyncCall(message);
    }
    bool nativeOwnsInput() const {
        if (waylandServer()->isScreenLocked() || waylandServer()->seat()->isDragPointer()
            || effects->hasActiveFullScreenEffect() || input()->isSelectingWindow()
            || workspace()->moveResizeWindow()
            || (workspace()->activeWindow() && workspace()->activeWindow()->isModal())) return true;
        const auto windows = workspace()->windows();
        return std::any_of(windows.begin(), windows.end(), [](auto *window) { return window->hasPopupGrab(); });
    }
    bool unmanagedPopupAt(const QPointF &point) const {
        auto *window = input()->findToplevel(point);
        return window && (window->isInputMethod() || window->isPopupWindow())
            && std::none_of(m_entries.begin(), m_entries.end(), [window](const auto &item) { return item.window == window; });
    }
    bool onPointerMotion(PointerMotionEvent *event) {
        if (nativeOwnsInput()) return false;
        seatMap(event->position);
        return m_mode == QStringLiteral("two-click") && !m_suppressedButtons.isEmpty();
    }
    bool onPointerButton(PointerButtonEvent *event) {
        if (event->state == PointerButtonState::Released && m_suppressedButtons.remove(event->nativeButton)) { ++m_consumed; return true; }
        if (nativeOwnsInput() || unmanagedPopupAt(event->position)) return false;
        if (m_mode != QStringLiteral("two-click")) { seatMap(event->position); return false; }
        auto *item = visualHit(event->position);
        if (event->state == PointerButtonState::Pressed && ((!m_suppressedButtons.isEmpty()) || (item && item->delta != 0))) {
            const bool first = m_suppressedButtons.isEmpty();
            m_suppressedButtons.insert(event->nativeButton); ++m_consumed;
            if (first && item) requestFocus(item);
            return true;
        }
        return false;
    }
    bool onPointerAxis(PointerAxisEvent *event) {
        if (nativeOwnsInput() || unmanagedPopupAt(event->position)) return false;
        seatMap(event->position);
        const auto *item = visualHit(event->position);
        if (m_mode == QStringLiteral("two-click") && ((!m_suppressedButtons.isEmpty()) || (item && item->delta != 0))) { ++m_consumed; return true; }
        return false;
    }
    bool onTouchDown(TouchDownEvent *event) {
        if (m_suppressedTouches.isEmpty() && (nativeOwnsInput() || unmanagedPopupAt(event->pos))) return false;
        const auto *item = visualHit(event->pos);
        if (m_mode == QStringLiteral("two-click") && ((!m_suppressedTouches.isEmpty()) || (item && item->delta != 0))) {
            m_suppressedTouches.insert(event->id); ++m_consumed;
            if (item) requestFocus(const_cast<Entry *>(item));
            return true;
        }
        return false;
    }
    bool onTouchMotion(TouchMotionEvent *event) { return m_suppressedTouches.contains(event->id); }
    bool onTouchUp(TouchUpEvent *event) { if (m_suppressedTouches.remove(event->id)) { ++m_consumed; return true; } return false; }
    bool onTouchCancel() { const bool pending = !m_suppressedTouches.isEmpty(); m_suppressedTouches.clear(); return pending; }
    std::unique_ptr<Filter> m_filter;
    std::unique_ptr<QWindow> m_internalWindow;
    std::unique_ptr<QBackingStore> m_internalBacking;
    QPointer<EffectWindow> m_internalEffect;
    EffectWindowDeletedRef m_internalDeleted;
    unsigned m_internalCycles = 0;
    std::vector<Entry> m_entries;
    std::vector<Mask> m_masked;
    QSet<uint32_t> m_suppressedButtons;
    QSet<int> m_suppressedTouches;
    QRectF m_output;
    QString m_mode;
    QString m_capture;
    QSet<QString> m_capturedOutputs;
    int m_epoch = 0, m_consumed = 0;
    bool m_changing = false, m_originalPointer = false, m_originalTouch = false, m_originalKeyboard = false;
    bool m_rawInput = false;
};
KWIN_EFFECT_FACTORY_SUPPORTED_ENABLED(P0InputEffect, "metadata.json", return P0InputEffect::isolated();, return false;)
} // namespace KWin
#include "P0InputEffect.moc"
