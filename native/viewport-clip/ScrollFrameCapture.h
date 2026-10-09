/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "AnimationFrameContext.h"
#include <array>
#include <cstddef>

namespace CcNiri {
struct ScrollCaptureFrame {
    uint64_t frame = 0, output = 0, revision = 0;
    int64_t epoch = -1, eventNs = 0, predictedNs = 0, sampleNs = 0, paintNs = 0;
    double position = 0, velocity = 0, target = 0, scale = 1, refreshHz = 0;
    ClockFallback fallback = ClockFallback::None;
    bool completed = false, ownership = false;
    double initialPosition = 0;
    int64_t startNs = 0;
    AnimationProfile profile = AnimationProfile::Stable;
    double initialVelocity = 0;
};
struct ScrollCapturePresentation { uint64_t output = 0; int64_t timeNs = 0; };
struct ScrollCaptureLifecycle {
    uint64_t output = 0, revision = 0;
    int64_t epoch = -1, timeNs = 0;
    // 0 arm, 1 cancel request, 2 context update, 3 clear / reconfigure / output removal.
    uint32_t kind = 0;
    double initialVelocity = 0, savedVelocity = 0, brakeMs = 0, brakeDistance = 0;
    uint32_t strategy = 0, reason = 0;
};
// Opt-in, fixed-capacity telemetry; no clocks, scheduling, JSON or allocations.
class ScrollFrameCapture {
public:
    static constexpr size_t Capacity = 2048;
    void start(int64_t now) {
        ++captureId;
        startNs = now; deadlineNs = now + 10'000'000'000LL;
        frameCount = presentationCount = lifecycleCount = repaintFullCount = 0;
        truncated = false;
        recording = true;
    }
    bool active(int64_t now) const { return recording && !truncated && now >= startNs && now <= deadlineNs; }
    void expire(int64_t now) { if (now > deadlineNs) recording = false; }
    void record(const ScrollCaptureFrame &row) { if (recording) append(frames, frameCount, row); }
    void presented(uint64_t output, int64_t now) {
        expire(now);
        if (active(now)) append(presentations, presentationCount, ScrollCapturePresentation{output, now});
    }
    void lifecycle(const ScrollCaptureLifecycle &row) {
        expire(row.timeNs);
        if (active(row.timeNs)) append(lifecycles, lifecycleCount, row);
    }
    void repaint(int64_t now) { if (active(now)) ++repaintFullCount; }
    std::array<ScrollCaptureFrame, Capacity> frames{};
    std::array<ScrollCapturePresentation, Capacity> presentations{};
    std::array<ScrollCaptureLifecycle, 128> lifecycles{};
    size_t frameCount = 0, presentationCount = 0, lifecycleCount = 0;
    uint64_t repaintFullCount = 0;
    uint64_t captureId = 0;
    int64_t startNs = 0, deadlineNs = 0;
    bool truncated = false;
    bool recording = false;
private:
    template<class T, size_t N> void append(std::array<T, N> &buffer, size_t &count, const T &row) {
        if (truncated) return;
        if (count == N) { truncated = true; recording = false; return; }
        buffer[count++] = row;
    }
};
}
