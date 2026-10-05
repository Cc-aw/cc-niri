/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingStrokeItem.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
using namespace KWin;
static void check(bool value, const char *message) {
    if (!value) { std::cerr << "FAIL " << message << '\n'; std::exit(1); }
}
static bool near(qreal a, qreal b) { return std::abs(a-b)<0.002; }
// KWin createRenderNode composes rounded child position before its transform;
// appendWindowQuad rounds the local device vertices independently.
static QMatrix4x4 childMatrix(const QMatrix4x4 &parent, Item *child, qreal s) {
    auto local=focusRingItemMatrix(child,WindowPaintData(),s);
    return parent*local;
}
static QRectF deviceBounds(const QMatrix4x4 &parent, Item *patch, qreal s) {
    const auto quads=patch->quads(); check(quads.size()==1,"patch quad exists");
    RenderGeometry geometry;
    geometry.appendWindowQuad(quads.front(),s);
    std::array<GLVertex2D,6> vertices;
    geometry.copy(vertices);
    // Use the SDK's actual device vertex builder, not a second quad snapper.
    const auto matrix=childMatrix(parent,patch,s);
    const auto a=matrix.map(vertices[0].position.toPointF());
    const auto b=matrix.map(vertices[5].position.toPointF());
    return QRectF(a,b);
}
int main(int argc,char **argv) {
    QCoreApplication app(argc,argv);
    Item window; Item content(&window); FocusRingItem ring;
    QImage image(3840,2160,QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    FocusRingCaptureRenderer renderer; int samples=0;
    for(qreal s : {1.0,1.25,1.5,2.0}) {
        RenderViewport viewport(RectF(0,0,1920,1080),s,target,QPoint(7,11));
        for(qreal fraction : {0.0,0.25,0.5,0.75})
        for(qreal width : {931.0,932.0,932.4}) for(qreal sx : {0.713,0.9999,1.0,1.0001,1.317}) {
            const QSizeF size(width,701); window.setGeometry(RectF(24+fraction,50+fraction/2,size.width(),size.height()));
            content.setSize(size); check(ring.attach(&window,&content,size,BorderRadius(12)),"attach");
            WindowPaintData data; data.setXScale(sx); data.setYScale(sx==1?1:0.973);
            data.setXTranslation(fraction); data.setYTranslation(-fraction);
            auto frame=ring.capture(Effect::PAINT_WINDOW_TRANSFORMED,Region::infinite(),data);
            check(frame && ring.paint(&renderer,target,viewport,*frame),"paint");
            check(renderer.sceneMatrix==focusRingItemMatrix(&window,data,s),"same window root");
            const qreal thickness=std::round(3*s), w=std::round(width*s)*sx,h=std::round(size.height()*s)*data.yScale();
            auto bodyMatrix=renderer.sceneMatrix;
            bodyMatrix.scale(1/sx,1/data.yScale());
            const auto origin=bodyMatrix.map(QPointF());
            if(sx==1) {
                auto *border=ring.border();
                const auto matrix=childMatrix(renderer.sceneMatrix,border,s);
                const qreal t=std::round(border->outline().thickness()*s);
                const auto outer=border->rect().scaled(s).rounded();
                const auto inner=matrix.mapRect(QRectF(outer.x()+t,outer.y()+t,outer.width()-2*t,outer.height()-2*t));
                check(near(inner.left(),origin.x()) && near(inner.top(),origin.y())
                    && near(inner.width(),w) && near(inner.height(),h),"static native inner edge matches window device bounds");
            } else {
                FocusRingStrokeItem *stroke=nullptr;
                for(auto *child : ring.paintRoot()->childItems()) if(auto *item=dynamic_cast<FocusRingStrokeItem *>(child)) stroke=item;
                check(stroke && stroke->isVisible(),"animated stroke");
                auto matrix=childMatrix(renderer.sceneMatrix,stroke,s);
                const auto &p=stroke->patches();
                auto top=deviceBounds(matrix,p[4],s),right=deviceBounds(matrix,p[5],s);
                auto bottom=deviceBounds(matrix,p[6],s),left=deviceBounds(matrix,p[7],s);
                check(near(top.height(),thickness) && near(bottom.height(),thickness)
                    && near(left.width(),thickness) && near(right.width(),thickness),"final device thickness");
                check(near(top.bottom(),origin.y()) && near(left.right(),origin.x())
                    && near(right.left(),origin.x()+w) && near(bottom.top(),origin.y()+h),"animated inner edges follow exact window device bounds");
                auto tl=deviceBounds(matrix,p[0],s),tr=deviceBounds(matrix,p[1],s);
                auto br=deviceBounds(matrix,p[2],s),bl=deviceBounds(matrix,p[3],s);
                check(near(tl.right(),top.left()) && near(tr.left(),top.right())
                    && near(tr.bottom(),right.top()) && near(br.top(),right.bottom())
                    && near(bl.right(),bottom.left()) && near(br.left(),bottom.right())
                    && near(tl.bottom(),left.top()) && near(bl.top(),left.bottom()),"rounded patches and edges meet after native rounding");
                const int rasters=stroke->rasterizations();
                check(ring.paint(&renderer,target,viewport,*frame) && stroke->rasterizations()==rasters,"stable pixel cache");
            }
            const auto damage=RectF(ring.damageItem()->position(),ring.damageItem()->size());
            check(damage.left()*s*sx<=-thickness+0.002 && damage.top()*s*data.yScale()<=-thickness+0.002,"device-rounded stroke is damaged");
            check(window.size()==size,"window geometry preserved"); ++samples;
        }
    }
    ring.clear(); check(window.childItems().size()==1,"cleanup");
    std::cout<<"PASS HiDPI: "<<samples<<" frames; native child rounding, final edges, seams, thickness, static endpoints and scale cache\n";
}
