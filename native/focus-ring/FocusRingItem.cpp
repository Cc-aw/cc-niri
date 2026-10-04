/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingItem.h"
#include <QColor>
#include <cmath>
namespace KWin {
FocusRingItem::FocusRingItem(QObject *parent) : QObject(parent) {}
FocusRingItem::~FocusRingItem() { clear(); }
bool FocusRingItem::attach(Item *windowItem, Item *contentItem, const QSizeF &frameSize) {
    if (!windowItem || !contentItem || contentItem->parentItem() != windowItem
        || !std::isfinite(frameSize.width()) || !std::isfinite(frameSize.height())
        || frameSize.width() <= 0 || frameSize.height() <= 0) { clear(); return false; }
    const RectF inner(0, 0, frameSize.width(), frameSize.height());
    if (m_parent != windowItem || !m_border) {
        clear();
        m_parent = windowItem;
        m_border = new OutlinedBorderItem(inner, BorderOutline(Width, QColor(QStringLiteral("#7FC8FF"))), windowItem);
        // Item visual parenting does not imply QObject lifetime ownership.
        m_border->setParent(this);
        m_parentDestroyed = connect(windowItem, &QObject::destroyed, this, [this] { clear(); });
        m_border->setZ(contentItem->z());
        m_border->stackBefore(contentItem);
    } else {
        m_border->setInnerRect(inner);
    }
    return true;
}
void FocusRingItem::clear() {
    disconnect(m_parentDestroyed);
    m_parentDestroyed = {};
    // Item removal schedules the old bounds and shrinks the parent's bounding
    // rectangle. No timer, GL allocation or full-screen repaint is required.
    delete m_border.data();
    m_border = nullptr; m_parent = nullptr;
}
}
