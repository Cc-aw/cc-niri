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
    // Platform matrix composition requires a finite, positive device scale.
    if(!std::isfinite(scale) || scale<=0) return std::nullopt;
    auto matrix = frame.paintData().toMatrix(scale);
    matrix.scale(scale,scale); matrix *= QMatrix4x4(frame.transform()); matrix.scale(1/scale,1/scale);
    CcNiriRingInput input{}; input.frame=frame.coreState(); input.device_scale=scale;
    for(int i=0;i<4;++i) for(int j=0;j<4;++j) input.matrix[4*i+j]=matrix(i,j);
    const auto result=CcNiri::FocusRingCore::metrics(input);
    if(result.status || !result.valid) return std::nullopt;
    const auto &v=result.value;
    FocusRingStrokeMetrics m;
    m.scaleX=v.scale_x; m.scaleY=v.scale_y; m.deviceScale=v.device_scale; m.thickness=v.thickness;
    m.body=QSizeF(v.width,v.height); m.compensated=v.compensated; m.borderThickness=v.border_thickness;
    for(int i=0;i<4;++i) m.radii[i]=QSizeF(v.radii[2*i],v.radii[2*i+1]);
    return m;
}
CcNiriRingMetrics FocusRingStrokeMetrics::numeric() const {
    CcNiriRingMetrics m{};
    m.scale_x=scaleX; m.scale_y=scaleY; m.device_scale=deviceScale; m.thickness=thickness;
    m.width=body.width(); m.height=body.height(); m.compensated=compensated; m.border_thickness=borderThickness;
    for(int i=0;i<4;++i) { m.radii[2*i]=radii[i].width(); m.radii[2*i+1]=radii[i].height(); }
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
    const auto layout=CcNiri::FocusRingCore::layout(m.numeric());
    if(layout.status || !layout.valid) return false;
    const qreal t=m.thickness;
    const QPainterPath inner=strokeContour(m);
    QPainterPathStroker stroker; stroker.setWidth(2*t); stroker.setJoinStyle(Qt::RoundJoin);
    const QPainterPath stroke=stroker.createStroke(inner).subtracted(inner);
    QImage solid(1,1,QImage::Format_ARGB32_Premultiplied); solid.fill(outline.color());
    for(int i=0;i<8;++i) {
        auto *patch=m_patches[i];
        // KWin snaps the Item origin and its local quad independently. Keep
        // the desired extent in device space, including the animated body's
        // fractional right/bottom edge, without moving the window paint root.
        const auto &p=layout.patches[i];
        const QRectF rect(p.rect.x,p.rect.y,p.rect.width,p.rect.height);
        patch->setGeometry(RectF(p.geometry.x,p.geometry.y,p.geometry.width,p.geometry.height));
        QTransform correction;
        correction.translate(p.translate_x,p.translate_y);
        correction.scale(p.scale_x,p.scale_y);
        patch->setTransform(correction);
        patch->setVisible(p.visible);
        if(i<4) {
            QImage pixels(p.texture_width,p.texture_height,QImage::Format_ARGB32_Premultiplied);
            pixels.fill(Qt::transparent);
            QPainter painter(&pixels); painter.setRenderHint(QPainter::Antialiasing);
            // Map the exact patch extent onto its small native texture.
            painter.scale(pixels.width()/rect.width(),pixels.height()/rect.height());
            painter.translate(-rect.topLeft()); painter.fillPath(stroke,outline.color()); painter.end();
            patch->setImage(pixels); ++m_rasterizations;
        } else if(patch->image().isNull() || m_color!=outline.color()) patch->setImage(solid);
    }
    setSize(m.body); setTransform(QTransform::fromScale(1/m.scaleX,1/m.scaleY));
    m_previous=m; m_color=outline.color(); return true;
}
}
