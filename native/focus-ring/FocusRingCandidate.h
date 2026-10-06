/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <QSet>
#include <QString>

namespace CcNiri {
// A snapshot of the actual KWin candidate, consumed by Rust eligibility policy.
struct FocusRingCandidate {
    QString id, output, workspace;
    bool active = false, managed = false, normal = false, visible = false;
    bool onCurrentActivity = false, onCurrentDesktop = false, minimized = false, deleted = false, fullscreen = false;
    bool insideOutput = false;
    double opacity = 0;
};
}
