/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <QObject>
#include <QPointer>
#include <QSizeF>
#include "scene/outlinedborderitem.h"

namespace KWin {
// A compositor scene child, not a Window or an input/Wayland surface.
class FocusRingItem : public QObject {
    Q_OBJECT
public:
    explicit FocusRingItem(QObject *parent = nullptr);
    ~FocusRingItem() override;
    bool attach(Item *windowItem, Item *contentItem, const QSizeF &frameSize);
    void clear();
    bool attached() const { return !m_border.isNull(); }
    OutlinedBorderItem *border() const { return m_border.data(); }
    static constexpr qreal Width = 2.0;
private:
    QPointer<Item> m_parent;
    QPointer<OutlinedBorderItem> m_border;
    QMetaObject::Connection m_parentDestroyed;
};
}
