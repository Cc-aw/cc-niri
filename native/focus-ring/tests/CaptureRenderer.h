/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "scene/itemrenderer.h"
#include "scene/item.h"
#include "scene/atlas.h"
#include "scene/ninepatch.h"
#include "effect/effect.h"
#include "core/rendertarget.h"
#include "core/renderviewport.h"
#include <cmath>
#include <cstdlib>
#include <iostream>
using namespace KWin;
// KWin 6.7 root Item rendering composes snapped position, paint data, then
// the native Item transform in device coordinates. No GL pixels are asserted.
inline QMatrix4x4 focusRingItemMatrix(Item *item, const WindowPaintData &data, qreal scale) {
    QMatrix4x4 result;
    result.translate(std::round(item->position().x() * scale), std::round(item->position().y() * scale));
    result *= data.toMatrix(scale);
    result.scale(scale, scale);
    result *= QMatrix4x4(item->transform());
    result.scale(1 / scale, 1 / scale);
    return result;
}
// This inspects the actual KWin Item tree and paint arguments without a GL
// context. The live compositor still has to validate its final pixels.
class FocusRingCaptureRenderer : public ItemRenderer {
public:
    std::unique_ptr<Texture> createTexture(GraphicsBuffer *, const std::shared_ptr<SyncReleasePoint> &) override { std::cerr << "FAIL CPU capture renderer cannot upload textures\n"; std::abort(); }
    std::unique_ptr<Texture> createTexture(const QImage &) override { std::cerr << "FAIL CPU capture renderer cannot upload textures\n"; std::abort(); }
    std::unique_ptr<NinePatch> createNinePatch(const QImage &) override { return {}; }
    std::unique_ptr<NinePatch> createNinePatch(const QImage &, const QImage &, const QImage &, const QImage &,
        const QImage &, const QImage &, const QImage &, const QImage &) override { return {}; }
    std::unique_ptr<Atlas> createAtlas(const QList<QImage> &) override { return {}; }
    void renderBackground(const RenderTarget &, const RenderViewport &, const Region &) override {}
    void renderItem(const RenderTarget &, const RenderViewport &viewport, Item *root, int mask, const Region &region,
        const WindowPaintData &data, const std::function<bool(Item *)> &, const std::function<bool(Item *)> &) override {
        ++calls; lastRoot = root; lastMask = mask; lastRegion = region;
        opacity = data.opacity(); brightness = data.brightness(); saturation = data.saturation();
        matrix = data.toMatrix(viewport.scale());
        sceneMatrix = focusRingItemMatrix(root, data, viewport.scale());
        rootPosition = root->position(); rootTransform = root->transform(); rootOpacity = root->opacity();
        effectiveOpacity = data.opacity() * root->opacity();
    }
    int calls = 0, lastMask = 0;
    Item *lastRoot = nullptr;
    Region lastRegion;
    qreal opacity = 0, brightness = 0, saturation = 0, effectiveOpacity = 0;
    QMatrix4x4 matrix, sceneMatrix;
    QPointF rootPosition;
    QTransform rootTransform;
    qreal rootOpacity = 0;
};
