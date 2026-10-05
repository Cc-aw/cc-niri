/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingStrokeItem.h"
#include <QPainter>
#include <QPainterPathStroker>
#include <algorithm>
#include <cmath>
namespace KWin {
namespace {
class StrokePatch : public ImageItem {
public:
    explicit StrokePatch(Item *parent) : ImageItem(parent) {}
    void bindScene(Scene *value) { if (scene() != value) setScene(value); }
};
QPainterPath strokeContour(const FocusRingStrokeMetrics &m) {
    const qreal w = m.body.width(), h = m.body.height();
    const auto &r = m.radii;
    QPainterPath p;
    p.moveTo(r[0].width(), 0); p.lineTo(w - r[1].width(), 0);
    const auto arc = [&](int i, const QRectF &box, qreal start, const QPointF &square) {
        if (r[i].width() > 0 && r[i].height() > 0) p.arcTo(box, start, -90);
        else p.lineTo(square);
    };
    arc(1, QRectF(w - 2*r[1].width(), 0, 2*r[1].width(), 2*r[1].height()), 90, QPointF(w,0));
    p.lineTo(w,h - r[2].height());
    arc(2, QRectF(w - 2*r[2].width(), h - 2*r[2].height(), 2*r[2].width(), 2*r[2].height()), 0, QPointF(w,h));
    p.lineTo(r[3].width(),h);
    arc(3, QRectF(0,h - 2*r[3].height(),2*r[3].width(),2*r[3].height()),270,QPointF(0,h));
    p.lineTo(0,r[0].height());
    arc(0,QRectF(0,0,2*r[0].width(),2*r[0].height()),180,QPointF(0,0));
    p.closeSubpath(); return p;
}
bool same(const FocusRingStrokeMetrics &a, const FocusRingStrokeMetrics &b) {
    return a.scaleX == b.scaleX && a.scaleY == b.scaleY && a.deviceScale == b.deviceScale
        && a.thickness == b.thickness && a.body == b.body && a.radii == b.radii;
}
}
std::optional<FocusRingStrokeMetrics> FocusRingStrokeMetrics::fromFrame(const FocusRingPaintFrame &frame, qreal scale) {
    if (!std::isfinite(scale) || scale <= 0 || !frame.innerRect().isValid()) return std::nullopt;
    auto matrix = frame.paintData().toMatrix(scale);
    matrix.scale(scale,scale); matrix *= QMatrix4x4(frame.transform()); matrix.scale(1/scale,1/scale);
    for (int i=0;i<4;++i) for (int j=0;j<4;++j) if (!std::isfinite(matrix(i,j))) return std::nullopt;
    FocusRingStrokeMetrics m;
    m.deviceScale = scale; m.body = frame.innerRect().size();
    const bool axis = matrix(0,1)==0 && matrix(1,0)==0 && matrix(0,2)==0 && matrix(1,2)==0
        && matrix(2,0)==0 && matrix(2,1)==0 && matrix(3,0)==0 && matrix(3,1)==0 && matrix(3,2)==0 && matrix(3,3)==1;
    // Preserve the existing native path for rotations/shears/reflections.
    if (!axis || matrix(0,0)<0 || matrix(1,1)<0) return m;
    m.scaleX = matrix(0,0); m.scaleY = matrix(1,1);
    if (m.scaleX < 0.0001 || m.scaleY < 0.0001 || m.scaleX > 64 || m.scaleY > 64) return std::nullopt;
    m.thickness = std::round(frame.outline().thickness()*scale)/scale;
    m.body = QSizeF(std::round(frame.innerRect().width()*scale)*m.scaleX/scale,
        std::round(frame.innerRect().height()*scale)*m.scaleY/scale);
    const auto &r = frame.outline().radius();
    const std::array<qreal,4> radii{r.topLeft(),r.topRight(),r.bottomRight(),r.bottomLeft()};
    for (int i=0;i<4;++i) {
        const qreal radius = std::round(radii[i]*scale)/scale;
        m.radii[i] = QSizeF(std::min(radius*m.scaleX,m.body.width()/2), std::min(radius*m.scaleY,m.body.height()/2));
    }
    // Only stroke children counter-scale; the root retains the window matrix.
    m.compensated = m.scaleX != 1 || m.scaleY != 1;
    return m;
}
FocusRingStrokeItem::FocusRingStrokeItem(Item *parent) : Item(parent) {
    for (auto &patch : m_patches) { patch = new StrokePatch(this); patch->setParent(this); }
}
FocusRingStrokeItem::~FocusRingStrokeItem() { for (auto *patch : m_patches) delete patch; }
bool FocusRingStrokeItem::update(const FocusRingStrokeMetrics &m, const BorderOutline &outline, Scene *scene) {
    if (this->scene() != scene) setScene(scene);
    for (auto *patch : m_patches) static_cast<StrokePatch *>(patch)->bindScene(scene);
    if (m_previous && same(*m_previous,m) && m_color == outline.color()) return true;
    const qreal w=m.body.width(),h=m.body.height(),t=m.thickness,s=m.deviceScale;
    std::array<QSizeF,4> inset;
    for(int i=0;i<4;++i) inset[i]=QSizeF(std::min(std::ceil(m.radii[i].width()*s)/s,w/2),std::min(std::ceil(m.radii[i].height()*s)/s,h/2));
    const std::array<QRectF,8> rects{
        QRectF(-t,-t,inset[0].width()+t,inset[0].height()+t),
        QRectF(w-inset[1].width(),-t,inset[1].width()+t,inset[1].height()+t),
        QRectF(w-inset[2].width(),h-inset[2].height(),inset[2].width()+t,inset[2].height()+t),
        QRectF(-t,h-inset[3].height(),inset[3].width()+t,inset[3].height()+t),
        QRectF(inset[0].width(),-t,std::max(0.0,w-inset[0].width()-inset[1].width()),t),
        QRectF(w,inset[1].height(),t,std::max(0.0,h-inset[1].height()-inset[2].height())),
        QRectF(inset[3].width(),h,std::max(0.0,w-inset[3].width()-inset[2].width()),t),
        QRectF(-t,inset[0].height(),t,std::max(0.0,h-inset[0].height()-inset[3].height()))};
    for (int i=0;i<4;++i) if (std::ceil(rects[i].width()*s)>1024 || std::ceil(rects[i].height()*s)>1024) return false;
    const QPainterPath inner=strokeContour(m);
    QPainterPathStroker stroker; stroker.setWidth(2*t); stroker.setJoinStyle(Qt::RoundJoin);
    const QPainterPath stroke=stroker.createStroke(inner).subtracted(inner);
    QImage solid(1,1,QImage::Format_ARGB32_Premultiplied); solid.fill(outline.color());
    for(int i=0;i<8;++i) {
        auto *patch=m_patches[i];
        // KWin snaps the Item origin and its local quad independently. Keep
        // the desired extent in device space, including the animated body's
        // fractional right/bottom edge, without moving the window paint root.
        const auto &rect = rects[i];
        const QPointF snapped(std::round(rect.x()*s)/s, std::round(rect.y()*s)/s);
        const QSizeF extent(std::max(1.0,std::round(rect.width()*s))/s,
            std::max(1.0,std::round(rect.height()*s))/s);
        patch->setGeometry(RectF(snapped,extent));
        QTransform correction;
        correction.translate(rect.x()-snapped.x(),rect.y()-snapped.y());
        correction.scale(rect.width()/extent.width(),rect.height()/extent.height());
        patch->setTransform(correction);
        patch->setVisible(!rect.isEmpty());
        if(i<4) {
            QImage pixels(std::max(1,int(std::ceil(rects[i].width()*s))),std::max(1,int(std::ceil(rects[i].height()*s))),QImage::Format_ARGB32_Premultiplied);
            pixels.fill(Qt::transparent);
            QPainter painter(&pixels); painter.setRenderHint(QPainter::Antialiasing);
            // Map the exact patch extent onto its small native texture.
            painter.scale(pixels.width()/rects[i].width(),pixels.height()/rects[i].height());
            painter.translate(-rects[i].topLeft()); painter.fillPath(stroke,outline.color()); painter.end();
            patch->setImage(pixels); ++m_rasterizations;
        } else if(patch->image().isNull() || m_color!=outline.color()) patch->setImage(solid);
    }
    setSize(m.body); setTransform(QTransform::fromScale(1/m.scaleX,1/m.scaleY));
    m_previous=m; m_color=outline.color(); return true;
}
}
