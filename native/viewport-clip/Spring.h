/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once

#include <chrono>

namespace CcNiri
{
struct SpringParams {
    double dampingRatio = 1.0;
    double stiffness = 800.0;
    double epsilon = 0.0001;
    double mass = 1.0;
};

struct SpringSample {
    double position;
    double velocity;
};

// Pure time-based oscillator. Sampling does not advance a frame counter or
// touch a window, clock, QObject, or compositor.
class Spring
{
public:
    Spring(double from, double target, double initialVelocity = 0.0,
           SpringParams params = {}) noexcept;
    bool isValid() const noexcept { return m_valid; }
    SpringSample sample(std::chrono::nanoseconds elapsed) const noexcept;
    bool isSettled(const SpringSample &sample) const noexcept;

private:
    enum class Regime { Critical, Under, Over };
    bool m_valid = false;
    Regime m_regime = Regime::Critical;
    SpringParams m_params;
    double m_from;
    double m_target;
    double m_initialVelocity;
    double m_omega = 0.0;
    double m_decay = 0.0;
    double m_frequency = 0.0;
    double m_a = 0.0;
    double m_b = 0.0;
    double m_slow = 0.0;
    double m_fast = 0.0;
};
}
