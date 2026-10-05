/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingItem.h"
#include "../FocusRingPaintFrame.h"
#include "../../common/ViewportPaintClip.h"
#include "CaptureRenderer.h"
#include <QCoreApplication>
#include <iostream>
using namespace KWin;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QImage image(3840, 2160, QImage::Format_ARGB32_Premultiplied); RenderTarget target(&image);
    const RectF safe(24, 50, 1872, 960);
    for (qreal scale : {1.0, 1.25, 1.5, 2.0}) {
        RenderViewport viewport(RectF(0, 0, 1920, 1080), scale, target, QPoint());
        Item window; window.setGeometry(RectF(964, 50, 932, 960));
        Item content(&window); content.setSize(window.size());
        FocusRingItem ring;
        check(ring.attach(&window, &content, window.size(), BorderRadius(12)), "attach incoming scene owner without shadow");
        check(window.property(ViewportDecorationPaddingProperty).toDouble() == FocusRingItem::Width,
            "production Ring reserves its actual stroke extent");
        const Region screen(viewport.mapToDeviceCoordinates(RectF(0, 0, 1920, 1080)).rounded());
        const Region top(viewport.mapToDeviceCoordinates(RectF(1200, 47, 120, 3)).rounded());
        const Region bottom(viewport.mapToDeviceCoordinates(RectF(1200, 1010, 120, 3)).rounded());
        const Rect baseClip = viewport.mapToDeviceCoordinates(safe).rounded();
        const Region legacy = screen & baseClip;
        check((legacy & top).isEmpty() && (legacy & bottom).isEmpty(), "old clip reproduces missing horizontal strokes");
        const auto clip = viewportPaintClip(&window, viewport, safe, screen);
        check((clip & top) == top && (clip & bottom) == bottom, "incoming top and bottom strokes survive first scrolling paint");
        const int stroke = std::ceil(FocusRingItem::Width * scale);
        const int centerX = std::round(1300 * scale);
        check(clip.contains(QPoint(centerX, baseClip.top() - stroke))
            && clip.contains(QPoint(centerX, baseClip.bottom() + stroke - 1)),
            "fractional scale retains outermost stroke rows");
        const int centerY = std::round(500 * scale);
        check(clip.contains(QPoint(baseClip.left() - stroke, centerY))
            && clip.contains(QPoint(baseClip.right() + stroke - 1, centerY)),
            "leftmost left stroke and rightmost right stroke survive scrolling paint");
        check(!clip.contains(QPoint(baseClip.left() - stroke - 1, centerY))
            && !clip.contains(QPoint(baseClip.right() + stroke, centerY))
            && !clip.contains(QPoint(centerX, baseClip.top() - stroke - 1))
            && !clip.contains(QPoint(centerX, baseClip.bottom() + stroke)),
            "each viewport edge allows only outward-aligned stroke thickness");
        check(viewportPaintClip(nullptr, viewport, safe, screen) == legacy,
            "windows without a ring retain strict viewport clipping");
        WindowPaintData data; data.setXTranslation(200);
        FocusRingCaptureRenderer renderer;
        const auto frame = ring.capture(Effect::PAINT_WINDOW_TRANSFORMED, clip, data);
        check(frame && ring.paint(&renderer, target, viewport, *frame) && renderer.lastRegion == clip,
            "isolated border receives decoration-aware clip with the window's current transform");
        // A higher window or screen damage may remove side as well as top paint.
        const Region leftBand(Rect(baseClip.left() - stroke, baseClip.top(), stroke, baseClip.height()));
        const Region rightBand(Rect(baseClip.right(), baseClip.top(), stroke, baseClip.height()));
        const Region restricted = screen - top - leftBand - rightBand;
        const auto restrictedClip = viewportPaintClip(&window, viewport, safe, restricted);
        check((restrictedClip & (top | leftBand | rightBand)).isEmpty(), "original occlusion/damage never expanded");
        const Region tiny(viewport.mapToDeviceCoordinates(RectF(1300, 60, 10, 10)).rounded());
        check(viewportPaintClip(&window, viewport, safe, tiny) == tiny, "small damage remains small");
        check(viewportPaintClip(&window, viewport, safe, Region()).isEmpty(), "empty damage stays empty");
        ring.clear();
        check(!window.property(ViewportDecorationPaddingProperty).isValid(), "no stale padding after Ring clears");
        check(viewportPaintClip(&window, viewport, safe, screen) == legacy, "off/unload restores original clip");
    }
    // Reservation cleanup must not leave stale scene state or destroy another writer's value.
    Item first, second;
    ViewportDecorationPadding padding;
    first.setProperty(ViewportDecorationPaddingProperty, 1.0);
    padding.attach(&first, 3); padding.attach(&second, 3);
    check(first.property(ViewportDecorationPaddingProperty).toDouble() == 1, "owner change restores old scene value");
    second.setProperty(ViewportDecorationPaddingProperty, 2.0); padding.clear();
    check(second.property(ViewportDecorationPaddingProperty).toDouble() == 2, "clear respects replacement by another owner");
    auto *dead = new Item; padding.attach(dead, 3); delete dead; padding.clear();
    std::cout << "PASS all four border strips, bounded viewport outsets, scale, occlusion and reservation lifetime\n";
}
