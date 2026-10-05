/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "core/renderviewport.h"
#include "scene/item.h"
#include <QPointer>
#include <QVariant>
#include <algorithm>
#include <cmath>

namespace KWin {
// A scene decoration can reserve its stroke space around all viewport edges,
// without changing layout or motion. The original device region still bounds
// painting, preserving screen damage and occlusion. No KWin data roles.
inline constexpr char ViewportDecorationPaddingProperty[] = "ccNiriViewportDecorationPadding";
class ViewportDecorationPadding {
public:
    ViewportDecorationPadding() = default;
    Q_DISABLE_COPY_MOVE(ViewportDecorationPadding)
    ~ViewportDecorationPadding() { clear(); }
    void attach(Item *owner, qreal padding) {
        if (m_owner != owner) {
            clear(); m_owner = owner;
            if (owner) m_previous = owner->property(ViewportDecorationPaddingProperty);
        }
        m_padding = std::isfinite(padding) ? std::clamp(padding, 0.0, 128.0) : 0;
        if (owner && owner->property(ViewportDecorationPaddingProperty) != QVariant(m_padding)) {
            owner->setProperty(ViewportDecorationPaddingProperty, m_padding);
        }
    }
    void clear() {
        if (m_owner && m_owner->property(ViewportDecorationPaddingProperty) == QVariant(m_padding)) {
            m_owner->setProperty(ViewportDecorationPaddingProperty, m_previous);
        }
        m_owner = nullptr; m_previous = {}; m_padding = 0;
    }
private:
    QPointer<Item> m_owner;
    QVariant m_previous;
    qreal m_padding = 0;
};
inline Region viewportPaintClip(Item *owner, const RenderViewport &viewport,
        const RectF &logicalViewport, const Region &deviceRegion) {
    const qreal requested = owner ? owner->property(ViewportDecorationPaddingProperty).toDouble() : 0;
    const qreal padding = std::isfinite(requested) ? std::clamp(requested, 0.0, 128.0) : 0;
    const Rect deviceClip = viewport.mapToDeviceCoordinates(logicalViewport).rounded();
    // OutlinedBorderItem rounds its device thickness. Reserve outward to
    // avoid losing an outer row or column at fractional scale.
    const int devicePadding = std::ceil(padding * viewport.scale());
    return deviceRegion & deviceClip.adjusted(-devicePadding, -devicePadding, devicePadding, devicePadding);
}
}
