/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "cc_niri_native_core.h"
#include "effect/effect.h"
#include "effect/effectwindow.h"
#include <QHash>
#include <QPointer>
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
        bool finished = false;
    };
    std::shared_ptr<ScreenBinding> prepare(LogicalOutput *output, EffectWindow *moving);
    void desktopChanged(VirtualDesktop *previous, VirtualDesktop *current, EffectWindow *moving, LogicalOutput *output);
    void desktopChanging(VirtualDesktop *desktop, QPointF offset, EffectWindow *moving, LogicalOutput *output);
    void cancelGesture();
    void finish(LogicalOutput *output);
    void finishAll();
    void bindWindow(ScreenBinding &screen, EffectWindow *window);
    void unbindWindow(ScreenBinding &screen, EffectWindow *window);
    CcNiriViewportClipEffect *m_owner;
    QHash<LogicalOutput *, std::shared_ptr<ScreenBinding>> m_screens;
    QPointer<LogicalOutput> m_paintedScreen;
    qint64 m_epoch = 0;
    int m_duration = 420;
    int m_horizontalGap = 45;
    int m_verticalGap = 20;
    bool m_slideBackground = true;
    bool m_enabled = false;
    bool m_switchingActivity = false;
};
}
