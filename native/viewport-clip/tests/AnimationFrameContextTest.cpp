/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "AnimationFrameContext.h"
#include "RustScrollViewportRuntime.h"
#include "ScrollFrameCapture.h"
#include <QJsonArray>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <vector>

using namespace CcNiri;
static_assert(sizeof(CcNiriScrollSample) == 56);
static_assert(offsetof(CcNiriScrollSample, valid) == 40);
static void check(bool ok, const char *message)
{
    if (!ok) { std::cerr << "FAIL " << message << '\n'; std::exit(1); }
}
static QJsonObject context()
{
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("sessionId"), QStringLiteral("s")},
        {QStringLiteral("workspaceId"), QStringLiteral("a")}, {QStringLiteral("targetOutput"), QStringLiteral("DP-1")},
        {QStringLiteral("generation"), 1}};
}
static QJsonObject plan(int epoch, double from, double to)
{
    QJsonArray entries;
    for (int i = 0; i < 5; ++i) {
        const auto visible = [i](double offset) { return i * 108 >= offset && i * 108 + 100 <= offset + 208; };
        if (!visible(from) && !visible(to)) continue;
        entries.append(QJsonObject{{QStringLiteral("windowId"), QString::number(i)}, {QStringLiteral("columnId"), i},
            {QStringLiteral("logicalX"), i * 108}, {QStringLiteral("pixelWidth"), 100},
            {QStringLiteral("oldPlacement"), visible(from) ? QStringLiteral("visible") : QStringLiteral("parked")},
            {QStringLiteral("newPlacement"), visible(to) ? QStringLiteral("visible") : QStringLiteral("parked")}});
    }
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("type"), QStringLiteral("SCROLL")},
        {QStringLiteral("sessionId"), QStringLiteral("s")}, {QStringLiteral("workspaceId"), QStringLiteral("a")},
        {QStringLiteral("targetOutput"), QStringLiteral("DP-1")}, {QStringLiteral("epoch"), epoch},
        {QStringLiteral("issuedAt"), 1}, {QStringLiteral("oldScrollOffsetX"), from},
        {QStringLiteral("newScrollOffsetX"), to}, {QStringLiteral("entries"), entries},
        {QStringLiteral("retargetOnly"), from == to},
        {QStringLiteral("viewport"), QJsonObject{{QStringLiteral("x"), -300.5}, {QStringLiteral("y"), 50.25},
            {QStringLiteral("width"), 208}, {QStringLiteral("height"), 800}}}};
}
static std::vector<double> trajectory(double hz, bool jitter, bool secondary, bool capture)
{
    RustScrollViewportRuntime runtime;
    AnimationFrameContext clock;
    auto telemetry = std::make_unique<ScrollFrameCapture>();
    if (capture) telemetry->start(0);
    check(runtime.updateContext(context()) && runtime.arm(plan(1, 0, 108), ViewportMotionBackend::TimePoint(0)), "production arm");
    clock.bind(1, 1, 0);
    std::vector<double> xs;
    for (int frame = 1; frame <= 60; ++frame) {
        const int64_t predicted = int64_t(frame * 1e9 / hz);
        const int64_t execution = predicted - (jitter ? (frame % 5 + 1) * 1'000'000 : 2'000'000);
        if (secondary) {
            auto before = runtime.frameSample(true);
            check(!clock.select(2, true, true, predicted + 3'000'000, execution, frame).advance, "secondary pass ignored");
            check(runtime.frameSample(true).time_ns == before.time_ns, "secondary cannot change painted anchor");
        }
        auto decision = clock.select(1, true, true, predicted, execution, frame);
        check(decision.advance && decision.timeNs == predicted, "predicted presentation clock");
        const auto paintedBefore = runtime.frameSample(true);
        check(runtime.prepareFrame(ViewportMotionBackend::TimePoint(decision.timeNs)), "pending sample");
        const auto sample = runtime.frameSample();
        if (frame == 2) {
            RustScrollViewportRuntime frozen(runtime), assigned;
            assigned = runtime;
            check(frozen.frameSample().time_ns == paintedBefore.time_ns
                && assigned.frameSample().time_ns == paintedBefore.time_ns,
                "FFI clone and copy freeze painted pose instead of pending prepaint");
        }
        const auto targets = runtime.targets();
        for (auto it = targets.cbegin(); it != targets.cend(); ++it) {
            // Each window consumes the same frozen sample, without sampling time.
            check(runtime.projection(it.key(), it.value()).has_value(), "all roles reuse projection");
        }
        check(!clock.select(1, true, true, predicted, execution + 9'000'000, frame).advance, "duplicate frame and recursive paint reuse");
        check(runtime.markPainted(sample.epoch, sample.time_ns), "real output paint commits anchor");
        if (capture) telemetry->record({uint64_t(frame), 1, 1, sample.epoch, 0, predicted, sample.time_ns,
            execution, sample.position, sample.velocity, sample.target, 1.5, hz});
        xs.push_back(sample.position);
    }
    return xs;
}
int main()
{
    static_assert(sizeof(CcNiriScrollRetargetStatus)==120);
    check(cc_niri_scroll_retarget_status(nullptr).status==CC_NIRI_FFI_INVALID_HANDLE,"retarget query null ABI");
    for (int64_t delay : {30'000'000LL,60'000'000LL,120'000'000LL}) {
        RustScrollViewportRuntime runtime;
        check(runtime.updateContext(context()) && runtime.arm(plan(1,0,108),ViewportMotionBackend::TimePoint(0),{},true),"smooth production FFI arm");
        check(runtime.prepareFrame(ViewportMotionBackend::TimePoint(delay)),"smooth prepare");
        auto anchor=runtime.frameSample();check(runtime.markPainted(anchor.epoch,anchor.time_ns),"smooth painted anchor");
        check(runtime.prepareFrame(ViewportMotionBackend::TimePoint(delay+20'000'000)),"unpainted future");
        check(runtime.arm(plan(2,108,216),ViewportMotionBackend::TimePoint(delay-1),{},true),"actual arm forwards smooth policy");
        auto origin=runtime.originSample();auto status=runtime.retargetStatus();
        check(origin.position==anchor.position && origin.velocity==anchor.velocity && origin.time_ns==anchor.time_ns,"production x0/v0/time use one painted sample");
        check(status.carried==1 && status.strategy==1 && status.degraded==0,"carry counters from Rust");
        check(runtime.arm(plan(3,216,216),ViewportMotionBackend::TimePoint(delay+1),{},true),"same target accepts epoch");
        check(runtime.retargetStatus().kept==1,"same target keeps trajectory");
        check(runtime.role(QStringLiteral("0"))==QStringLiteral("outgoing"),"keep still owns outgoing");
    }
    check(animationProfile("stable") == AnimationProfile::Stable && animationProfile("smooth60") == AnimationProfile::Smooth60
        && animationProfile("garbage") == AnimationProfile::Stable, "typed profile and invalid fallback");
    for (double hz : {59.94, 60.0, 120.0, 144.0}) {
        const auto baseline = trajectory(hz, false, false, false);
        check(baseline == trajectory(hz, true, true, false), "execution jitter and secondary output invariance");
        check(baseline == trajectory(hz, true, true, true), "telemetry never changes trajectory");
    }
    AnimationFrameContext clock;
    clock.bind(1, 1, 10);
    check(!clock.select(1, false, true, 20, 15, 1).advance, "offscreen prepaint ignored");
    auto sample = clock.select(1, true, true, 20, 15, 1);
    check(sample.advance && sample.timeNs == 20, "prediction may be ahead of event");
    check(clock.select(1, true, true, 100, 99, 9, true).timeNs == 20, "nested real paint keeps outer immutable sample");
    clock.bind(1, 2, 18);
    check(clock.select(1, true, true, 20, 18, 1).advance, "same timestamp new epoch sampled");
    sample = clock.select(1, true, true, 19, 17, 2);
    check(sample.advance && sample.timeNs == 20 && sample.fallback == ClockFallback::RegressedPrediction, "fallback never rewinds");
    const auto fallbacks = clock.fallbackCount();
    check(!clock.select(1, true, true, 19, 30, 2).advance && clock.fallbackCount() == fallbacks, "fallback counted once per frame");
    sample = clock.select(1, true, false, 0, 31, 3);
    check(sample.advance && sample.timeNs == 31 && sample.fallback == ClockFallback::MissingPrediction, "missing prediction fallback");
    check(!clock.select(1, true, false, 0, 35, 3).advance, "missing prediction nested frame reused");
    clock.endPass();
    sample = clock.select(1, true, true, -1, 32, 4);
    check(sample.advance && sample.timeNs == 32 && sample.fallback == ClockFallback::InvalidPrediction, "invalid signed timestamp");
    check(clock.select(1, true, true, 10'000'000'000, 33, 5).timeNs == 10'000'000'000, "long elapsed is not clamped");
    clock.bind(2, 3, 0);
    check(!clock.select(1, true, true, 34, 34, 6).advance && clock.select(2, true, true, 34, 34, 6).advance, "target output changed");
    clock.clear();
    check(!clock.select(2, true, true, 35, 35, 7).advance, "stop or output removal clears binding");
    // Event boundaries use the same clear path as profile reconfiguration.
    {
        RustScrollViewportRuntime runtime;
        check(runtime.updateContext(context()), "profile lifecycle context");
        int epoch = 0;
        for (auto profile : {AnimationProfile::Stable, AnimationProfile::Smooth60, AnimationProfile::Stable}) {
            runtime.clear(); clock.clear();
            const auto event = ViewportMotionBackend::TimePoint(++epoch * 1'000'000'000LL);
            check(runtime.arm(plan(epoch, 0, 108), event), "profile rearm preserves epoch authority");
            if (profile == AnimationProfile::Stable) runtime.advance(event + ViewportMotionBackend::TimePoint(10'000'000));
            else {
                clock.bind(1, epoch, event.count());
                const auto decision = clock.select(1, true, true, event.count() + 10'000'000, event.count(), epoch);
                check(runtime.prepareFrame(ViewportMotionBackend::TimePoint(decision.timeNs)), "smooth profile prepare");
                const auto sample = runtime.frameSample();
                check(runtime.markPainted(sample.epoch, sample.time_ns), "smooth profile commit");
            }
            check(runtime.active() && !runtime.completed(), "profile switch remains a Rust scroll with unchanged duration");
        }
    }
    auto capture = std::make_unique<ScrollFrameCapture>();
    check(!capture->active(0), "diagnostics default off");
    capture->start(0);
    for (size_t i = 0; i < ScrollFrameCapture::Capacity; ++i) capture->record({});
    check(!capture->truncated && capture->frameCount == ScrollFrameCapture::Capacity, "fixed buffer exact capacity");
    capture->record({});
    check(capture->truncated && !capture->active(1), "overflow is explicit and stops capture");
    capture->presented(1, 2);
    check(!capture->presentationCount, "truncated capture does not silently overwrite");
    capture->start(100);
    capture->presented(1, 99); capture->presented(1, 101);
    check(capture->presentationCount == 1 && !capture->active(10'000'000'101LL), "actual presentations independent and bounded");
    capture->expire(10'000'000'101LL);
    check(!capture->recording, "finished capture disables diagnostic hot path");
    std::cout << "PASS output presentation clock, frame reuse, production arm and fixed capture\n";
}
