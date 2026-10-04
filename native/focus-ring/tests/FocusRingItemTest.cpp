/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include <QCoreApplication>
#include <QColor>
#include <cstdlib>
#include <iostream>
using namespace KWin;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    Item window; window.setGeometry(RectF(24, 50, 932, 960));
    Item content(&window); content.setSize(window.size());
    FocusRingItem ring;
    int boundsChanges = 0;
    QObject::connect(&window, &Item::boundingRectChanged, [&] { ++boundsChanges; });
    const auto framePosition = window.position(); const auto frameSize = window.size();
    check(ring.attach(&window, &content, frameSize), "attach native border child");
    auto *border = ring.border();
    check(border->parentItem() == &window, "same scene parent as window content");
    check(border->innerRect() == RectF(0, 0, 932, 960), "inner bounds are window local frame");
    check(border->outline().thickness() == 2 && border->outline().color() == QColor(QStringLiteral("#7FC8FF"))
        && border->outline().radius().isNull(), "solid blue 2 logical px with square corners");
    check(window.boundingRect() == RectF(-2, -2, 936, 964), "outer 2px participates in scene damage bounds");
    check(window.position() == framePosition && window.size() == frameSize, "no change to window position or size");
    check(window.sortedChildItems().indexOf(border) < window.sortedChildItems().indexOf(&content), "ring is behind content");
    check(border->quads().count() > 0, "real compositor geometry exists");
    check(ring.attach(&window, &content, frameSize) && ring.border() == border, "same owner does not allocate again");
    const int stable = boundsChanges;
    for (int i = 0; i < 10; ++i) QCoreApplication::processEvents();
    check(boundsChanges == stable, "static item schedules no persistent geometry updates");
    check(ring.attach(&window, &content, QSizeF(1348, 960)), "resize border in local coordinates");
    check(window.size() == frameSize && window.boundingRect().width() == 1352, "resize affects only ring bounds");
    ring.clear();check(!ring.attached() && window.boundingRect() == RectF(0, 0, 932, 960), "removal restores scene bounds");
    for (int i = 0; i < 40; ++i) {
        check(ring.attach(&window, &content, frameSize), "repeated attach");
        ring.clear();check(window.childItems().size() == 1, "no orphan nodes on clear");
    }
    auto *other = new Item; auto *otherContent = new Item(other); otherContent->setParent(other);
    check(ring.attach(other, otherContent, frameSize), "new owner");
    delete other;check(!ring.attached(), "window scene destruction releases border");
    check(!ring.attach(&window, &content, QSizeF(0, 960)), "empty frame refused");
    check(!ring.attach(&window, nullptr, frameSize), "missing content refused");
    std::cout << "PASS native border geometry, ordering, damage bounds and lifetime\n";
}
