/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "effect/effect.h"
#include "scene/item.h"
#include "scene/borderoutline.h"
#include <QPointer>
#include <optional>

namespace KWin {
// A local value for one paintWindow call. No clock, layout target, or cached
// sample: capture after motion/clip, before delegating to the window renderer.
// The weak attachment token also expires on focus-away/back or off/on.
class FocusRingPaintFrame {
public:
    static std::optional<FocusRingPaintFrame> capture(Item *owner, Item *attachment, int mask,
        const Region &deviceRegion, const WindowPaintData &data, const RectF &inner, const BorderOutline &outline);
    Item *owner() const { return m_owner.data(); }
    Item *attachment() const { return m_attachment.data(); }
    const RectF &innerRect() const { return m_innerRect; }
    const BorderOutline &outline() const { return m_outline; }
    QPointF position() const { return m_position; }
    QTransform transform() const { return m_transform; }
    qreal itemOpacity() const { return m_itemOpacity; }
    int mask() const { return m_mask; }
    const Region &deviceRegion() const { return m_deviceRegion; }
    const WindowPaintData &paintData() const { return m_data; }
private:
    FocusRingPaintFrame(Item *owner, Item *attachment, int mask, const Region &deviceRegion, const WindowPaintData &data, const RectF &inner, const BorderOutline &outline);
    QPointer<Item> m_owner;
    QPointer<Item> m_attachment;
    RectF m_innerRect;
    BorderOutline m_outline;
    QPointF m_position;
    QTransform m_transform;
    qreal m_itemOpacity;
    int m_mask;
    Region m_deviceRegion;
    WindowPaintData m_data;
};
}
