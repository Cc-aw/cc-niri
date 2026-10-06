/* SPDX-License-Identifier: GPL-2.0-or-later */

#pragma once

#include "effect/effect.h"

#include "ScrollViewportRuntimeBackend.h"
#include "NativeScrollProtocolBackend.h"
#include <QSet>
#include <QHash>
#include <QString>
#include "../../src/protocol/ViewportScrollPlan.h"

namespace KWin
{

class CcNiriViewportClipEffect : public Effect
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.NiriViewportMotion1")

public:
    CcNiriViewportClipEffect();
    ~CcNiriViewportClipEffect() override;

    bool isActive() const override;
    bool blocksDirectScanout() const override;
    int requestedEffectChainPosition() const override;

    void prePaintScreen(ScreenPrePaintData &data) override;
    void prePaintWindow(RenderView *view, EffectWindow *window, WindowPrePaintData &data) override;
    void postPaintScreen() override;
    void paintWindow(const RenderTarget &renderTarget,
                     const RenderViewport &viewport,
                     EffectWindow *window,
                     int mask,
                     const Region &deviceRegion,
                     WindowPaintData &data) override;

public Q_SLOTS:
    Q_SCRIPTABLE bool ArmScrollPlan(const QString &json);
    Q_SCRIPTABLE void CancelScrollPlan(const QString &json);
    Q_SCRIPTABLE QString GetScrollMotionStatus() const;
    Q_SCRIPTABLE bool WorkspaceTransitionActive() const;

private:
    static constexpr int ScrollOwnershipDataRole = 1005;
    static constexpr int ScrollMotionCapabilityDataRole = 1006;
    static constexpr int ViewportClipDataRole = 1001;
    static constexpr int CapabilityDataRole = 1002;
    static constexpr int MotionPlanDataRole = 1003;
    static constexpr int MotionCompleteDataRole = 1004;

private Q_SLOTS:
    void onMotionPlanChanged(const QString &json);
    void onDockStateChanged(const QString &json);
    void observeScrollPlan(const QJsonObject &plan);
    void onMotionParked(const QString &json);

private:

    bool resolveScrollPlan(const QJsonObject &plan) const;
    void updateScrollOwnership();
    void clearScrollState();
    CcNiri::ScrollViewportRuntimeBackend m_scrollRuntime;
    bool m_scrollEndpointRegistered = false;
    void advertiseCapability(EffectWindow *window, bool available);
    void updateWindowMarker(EffectWindow *window);
    void forwardMotionCompletion(EffectWindow *window);
    void clearWorkspaceState(LogicalOutput *output);

    CcNiri::NativeScrollPlanSequence m_scrollPlanObserver;
    bool m_receivedDockStateSignal = false;
    QSet<EffectWindow *> m_activeWindows;
    QSet<EffectWindow *> m_motionPlanWindows;
    QSet<QString> m_loggedDeviceClips;
    QHash<LogicalOutput *, qint64> m_workspaceBarriers;
};

} // namespace KWin
