/* SPDX-License-Identifier: GPL-2.0-or-later */

#pragma once

#include "effect/effect.h"

#include "ScrollViewportRuntimeBackend.h"
#include "ScrollClipHandoff.h"
#include <QSet>
#include <QHash>
#include <QString>
#include <array>
#include "NativeScrollProtocolBackend.h"
#include "AnimationFrameContext.h"
#include "ScrollFrameCapture.h"
#include <QPointer>
#include <vector>

namespace KWin
{
class WorkspaceSlideAdapter;
class ViewportInputClip;

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
    void reconfigure(ReconfigureFlags flags) override;

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
    Q_SCRIPTABLE QString GetViewportHitTest(double x, double y) const;
    Q_SCRIPTABLE void StartWorkspaceFrameCapture();
    Q_SCRIPTABLE QString GetWorkspaceFrameCapture() const;
    Q_SCRIPTABLE void StartScrollFrameCapture();
    Q_SCRIPTABLE QString GetScrollFrameCapture() const;

private:
    friend class WorkspaceSlideAdapter;
    friend class ViewportInputClip;
    std::unique_ptr<ViewportInputClip> m_inputClip;
    void paintClippedWindow(const RenderTarget &renderTarget, const RenderViewport &viewport,
        EffectWindow *window, int mask, const Region &deviceRegion, WindowPaintData &data);
    std::unique_ptr<WorkspaceSlideAdapter> m_workspaceSlide;
    static constexpr int ScrollOwnershipDataRole = 1005;
    static constexpr int ScrollMotionCapabilityDataRole = 1006;
    static constexpr int ViewportClipDataRole = 1001;
    static constexpr int CapabilityDataRole = 1002;
    static constexpr int MotionPlanDataRole = 1003;
    static constexpr int MotionCompleteDataRole = 1004;

private Q_SLOTS:
    void onMotionPlanChanged(const QString &json);
    void onRuntimeStateChanged(const QString &json);
    void observeScrollPlan(const QJsonObject &plan);
    void onMotionParked(const QString &json);

private:

    bool resolveScrollPlan(const QJsonObject &plan) const;
    void updateScrollOwnership();
    void clearScrollState();
    void configureAnimationProfile();
    void syncScrollOutput();
    void captureScrollLifecycle(uint32_t kind, qint64 epoch);
    void requestRepaintFull();
    CcNiri::AnimationProfile m_animationProfile = CcNiri::AnimationProfile::Stable;
    bool m_invalidAnimationProfile = false;
    CcNiri::AnimationFrameContext m_scrollFrameContext;
    QPointer<LogicalOutput> m_scrollTargetOutput;
    QString m_scrollTargetName;
    uint64_t m_scrollRevision = 0, m_scrollFrameSerial = 0;
    uint64_t m_scrollCapturedSerial = 0;
    qint64 m_scrollEventTime = 0;
    qint64 m_scrollBoundEpoch = -1;
    struct ScrollPaintPass {
        QPointer<LogicalOutput> output;
        bool real = false, recorded = false;
        uint64_t revision = 0, serial = 0;
        qint64 predictedNs = 0, sampleNs = 0;
        double refreshHz = 0;
        CcNiri::ClockFallback fallback = CcNiri::ClockFallback::None;
    };
    std::array<ScrollPaintPass, 32> m_scrollPaintPasses;
    size_t m_scrollPaintDepth = 0;
    CcNiri::ScrollFrameCapture m_scrollCapture;
    struct ScrollCaptureOutput {
        QPointer<LogicalOutput> output;
        QString name;
        uint64_t token = 0;
        double refreshHz = 0, scale = 1;
        uint64_t fullRepaintRequests = 0;
    };
    std::vector<ScrollCaptureOutput> m_scrollCaptureOutputs;
    uint64_t captureOutputToken(LogicalOutput *output) const;
    CcNiri::ScrollViewportRuntimeBackend m_scrollRuntime;
    CcNiri::ScrollClipHandoff m_scrollClipHandoff;
    // Frozen Rust handles live only until the native workspace effect becomes idle.
    QHash<QString, CcNiri::ScrollViewportRuntimeBackend> m_workspaceDepartures;
    // Paint composition also preserves the real frame before a Wayland ACK
    // starts the existing Script width animation. This is not another clock.
    bool m_scrollPaintFromScript = false;
    QHash<QString, bool> m_workspaceDepartureScriptPaint;
    bool m_scrollEndpointRegistered = false;
    void advertiseCapability(EffectWindow *window, bool available);
    void updateWindowMarker(EffectWindow *window);
    void forwardMotionCompletion(EffectWindow *window);
    void clearWorkspaceState(LogicalOutput *output);
    void observeWorkspaceFrames(LogicalOutput *output);

    // Opt-in platform telemetry. No animation clock, scheduling or Core policy.
    struct WorkspaceFrameSamples {
        std::array<qint64, 512> timestamps{};
        size_t count = 0;
        int refreshRate = 0;
        bool truncated = false;
    };
    struct WorkspaceDesktopEvent {
        QString outputName;
        QString previousId;
        QString currentId;
        qint64 timestamp = 0;
    };
    QHash<LogicalOutput *, QMetaObject::Connection> m_frameConnections;
    QHash<LogicalOutput *, WorkspaceFrameSamples> m_frameSamples;
    std::array<WorkspaceDesktopEvent, 16> m_frameDesktopEvents;
    size_t m_frameDesktopEventCount = 0;
    qint64 m_frameCaptureStart = 0;
    qint64 m_frameCaptureDeadline = 0;
    qint64 m_frameTransitionEnd = 0;
    bool m_frameEventsTruncated = false;

    CcNiri::NativeScrollPlanSequence m_scrollPlanObserver;
    bool m_receivedRuntimeStateSignal = false;
    QSet<EffectWindow *> m_activeWindows;
    QSet<EffectWindow *> m_motionPlanWindows;
    QSet<QString> m_loggedDeviceClips;
    QHash<LogicalOutput *, qint64> m_workspaceBarriers;
};

} // namespace KWin
