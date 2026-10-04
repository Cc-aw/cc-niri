/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingPaintFrame.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
#include <cstdlib>
#include <iostream>
using namespace KWin;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    Item window; window.setGeometry(RectF(24, 50, 932, 960)); window.setOpacity(0.55);
    Item content(&window); content.setSize(window.size());
    Item shadow(&window); shadow.setGeometry(RectF(-20, -20, 972, 1000)); shadow.setOpacity(0.2);
    FocusRingItem ring; check(ring.attach(&window, &content, window.size(), BorderRadius(12)), "attach");
    const auto paintRing = [&](ItemRenderer *renderer, const RenderTarget &target, const RenderViewport &viewport,
            int mask, const Region &region, const WindowPaintData &data) {
        const auto frame = FocusRingPaintFrame::capture(&window, mask, region, data);
        return frame && ring.paint(renderer, target, viewport, *frame);
    };
    check(ring.damageItem()->quads().isEmpty(), "application capture receives no colored quads");
    check(ring.paintRoot()->childItems().size() == 1 && ring.paintRoot()->childItems().front() == ring.border(),
        "isolated paint contains only border, no app contents or shadow");
    check(ring.paintRoot()->opacity() == 1 && ring.border()->opacity() == 1, "isolated nodes do not inherit application capture opacity");
    QImage image(1920, 1080, QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    const Region clip(Rect(24, 50, 1872, 960));
    FocusRingCaptureRenderer renderer;
    WindowPaintData data; data.setXTranslation(-230); data.setYTranslation(10);
    data.setXScale(0.85); data.setYScale(1.1); data.setOpacity(0.8); data.setBrightness(0.25); data.setSaturation(0.1);
    const int mask = Effect::PAINT_WINDOW_TRANSFORMED;
    for (const qreal scale : {1.0, 1.5, 2.0}) {
        RenderViewport viewport(RectF(0, 0, 1920, 1080), scale, target, QPoint());
        check(paintRing(&renderer, target, viewport, mask, clip, data), "isolated draw");
        check(renderer.lastRoot == ring.paintRoot() && renderer.lastMask == mask && renderer.lastRegion == clip,
            "preserves draw tree, mask and native device clip");
        check(renderer.matrix == data.toMatrix(scale) && renderer.opacity == data.opacity(), "same visual transform and fade opacity");
        check(qAbs(renderer.effectiveOpacity - window.opacity() * data.opacity()) < 1e-9, "native item opacity and effect fade each apply exactly once");
        check(renderer.brightness == 1 && renderer.saturation == 1, "stable material bypasses application color modulation");
        check(data.brightness() == 0.25 && data.saturation() == 0.1, "application paint data unchanged");
        check(ring.border()->outline().color() == QColor(QStringLiteral("#7FC8FF")) &&
            ring.border()->colorDescription() == ColorDescription::sRGB, "constant independent sRGB material");
    }
    window.setPosition(QPointF(100, 70));
    QTransform transform; transform.scale(0.9, 0.9); window.setTransform(transform);
    RenderViewport viewport(RectF(0, 0, 1920, 1080), 1.0, target, QPoint());
    check(paintRing(&renderer, target, viewport, mask, clip, data), "moved scene owner");
    check(ring.paintRoot()->position() == window.position() && ring.paintRoot()->transform() == window.transform(), "synchronizes native scene transform");
    // A downstream nested paint can change source properties. The border
    // must retain the exact source sample, without a cached "previous frame".
    const auto captured = FocusRingPaintFrame::capture(&window, mask, clip, data);
    check(captured.has_value(), "capture current source");
    const auto expectedMatrix = focusRingItemMatrix(&window, data, 1.0);
    const auto expectedOpacity = window.opacity() * data.opacity();
    window.setPosition(QPointF(400, 80)); window.setOpacity(0.9);
    window.setTransform(QTransform()); data.setXTranslation(500); data.setOpacity(0.2);
    check(ring.paint(&renderer, target, viewport, *captured), "paint scoped snapshot after nested source changes");
    check(renderer.sceneMatrix == expectedMatrix && qAbs(renderer.effectiveOpacity - expectedOpacity) < 1e-9,
        "position, item transform and both opacity factors use the same frozen sample");
    check(captured->paintData().brightness() == 1 && captured->paintData().saturation() == 1,
        "copied paint material remains independent");
    Item second; second.setSize(window.size()); Item secondContent(&second); secondContent.setSize(second.size());
    check(ring.attach(&second, &secondContent, second.size()), "owner changes during downstream work");
    const int beforeStale = renderer.calls;
    check(!ring.paint(&renderer, target, viewport, *captured) && renderer.calls == beforeStale,
        "old owner's local frame cannot paint onto the new owner");
    check(ring.attach(&window, &content, window.size()), "return owner");
    WindowPaintData transparent; transparent.setOpacity(0);
    check(!FocusRingPaintFrame::capture(&window, mask, clip, transparent), "transparent effect frame draws no border");
    window.setOpacity(0);
    check(!FocusRingPaintFrame::capture(&window, mask, clip, data), "transparent native item draws no border");
    window.setOpacity(0.9);
    const int calls = renderer.calls;
    check(!paintRing(nullptr, target, viewport, mask, clip, data), "missing renderer skips safely");
    check(!paintRing(&renderer, target, viewport, mask, Region(), data), "empty damage skips");
    ring.clear(); check(!paintRing(&renderer, target, viewport, mask, clip, data) && renderer.calls == calls, "unloaded tree cannot paint");
    auto *destroyed = new Item; destroyed->setSize(window.size());
    const auto deadFrame = FocusRingPaintFrame::capture(destroyed, mask, clip, data);
    delete destroyed;
    check(deadFrame && !deadFrame->owner() && !ring.paint(&renderer, target, viewport, *deadFrame),
        "destroyed source is guarded by QPointer");
    std::cout << "PASS scoped frame, native opacity, stale owner guards; isolated sRGB border, app shadow exclusion, native clip/transform and fade\n";
}
