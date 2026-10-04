/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "effect/effect.h"
#include "scene/item.h"
#include <QPointer>
#include <optional>

namespace KWin {
// A local value for one paintWindow call. No clock, layout target, or cached
// sample: capture after motion/clip, before delegating to the window renderer.
class FocusRingPaintFrame {
public:
    static std::optional<FocusRingPaintFrame> capture(Item *owner, int mask,
        const Region &deviceRegion, const WindowPaintData &data);
    Item *owner() const { return m_owner.data(); }
    QPointF position() const { return m_position; }
    QTransform transform() const { return m_transform; }
    qreal itemOpacity() const { return m_itemOpacity; }
    int mask() const { return m_mask; }
    const Region &deviceRegion() const { return m_deviceRegion; }
    const WindowPaintData &paintData() const { return m_data; }
private:
    FocusRingPaintFrame(Item *owner, int mask, const Region &deviceRegion, const WindowPaintData &data);
    QPointer<Item> m_owner;
    QPointF m_position;
    QTransform m_transform;
    qreal m_itemOpacity;
    int m_mask;
    Region m_deviceRegion;
    WindowPaintData m_data;
};
}
