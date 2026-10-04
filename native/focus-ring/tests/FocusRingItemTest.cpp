/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include <QCoreApplication>
#include <QColor>
#include <cstdlib>
#include <iostream>
#include <limits>
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
    check(ring.damageItem()->parentItem() == &window && ring.damageItem()->quads().isEmpty(), "window only contains a non-drawing damage marker");
    check(border->parentItem() == ring.paintRoot() && !ring.paintRoot()->parentItem(), "colored border isolated from app's offscreen capture");
    check(border->colorDescription() == ColorDescription::sRGB, "border has its own sRGB color source");
    check(ring.paintRoot()->position() == framePosition, "isolated root retains window transform origin");
    check(border->innerRect() == RectF(0, 0, 932, 960), "inner bounds are window local frame");
    check(border->outline().thickness() == 3 && border->outline().color() == QColor(QStringLiteral("#7FC8FF"))
        && border->outline().radius().isNull(), "solid blue 3 logical px with square corners");
    check(window.boundingRect() == RectF(-3, -3, 938, 966), "outer 3px participates in scene damage bounds");
    check(window.position() == framePosition && window.size() == frameSize, "no change to window position or size");
    check(window.sortedChildItems().indexOf(ring.damageItem()) < window.sortedChildItems().indexOf(&content), "damage marker keeps content ordering");
    check(border->quads().count() > 0, "real compositor geometry exists");
    check(ring.attach(&window, &content, frameSize) && ring.border() == border, "same owner does not allocate again");
    const BorderRadius rounded(12);
    check(ring.attach(&window, &content, frameSize, rounded) && ring.border() == border, "rounded style reuses the owner node");
    check(border->outline().radius() == rounded && border->outline().thickness() == 3, "12px inner radius matches rounded windows");
    check(window.boundingRect() == RectF(-3, -3, 938, 966), "roundness preserves external damage bounds");
    check(border->quads().count() == 8, "four corner arcs and four edge strips");
    check(window.position() == framePosition && window.size() == frameSize, "rounded style never modifies frame geometry");
    check(ring.attach(&window, &content, frameSize, BorderRadius(0, 12, 12, 0)) &&
        border->outline().radius().topLeft() == 0 && border->outline().radius().topRight() == 12, "per-corner native radius preserved");
    check(ring.attach(&window, &content, frameSize) && border->outline().radius().isNull(), "return to square style has no stale rounded corners");
    const int stable = boundsChanges;
    for (int i = 0; i < 10; ++i) QCoreApplication::processEvents();
    check(boundsChanges == stable, "static item schedules no persistent geometry updates");
    check(ring.attach(&window, &content, QSizeF(1348, 960)), "resize border in local coordinates");
    check(window.size() == frameSize && window.boundingRect().width() == 1354, "resize affects only ring bounds");
    ring.clear();check(!ring.attached() && window.boundingRect() == RectF(0, 0, 932, 960), "removal restores scene bounds");
    for (int i = 0; i < 40; ++i) {
        check(ring.attach(&window, &content, frameSize), "repeated attach");
        ring.clear();check(window.childItems().size() == 1, "no orphan nodes on clear");
    }
    Item second; second.setSize(frameSize); Item secondContent(&second); secondContent.setSize(frameSize);
    for (int i = 0; i < 40; ++i) {
        check(ring.attach(&window, &content, frameSize, rounded), "focus first owner");
        check(ring.attach(&second, &secondContent, frameSize, rounded), "focus second owner");
        check(window.childItems().size() == 1 && second.childItems().size() == 2, "only current owner has a scene border");
        ring.clear(); check(second.childItems().size() == 1, "second owner clears without a node residue");
    }
    check(!ring.attach(&window, &content, frameSize, BorderRadius(-1)), "negative radius refused");
    check(!ring.attach(&window, &content, frameSize, BorderRadius(std::numeric_limits<qreal>::quiet_NaN())), "nonfinite radius refused");
    auto *other = new Item; auto *otherContent = new Item(other); otherContent->setParent(other);
    check(ring.attach(other, otherContent, frameSize), "new owner");
    delete other;check(!ring.attached(), "window scene destruction releases border");
    check(!ring.attach(&window, &content, QSizeF(0, 960)), "empty frame refused");
    check(!ring.attach(&window, nullptr, frameSize), "missing content refused");
    std::cout << "PASS native border geometry, ordering, damage bounds and lifetime\n";
}
