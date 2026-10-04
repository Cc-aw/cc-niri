/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <QSet>
#include <QString>

namespace CcNiri {
struct FocusRingCandidate {
    QString id, output, workspace;
    bool active = false, managed = false, normal = false, visible = false;
    bool onCurrentActivity = false, onCurrentDesktop = false, minimized = false, deleted = false, fullscreen = false;
    bool insideOutput = false;
    double opacity = 0;
};

// Independent JS eligibility authority. Native focus and visibility still
// choose the unique owner. No Dock, layout geometry or animation state.
class FocusRingContext {
public:
    bool update(const QString &json);
    void clear();
    bool permits(const FocusRingCandidate &candidate) const;
    QString session, workspace, output;
    qint64 generation = -1;
    bool enabled = false;
    QSet<QString> retiredSessions;
    QSet<QString> windows;
};
}
