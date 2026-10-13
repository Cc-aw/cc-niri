/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "cc_niri_native_core.h"
#include "WorkspaceProjectionCache.h"
#include "effect/effect.h"
#include "effect/effectwindow.h"
#include <QHash>
#include <QPointer>
#include <QJsonObject>
#include <array>
#include <memory>

namespace KWin {
class CcNiriViewportClipEffect;
// Only KWin object lifetime, visibility refs, effect hooks and rendering live
// here. Camera interpolation, retarget and projection remain in Rust.
class WorkspaceSlideAdapter : public QObject {
public:
    explicit WorkspaceSlideAdapter(CcNiriViewportClipEffect *owner);
    ~WorkspaceSlideAdapter() override;
    void reconfigure();
    void stop() { finishAll(); }
    bool enabled() const { return m_enabled; }
    bool active() const { return !m_screens.isEmpty(); }
    int duration() const { return m_duration; }
    bool smoothEnabled() const { return m_enabled && m_smooth; }
    QJsonObject status() const;
    void startCapture(qint64 now);
    QJsonObject capture() const;
    void prePaintScreen(ScreenPrePaintData &data);
    void prePaintWindow(EffectWindow *window, WindowPrePaintData &data);
    void postPaintScreen();
    bool paintWindow(const RenderTarget &target, const RenderViewport &viewport,
        EffectWindow *window, int mask, const Region &region, WindowPaintData &data);
private:
    struct WindowBinding {
        EffectWindowVisibleRef visibility;
        QVariant blur;
        QVariant contrast;
        bool elevated = false;
    };
    struct ScreenBinding {
        ScreenBinding();
        ~ScreenBinding();
        Q_DISABLE_COPY_MOVE(ScreenBinding)
        CcNiriWorkspace *motion = nullptr;
        QHash<EffectWindow *, WindowBinding> windows;
        QPointer<EffectWindow> movingWindow;
        qint64 lastSampleTime = 0;
        uint64_t motionRevision = 0;
        bool finished = false;
        bool painted = false;
        WorkspaceProjectionCache<VirtualDesktop> projections;
        Rect projectionGeometry;
        qreal projectionScale = 0;
        uint64_t projectionRevision = 0;
        QSize projectionGrid;
    };
    std::shared_ptr<ScreenBinding> prepare(LogicalOutput *output, EffectWindow *moving);
    void desktopChanged(VirtualDesktop *previous, VirtualDesktop *current, EffectWindow *moving, LogicalOutput *output);
    void desktopChanging(VirtualDesktop *desktop, QPointF offset, EffectWindow *moving, LogicalOutput *output);
    void cancelGesture();
    void finish(LogicalOutput *output);
    void finishAll();
    void bindWindow(ScreenBinding &screen, EffectWindow *window);
    void unbindWindow(ScreenBinding &screen, EffectWindow *window);
    void invalidateProjections();
    void watchDesktop(VirtualDesktop *desktop);
    void watchOutput(LogicalOutput *output);
    void observe(LogicalOutput *output, ScreenBinding &screen, uint32_t kind);
    struct CaptureOutput { QPointer<LogicalOutput> output; QString name; };
    struct CaptureRecord { CcNiriWorkspaceState state; qint64 at; uint32_t output,kind; };
    QList<CaptureOutput> m_captureOutputs;
    std::array<CaptureRecord, 512> m_captureRecords{};
    size_t m_captureCount = 0;
    qint64 m_captureStart = 0, m_captureDeadline = 0;
    bool m_captureTruncated = false;
    CcNiriWorkspaceState m_lastState{};
    QPointer<LogicalOutput> m_lastOutput;
    CcNiriViewportClipEffect *m_owner;
    QHash<LogicalOutput *, std::shared_ptr<ScreenBinding>> m_screens;
    WorkspaceProjectionPasses m_projectionPasses;
    uint64_t m_projectionRevision = 0;
    uint64_t m_captureProjectionCalls = 0, m_captureProjectionFrames = 0;
    uint64_t m_captureProjectionHits = 0, m_captureProjectionFallbacks = 0;
    qint64 m_epoch = 0;
    int m_duration = 420;
    int m_horizontalGap = 45;
    int m_verticalGap = 20;
    bool m_slideBackground = true;
    bool m_enabled = false;
    bool m_smooth = false;
    bool m_switchingActivity = false;
    bool m_projectionCacheEnabled = false;
};
}
