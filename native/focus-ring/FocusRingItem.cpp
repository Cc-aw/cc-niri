/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingItem.h"
#include "FocusRingPaintFrame.h"
#include "FocusRingStrokeItem.h"
#include <QColor>
#include <cmath>
#include <algorithm>
#include "scene/itemrenderer.h"
#include "effect/effect.h"
namespace KWin {
FocusRingItem::FocusRingItem(QObject *parent) : QObject(parent) {}
FocusRingItem::~FocusRingItem() { clear(); }
FocusRingStrokeItem *FocusRingItem::glow() const { return m_glow.data(); }
QColor FocusRingItem::borderColor() {
    QColor color(QStringLiteral("#7FC8FF")); color.setAlphaF(BorderAlpha); return color;
}
QColor FocusRingItem::glowColor() {
    QColor color(QStringLiteral("#7FC8FF")); color.setAlphaF(GlowAlpha); return color;
}
bool FocusRingItem::attach(Item *windowItem, Item *contentItem, const QSizeF &frameSize, const BorderRadius &radius) {
    if (!windowItem || !contentItem || contentItem->parentItem() != windowItem) { clear(); return false; }
    const double radii[4]{radius.topLeft(),radius.topRight(),radius.bottomRight(),radius.bottomLeft()};
    if(!CcNiri::FocusRingCore::geometryValid(frameSize.width(),frameSize.height(),radii)) { clear(); return false; }
    const RectF inner(0, 0, frameSize.width(), frameSize.height());
    const BorderOutline outline(Width, borderColor(), radius);
    if (m_parent != windowItem || !m_border) {
        clear();
        m_parent = windowItem;
        // Only a non-drawing damage marker belongs to the window tree. A
        // rounded-corners OffscreenEffect must never capture the colored ring
        // and reinterpret its outside pixels as this application's shadow.
        m_damage = new Item(windowItem);
        m_damage->setParent(this);
        m_paintRoot = new Item;
        m_paintRoot->setParent(this);
        m_glow = new FocusRingStrokeItem(m_paintRoot, true);
        m_glow->setParent(this);
        m_border = new OutlinedBorderItem(inner, outline, m_paintRoot);
        m_border->setParent(this);
        m_border->setZ(1);
        // Item defaults to sRGB independently of the application surface.
        m_parentDestroyed = connect(windowItem, &QObject::destroyed, this, [this] { clear(); });
        m_damage->setZ(contentItem->z());
        m_damage->stackBefore(contentItem);
    } else {
        m_border->setInnerRect(inner);
        m_border->setOutline(outline);
    }
    m_sourceInner = inner; m_sourceOutline = outline;
    m_damage->setGeometry(BorderOutline(PaintOutset, glowColor(), radius).inflate(inner));
    m_clipPadding.attach(windowItem, ViewportOutset);
    m_paintRoot->setGeometry(RectF(windowItem->position(), frameSize));
    m_paintRoot->setTransform(windowItem->transform());
    return true;
}
std::optional<FocusRingPaintFrame> FocusRingItem::capture(int mask, const Region &region, const WindowPaintData &data) const {
    return FocusRingPaintFrame::capture(m_parent.data(), m_paintRoot.data(), mask, region, data, m_sourceInner, m_sourceOutline);
}
bool FocusRingItem::paint(ItemRenderer *renderer, const RenderTarget &target, const RenderViewport &viewport,
        const FocusRingPaintFrame &frame) {
    if (!attached() || !m_parent || frame.owner() != m_parent.data() || !renderer
        || frame.attachment() != m_paintRoot.data() || frame.deviceRegion().isEmpty()) return false;
    // Preserve the window's state at entry to this paint call, even if nested
    // downstream work changes the Item. A destroyed/recreated attachment must
    // reject its old local frame even when focus returns to the same window.
    m_paintRoot->setPosition(frame.position());
    m_paintRoot->setTransform(frame.transform());
    m_paintRoot->setOpacity(frame.itemOpacity());
    const auto metrics = FocusRingStrokeMetrics::fromFrame(frame, viewport.scale());
    if (!metrics) return false;
    auto glowMetrics = FocusRingStrokeMetrics::fromFrame(frame, viewport.scale(), GlowExtent);
    if (!glowMetrics) return false;
    // Non-axis transforms retain the native local-shape fallback. Rust still
    // computes its layout; the common paint root applies the owner's matrix.
    const bool nativeFallback = metrics->radii[0].width() < 0;
    if (nativeFallback) glowMetrics = FocusRingStrokeMetrics::fromFrame(frame, viewport.scale(), GlowExtent, true);
    if (!glowMetrics || !m_glow->update(*glowMetrics,
        BorderOutline(GlowExtent, glowColor(), frame.outline().radius()), m_parent->scene(),
        nativeFallback ? frame.outline().thickness() : metrics->thickness)) return false;
    if (metrics->compensated) {
        if (!m_stroke) { m_stroke = new FocusRingStrokeItem(m_paintRoot); m_stroke->setParent(this); m_stroke->setZ(1); }
        if (!m_stroke->update(*metrics, frame.outline(), m_parent->scene())) return false;
        m_border->setVisible(false); m_stroke->setVisible(true);
    } else {
        if (m_stroke) m_stroke->setVisible(false);
        // Share the native device alignment with the window's inner edge.
        const qreal thickness = nativeFallback ? frame.outline().thickness() : metrics->borderThickness;
        const BorderOutline outline(thickness, frame.outline().color(), frame.outline().radius());
        m_border->setInnerRect(frame.innerRect()); m_border->setOutline(outline); m_border->setVisible(true);
    }
    const auto damage=CcNiri::FocusRingCore::damage(frame.coreState().inner,glowMetrics->numeric());
    m_damage->setGeometry(RectF(damage.x,damage.y,damage.width,damage.height));
    renderer->renderItem(target, viewport, m_paintRoot, frame.mask(), frame.deviceRegion(), frame.paintData(), {}, {});
    return true;
}
void FocusRingItem::clear() {
    m_clipPadding.clear();
    disconnect(m_parentDestroyed);
    m_parentDestroyed = {};
    // Destroy visual children before their detached parent.
    delete m_stroke.data(); m_stroke = nullptr;
    delete m_glow.data(); m_glow = nullptr;
    delete m_border.data();
    m_border = nullptr;
    delete m_paintRoot.data();
    m_paintRoot = nullptr;
    // Removing the non-drawing marker schedules the old outside bounds.
    delete m_damage.data();
    m_damage = nullptr;
    m_parent = nullptr;
}
}
