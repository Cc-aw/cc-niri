/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingPaintFrame.h"
#include "../../viewport-clip/ScrollRuntimeTestBackend.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
#include <algorithm>
#include <array>
#include <map>
#include <memory>
using namespace std::chrono_literals;
using CcNiri::ScrollRuntimeTestBackend;
namespace {
constexpr double Step = 940;
const QString Session = QStringLiteral("ring-retarget");
const QString Workspace = QStringLiteral("workspace");
int samples = 0, handoffs = 0, incoming = 0, outgoing = 0, continuing = 0;
qreal maxCommitDelta = 0;
QString testScope;
void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << testScope.toStdString() << ": " << label << '\n'; std::exit(1); }
}
QJsonObject context(int generation = 1, const QString &workspace = Workspace) {
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("sessionId"), Session},
        {QStringLiteral("generation"), generation}, {QStringLiteral("workspaceId"), workspace},
        {QStringLiteral("targetOutput"), QStringLiteral("eDP-1")}};
}
QJsonObject plan(int epoch, double from, double to, bool retargetOnly = false) {
    QJsonArray entries;
    for (int i = 0; i < 7; ++i) {
        const auto visible = [i](double offset) { return i * Step >= offset && i * Step + 932 <= offset + 1872; };
        if (!visible(from) && !visible(to)) continue;
        entries.append(QJsonObject{{QStringLiteral("windowId"), QString::number(i)},
            {QStringLiteral("columnId"), i}, {QStringLiteral("logicalX"), i * Step},
            {QStringLiteral("pixelWidth"), 932},
            {QStringLiteral("oldPlacement"), visible(from) ? QStringLiteral("visible") : QStringLiteral("parked")},
            {QStringLiteral("newPlacement"), visible(to) ? QStringLiteral("visible") : QStringLiteral("parked")}});
    }
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("type"), QStringLiteral("SCROLL")},
        {QStringLiteral("sessionId"), Session}, {QStringLiteral("epoch"), epoch},
        {QStringLiteral("workspaceId"), Workspace}, {QStringLiteral("targetOutput"), QStringLiteral("eDP-1")},
        {QStringLiteral("issuedAt"), epoch}, {QStringLiteral("oldScrollOffsetX"), from},
        {QStringLiteral("newScrollOffsetX"), to}, {QStringLiteral("retargetOnly"), retargetOnly},
        {QStringLiteral("viewport"), QJsonObject{{QStringLiteral("x"), 24}, {QStringLiteral("y"), 50},
            {QStringLiteral("width"), 1872}, {QStringLiteral("height"), 960}}}, {QStringLiteral("entries"), entries}};
}
struct WindowNode {
    Item window, content;
    explicit WindowNode(const QRectF &geometry) : content(&window) {
        window.setGeometry(RectF(geometry)); window.setOpacity(0.65); content.setSize(window.size());
    }
};
struct Picture { QMatrix4x4 matrix; double x; };
class Scene {
public:
    explicit Scene(qreal scale) : image(3840, 2160, QImage::Format_ARGB32_Premultiplied), target(&image),
        viewport(RectF(0, 0, 1920, 1080), scale, target, QPoint()) {}
    void initialize(ScrollRuntimeTestBackend &runtime, bool pending) {
        const auto targets = runtime.targets(), sources = runtime.sourceFrames();
        for (auto it = targets.cbegin(); it != targets.cend(); ++it) {
            nodes.emplace(it.key(), std::make_unique<WindowNode>(pending && sources.contains(it.key()) ? sources.value(it.key()) : it.value()));
        }
    }
    WindowNode &node(const QString &id) { return *nodes.at(id); }
    void focus(const QString &id) {
        Item *previous = owner;
        auto &n = node(id);
        const auto *previousRoot = ring.paintRoot();
        check(ring.attach(&n.window, &n.content, n.window.size(), BorderRadius(12)), "attach actual scene owner");
        if (previous == &n.window) check(ring.paintRoot() == previousRoot, "same owner retarget reuses its attachment");
        if (previous && previous != &n.window) {
            check(!previous->property(ViewportDecorationPaddingProperty).isValid() && previous->childItems().size() == 1,
                "focus change clears old damage marker and stroke reservation");
        }
        owner = &n.window;
    }
    QHash<QString, QRectF> geometries() const {
        QHash<QString, QRectF> result;
        for (const auto &[id, n] : nodes) result.insert(id, QRectF(n->window.position(), n->window.size()));
        return result;
    }
    void commit(ScrollRuntimeTestBackend &runtime) {
        const auto targets = runtime.targets();
        for (auto it = targets.cbegin(); it != targets.cend(); ++it) {
            if (!nodes.contains(it.key())) nodes.emplace(it.key(), std::make_unique<WindowNode>(it.value()));
            else node(it.key()).window.setGeometry(RectF(it.value()));
        }
    }
    WindowPaintData paintData(ScrollRuntimeTestBackend &runtime, const QString &id) {
        const auto &n = node(id);
        const auto projection = runtime.projection(id, QRectF(n.window.position(), n.window.size()));
        check(projection.has_value(), "production runtime accepts actual source/target geometry");
        WindowPaintData data; data.setXTranslation(projection->translationX);
        data.setOpacity(0.75); data.setBrightness(0.2); data.setSaturation(0.3);
        return data;
    }
    Region clip(ScrollRuntimeTestBackend &runtime, const QString &id) {
        const auto projection = runtime.projection(id, QRectF(node(id).window.position(), node(id).window.size()));
        check(projection.has_value(), "production viewport for current owner");
        const Region screen(viewport.mapToDeviceCoordinates(RectF(0, 0, 1920, 1080)).rounded());
        return viewportPaintClip(&node(id).window, viewport, RectF(projection->viewport), screen);
    }
    Picture paint(ScrollRuntimeTestBackend &runtime, const QString &id) {
        focus(id);
        auto &n = node(id);
        const auto position = n.window.position();
        const auto data = paintData(runtime, id);
        const auto region = clip(runtime, id);
        const int mask = Effect::PAINT_WINDOW_TRANSFORMED | Effect::PAINT_WINDOW_TRANSLUCENT;
        const auto frame = ring.capture(mask, region, data);
        check(frame.has_value(), "capture current retarget frame");
        renderer.renderItem(target, viewport, &n.window, mask, region, data, {}, {});
        const auto expected = renderer.sceneMatrix; const auto opacity = renderer.effectiveOpacity;
        check(ring.paint(&renderer, target, viewport, *frame), "paint current retarget attachment");
        check(renderer.sceneMatrix == expected && renderer.lastRegion == region && renderer.lastMask == mask,
            "every retarget frame has exact window matrix, device clip and mask");
        check(qAbs(renderer.effectiveOpacity - opacity) < 1e-9 && renderer.brightness == 1 && renderer.saturation == 1,
            "retarget preserves opacity once and independent border material");
        check(n.window.position() == position && n.window.size() == QSizeF(932, 960), "Ring paint never changes window geometry");
        const qreal scale = viewport.scale();
        const auto body = expected.mapRect(QRectF(0, 0, 932 * scale, 960 * scale));
        const auto base = viewport.mapToDeviceCoordinates(RectF(24, 50, 1872, 960)).rounded();
        const qreal left = std::max(body.left() + 20 * scale, qreal(base.left()));
        const qreal right = std::min(body.right() - 20 * scale, qreal(base.right()));
        if (right - left > 2) {
            const int x = std::floor((left + right) / 2);
            check(region.contains(QPoint(x, std::floor(body.top() - scale)))
                && region.contains(QPoint(x, std::ceil(body.bottom() + scale))), "top/bottom strokes survive every visible retarget sample");
        }
        const int y = std::floor(body.center().y());
        if (body.left() >= base.left() && body.left() < base.right() - 20 * scale)
            check(region.contains(QPoint(std::floor(body.left() - scale), y)), "left stroke survives viewport boundary during retarget");
        if (body.right() <= base.right() && body.right() > base.left() + 20 * scale)
            check(region.contains(QPoint(std::ceil(body.right() + scale) - 1, y)), "right stroke survives viewport boundary during retarget");
        if (body.right() < base.left() - 6 * scale || body.left() > base.right() + 6 * scale) {
            const auto outline = expected.mapRect(QRectF(-3 * scale, -3 * scale, 938 * scale, 966 * scale));
            check((Region(RectF(outline).rounded()) & region).isEmpty(), "fully parked border remains invisible during retarget");
        }
        const auto role = runtime.role(id);
        incoming += role == QStringLiteral("incoming"); outgoing += role == QStringLiteral("outgoing"); continuing += role == QStringLiteral("continuing");
        ++samples;
        // Keep the physics continuity oracle in double precision. KWin paint
        // data/matrices use floats; their commit error is checked separately.
        const auto projection = runtime.projection(id, QRectF(n.window.position(), n.window.size()));
        return {expected, n.window.position().x() + projection->translationX};
    }
    QHash<QString, Picture> paintAll(ScrollRuntimeTestBackend &runtime) {
        QHash<QString, Picture> result;
        const auto targets = runtime.targets();
        for (auto it = targets.cbegin(); it != targets.cend(); ++it) result.insert(it.key(), paint(runtime, it.key()));
        return result;
    }
    void clear() { ring.clear(); owner = nullptr; }
    QImage image;
    RenderTarget target;
    RenderViewport viewport;
    FocusRingCaptureRenderer renderer;
    std::map<QString, std::unique_ptr<WindowNode>> nodes;
    FocusRingItem ring;
    Item *owner = nullptr;
};
void continuous(const Picture &before, const Picture &after) {
    if (std::abs(before.x - after.x) >= 1e-8) std::cerr << "continuity before=" << before.x << " after=" << after.x << " delta=" << after.x - before.x << "\n";
    check(std::abs(before.x - after.x) < 1e-8, "new epoch preserves last actual painted position");
    qreal delta = 0;
    for (int r = 0; r < 4; ++r) for (int c = 0; c < 4; ++c)
        delta = std::max(delta, qreal(qAbs(before.matrix(r, c) - after.matrix(r, c))));
    maxCommitDelta = std::max(delta, maxCommitDelta);
    check(delta <= 0.001, "native float matrix remains subpixel-continuous across geometry commit");
}
void chain(qreal scale, const std::array<int, 6> &directions, double start) {
    ScrollRuntimeTestBackend runtime; check(runtime.updateContext(context()), "chain authority");
    Scene scene(scale);
    double from = start;
    std::chrono::nanoseconds lastTime = 0ns;
    for (int epoch = 1; epoch <= 6; ++epoch) {
        testScope = QStringLiteral("chain scale=%1 from=%2 epoch=%3").arg(scale).arg(from).arg(epoch);
        const double to = from + directions[epoch - 1] * Step;
        const auto before = epoch == 1 ? QHash<QString, Picture>() : scene.paintAll(runtime);
        const auto now = epoch == 1 ? 0ns : lastTime + 3ms;
        check(runtime.arm(plan(epoch, from, to), now, scene.geometries()), "consecutive keys arm real production runtime");
        ++handoffs;
        if (epoch == 1) scene.initialize(runtime, false);
        else {
            // This checks source frames before the compositor sees the geometry ACK.
            for (auto it = before.cbegin(); it != before.cend(); ++it) continuous(it.value(), scene.paint(runtime, it.key()));
            runtime.cancel(Session, epoch - 1);
            check(runtime.active() && runtime.status().value(QStringLiteral("epoch")).toInteger() == epoch,
                "late old cancellation cannot remove latest Ring motion");
        }
        scene.commit(runtime);
        for (auto it = before.cbegin(); it != before.cend(); ++it) continuous(it.value(), scene.paint(runtime, it.key()));
        for (const auto offset : {0ms, 7ms, 20ms, 40ms}) {
            lastTime = now + offset;
            check(runtime.advance(lastTime), "one compositor sample of newest epoch"); scene.paintAll(runtime);
        }
        from = to;
    }
    check(runtime.advance(lastTime + 3s) && runtime.completed(), "final retarget settles"); scene.paintAll(runtime);
    runtime.cancel(Session, 5); check(runtime.active(), "old completion cannot end latest settled attachment");
    runtime.cancel(Session, 6); check(!runtime.active(), "latest completion clears production motion");
    // Switch workspace while a new segment and Ring are still in flight.
    const double next = from + (from == 0 ? Step : -Step);
    check(runtime.arm(plan(7, from, next), lastTime + 4s, scene.geometries()), "new active segment before workspace barrier");
    scene.commit(runtime); runtime.advance(lastTime + 4s + 20ms); scene.paintAll(runtime);
    check(runtime.active() && !runtime.completed() && scene.ring.attached(), "workspace barrier starts with active motion and border");
    // Effect desktopChanged clears the Ring; context changes clear native motion.
    scene.clear();
    check(runtime.updateContext(context(2, QStringLiteral("other"))) && !runtime.active(), "workspace barrier clears motion");
    for (const auto &[id, n] : scene.nodes) {
        check(!n->window.property(ViewportDecorationPaddingProperty).isValid() && n->window.childItems().size() == 1,
            "workspace clear leaves no old stroke reservations or scene nodes");
    }
    check(runtime.updateContext(context(3)), "return to original workspace");
    check(runtime.arm(plan(8, next, from), lastTime + 5s, scene.geometries()), "new motion after workspace return");
    scene.commit(runtime); scene.paintAll(runtime);
    const QString closed = runtime.targets().cbegin().key();
    scene.focus(closed);
    const auto frame = scene.ring.capture(0,
        scene.clip(runtime, closed), scene.paintData(runtime, closed));
    scene.nodes.erase(closed); scene.owner = nullptr; runtime.remove(closed);
    const int calls = scene.renderer.calls;
    check(frame && !frame->owner() && !scene.ring.attached()
        && !scene.ring.paint(&scene.renderer, scene.target, scene.viewport, *frame) && scene.renderer.calls == calls,
        "closing retarget owner invalidates frame and its isolated attachment");
    scene.paintAll(runtime);
}
void pendingAndNested(qreal scale) {
    for (bool returnToSource : {false, true}) {
        testScope = QStringLiteral("pending scale=%1 return=%2").arg(scale).arg(returnToSource);
        ScrollRuntimeTestBackend runtime; runtime.updateContext(context());
        check(runtime.arm(plan(1, 0, Step), 0ns), "pending first plan");
        Scene scene(scale); scene.initialize(runtime, true); runtime.advance(40ms);
        const QString id = QStringLiteral("1"); const auto before = scene.paint(runtime, id);
        check(runtime.arm(plan(2, 0, returnToSource ? 0 : 2 * Step, returnToSource), 43ms, scene.geometries()),
            "retarget before previous geometry ACK");
        continuous(before, scene.paint(runtime, id)); scene.commit(runtime); continuous(before, scene.paint(runtime, id));
        for (const auto time : {43ms, 60ms, 100ms, 400ms, 3000ms}) {
            runtime.advance(time); scene.paintAll(runtime);
        }
    }
    testScope = QStringLiteral("nested and completion scale=%1").arg(scale);
    ScrollRuntimeTestBackend runtime; runtime.updateContext(context()); runtime.arm(plan(1, 0, Step), 0ns);
    Scene scene(scale); scene.initialize(runtime, false); runtime.advance(40ms);
    const QString id = QStringLiteral("2"); scene.focus(id);
    const auto oldData = scene.paintData(runtime, id); const auto oldClip = scene.clip(runtime, id);
    const auto frame = scene.ring.capture(Effect::PAINT_WINDOW_TRANSFORMED, oldClip, oldData);
    const auto frozen = focusRingItemMatrix(&scene.node(id).window, oldData, scale);
    auto *root = scene.ring.paintRoot();
    check(runtime.arm(plan(2, Step, 2 * Step), 43ms, scene.geometries()), "nested next epoch during paint callback");
    scene.commit(runtime); scene.focus(id); scene.node(id).window.setOpacity(0.4);
    check(scene.ring.paintRoot() == root && frame && scene.ring.paint(&scene.renderer, scene.target, scene.viewport, *frame),
        "same attachment retains valid local frame across nested retarget");
    check(scene.renderer.sceneMatrix == frozen && scene.renderer.lastRegion == oldClip
        && std::abs(scene.renderer.effectiveOpacity - 0.65 * oldData.opacity()) < 1e-9,
        "nested retarget cannot replace the paint call's frozen position, clip or opacity");
    runtime.advance(80ms); scene.paint(runtime, id);
    runtime.advance(3s); check(runtime.completed(), "settled epoch remains pending finalization");
    const auto settled = scene.paintAll(runtime);
    check(runtime.arm(plan(3, 2 * Step, Step), 3s + 3ms, scene.geometries()), "retarget at completion boundary");
    runtime.cancel(Session, 2); scene.commit(runtime);
    check(runtime.active() && !runtime.completed(), "old completion cannot clear boundary reversal");
    for (auto it = settled.cbegin(); it != settled.cend(); ++it) continuous(it.value(), scene.paint(runtime, it.key()));
}
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    for (qreal scale : {1.0, 1.25, 1.5, 2.0}) {
        chain(scale, {1, 1, -1, 1, -1, -1}, 0);
        chain(scale, {-1, -1, 1, -1, 1, 1}, 3 * Step);
        pendingAndNested(scale);
    }
    check(incoming > 0 && outgoing > 0 && continuing > 0, "all three production motion roles were rendered");
    std::cout << "PASS " << samples << " Ring paint samples, " << handoffs << " epoch arms; source/target ACK, reverse, pending return, nested paint, focus cleanup, close, workspace barrier; max native commit matrix delta=" << maxCommitDelta << '\n';
}
