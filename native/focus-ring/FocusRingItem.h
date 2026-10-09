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
    std::optional<FocusRingPaintFrame> capture(int mask, const Region &region, const WindowPaintData &data) const;
    bool paint(ItemRenderer *renderer, const RenderTarget &target, const RenderViewport &viewport,
        const FocusRingPaintFrame &frame);
    bool attached() const { return m_damage && m_paintRoot && m_border && m_glow; }
    Item *damageItem() const { return m_damage.data(); }
    Item *paintRoot() const { return m_paintRoot.data(); }
    OutlinedBorderItem *border() const { return m_border.data(); }
    FocusRingStrokeItem *glow() const;
    static constexpr qreal Width = 1.5;
    static constexpr qreal BorderAlpha = 0.85;
    static constexpr qreal GlowRadius = 5.5;
    static constexpr qreal GlowAlpha = 0.15;
    // Covers the largest native-pixel rounding of the soft outer extent.
    static constexpr qreal PaintOutset = 6.0;
    static QColor borderColor();
    static QColor glowColor();
private:
    ViewportDecorationPadding m_clipPadding;
    RectF m_sourceInner;
    BorderOutline m_sourceOutline;
    QPointer<FocusRingStrokeItem> m_stroke;
    QPointer<FocusRingStrokeItem> m_glow;
    QPointer<Item> m_parent;
    QPointer<OutlinedBorderItem> m_border;
    QPointer<Item> m_damage;
    QPointer<Item> m_paintRoot;
    QMetaObject::Connection m_parentDestroyed;
};
}
