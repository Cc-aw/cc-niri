/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "RustViewportMotion.h"
#include <cstdlib>

namespace CcNiri {
namespace {
void checkStatus(std::uint32_t status) noexcept {
    if (status != CC_NIRI_FFI_OK) std::abort();
}
bool accepted(CcNiriSpringBoolResult result) noexcept {
    checkStatus(result.status);
    return result.value != 0;
}
}
RustViewportMotion::RustViewportMotion(SpringParams params) noexcept
    : m_handle(cc_niri_motion_create({params.dampingRatio, params.stiffness, params.epsilon, params.mass})) {
    if (!m_handle) std::abort();
}
RustViewportMotion::RustViewportMotion(const RustViewportMotion &other) noexcept
    : m_handle(cc_niri_motion_clone(other.m_handle)) {
    if (!m_handle) std::abort();
}
RustViewportMotion &RustViewportMotion::operator=(const RustViewportMotion &other) noexcept {
    checkStatus(cc_niri_motion_copy(m_handle, other.m_handle));
    return *this;
}
RustViewportMotion::~RustViewportMotion() { cc_niri_motion_destroy(m_handle); }
bool RustViewportMotion::start(double from, double target, std::int64_t epoch, TimePoint now) noexcept {
    return accepted(cc_niri_motion_start(m_handle, from, target, epoch, now.count()));
}
bool RustViewportMotion::retarget(double target, std::int64_t epoch, TimePoint now) noexcept {
    return accepted(cc_niri_motion_retarget(m_handle, target, epoch, now.count()));
}
ViewportMotionSample RustViewportMotion::sample(TimePoint now) const noexcept {
    const auto result = cc_niri_motion_sample(m_handle, now.count());
    checkStatus(result.status);
    if (result.kind > CC_NIRI_MOTION_ANIMATION) std::abort();
    return {result.kind == CC_NIRI_MOTION_ANIMATION ? ViewportMotionKind::Animation : ViewportMotionKind::Static,
        result.current, result.target, result.velocity, result.epoch};
}
bool RustViewportMotion::finish(std::int64_t epoch, TimePoint now) noexcept {
    return accepted(cc_niri_motion_finish(m_handle, epoch, now.count()));
}
bool RustViewportMotion::snap(double offset) noexcept { return accepted(cc_niri_motion_snap(m_handle, offset)); }
}
