/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingPaintFrame.h"
#include "../FocusRingStrokeItem.h"
#include "../../common/ViewportPaintClip.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
#include <iostream>
using namespace KWin;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QImage image(3840, 2160, QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    const RectF safe(24, 50, 1872, 960);
    for (qreal scale : {1.0, 1.25, 1.5, 1.75, 2.0}) {
        RenderViewport viewport(RectF(0, 0, 1920, 1080), scale, target, QPoint());
        Item window; window.setGeometry(RectF(964, 50, 932, 960));
        Item content(&window); content.setSize(window.size());
        FocusRingItem ring;
        check(ring.attach(&window, &content, window.size(), BorderRadius(12)), "attach incoming scene owner without shadow");
        check(window.property(ViewportDecorationPaddingProperty).toDouble() == FocusRingItem::ViewportOutset,
            "production Ring keeps its viewport reservation independent of halo damage extent");
        check(FocusRingItem::ViewportOutset == 5 && FocusRingItem::PaintOutset > FocusRingItem::ViewportOutset,
            "thicker line retains room inside the column gap without expanding parked application painting");
        const Region screen(viewport.mapToDeviceCoordinates(RectF(0, 0, 1920, 1080)).rounded());
        const Region top(viewport.mapToDeviceCoordinates(RectF(1200, 47, 120, 3)).rounded());
        const Region bottom(viewport.mapToDeviceCoordinates(RectF(1200, 1010, 120, 3)).rounded());
        const Rect baseClip = viewport.mapToDeviceCoordinates(safe).rounded();
        const Region legacy = screen & baseClip;
        check((legacy & top).isEmpty() && (legacy & bottom).isEmpty(), "old clip reproduces missing horizontal strokes");
        const auto clip = viewportPaintClip(&window, viewport, safe, screen);
        check((clip & top) == top && (clip & bottom) == bottom, "incoming top and bottom strokes survive first scrolling paint");
        const int stroke = std::ceil(FocusRingItem::ViewportOutset * scale);
        const int centerX = std::round(1300 * scale);
        check(clip.contains(QPoint(centerX, baseClip.top() - stroke))
            && clip.contains(QPoint(centerX, baseClip.bottom() + stroke - 1)),
            "fractional scale retains outermost stroke rows");
        const int centerY = std::round(500 * scale);
        check(clip.contains(QPoint(baseClip.left() - stroke, centerY))
            && clip.contains(QPoint(baseClip.right() + stroke - 1, centerY)),
            "leftmost left stroke and rightmost right stroke survive scrolling paint");
        check(!clip.contains(QPoint(baseClip.left() - stroke - 1, centerY))
            && !clip.contains(QPoint(baseClip.right() + stroke, centerY))
            && !clip.contains(QPoint(centerX, baseClip.top() - stroke - 1))
            && !clip.contains(QPoint(centerX, baseClip.bottom() + stroke)),
            "each viewport edge allows only outward-aligned stroke thickness");
        check(viewportPaintClip(nullptr, viewport, safe, screen) == legacy,
            "windows without a ring retain strict viewport clipping");
        WindowPaintData data; data.setXTranslation(200);
        FocusRingCaptureRenderer renderer;
        const auto frame = ring.capture(Effect::PAINT_WINDOW_TRANSFORMED, clip, data);
        check(frame && ring.paint(&renderer, target, viewport, *frame) && renderer.lastRegion == clip,
            "isolated border receives decoration-aware clip with the window's current transform");
        // A higher window or screen damage may remove side as well as top paint.
        const Region leftBand(Rect(baseClip.left() - stroke, baseClip.top(), stroke, baseClip.height()));
        const Region rightBand(Rect(baseClip.right(), baseClip.top(), stroke, baseClip.height()));
        const Region restricted = screen - top - leftBand - rightBand;
        const auto restrictedClip = viewportPaintClip(&window, viewport, safe, restricted);
        check((restrictedClip & (top | leftBand | rightBand)).isEmpty(), "original occlusion/damage never expanded");
        const Region tiny(viewport.mapToDeviceCoordinates(RectF(1300, 60, 10, 10)).rounded());
        check(viewportPaintClip(&window, viewport, safe, tiny) == tiny, "small damage remains small");
        check(viewportPaintClip(&window, viewport, safe, Region()).isEmpty(), "empty damage stays empty");
        // Capture the Clip adapter's original region and viewport, then
        // paint after the stack scope ends. Only the halo can use more room.
        std::optional<FocusRingPaintFrame> haloFrame;
        {
            const ScopedViewportPaintContext outer(&window,viewport,safe,restricted);
            const auto captured=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,restrictedClip,data);
            check(captured.has_value(),"capture decoration paint context");
            haloFrame.emplace(*captured);
            {
                const ScopedViewportPaintContext nested(&window,viewport,safe,tiny);
                check(ScopedViewportPaintContext::snapshot(&window)->deviceRegion==tiny,"nested paint has its own original region");
            }
            check(ScopedViewportPaintContext::snapshot(&window)->deviceRegion==restricted,"nested scope restores the enclosing region");
        }
        check(!window.property(ViewportPaintContextProperty).isValid(),"no stack pointer remains after viewport paint scope");
        const int count=renderer.calls;
        check(haloFrame && ring.paint(&renderer,target,viewport,*haloFrame) && renderer.calls==count+2,"halo and crisp line render through separate clips");
        const int haloPixels=std::ceil(FocusRingItem::GlowExtent*scale);
        const Region expectedHalo=restricted & baseClip.adjusted(-haloPixels,-haloPixels,haloPixels,haloPixels);
        const auto &haloDraw=renderer.draws[renderer.draws.size()-2];
        const auto &lineDraw=renderer.draws.back();
        check(haloDraw.region==expectedHalo && lineDraw.region==restrictedClip,"only halo expands the viewport; crisp line preserves the window clip");
        check(haloDraw.region.contains(QPoint(centerX,baseClip.top()-6*scale)) && !lineDraw.region.contains(QPoint(centerX,baseClip.top()-6*scale)),"soft tail outside the shared five-pixel clip is actually submitted for rendering");
        check((haloDraw.region & (top|leftBand|rightBand)).isEmpty(),"halo never paints through original compositor occlusion");
        check(haloDraw.matrix==lineDraw.matrix && haloDraw.opacity==lineDraw.opacity,"both clips use the same frozen render transform and opacity");
        check(haloDraw.filter(ring.border()) && !haloDraw.filter(ring.glow()) && !haloDraw.filter(ring.paintRoot())
            && lineDraw.filter(ring.glow()) && !lineDraw.filter(ring.border()),"layer filters skip the opposite subtree without visibility changes");
        const int diagnosticCount=renderer.calls;
        check(ring.paint(&renderer,target,viewport,*haloFrame,true) && renderer.calls==diagnosticCount+1
            && renderer.draws.back().filter(ring.border()),"glow-only diagnostic draws no crisp border");
        check(ring.border()->isVisible() && ring.glow()->isVisible(),"render filters leave cached Item visibility intact");
        {
            const ScopedViewportPaintContext partial(&window,viewport,safe,tiny);
            const auto small=ring.capture(0,tiny,data);
            check(small && small->decorationRegion(FocusRingItem::GlowExtent,scale)==tiny,"halo retains small damage rather than requesting a full output");
        }
        ring.clear();
        check(!window.property(ViewportDecorationPaddingProperty).isValid(), "no stale padding after Ring clears");
        check(viewportPaintClip(&window, viewport, safe, screen) == legacy, "off/unload restores original clip");
    }
    // A halo near the primary's right edge crosses into its neighbor, but alternating output
    // passes must not rebuild the same cache at 150% and 100% forever.
    {
        Item owner; owner.setGeometry(RectF(1304,50,1252,1382));
        Item content(&owner); content.setSize(owner.size());
        FocusRingItem ring; check(ring.attach(&owner,&content,owner.size(),BorderRadius(12)),"attach near mixed-DPI output boundary");
        const RectF primaryGeometry(0,0,2560,1440);
        RenderViewport primary(primaryGeometry,1.5,target,QPoint());
        RenderViewport neighbor(RectF(2560,0,2560,1440),1,target,QPoint());
        const Region primaryRegion=Region(primary.mapToDeviceCoordinates(primaryGeometry).rounded()) & primary.deviceRect();
        const Region neighborRegion=Region(neighbor.mapToDeviceCoordinates(primaryGeometry).rounded()) & neighbor.deviceRect();
        WindowPaintData data; FocusRingCaptureRenderer renderer;
        const auto frame=ring.capture(0,Region::infinite(),data);
        check(frame && ring.paint(&renderer,target,primary,*frame,false,primaryRegion),"primary output draws halo");
        const int rasters=ring.glow()->rasterizations();
        const auto cache=ring.glow()->patches()[0]->image().cacheKey();
        for (int i=0;i<12;++i) {
            const int draws=renderer.calls;
            check(!ring.paint(&renderer,target,neighbor,*frame,false,neighborRegion) && renderer.calls==draws,"neighbor output submits no owner halo");
            check(ring.paint(&renderer,target,primary,*frame,false,primaryRegion),"primary redraw after neighbor pass");
            check(ring.glow()->rasterizations()==rasters && ring.glow()->patches()[0]->image().cacheKey()==cache,"mixed-DPI passes preserve the primary texture cache");
            check((renderer.lastRegion-primaryRegion).isEmpty(),"halo remains inside owner output bounds");
        }
    }
    // Reservation cleanup must not leave stale scene state or destroy another writer's value.
    Item first, second;
    ViewportDecorationPadding padding;
    first.setProperty(ViewportDecorationPaddingProperty, 1.0);
    padding.attach(&first, 3); padding.attach(&second, 3);
    check(first.property(ViewportDecorationPaddingProperty).toDouble() == 1, "owner change restores old scene value");
    second.setProperty(ViewportDecorationPaddingProperty, 2.0); padding.clear();
    check(second.property(ViewportDecorationPaddingProperty).toDouble() == 2, "clear respects replacement by another owner");
    auto *dead = new Item; padding.attach(dead, 3); delete dead; padding.clear();
    Item unadorned;
    QImage image2(1920,1080,QImage::Format_ARGB32_Premultiplied); RenderTarget target2(&image2);
    RenderViewport viewport2(RectF(0,0,1920,1080),1,target2,QPoint());
    {
        const ScopedViewportPaintContext skipped(&unadorned,viewport2,safe,Region::infinite());
        check(!ScopedViewportPaintContext::snapshot(&unadorned),"unadorned windows install no paint context");
    }
    auto *destroyed=new Item; destroyed->setProperty(ViewportDecorationPaddingProperty,6);
    {
        const ScopedViewportPaintContext guarded(destroyed,viewport2,safe,Region::infinite());
        delete destroyed;
    }
    std::cout << "PASS all four border strips, bounded viewport outsets, scale, occlusion and reservation lifetime\n";
}
