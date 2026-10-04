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

// Read-only Bridge membership adapter for the static POC. It carries no
// geometry or animation state; production JS ownership is a later phase.
class FocusRingContext {
public:
    bool update(const QString &json);
    void clear();
    bool permits(const FocusRingCandidate &candidate) const;
    QString session, workspace, output;
    qint64 generation = -1;
    QSet<QString> windows;
};
}
