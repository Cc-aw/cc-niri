/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "core/renderviewport.h"
#include "scene/item.h"
#include <QPointer>
#include <QVariant>
#include <algorithm>
#include <cmath>
#include <optional>
#include "FocusRingCoreBackend.h"

namespace KWin {
// A scene decoration can reserve its stroke space around all viewport edges,
// without changing layout or motion. The original device region still bounds
// painting, preserving screen damage and occlusion. No KWin data roles.
inline constexpr char ViewportDecorationPaddingProperty[] = "ccNiriViewportDecorationPadding";
inline constexpr char ViewportPaintContextProperty[] = "ccNiriViewportPaintContext";
// Adapter-only, call-scoped context from Clip to scene decorations. The
// original compositor region remains the damage / occlusion authority.
struct ViewportPaintContext {
    Region deviceRegion;
    Rect deviceViewport;
    Region decorationRegion(qreal padding, qreal scale) const {
        const int pixels = CcNiri::FocusRingCore::devicePadding(padding, scale);
        return deviceRegion & deviceViewport.adjusted(-pixels, -pixels, pixels, pixels);
    }
};
class ScopedViewportPaintContext {
public:
    ScopedViewportPaintContext(Item *owner, const RenderViewport &viewport,
            const RectF &logicalViewport, const Region &deviceRegion) {
        // Only the Ring owner needs this context. No per-window registry or
        // Qt metatype with a destructor owned by a reloadable plugin.
        if (!owner || !owner->property(ViewportDecorationPaddingProperty).isValid()) return;
        m_owner = owner;
        m_context = {deviceRegion, viewport.mapToDeviceCoordinates(logicalViewport).rounded()};
        m_previous = owner->property(ViewportPaintContextProperty);
        m_address = QVariant::fromValue(reinterpret_cast<quintptr>(&m_context));
        owner->setProperty(ViewportPaintContextProperty, m_address);
    }
    Q_DISABLE_COPY_MOVE(ScopedViewportPaintContext)
    ~ScopedViewportPaintContext() {
        if (m_owner && m_owner->property(ViewportPaintContextProperty) == m_address)
            m_owner->setProperty(ViewportPaintContextProperty, m_previous);
    }
    static std::optional<ViewportPaintContext> snapshot(Item *owner) {
        if (!owner) return std::nullopt;
        const auto address = owner->property(ViewportPaintContextProperty).value<quintptr>();
        // This pointer is published only around the synchronous paint call.
        // Copy Qt values now; a paint frame never retains the stack pointer.
        if (address) return *reinterpret_cast<const ViewportPaintContext *>(address);
        return std::nullopt;
    }
private:
    QPointer<Item> m_owner;
    ViewportPaintContext m_context;
    QVariant m_previous;
    QVariant m_address;
};
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
        m_padding = CcNiri::FocusRingCore::padding(padding);
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
    const Rect deviceClip = viewport.mapToDeviceCoordinates(logicalViewport).rounded();
    // OutlinedBorderItem rounds its device thickness. Reserve outward to
    // avoid losing an outer row or column at fractional scale.
    const int devicePadding = CcNiri::FocusRingCore::devicePadding(requested,viewport.scale());
    return deviceRegion & deviceClip.adjusted(-devicePadding, -devicePadding, devicePadding, devicePadding);
}
}
