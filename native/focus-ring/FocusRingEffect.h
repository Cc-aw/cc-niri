/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "effect/effect.h"
#include "effect/effectwindow.h"
#include "FocusRingContext.h"
#include "FocusRingItem.h"
#include <QPointer>
#include <QSet>

namespace KWin {
class CcNiriFocusRingEffect : public Effect {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.NiriFocusRing1")
public:
    CcNiriFocusRingEffect();
    ~CcNiriFocusRingEffect() override;
    void reconfigure(ReconfigureFlags flags) override;
    int requestedEffectChainPosition() const override;
    void paintWindow(const RenderTarget &target, const RenderViewport &viewport, EffectWindow *window,
        int mask, const Region &region, WindowPaintData &data) override;
    bool isActive() const override;
    bool blocksDirectScanout() const override;
public Q_SLOTS:
    Q_SCRIPTABLE QString GetFocusRingStatus() const;
    Q_SCRIPTABLE bool PublishEligibility(const QString &json);
private:
    void requestEligibility();
    void watchWindow(EffectWindow *window);
    void refresh();
    bool eligible(EffectWindow *window) const;
    void clearRing();
    CcNiri::FocusRingContext m_context;
    FocusRingItem m_ring;
    QPointer<EffectWindow> m_owner;
    QSet<EffectWindow *> m_watched;
    QSet<QString> m_closedIds;
    bool m_endpointRegistered = false;
    qreal m_configuredRadius = -1;
    qreal m_roundCornersRadius = 0;
    quint64 m_drawCount = 0;
};
}
