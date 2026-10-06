/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "FocusRingPaintFrame.h"
#include "scene/imageitem.h"
#include <array>
namespace KWin {
// Resolved solely from the current paint frame; no presentation mode or clock.
struct FocusRingStrokeMetrics {
    qreal scaleX = 1, scaleY = 1, deviceScale = 1, thickness = 3;
    QSizeF body;
    std::array<QSizeF, 4> radii;
    bool compensated = false;
    qreal borderThickness = 3;
    CcNiriRingMetrics numeric() const;
    static std::optional<FocusRingStrokeMetrics> fromFrame(const FocusRingPaintFrame &frame, qreal deviceScale);
};
class FocusRingStrokeItem : public Item {
public:
    explicit FocusRingStrokeItem(Item *parent);
    ~FocusRingStrokeItem() override;
    bool update(const FocusRingStrokeMetrics &metrics, const BorderOutline &outline, Scene *scene);
    const std::array<ImageItem *, 8> &patches() const { return m_patches; }
    int rasterizations() const { return m_rasterizations; }
private:
    std::array<ImageItem *, 8> m_patches;
    std::optional<FocusRingStrokeMetrics> m_previous;
    QColor m_color;
    int m_rasterizations = 0;
};
}
