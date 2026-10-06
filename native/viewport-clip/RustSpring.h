/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "Spring.h"
#include "cc_niri_native_core.h"

namespace CcNiri
{
// Immutable Rust state with value semantics. No window/clock/Qt ownership.
class RustSpring
{
public:
    RustSpring(double from, double target, double initialVelocity = 0.0,
               SpringParams params = {}) noexcept;
    RustSpring(const RustSpring &other) noexcept;
    RustSpring &operator=(const RustSpring &other) noexcept;
    ~RustSpring();
    bool isValid() const noexcept;
    SpringSample sample(std::chrono::nanoseconds elapsed) const noexcept;
    bool isSettled(const SpringSample &sample) const noexcept;
private:
    const CcNiriSpring *m_handle;
};
}
