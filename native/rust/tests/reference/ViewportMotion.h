/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#ifndef CC_NIRI_GOLDEN_REFERENCE
#error "Frozen C++ reference is test-only; production must use Rust Native Core"
#endif

#include "Spring.h"
#include <cstdint>

namespace CcNiri
{

class ViewportMotion
{
public:
    // Absolute, nonnegative timestamps supplied by the native monotonic clock.
    // This unit never reads JS/wall-clock time or chooses a repaint cadence.
    using TimePoint = std::chrono::nanoseconds;
    static constexpr auto MaxSpringTime = std::chrono::seconds(3);

    explicit ViewportMotion(SpringParams params = {}) noexcept;
    bool start(double from, double target, std::int64_t epoch, TimePoint now) noexcept;
    bool retarget(double target, std::int64_t epoch, TimePoint now) noexcept;
    ViewportMotionSample sample(TimePoint now) const noexcept;
    double current(TimePoint now) const noexcept { return sample(now).current; }
    double target() const noexcept { return m_target; }
    std::int64_t epoch() const noexcept { return m_epoch; }
    bool isActive(TimePoint now) const noexcept { return sample(now).kind == ViewportMotionKind::Animation; }
    bool isDone(TimePoint now) const noexcept { return !isActive(now); }
    bool finish(std::int64_t epoch, TimePoint now) noexcept;
    bool snap(double offset) noexcept;

private:
    SpringParams m_params;
    Spring m_spring;
    ViewportMotionKind m_kind = ViewportMotionKind::Static;
    double m_from = 0.0;
    double m_target = 0.0;
    std::int64_t m_epoch = -1;
    TimePoint m_startTime{0};
};
}
