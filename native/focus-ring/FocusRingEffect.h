/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "effect/effect.h"
#include "effect/effectwindow.h"
#include "FocusRingContextBackend.h"
#include "FocusRingItem.h"
#include "FocusRingCornerStyle.h"
#include "RustFocusFade.h"
#include <array>
#include <memory>
#include <vector>
#include <QPointer>
#include <QHash>

namespace KWin {
class CcNiriFocusRingEffect : public Effect {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.NiriFocusRing1")
public:
    CcNiriFocusRingEffect();
    ~CcNiriFocusRingEffect() override;
    void reconfigure(ReconfigureFlags flags) override;
    int requestedEffectChainPosition() const override;
    void prePaintScreen(ScreenPrePaintData &data) override;
    void postPaintScreen() override;
    void paintWindow(const RenderTarget &target, const RenderViewport &viewport, EffectWindow *window,
        int mask, const Region &region, WindowPaintData &data) override;
    bool isActive() const override;
    bool blocksDirectScanout() const override;
public Q_SLOTS:
    Q_SCRIPTABLE QString GetFocusRingStatus() const;
    Q_SCRIPTABLE bool PublishEligibility(const QString &json);
    // Transient rendering diagnostic; never changes focus, layout or config.
    Q_SCRIPTABLE bool SetGlowOnlyDiagnostic(bool enabled);
private:
    void requestEligibility();
    void watchWindow(EffectWindow *window);
    void refresh();
    bool eligible(EffectWindow *window, bool decoration = false) const;
    void clearRing();
    void removeWindow(EffectWindow *window);
    void updateFrameDemand();
    struct Visual {
        explicit Visual(EffectWindow *source) : window(source) {}
        QPointer<EffectWindow> window;
        FocusRingItem ring;
        CcNiri::RustFocusFade fade;
    };
    std::shared_ptr<Visual> visualFor(EffectWindow *window) const;
    CcNiri::FocusRingContextBackend m_context;
    std::vector<std::shared_ptr<Visual>> m_visuals;
    QPointer<EffectWindow> m_owner;
    QHash<EffectWindow *, QString> m_watched;
    QSet<QString> m_closedIds;
    bool m_endpointRegistered = false;
    FocusRingCornerStyle m_cornerStyle;
    quint64 m_drawCount = 0;
    quint64 m_separateGlowClipDrawCount = 0;
    quint64 m_otherOutputPaintSkips = 0;
    bool m_glowOnlyDiagnostic = false;
    struct PaintPass { uintptr_t output = 0; bool real = false; };
    std::array<PaintPass, 32> m_paintPasses{};
    size_t m_paintDepth = 0;
    quint64 m_sharedFrameSamples = 0, m_fadeRepaintRequests = 0;
};
}
