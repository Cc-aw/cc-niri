/* SPDX-License-Identifier: GPL-2.0-or-later */

#pragma once

#include "effect/effect.h"

#include <QSet>
#include <QString>

namespace KWin
{

class CcNiriViewportClipEffect : public Effect
{
    Q_OBJECT

public:
    CcNiriViewportClipEffect();
    ~CcNiriViewportClipEffect() override;

    bool isActive() const override;
    bool blocksDirectScanout() const override;
    int requestedEffectChainPosition() const override;

    void paintWindow(const RenderTarget &renderTarget,
                     const RenderViewport &viewport,
                     EffectWindow *window,
                     int mask,
                     const Region &deviceRegion,
                     WindowPaintData &data) override;

private:
    static constexpr int ViewportClipDataRole = 1001;
    static constexpr int CapabilityDataRole = 1002;

    void advertiseCapability(EffectWindow *window, bool available);
    void updateWindowMarker(EffectWindow *window);

    QSet<EffectWindow *> m_activeWindows;
    QSet<QString> m_loggedDeviceClips;
};

} // namespace KWin
