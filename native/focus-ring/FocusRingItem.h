/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <QObject>
#include <QPointer>
#include <QSizeF>
#include "FocusRingPaintFrame.h"
#include "scene/outlinedborderitem.h"
#include "../common/ViewportPaintClip.h"

namespace KWin {
class ItemRenderer;
class RenderTarget;
class RenderViewport;
class FocusRingStrokeItem;
// A scene damage child plus an isolated border draw tree; no Window/input surface.
class FocusRingItem : public QObject {
    Q_OBJECT
public:
    explicit FocusRingItem(QObject *parent = nullptr);
    ~FocusRingItem() override;
    bool attach(Item *windowItem, Item *contentItem, const QSizeF &frameSize, const BorderRadius &radius = BorderRadius());
    void clear();
    std::optional<FocusRingPaintFrame> capture(int mask, const Region &region, const WindowPaintData &data,
        qreal visualOpacity = 1.0, qreal glowMix = 0.0) const;
    bool paint(ItemRenderer *renderer, const RenderTarget &target, const RenderViewport &viewport,
        const FocusRingPaintFrame &frame, bool glowOnly = false,
        const Region &outputRegion = Region::infinite());
    bool attached() const { return m_damage && m_paintRoot && m_border && m_glow; }
    Item *damageItem() const { return m_damage.data(); }
    Item *paintRoot() const { return m_paintRoot.data(); }
    OutlinedBorderItem *border() const { return m_border.data(); }
    FocusRingStrokeItem *glow() const;
    FocusRingStrokeItem *gainGlow() const;
    static constexpr qreal Width = 2.0;
    static constexpr qreal BorderAlpha = 0.85;
    // Gaussian sigma; fade to zero before reaching the neighboring column.
    static constexpr qreal GlowRadius = 1.7;
    static constexpr qreal GlowExtent = Width + 3 * GlowRadius;
    static constexpr qreal GlowAlpha = 0.28;
    // Small gain spread; native-pixel rounding stays inside the 8px gap.
    static constexpr qreal GainGlowExtent = 7.4;
    // Covers the largest native-pixel rounding of the soft outer extent.
    static constexpr qreal PaintOutset = 8.0;
    // Leave room for the thicker, device-rounded line within the 8px column
    // gap. The shared clip also applies to application pixels; the halo has
    // a separate decoration-only paint region.
    static constexpr qreal ViewportOutset = 5.0;
    static QColor borderColor();
    static QColor glowColor();
private:
    ViewportDecorationPadding m_clipPadding;
    RectF m_sourceInner;
    BorderOutline m_sourceOutline;
    QPointer<FocusRingStrokeItem> m_stroke;
    QPointer<FocusRingStrokeItem> m_glow, m_gainGlow;
    QPointer<Item> m_parent;
    QPointer<OutlinedBorderItem> m_border;
    QPointer<Item> m_damage;
    QPointer<Item> m_paintRoot;
    QMetaObject::Connection m_parentDestroyed;
};
}
