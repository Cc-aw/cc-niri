/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "MotionTypes.h"
#include "cc_niri_native_core.h"

namespace CcNiri {
// Owns one independent Rust state. All motion policy lives in Rust.
class RustViewportMotion {
public:
    using TimePoint = std::chrono::nanoseconds;
    static constexpr auto MaxSpringTime = std::chrono::seconds(3);
    explicit RustViewportMotion(SpringParams params = {}) noexcept;
    RustViewportMotion(const RustViewportMotion &other) noexcept;
    RustViewportMotion &operator=(const RustViewportMotion &other) noexcept;
    ~RustViewportMotion();
    bool start(double from, double target, std::int64_t epoch, TimePoint now) noexcept;
    bool retarget(double target, std::int64_t epoch, TimePoint now) noexcept;
    ViewportMotionSample sample(TimePoint now) const noexcept;
    double current(TimePoint now) const noexcept { return sample(now).current; }
    double target() const noexcept { return sample(TimePoint::zero()).target; }
    std::int64_t epoch() const noexcept { return sample(TimePoint::zero()).epoch; }
    bool isActive(TimePoint now) const noexcept { return sample(now).kind == ViewportMotionKind::Animation; }
    bool isDone(TimePoint now) const noexcept { return !isActive(now); }
    bool finish(std::int64_t epoch, TimePoint now) noexcept;
    bool snap(double offset) noexcept;
private:
    CcNiriMotion *m_handle;
};
}
