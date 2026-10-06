/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "Spring.h"

#include <cmath>

namespace CcNiri
{
Spring::Spring(double from, double target, double initialVelocity,
               SpringParams params) noexcept
    : m_params(params), m_from(from), m_target(target), m_initialVelocity(initialVelocity)
{
    if (!std::isfinite(from) || !std::isfinite(target) || !std::isfinite(initialVelocity)
        || !std::isfinite(params.dampingRatio) || params.dampingRatio < 0.0
        || !std::isfinite(params.stiffness) || params.stiffness <= 0.0
        || !std::isfinite(params.mass) || params.mass <= 0.0
        || !std::isfinite(params.epsilon) || params.epsilon <= 0.0) return;

    const double displacement = from - target;
    m_omega = std::sqrt(params.stiffness) / std::sqrt(params.mass);
    m_decay = params.dampingRatio * m_omega;
    const double numerator = initialVelocity + m_decay * displacement;
    if (!std::isfinite(displacement) || !std::isfinite(m_omega) || m_omega <= 0.0
        || !std::isfinite(m_decay) || !std::isfinite(numerator)
        || !std::isfinite(params.epsilon * m_omega)) return;

    if (params.dampingRatio == 1.0) {
        m_a = displacement;
        m_b = numerator;
    } else if (params.dampingRatio < 1.0) {
        m_regime = Regime::Under;
        m_frequency = m_omega * std::sqrt((1.0 - params.dampingRatio)
                                         * (1.0 + params.dampingRatio));
        m_a = displacement;
        m_b = numerator / m_frequency;
    } else {
        m_regime = Regime::Over;
        const double root = std::sqrt(params.dampingRatio - 1.0)
                            * std::sqrt(params.dampingRatio + 1.0);
        // The reciprocal form avoids cancellation in the slow root.
        m_slow = -m_omega / (params.dampingRatio + root);
        m_fast = -m_omega * (params.dampingRatio + root);
        m_a = (initialVelocity - m_fast * displacement) / (m_slow - m_fast);
        m_b = displacement - m_a;
    }
    m_valid = std::isfinite(m_a) && std::isfinite(m_b)
              && std::isfinite(m_frequency) && std::isfinite(m_slow) && std::isfinite(m_fast);
}

SpringSample Spring::sample(std::chrono::nanoseconds elapsed) const noexcept
{
    if (!m_valid) return {std::isfinite(m_target) ? m_target : 0.0, 0.0};
    if (elapsed <= std::chrono::nanoseconds::zero()) return {m_from, m_initialVelocity};
    const double t = std::chrono::duration<double>(elapsed).count();
    double displacement;
    double velocity;
    if (m_regime == Regime::Critical) {
        const double envelope = std::exp(-m_decay * t);
        const double polynomial = m_a + m_b * t;
        displacement = envelope * polynomial;
        velocity = envelope * (m_b - m_decay * polynomial);
    } else if (m_regime == Regime::Under) {
        const double envelope = std::exp(-m_decay * t);
        const double cosine = std::cos(m_frequency * t);
        const double sine = std::sin(m_frequency * t);
        const double wave = m_a * cosine + m_b * sine;
        displacement = envelope * wave;
        velocity = envelope * (m_frequency * (m_b * cosine - m_a * sine) - m_decay * wave);
    } else {
        const double slow = m_a * std::exp(m_slow * t);
        const double fast = m_b * std::exp(m_fast * t);
        displacement = slow + fast;
        velocity = m_slow * slow + m_fast * fast;
    }
    const double position = m_target + displacement;
    // Unrepresentable arithmetic must not reach paint projection as NaN/Inf.
    if (!std::isfinite(position) || !std::isfinite(velocity)) return {m_target, 0.0};
    return {position, velocity};
}

bool Spring::isSettled(const SpringSample &sample) const noexcept
{
    // Velocity also matters: an underdamped spring can cross its target at speed.
    return m_valid && std::isfinite(sample.position) && std::isfinite(sample.velocity)
           && std::abs(sample.position - m_target) <= m_params.epsilon
           && std::abs(sample.velocity) <= m_params.epsilon * m_omega;
}
}
