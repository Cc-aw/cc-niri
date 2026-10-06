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
                              int clipRole, int planRole, int completionRole,
                              bool preserveDepartingWide = false)
{
    for (auto *window : windows) {
        if (output && window->screen() != output) continue;
        QVariantMap clip = window->data(clipRole).toMap();
        const QVariantMap plan = window->data(planRole).toMap();
        const QString type = plan.value(QStringLiteral("type")).toString();
        const bool wide = type == QStringLiteral("PAIR_TO_WIDE") || type == QStringLiteral("WIDE_TO_PAIR");
        // Motion policy stays in the Script Effect. Retain only its departing
        // Wide clip while KWin's fullscreen workspace effect paints the old
        // desktop. The Effect clears this role when Slide finishes/returns.
        const bool preserve = preserveDepartingWide && !window->isOnCurrentDesktop() &&
            clip.value(QStringLiteral("enabled")).toBool() &&
            (wide || clip.value(QStringLiteral("workspaceDeparture")).toBool());
        if (preserve) {
            clip.insert(QStringLiteral("workspaceDeparture"), true);
            window->setData(clipRole, clip);
            active.insert(window);
        } else {
            window->setData(clipRole, QVariant());
            active.remove(window);
        }
        window->setData(planRole, QVariant());
        window->setData(completionRole, QVariant());
        plans.remove(window);
    }
}
}
