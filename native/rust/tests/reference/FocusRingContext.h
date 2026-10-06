/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#ifndef CC_NIRI_GOLDEN_REFERENCE
#error "Frozen C++ reference is test-only; production must use Rust Native Core"
#endif
#include "FocusRingCandidate.h"
#include <QString>

namespace CcNiri {

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
