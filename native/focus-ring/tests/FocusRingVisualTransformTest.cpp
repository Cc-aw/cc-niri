/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingPaintFrame.h"
#include "../../viewport-clip/ScrollViewportRuntime.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
#include <algorithm>
using namespace std::chrono_literals;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
static QJsonObject plan(bool reverse) {
    const double from = reverse ? 940 : 0, to = reverse ? 0 : 940;
    QJsonArray entries;
    for (int i = 0; i < 3; ++i) {
        const auto placement = [i](double offset) {
            return i * 940 >= offset && i * 940 + 932 <= offset + 1872
                ? QStringLiteral("visible") : QStringLiteral("parked");
        };
        entries.append(QJsonObject{{QStringLiteral("windowId"), QString::number(i)},
            {QStringLiteral("columnId"), i}, {QStringLiteral("logicalX"), i * 940},
            {QStringLiteral("pixelWidth"), 932}, {QStringLiteral("oldPlacement"), placement(from)},
            {QStringLiteral("newPlacement"), placement(to)}});
    }
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("type"), QStringLiteral("SCROLL")},
        {QStringLiteral("sessionId"), QStringLiteral("ring-test")}, {QStringLiteral("epoch"), 1},
        {QStringLiteral("workspaceId"), QStringLiteral("workspace")}, {QStringLiteral("targetOutput"), QStringLiteral("eDP-1")},
        {QStringLiteral("issuedAt"), 1}, {QStringLiteral("oldScrollOffsetX"), from}, {QStringLiteral("newScrollOffsetX"), to},
        {QStringLiteral("viewport"), QJsonObject{{QStringLiteral("x"), 24}, {QStringLiteral("y"), 50},
            {QStringLiteral("width"), 1872}, {QStringLiteral("height"), 960}}}, {QStringLiteral("entries"), entries}};
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QImage image(3840, 2160, QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    FocusRingCaptureRenderer renderer;
    int samples = 0;
    qreal maxCommitMatrixDelta = 0;
    for (const qreal scale : {1.0, 1.5, 2.0}) for (bool reverse : {false, true}) {
        RenderViewport viewport(RectF(0, 0, 1920, 1080), scale, target, QPoint());
        CcNiri::ScrollViewportRuntime runtime;
        check(runtime.updateContext({{QStringLiteral("protocol"), 2}, {QStringLiteral("sessionId"), QStringLiteral("ring-test")},
            {QStringLiteral("generation"), 1}, {QStringLiteral("workspaceId"), QStringLiteral("workspace")},
            {QStringLiteral("targetOutput"), QStringLiteral("eDP-1")}}), "production Spring context");
        const auto scrollPlan = plan(reverse);
        check(runtime.arm(scrollPlan, 0ns), "production Spring plan");
        const auto targets = runtime.targets();
        for (const auto time : {0ms, 7ms, 20ms, 60ms, 100ms, 220ms, 400ms, 3000ms}) {
            check(runtime.advance(time), "one native prePaintScreen sample");
            for (auto it = targets.cbegin(); it != targets.cend(); ++it) {
                Item window; window.setGeometry(RectF(it.value())); window.setOpacity(0.65);
                Item content(&window); content.setSize(window.size());
                FocusRingItem ring;
                check(ring.attach(&window, &content, window.size(), BorderRadius(12)), "attach sampled owner");
                const auto projection = runtime.projection(it.key(), it.value());
                check(projection.has_value(), "native target projection");
                WindowPaintData data; data.setXTranslation(projection->translationX); data.setOpacity(0.75);
                data.setBrightness(0.25); data.setSaturation(0.1);
                const int mask = Effect::PAINT_WINDOW_TRANSFORMED | Effect::PAINT_WINDOW_TRANSLUCENT;
                Region deviceRegion(viewport.mapToDeviceCoordinates(RectF(projection->viewport)).rounded());
                const auto frame = FocusRingPaintFrame::capture(&window, mask, deviceRegion, data);
                check(frame.has_value(), "capture Spring paint sample");
                renderer.renderItem(target, viewport, &window, mask, deviceRegion, data, {}, {});
                const auto expectedMatrix = renderer.sceneMatrix;
                const auto expectedOpacity = renderer.effectiveOpacity;
                const auto expectedClip = renderer.lastRegion;
                check(ring.paint(&renderer, target, viewport, *frame), "paint current Spring sample");
                check(renderer.sceneMatrix == expectedMatrix && renderer.lastRegion == expectedClip && renderer.lastMask == mask,
                    "border receives exact window matrix, device clip and mask in each sampled frame");
                check(qAbs(renderer.effectiveOpacity - expectedOpacity) < 1e-9,
                    "border receives exact native opacity and effect fade");
                check(renderer.brightness == 1 && renderer.saturation == 1 && ring.damageItem()->quads().isEmpty(),
                    "moving border remains outside application capture and color modulation");
                const auto outlineBounds = renderer.sceneMatrix.mapRect(QRectF(-3 * scale, -3 * scale,
                    938 * scale, 966 * scale));
                const Region visible = Region(RectF(outlineBounds).rounded()) & renderer.lastRegion;
                if ((runtime.role(it.key()) == QStringLiteral("incoming") && time == 0ms)
                    || (runtime.role(it.key()) == QStringLiteral("outgoing") && runtime.completed())) {
                    check(visible.isEmpty(), "fully offscreen incoming/outgoing border stays clipped");
                }
                // Arm precedes geometry commit. An old source frame and the
                // committed target must project to exactly the same picture.
                if (runtime.role(it.key()) == QStringLiteral("continuing")) {
                    const auto source = it.value().translated(reverse ? -940 : 940, 0);
                    const auto beforeCommit = runtime.projection(it.key(), source);
                    check(beforeCommit.has_value(), "known pre-commit source");
                    window.setGeometry(RectF(source)); data.setXTranslation(beforeCommit->translationX);
                    const auto preCommitFrame = FocusRingPaintFrame::capture(&window, mask, deviceRegion, data);
                    renderer.renderItem(target, viewport, &window, mask, deviceRegion, data, {}, {});
                    const auto sourceMatrix = renderer.sceneMatrix;
                    window.setGeometry(RectF(it.value())); data.setXTranslation(projection->translationX);
                    check(preCommitFrame && ring.paint(&renderer, target, viewport, *preCommitFrame), "frozen pre-commit frame");
                    check(renderer.sceneMatrix == sourceMatrix, "border follows the exact rendered source frame despite a later commit");
                    qreal delta = 0;
                    for (int row = 0; row < 4; ++row) for (int column = 0; column < 4; ++column)
                        delta = std::max(delta, qreal(qAbs(sourceMatrix(row, column) - expectedMatrix(row, column))));
                    maxCommitMatrixDelta = std::max(maxCommitMatrixDelta, delta);
                    // Native QMatrix4x4 itself uses floats: adding a large slot
                    // displacement in a different order can vary by <0.001px.
                    if (delta > 0.001) std::cerr << "commit matrix delta=" << delta << '\n';
                    check(delta <= 0.001, "source and target native matrices preserve subpixel commit continuity");
                }
                check(window.position() == it.value().topLeft() && window.size() == it.value().size(),
                    "paint never changes actual window geometry");
                ++samples;
            }
        }
        runtime.cancel(QStringLiteral("ring-test"), 1);
        check(!runtime.active() && !runtime.projection(QStringLiteral("1"), targets.value(QStringLiteral("1"))),
            "workspace/scroll cancellation removes native projection");
        Item stationary; stationary.setGeometry(RectF(24, 50, 932, 960));
        Item content(&stationary); content.setSize(stationary.size()); FocusRingItem ring;
        check(ring.attach(&stationary, &content, stationary.size()), "stationary owner after cancellation");
        WindowPaintData identity;
        const auto stationaryFrame = FocusRingPaintFrame::capture(&stationary, 0, Region(Rect(0, 0, 3840, 2160)), identity);
        check(stationaryFrame && ring.paint(&renderer, target, viewport, *stationaryFrame), "static paint after cancellation");
        check(renderer.matrix.isIdentity(), "no previous Spring translation is cached in ring");
    }
    std::cout << "PASS " << samples << " production Spring window/border samples, source commit continuity and native clipping; max native float delta=" << maxCommitMatrixDelta << '\n';
}
