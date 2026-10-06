/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "FocusRingContext.h"
#include "cc_niri_native_core.h"
namespace CcNiri {
// Qt decoding and immutable public status mirrors; Rust owns all authority and
// eligibility policy. Native KWin candidates remain the only actual focus input.
class RustFocusRingContext {
public:
    RustFocusRingContext();
    ~RustFocusRingContext();
    RustFocusRingContext(const RustFocusRingContext &other);
    RustFocusRingContext &operator=(const RustFocusRingContext &other);
    bool update(const QString &json);
    void clear();
    bool permits(const FocusRingCandidate &candidate) const;
    QString session,workspace,output;
    qint64 generation = -1;
    bool enabled = false;
    QSet<QString> retiredSessions,windows;
private:
    void synchronize();
    QString text(std::uint32_t field,std::uint64_t index=0) const;
    CcNiriEligibility *m_handle;
};
}
