/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingPaintFrame.h"
#include <cmath>

namespace KWin {
FocusRingPaintFrame::FocusRingPaintFrame(Item *owner, Item *attachment, int mask, const Region &deviceRegion, const WindowPaintData &data, const RectF &inner, const BorderOutline &outline, const CcNiriRingFrame &coreState)
    : m_owner(owner), m_attachment(attachment), m_innerRect(inner), m_outline(outline), m_position(owner->position()), m_transform(owner->transform()),
      m_itemOpacity(coreState.item_opacity), m_mask(mask), m_deviceRegion(deviceRegion), m_data(data), m_coreState(coreState) {
    // The ring owns its sRGB material. Window and effect opacity still apply
    // once each; application brightness/saturation must not tint the border.
    m_data.setBrightness(1);
    m_data.setSaturation(1);
}
std::optional<FocusRingPaintFrame> FocusRingPaintFrame::capture(Item *owner, Item *attachment, int mask,
        const Region &deviceRegion, const WindowPaintData &data, const RectF &inner, const BorderOutline &outline) {
    if (!owner || !attachment || deviceRegion.isEmpty()) return std::nullopt;
    const auto &r=outline.radius();
    const CcNiriRingFrame values{{inner.x(),inner.y(),inner.width(),inner.height()},outline.thickness(),
        {r.topLeft(),r.topRight(),r.bottomRight(),r.bottomLeft()},owner->opacity(),data.opacity()};
    const auto snapshot=CcNiri::FocusRingCore::capture(values);
    if(snapshot.status || !snapshot.valid) return std::nullopt;
    return FocusRingPaintFrame(owner, attachment, mask, deviceRegion, data, inner, outline, snapshot.frame);
}
}
