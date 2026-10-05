/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingStrokeItem.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <limits>
using namespace KWin;
static void check(bool value, const char *name) {
    if (!value) { std::cerr << "FAIL " << name << '\n'; std::exit(1); }
}
static bool close(qreal a, qreal b) { return qAbs(a-b) < 0.001; }
static FocusRingStrokeItem *stroke(FocusRingItem &ring) {
    for (auto *child : ring.paintRoot()->childItems())
        if (auto *result = dynamic_cast<FocusRingStrokeItem *>(child)) return result;
    return nullptr;
}
// Image alpha at a logical point in the actual small corner texture.
static int alpha(ImageItem *patch, const QPointF &point) {
    const auto bounds = RectF(patch->position(), patch->size());
    const auto local = patch->transform().inverted().map(point - bounds.topLeft());
    const auto &image = patch->image();
    const int x = int(std::floor(local.x() * image.width()/bounds.width()));
    const int y = int(std::floor(local.y() * image.height()/bounds.height()));
    if (x < 0 || y < 0 || x >= image.width() || y >= image.height()) return 0;
    return qAlpha(image.pixel(x,y));
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    check(argc == 3, "node and fixture arguments");
    QProcess generator; generator.start(QString::fromLocal8Bit(argv[1]), {QString::fromLocal8Bit(argv[2])});
    check(generator.waitForFinished(10000) && generator.exitCode() == 0, "production motion fixture");
    const auto document = QJsonDocument::fromJson(generator.readAllStandardOutput());
    check(document.isArray() && !document.array().isEmpty(), "sample JSON");
    Item window; Item content(&window); FocusRingItem ring;
    QImage image(3840,2160,QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    const Region clip(Rect(21,47,1878,966)); FocusRingCaptureRenderer renderer;
    int samples = 0, scaled = 0;
    for (const qreal deviceScale : {1.0,1.25,1.5,2.0}) {
        RenderViewport viewport(RectF(0,0,1920,1080),deviceScale,target,QPoint());
        for (const auto &entry : document.array()) {
            const auto object=entry.toObject(), geometry=object.value(QStringLiteral("target")).toObject();
            const QSizeF size(geometry.value(QStringLiteral("width")).toDouble(),geometry.value(QStringLiteral("height")).toDouble());
            window.setGeometry(RectF(geometry.value(QStringLiteral("x")).toDouble(),geometry.value(QStringLiteral("y")).toDouble(),size.width(),size.height()));
            window.setTransform(QTransform()); window.setOpacity(0.7); content.setSize(size);
            check(ring.attach(&window,&content,size,BorderRadius(12)), "attach presentation geometry");
            WindowPaintData data; data.setXScale(object.value(QStringLiteral("sx")).toDouble()); data.setYScale(object.value(QStringLiteral("sy")).toDouble());
            data.setXTranslation(object.value(QStringLiteral("tx")).toDouble()); data.setYTranslation(object.value(QStringLiteral("ty")).toDouble());
            data.setOpacity(0.8); data.setBrightness(0.3); data.setSaturation(0.2);
            const auto frame=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,clip,data);
            check(frame && ring.paint(&renderer,target,viewport,*frame), "draw presentation frame");
            check(renderer.sceneMatrix == focusRingItemMatrix(&window,data,deviceScale), "same window frame root matrix");
            check(renderer.lastRegion==clip && close(renderer.effectiveOpacity,0.56) && renderer.brightness==1 && renderer.saturation==1,
                "preserve device clip, both opacities, independent material");
            const qreal expected = std::round(3*deviceScale);
            auto *item=stroke(ring);
            if (data.xScale()!=1 || data.yScale()!=1) {
                ++scaled;
                // This deliberately fails against the original scaled native border.
                if (!item || !item->isVisible()) {
                    check(close(ring.border()->outline().thickness()*deviceScale*data.xScale(),expected)
                        && close(ring.border()->outline().thickness()*deviceScale*data.yScale(),expected),
                        "animated border must retain device-rounded 3px width");
                }
                check(item && item->isVisible() && !ring.border()->isVisible(), "only compensated stroke visible");
                auto compensated=renderer.sceneMatrix; compensated.scale(deviceScale,deviceScale);
                compensated *= QMatrix4x4(item->transform()); compensated.scale(1/deviceScale,1/deviceScale);
                check(close(compensated(0,0),1) && close(compensated(1,1),1), "actual child transform cancels only visual scale");
                const auto &patches=item->patches();
                check(patches.size()==8 && item->parentItem()==ring.paintRoot() && window.childItems().size()==2,
                    "native image patches remain outside application capture");
                for (int i=0;i<8;++i) {
                    check(patches[i]->parentItem()==item && patches[i]->opacity()==1 && !patches[i]->image().isNull(), "owned native patches");
                    if (i<4) check(patches[i]->image().width()<256 && patches[i]->image().height()<256, "small corner textures");
                }
                for (int i : {4,6}) check(close(patches[i]->size().height()*deviceScale,expected), "top-bottom fixed physical thickness");
                for (int i : {5,7}) check(close(patches[i]->size().width()*deviceScale,expected), "left-right fixed physical thickness");
                check(close(item->size().width(),std::round(size.width()*deviceScale)*data.xScale()/deviceScale)
                    && close(item->size().height(),std::round(size.height()*deviceScale)*data.yScale()/deviceScale), "body follows this frame size");
                const auto metrics=FocusRingStrokeMetrics::fromFrame(*frame,deviceScale);
                check(metrics && close(metrics->radii[0].width(),12*data.xScale()) && close(metrics->radii[0].height(),12*data.yScale()),
                    "round window corners follow nonuniform scale");
                // Mid-arc: outward normal of an ellipse, not radial direction.
                const qreal rx=metrics->radii[0].width(), ry=metrics->radii[0].height(), k=std::sqrt(0.5);
                const QPointF boundary(rx*(1-k),ry*(1-k));
                QPointF normal(-k/rx,-k/ry); normal /= std::hypot(normal.x(),normal.y());
                const qreal half=metrics->thickness/2;
                check(alpha(patches[0],boundary+normal*half)>180, "elliptical corner stroke is present");
                check(alpha(patches[0],boundary-normal*half)<40, "corner stroke does not cover window contents");
                check(alpha(patches[0],boundary+normal*(metrics->thickness+2/deviceScale))<40, "corner stroke does not exceed outside width");
                for (int i : {4,5,6,7}) {
                    const auto quads=patches[i]->quads();
                    check(quads.size()==1, "straight stroke has one actual native quad");
                    const auto &q=quads.front();
                    const qreal pixels=i==4 || i==6
                        ? std::round(q.bottom()*deviceScale)-std::round(q.top()*deviceScale)
                        : std::round(q.right()*deviceScale)-std::round(q.left()*deviceScale);
                    check(close(pixels,expected), "native device vertices keep stroke width");
                }
                const int rasters=item->rasterizations(); const auto cacheKey=patches[0]->image().cacheKey();
                for(int repeat=0;repeat<3;++repeat) check(ring.paint(&renderer,target,viewport,*frame), "repaint unchanged frame");
                check(item->rasterizations()==rasters && patches[0]->image().cacheKey()==cacheKey, "unchanged frame reuses corner pixels");
                check(close(ring.damageItem()->position().x()*data.xScale()*deviceScale,-expected), "damage includes fixed-width left edge");
            } else {
                check(ring.border()->isVisible() && (!item || !item->isVisible()), "static path restored after animation");
                check(RectF(ring.damageItem()->position(),ring.damageItem()->size())==ring.border()->outline().inflate(frame->innerRect()), "static damage restored");
            }
            check(window.size()==size && ring.damageItem()->quads().isEmpty(), "source geometry and no-draw marker preserved");
            ++samples;
        }
    }
    // Same owner may commit size/radius while downstream paint is running.
    window.setGeometry(RectF(24,50,1348,960)); content.setSize(window.size());
    check(ring.attach(&window,&content,window.size(),BorderRadius(12)), "old source shape");
    WindowPaintData data; data.setXScale(0.7); data.setYScale(0.9);
    RenderViewport viewport(RectF(0,0,1920,1080),1,target,QPoint());
    const auto old=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,clip,data);
    window.setSize(QSizeF(932,700)); content.setSize(window.size());
    check(ring.attach(&window,&content,window.size(),BorderRadius(4)), "nested source geometry commit");
    check(old && ring.paint(&renderer,target,viewport,*old), "old local shape still valid on same attachment");
    check(close(stroke(ring)->size().width(),1348*data.xScale()), "frozen shape matches old painted window");
    check(old->outline().radius().topLeft()==12, "captured corner style stays frozen");
    const auto next=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,clip,data);
    check(next && ring.paint(&renderer,target,viewport,*next) && close(stroke(ring)->size().width(),932*data.xScale()), "next frame captures new shape");
    check(next->outline().radius().topLeft()==4, "next frame captures new corner style");
    // Combined native Item transform is handled too, with no second animation.
    window.setTransform(QTransform::fromScale(0.9,1.1));
    const auto combined=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,clip,data);
    check(combined && ring.paint(&renderer,target,viewport,*combined), "native and effect scale composition");
    auto matrix=renderer.sceneMatrix; matrix.scale(1,1); matrix *= QMatrix4x4(stroke(ring)->transform());
    check(close(matrix(0,0),1) && close(matrix(1,1),1), "combined scale compensation");
    window.setTransform(QTransform());
    for (const qreal bad : {0.0, std::numeric_limits<qreal>::quiet_NaN(),std::numeric_limits<qreal>::infinity()}) {
        data.setXScale(bad); const auto invalid=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,clip,data); const int count=renderer.calls;
        check(invalid && !ring.paint(&renderer,target,viewport,*invalid) && renderer.calls==count, "invalid scale skips safely");
    }
    WindowPaintData identity; QTransform rotation; rotation.rotate(5); window.setTransform(rotation);
    const auto rotated=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,clip,identity);
    check(rotated && ring.paint(&renderer,target,viewport,*rotated) && ring.border()->isVisible() && !stroke(ring)->isVisible(), "rotation retains native fallback");
    check(renderer.sceneMatrix==focusRingItemMatrix(&window,identity,1), "fallback preserves root transform");
    ring.clear(); check(!ring.capture(0,clip,identity), "scaled tree unload cleanup");
    std::cout << "PASS presentation: " << samples << " frame samples, " << scaled
        << " scaled samples; fixed strokes, elliptic corners, cached images, root pose/clip/opacity and frozen shape\n";
}
