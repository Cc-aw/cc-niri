/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "RustSpring.h"
#include <cstdlib>
#include <cstdint>

namespace CcNiri
{
namespace {
// These errors indicate a broken lifetime/ABI contract, not invalid physics.
void checkStatus(std::uint32_t status) noexcept
{
    if (status != CC_NIRI_FFI_OK) std::abort();
}
}
RustSpring::RustSpring(double from, double target, double velocity, SpringParams params) noexcept
    : m_handle(cc_niri_spring_create(from, target, velocity,
        {params.dampingRatio, params.stiffness, params.epsilon, params.mass}))
{
    if (!m_handle) std::abort();
}
RustSpring::RustSpring(const RustSpring &other) noexcept
    : m_handle(cc_niri_spring_clone(other.m_handle))
{
}
RustSpring &RustSpring::operator=(const RustSpring &other) noexcept
{
    if (this != &other) {
        const auto handle = cc_niri_spring_clone(other.m_handle);
        cc_niri_spring_destroy(m_handle);
        m_handle = handle;
    }
    return *this;
}
RustSpring::~RustSpring() { cc_niri_spring_destroy(m_handle); }
bool RustSpring::isValid() const noexcept
{
    const auto result = cc_niri_spring_is_valid(m_handle);
    checkStatus(result.status);
    return result.value != 0;
}
SpringSample RustSpring::sample(std::chrono::nanoseconds elapsed) const noexcept
{
    const auto result = cc_niri_spring_sample(m_handle, elapsed.count());
    checkStatus(result.status);
    return {result.value.position, result.value.velocity};
}
bool RustSpring::isSettled(const SpringSample &sample) const noexcept
{
    const auto result = cc_niri_spring_is_settled(m_handle, {sample.position, sample.velocity});
    checkStatus(result.status);
    return result.value != 0;
}
}
