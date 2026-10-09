/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <string_view>

namespace CcNiri {
enum class AnimationProfile { Stable, Smooth60 };
inline AnimationProfile animationProfile(std::string_view value)
{
    return value == "smooth60" ? AnimationProfile::Smooth60 : AnimationProfile::Stable;
}
enum class ClockFallback : uint32_t { None, MissingPrediction, InvalidPrediction, RegressedPrediction };
struct AnimationFrameDecision {
    int64_t timeNs = 0;
    bool advance = false;
    ClockFallback fallback = ClockFallback::None;
};

// Platform timestamp selection and paint-pass reuse only; no motion policy.
// Bindings are refreshed at event boundaries, never via status JSON in paint.
class AnimationFrameContext {
public:
    void clear() { m_output = 0; m_cached = false; m_lastTime = 0; m_fallback = ClockFallback::None; }
    void bind(uintptr_t output, uint64_t revision, int64_t startTime)
    {
        if (output != m_output) { clear(); m_output = output; }
        if (revision != m_revision) m_cached = false;
        m_revision = revision;
        m_lastTime = std::max(m_lastTime, startTime);
    }
    AnimationFrameDecision select(uintptr_t output, bool realOutputPass,
        bool hasPrediction, int64_t prediction, int64_t monotonicNow, uintptr_t frame, bool nested = false)
    {
        if (!realOutputPass || !output || output != m_output) return {};
        if (nested && m_cached) return {m_lastTime, false, m_fallback};
        // Positive predictions identify a compositor frame. When unavailable,
        // the live OutputFrame identity deduplicates nested preparation.
        if (m_cached && hasPrediction == m_hasPrediction && prediction == m_prediction
            && ((hasPrediction && prediction > 0) || frame == m_frame))
            return {m_lastTime, false, m_fallback};
        ClockFallback fallback = ClockFallback::None;
        if (!hasPrediction) fallback = ClockFallback::MissingPrediction;
        else if (prediction <= 0) fallback = ClockFallback::InvalidPrediction;
        else if (prediction < m_lastTime) fallback = ClockFallback::RegressedPrediction;
        const auto time = fallback == ClockFallback::None ? prediction : std::max(monotonicNow, m_lastTime);
        if (time < 0) return {};
        m_cached = true;
        m_hasPrediction = hasPrediction;
        m_prediction = prediction;
        m_frame = frame;
        m_fallback = fallback;
        m_lastTime = time;
        if (fallback != ClockFallback::None) { ++m_fallbackCount; ++m_fallbackReasons[uint32_t(fallback)]; }
        return {time, true, fallback};
    }
    void endPass()
    {
        if (!m_hasPrediction || m_prediction <= 0) m_cached = false;
    }
    int64_t lastTime() const { return m_lastTime; }
    uint64_t fallbackCount() const { return m_fallbackCount; }
    uint64_t fallbackCount(ClockFallback reason) const { return m_fallbackReasons[uint32_t(reason)]; }
    ClockFallback fallback() const { return m_fallback; }
private:
    uintptr_t m_output = 0, m_frame = 0;
    uint64_t m_revision = 0, m_fallbackCount = 0;
    int64_t m_lastTime = 0, m_prediction = 0;
    bool m_cached = false, m_hasPrediction = false;
    ClockFallback m_fallback = ClockFallback::None;
    std::array<uint64_t, 4> m_fallbackReasons{};
};
}
