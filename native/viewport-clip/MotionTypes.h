/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <chrono>
#include <cstdint>

namespace CcNiri {
// Value representations for the synchronous C ABI adapter, without algorithms.
struct SpringParams {
    double dampingRatio = 1.0;
    double stiffness = 800.0;
    double epsilon = 0.0001;
    double mass = 1.0;
};
struct SpringSample { double position; double velocity; };
enum class ViewportMotionKind { Static, Animation };
struct ViewportMotionSample {
    ViewportMotionKind kind;
    double current;
    double target;
    double velocity;
    std::int64_t epoch;
};
}
