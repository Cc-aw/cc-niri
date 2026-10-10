/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "cc_niri_native_core.h"
#include <cstdlib>

namespace CcNiri {
// Adapter lifetime only. Rust owns all interpolation/retarget/completion policy.
class RustFocusFade {
public:
    RustFocusFade() : m_handle(cc_niri_focus_fade_create()) { if (!m_handle) std::abort(); }
    ~RustFocusFade() { cc_niri_focus_fade_destroy(m_handle); }
    RustFocusFade(const RustFocusFade &) = delete;
    RustFocusFade &operator=(const RustFocusFade &) = delete;
    CcNiriFocusFadeSample retarget(bool focused) { return check(cc_niri_focus_fade_retarget(m_handle, focused)); }
    CcNiriFocusFadeSample advance(int64_t timeNs) { return check(cc_niri_focus_fade_advance(m_handle, timeNs)); }
    CcNiriFocusFadeSample sample() const { return check(cc_niri_focus_fade_sample(m_handle)); }
    double glowMix() const {
        const auto value = cc_niri_focus_fade_glow(m_handle);
        if (value.status) std::abort();
        return value.mix;
    }
private:
    static CcNiriFocusFadeSample check(CcNiriFocusFadeSample result) { if (result.status) std::abort(); return result; }
    CcNiriFocusFade *m_handle;
};
}
