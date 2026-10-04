/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "scene/itemrenderer.h"
#include "scene/atlas.h"
#include "scene/ninepatch.h"
#include "effect/effect.h"
#include "core/rendertarget.h"
#include "core/renderviewport.h"
#include <QCoreApplication>
#include <cstdlib>
#include <iostream>
using namespace KWin;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
// This inspects the actual KWin Item tree and paint arguments without a GL
// context. The live compositor still has to validate its final pixels.
class CaptureRenderer : public ItemRenderer {
public:
    std::unique_ptr<Texture> createTexture(GraphicsBuffer *, const std::shared_ptr<SyncReleasePoint> &) override { std::cerr << "FAIL border must not create a texture\n"; std::abort(); }
    std::unique_ptr<Texture> createTexture(const QImage &) override { std::cerr << "FAIL border must not create a texture\n"; std::abort(); }
    std::unique_ptr<NinePatch> createNinePatch(const QImage &) override { return {}; }
    std::unique_ptr<NinePatch> createNinePatch(const QImage &, const QImage &, const QImage &, const QImage &,
        const QImage &, const QImage &, const QImage &, const QImage &) override { return {}; }
    std::unique_ptr<Atlas> createAtlas(const QList<QImage> &) override { return {}; }
    void renderBackground(const RenderTarget &, const RenderViewport &, const Region &) override {}
    void renderItem(const RenderTarget &, const RenderViewport &viewport, Item *root, int mask, const Region &region,
        const WindowPaintData &data, const std::function<bool(Item *)> &, const std::function<bool(Item *)> &) override {
        ++calls; lastRoot = root; lastMask = mask; lastRegion = region;
        opacity = data.opacity(); brightness = data.brightness(); saturation = data.saturation();
        matrix = data.toMatrix(viewport.scale());
    }
    int calls = 0, lastMask = 0;
    Item *lastRoot = nullptr;
    Region lastRegion;
    qreal opacity = 0, brightness = 0, saturation = 0;
    QMatrix4x4 matrix;
};
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    Item window; window.setGeometry(RectF(24, 50, 932, 960)); window.setOpacity(0.55);
    Item content(&window); content.setSize(window.size());
    Item shadow(&window); shadow.setGeometry(RectF(-20, -20, 972, 1000)); shadow.setOpacity(0.2);
    FocusRingItem ring; check(ring.attach(&window, &content, window.size(), BorderRadius(12)), "attach");
    check(ring.damageItem()->quads().isEmpty(), "application capture receives no colored quads");
    check(ring.paintRoot()->childItems().size() == 1 && ring.paintRoot()->childItems().front() == ring.border(),
        "isolated paint contains only border, no app contents or shadow");
    check(ring.paintRoot()->opacity() == 1 && ring.border()->opacity() == 1, "app scene opacity is not applied twice");
    QImage image(1920, 1080, QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    const Region clip(Rect(24, 50, 1872, 960));
    CaptureRenderer renderer;
    WindowPaintData data; data.setXTranslation(-230); data.setYTranslation(10);
    data.setXScale(0.85); data.setYScale(1.1); data.setOpacity(0.8); data.setBrightness(0.25); data.setSaturation(0.1);
    const int mask = Effect::PAINT_WINDOW_TRANSFORMED;
    for (const qreal scale : {1.0, 1.5, 2.0}) {
        RenderViewport viewport(RectF(0, 0, 1920, 1080), scale, target, QPoint());
        check(ring.paint(&renderer, target, viewport, mask, clip, data), "isolated draw");
        check(renderer.lastRoot == ring.paintRoot() && renderer.lastMask == mask && renderer.lastRegion == clip,
            "preserves draw tree, mask and native device clip");
        check(renderer.matrix == data.toMatrix(scale) && renderer.opacity == data.opacity(), "same visual transform and fade opacity");
        check(renderer.brightness == 1 && renderer.saturation == 1, "stable material bypasses application color modulation");
        check(data.brightness() == 0.25 && data.saturation() == 0.1, "application paint data unchanged");
        check(ring.border()->outline().color() == QColor(QStringLiteral("#7FC8FF")) &&
            ring.border()->colorDescription() == ColorDescription::sRGB, "constant independent sRGB material");
    }
    window.setPosition(QPointF(100, 70));
    QTransform transform; transform.scale(0.9, 0.9); window.setTransform(transform);
    RenderViewport viewport(RectF(0, 0, 1920, 1080), 1.0, target, QPoint());
    check(ring.paint(&renderer, target, viewport, mask, clip, data), "moved scene owner");
    check(ring.paintRoot()->position() == window.position() && ring.paintRoot()->transform() == window.transform(), "synchronizes native scene transform");
    const int calls = renderer.calls;
    check(!ring.paint(nullptr, target, viewport, mask, clip, data), "missing renderer skips safely");
    check(!ring.paint(&renderer, target, viewport, mask, Region(), data), "empty damage skips");
    ring.clear(); check(!ring.paint(&renderer, target, viewport, mask, clip, data) && renderer.calls == calls, "unloaded tree cannot paint");
    std::cout << "PASS isolated sRGB border, app shadow exclusion, native clip/transform and fade\n";
}
