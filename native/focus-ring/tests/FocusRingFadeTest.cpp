/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingStrokeItem.h"
#include "../RustFocusFade.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    Item a, b; a.setGeometry(RectF(24,50,932,960)); b.setGeometry(RectF(964,50,932,960));
    a.setOpacity(.55); b.setOpacity(.7);
    Item ac(&a), bc(&b); ac.setSize(a.size()); bc.setSize(b.size());
    FocusRingItem ar, br;
    check(ar.attach(&a,&ac,a.size(),BorderRadius(12)) && br.attach(&b,&bc,b.size(),BorderRadius(12)), "two independent decorations");
    CcNiri::RustFocusFade old, incoming;
    old.retarget(true); old.advance(0); old.advance(140000000);
    old.retarget(false); incoming.retarget(true);
    QImage image(3840,2160,QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    FocusRingCaptureRenderer renderer;
    for (qreal scale : {1.0,1.25,1.5,1.75,2.0}) {
        RenderViewport viewport(RectF(0,0,1920,1080),scale,target,QPoint());
        WindowPaintData data; data.setOpacity(.8); data.setXTranslation(-200); data.setXScale(.9);
        // Each factor is frozen before nested downstream effects change it.
        const auto frame = br.capture(Effect::PAINT_WINDOW_TRANSFORMED, Region::infinite(), data, .5);
        const auto matrix = focusRingItemMatrix(&b,data,scale);
        b.setOpacity(.9); data.setXTranslation(500); data.setOpacity(.2);
        check(frame && br.paint(&renderer,target,viewport,*frame), "frozen fade frame paints");
        check(qAbs(renderer.effectiveOpacity - .7*.8*.5) < 1e-12 && renderer.sceneMatrix == matrix,
            "native item/effect/visual opacity each apply once, same render transform");
        b.setOpacity(.7);
        const int rasters = br.glow()->rasterizations();
        for (qreal opacity : {.25,.75,1.0}) {
            const auto next = br.capture(0,Region::infinite(),data,opacity);
            check(next && br.paint(&renderer,target,viewport,*next), "opacity-only frame paints");
            check(br.glow()->rasterizations()==rasters, "fade reuses Gaussian textures");
        }
        const auto gain = br.capture(0,Region::infinite(),data,.5,.75);
        check(gain && br.paint(&renderer,target,viewport,*gain) && br.gainGlow(), "gain uses second bounded cached profile");
        const int gainRasters = br.gainGlow()->rasterizations();
        const auto gainKey = br.gainGlow()->patches()[0]->image().cacheKey();
        check(gainRasters >= 8 && br.glow()->rasterizations()==rasters, "gain does not replace accepted static textures");
        for (qreal mix : {.5,.25,.01,0.0}) {
            const auto converging = br.capture(0,Region::infinite(),data,.75,mix);
            check(converging && br.paint(&renderer,target,viewport,*converging), "gain profile converges");
            check(br.gainGlow()->rasterizations()==gainRasters && br.glow()->rasterizations()==rasters
                && br.gainGlow()->patches()[0]->image().cacheKey()==gainKey, "convergence does not rasterize per frame");
            check(br.glow()->opacity()==1-mix && br.gainGlow()->opacity()==mix,
                "cached profiles have bounded complementary weights");
            check(br.gainGlow()->isVisible()==(mix>0), "expanded profile hidden exactly at completion");
        }
        const auto damagePosition = br.damageItem()->position();
        const auto damageSize = br.damageItem()->size();
        check(br.attach(&b,&bc,b.size(),BorderRadius(12)) && br.damageItem()->position()==damagePosition
            && br.damageItem()->size()==damageSize, "unchanged attach preserves resolved damage instead of toggling bounds at idle");
        check(br.paint(&renderer,target,viewport,*gain) && br.gainGlow()->opacity()==.75,
            "nested work cannot change frozen gain profile");
        // Profile weights cannot exceed the accepted peak alpha after source-over.
        for (int i=0;i<8;++i) {
            const auto &pixels=br.gainGlow()->patches()[i]->image();
            check(!pixels.isNull() && pixels.width()<128 && pixels.height()<128,"gain textures remain tiny");
            for (int y=0;y<pixels.height();++y) for (int x=0;x<pixels.width();++x)
                check(qAlpha(pixels.pixel(x,y))<=72,"expanded profile never raises peak glow alpha");
        }
        WindowPaintData identity;
        const auto unscaledGain = br.capture(0,Region::infinite(),identity,.5,.5);
        check(unscaledGain && br.paint(&renderer,target,viewport,*unscaledGain), "unscaled gain uses actual window contour");
        const auto gainMetrics = FocusRingStrokeMetrics::fromFrame(*unscaledGain,scale,FocusRingItem::GainGlowExtent);
        check(gainMetrics && gainMetrics->thickness<8, "native-rounded gain support stays within eight logical pixel column gap");
        const auto &corner = br.gainGlow()->patches()[0]->image();
        check(qAlpha(corner.pixel(corner.width()-1,corner.height()-1))==0, "expanded profile leaves client interior transparent");
        for (qreal invalid : {-.1,1.1}) check(!br.capture(0,Region::infinite(),data,.5,invalid), "invalid gain input rejected");
        check(!br.capture(0,Region::infinite(),data,0) && !br.capture(0,Region::infinite(),data,-.1)
            && !br.capture(0,Region::infinite(),data,1.1), "zero/invalid visual opacity draws no pixels");
    }
    old.advance(200000000); incoming.advance(200000000);
    const auto oa = old.advance(270000000), ib = incoming.advance(270000000);
    check(oa.opacity == .5 && ib.opacity == .5, "same output time produces both halfway samples");
    WindowPaintData data;
    const auto frozen = ar.capture(0,Region::infinite(),data,oa.opacity);
    ar.clear();
    RenderViewport viewport(RectF(0,0,1920,1080),1,target,QPoint());
    check(frozen && !ar.paint(&renderer,target,viewport,*frozen), "immediate removal invalidates retained frame");
    old.advance(340000000); incoming.advance(340000000);
    check(old.sample().retired && incoming.sample().opacity==1 && !incoming.sample().active,
        "retiring visual disappears, current visual settles");
    std::cout << "PASS fade opacity/transform snapshot, five DPI scales, texture reuse and removal\n";
}
