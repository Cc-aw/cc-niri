/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "ViewportMotion.h"

#include <cmath>

namespace CcNiri
{
ViewportMotion::ViewportMotion(SpringParams params) noexcept
    : m_params(params), m_spring(0.0, 0.0, 0.0, params)
{
}

bool ViewportMotion::start(double from, double target, std::int64_t epoch, TimePoint now) noexcept
{
    if (epoch < 0 || epoch < m_epoch || now < TimePoint::zero()) return false;
    if (epoch == m_epoch) return from == m_from && target == m_target;
    if (now < m_startTime) return false;
    const Spring candidate(from, target, 0.0, m_params);
    if (!candidate.isValid()) return false;
    m_spring = candidate;
    m_from = from;
    m_target = target;
    m_epoch = epoch;
    m_startTime = now;
    m_kind = from == target ? ViewportMotionKind::Static : ViewportMotionKind::Animation;
    return true;
}

bool ViewportMotion::retarget(double target, std::int64_t epoch, TimePoint now) noexcept
{
    if (epoch < 0 || now < TimePoint::zero()) return false;
    if (epoch == m_epoch) return std::isfinite(target) && target == m_target;
    if (now < m_startTime) return false;
    // Position continuity only, matching the first-version zero-velocity policy.
    return start(current(now), target, epoch, now);
}

ViewportMotionSample ViewportMotion::sample(TimePoint now) const noexcept
{
    if (m_kind == ViewportMotionKind::Static) {
        return {ViewportMotionKind::Static, m_target, m_target, 0.0, m_epoch};
    }
    // Both accepted start timestamps are nonnegative; this subtraction cannot
    // overflow, even at the largest representable presentation timestamp.
    const auto elapsed = now <= m_startTime ? TimePoint::zero() : now - m_startTime;
    if (elapsed >= MaxSpringTime) {
        return {ViewportMotionKind::Static, m_target, m_target, 0.0, m_epoch};
    }
    const auto value = m_spring.sample(elapsed);
    if (m_spring.isSettled(value)) {
        return {ViewportMotionKind::Static, m_target, m_target, 0.0, m_epoch};
    }
    return {ViewportMotionKind::Animation, value.position, m_target, value.velocity, m_epoch};
}

bool ViewportMotion::finish(std::int64_t epoch, TimePoint now) noexcept
{
    if (epoch != m_epoch || epoch < 0 || !isDone(now)) return false;
    m_kind = ViewportMotionKind::Static;
    return true;
}

bool ViewportMotion::snap(double offset) noexcept
{
    if (!std::isfinite(offset)) return false;
    m_from = offset;
    m_target = offset;
    m_kind = ViewportMotionKind::Static;
    // Keep the epoch barrier so a cancelled transaction cannot be revived.
    return true;
}
}
