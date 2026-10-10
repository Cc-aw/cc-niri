/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingPaintFrame.h"
#include "../FocusRingStrokeItem.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
#include <algorithm>
#include <cmath>
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
        const auto frame = ring.capture(mask, region, data);
        return frame && ring.paint(renderer, target, viewport, *frame);
    };
    check(ring.damageItem()->quads().isEmpty(), "application capture receives no colored quads");
    check(ring.paintRoot()->childItems().size() == 2 && ring.glow()->parentItem()==ring.paintRoot()
        && ring.glow()->softGlow() && ring.border()->z()>ring.glow()->z(),
        "isolated paint contains glow then crisp border, no app contents or shadow");
    check(ring.paintRoot()->opacity() == 1 && ring.border()->opacity() == 1, "isolated nodes do not inherit application capture opacity");
    QImage image(1920, 1080, QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    const Region clip(Rect(24, 50, 1872, 960));
    FocusRingCaptureRenderer renderer;
    // Inspect actual raster pixels at every supported scale. The glow must
    // fade outwards, keep bounded textures, and never fill the client area.
    for (qreal scale : {1.0,1.25,1.5,1.75,2.0}) {
        RenderViewport viewport(RectF(0,0,1920,1080),scale,target,QPoint());
        WindowPaintData identity;
        check(paintRing(&renderer,target,viewport,0,Region::infinite(),identity),"static layered draw");
        auto *glow=ring.glow();
        check(glow && glow->isVisible() && glow->colorDescription()==ColorDescription::sRGB,"independent sRGB glow");
        const auto &patches=glow->patches();
        for (int i=0; i<8; ++i) {
            const auto &pixels=patches[i]->image();
            check(!pixels.isNull() && pixels.width()<128 && pixels.height()<128,"bounded diagnostic glow textures");
            if (i>=4) {
                const bool horizontal=i==4 || i==6;
                const int n=horizontal?pixels.height():pixels.width();
                const auto sample=[&](int d){return qAlpha(pixels.pixel(horizontal?0:d,horizontal?d:0));};
                const bool reversed=i==4 || i==7;
                // Pixel centers stop just short of the fully transparent
                // support boundary; allow about 1% alpha in the last pixel.
                check(sample(reversed?n-1:0)>=250 && sample(reversed?0:n-1)<=3,"full-strength diagnostic fades to near transparent");
                // Check what remains visible after the crisp border covers
                // the inner pixels, rather than just the hidden peak alpha.
                const qreal borderWidth=std::round(FocusRingItem::Width*scale)/scale;
                const int outside=std::min(n-1,int((borderWidth+1)*scale));
                check(sample(reversed?n-1-outside:outside)>=65,"visible soft glow survives beyond crisp border at every scale");
                const int middle=std::min(n-1,int((borderWidth+3)*scale));
                check(sample(reversed?n-1-middle:middle)>=35,"soft halo stays visible three logical pixels beyond crisp border");
                const int diffuse=std::min(n-1,int((borderWidth+6)*scale));
                check(sample(reversed?n-1-diffuse:diffuse)>=55,"Gaussian glow retains a diffuse band six logical pixels outside the crisp line");
                for (int d=1;d<n;++d) check(reversed?sample(d)>=sample(d-1):sample(d)<=sample(d-1),"monotonic glow falloff");
                check(horizontal?pixels.width()==1:pixels.height()==1,"straight glow uses one-pixel strip");
            }
        }
        // The corner inside the rounded body is transparent, while its
        // outside arc receives glow. Same frozen frame reuses all pixels.
        const auto &corner=patches[0]->image();
        check(qAlpha(corner.pixel(corner.width()-1,corner.height()-1))==0,"glow does not fill client area");
        const int rasterizations=glow->rasterizations();
        const auto cache=corner.cacheKey();
        window.setPosition(window.position()+QPointF(.25,-.25));
        check(paintRing(&renderer,target,viewport,0,Region::infinite(),identity),"translation follows owner");
        check(glow->rasterizations()==rasterizations && glow->patches()[0]->image().cacheKey()==cache,"translation and idle reuse glow textures");
    }
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
        check(ring.border()->outline().color().rgb() == QColor(QStringLiteral("#7FC8FF")).rgb()
            && qAbs(ring.border()->outline().color().alphaF()-.85)<.001 &&
            ring.border()->colorDescription() == ColorDescription::sRGB, "constant independent sRGB material");
    }
    window.setPosition(QPointF(100, 70));
    QTransform transform; transform.scale(0.9, 0.9); window.setTransform(transform);
    RenderViewport viewport(RectF(0, 0, 1920, 1080), 1.0, target, QPoint());
    check(paintRing(&renderer, target, viewport, mask, clip, data), "moved scene owner");
    check(ring.paintRoot()->position() == window.position() && ring.paintRoot()->transform() == window.transform(), "synchronizes native scene transform");
    // A downstream nested paint can change source properties. The border
    // must retain the exact source sample, without a cached "previous frame".
    const auto captured = ring.capture(mask, clip, data);
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
    check(!ring.paint(&renderer, target, viewport, *captured) && renderer.calls == beforeStale,
        "returning to the same owner cannot revive a frame from its previous attachment");
    const auto beforeOff = ring.capture(mask, clip, data);
    ring.clear();
    check(!ring.capture(mask, clip, data), "missing attachment cannot create a paint frame");
    check(ring.attach(&window, &content, window.size()), "re-enable same owner");
    check(beforeOff && !ring.paint(&renderer, target, viewport, *beforeOff) && renderer.calls == beforeStale,
        "off/on cannot revive an in-flight frame from the unloaded tree");
    WindowPaintData transparent; transparent.setOpacity(0);
    check(!ring.capture(mask, clip, transparent), "transparent effect frame draws no border");
    window.setOpacity(0);
    check(!ring.capture(mask, clip, data), "transparent native item draws no border");
    window.setOpacity(0.9);
    const int calls = renderer.calls;
    check(!paintRing(nullptr, target, viewport, mask, clip, data), "missing renderer skips safely");
    check(!paintRing(&renderer, target, viewport, mask, Region(), data), "empty damage skips");
    ring.clear(); check(!paintRing(&renderer, target, viewport, mask, clip, data) && renderer.calls == calls, "unloaded tree cannot paint");
    auto *destroyed = new Item; destroyed->setSize(window.size());
    auto *destroyedContent = new Item(destroyed); destroyedContent->setParent(destroyed);
    destroyedContent->setSize(destroyed->size());
    check(ring.attach(destroyed, destroyedContent, destroyed->size()), "attach owner before scene destruction");
    const auto deadFrame = ring.capture(mask, clip, data);
    delete destroyed;
    check(deadFrame && !deadFrame->owner() && !deadFrame->attachment() && !ring.paint(&renderer, target, viewport, *deadFrame),
        "destroyed source is guarded by QPointer");
    std::cout << "PASS scoped frame, native opacity, stale owner guards; isolated sRGB border, app shadow exclusion, native clip/transform and fade\n";
}
