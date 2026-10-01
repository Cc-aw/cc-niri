#pragma once

#include <QVariant>

namespace KWin
{
inline bool acceptsWorkspaceMotion(qint64 issuedAt, qint64 barrier, bool onCurrentDesktop)
{
    return onCurrentDesktop && issuedAt >= barrier;
}

// Shared with the native regression fixture; no compositor is needed to verify
// output scoping, all three roles, or set mutation during dataChanged callbacks.
template<typename Windows, typename Output, typename WindowSet>
void clearWorkspaceClipWindows(const Windows &windows, Output *output,
                              WindowSet &active, WindowSet &plans,
                              int clipRole, int planRole, int completionRole)
{
    for (auto *window : windows) {
        if (output && window->screen() != output) continue;
        window->setData(clipRole, QVariant());
        window->setData(planRole, QVariant());
        window->setData(completionRole, QVariant());
        active.remove(window);
        plans.remove(window);
    }
}
}
