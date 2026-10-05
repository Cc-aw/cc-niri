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
bool FocusRingItem::attach(Item *windowItem, Item *contentItem, const QSizeF &frameSize, const BorderRadius &radius) {
    if (!windowItem || !contentItem || contentItem->parentItem() != windowItem
        || !std::isfinite(frameSize.width()) || !std::isfinite(frameSize.height())
        || frameSize.width() <= 0 || frameSize.height() <= 0) { clear(); return false; }
    for (const qreal value : {radius.topLeft(), radius.topRight(), radius.bottomRight(), radius.bottomLeft()}) {
        if (!std::isfinite(value) || value < 0 || value > std::min(frameSize.width(), frameSize.height()) / 2) { clear(); return false; }
    }
    const RectF inner(0, 0, frameSize.width(), frameSize.height());
    const BorderOutline outline(Width, QColor(QStringLiteral("#7FC8FF")), radius);
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
        m_border = new OutlinedBorderItem(inner, outline, m_paintRoot);
        m_border->setParent(this);
        // Item defaults to sRGB independently of the application surface.
        m_parentDestroyed = connect(windowItem, &QObject::destroyed, this, [this] { clear(); });
        m_damage->setZ(contentItem->z());
        m_damage->stackBefore(contentItem);
    } else {
        m_border->setInnerRect(inner);
        m_border->setOutline(outline);
    }
    m_sourceInner = inner; m_sourceOutline = outline;
    m_damage->setGeometry(outline.inflate(inner));
    m_clipPadding.attach(windowItem, outline.thickness());
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
    if (metrics->compensated) {
        if (!m_stroke) { m_stroke = new FocusRingStrokeItem(m_paintRoot); m_stroke->setParent(this); }
        if (!m_stroke->update(*metrics, frame.outline(), m_parent->scene())) return false;
        m_border->setVisible(false); m_stroke->setVisible(true);
        const auto &inner = frame.innerRect();
        m_damage->setGeometry(inner.adjusted(-metrics->thickness / metrics->scaleX, -metrics->thickness / metrics->scaleY,
            metrics->thickness / metrics->scaleX, metrics->thickness / metrics->scaleY));
    } else {
        if (m_stroke) m_stroke->setVisible(false);
        // Quantize the outer margin before KWin rounds the border's origin
        // and size. A 3px margin at 150% otherwise rounds -4.5 and +9
        // independently, shrinking the native inner box by one device pixel.
        const qreal thickness = metrics->scaleX == 1 && metrics->scaleY == 1
            ? metrics->thickness : frame.outline().thickness();
        const BorderOutline outline(thickness, frame.outline().color(), frame.outline().radius());
        m_border->setInnerRect(frame.innerRect()); m_border->setOutline(outline); m_border->setVisible(true);
        m_damage->setGeometry(outline.inflate(frame.innerRect()));
    }
    renderer->renderItem(target, viewport, m_paintRoot, frame.mask(), frame.deviceRegion(), frame.paintData(), {}, {});
    return true;
}
void FocusRingItem::clear() {
    m_clipPadding.clear();
    disconnect(m_parentDestroyed);
    m_parentDestroyed = {};
    // Destroy visual children before their detached parent.
    delete m_stroke.data(); m_stroke = nullptr;
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
