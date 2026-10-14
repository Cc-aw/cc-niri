/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "cc_niri_native_core.h"
#include "reference/Spring.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <memory>

static_assert(sizeof(CcNiriPoint) == 16 && alignof(CcNiriPoint) == 8);
static_assert(sizeof(CcNiriWorkspaceSample) == 24 && sizeof(CcNiriWorkspaceProjection) == 24);
static_assert(sizeof(CcNiriWorkspaceState) == 280 && alignof(CcNiriWorkspaceState) == 8);
static_assert(sizeof(CcNiriWorkspaceClockState) == 64 && alignof(CcNiriWorkspaceClockState) == 8);
namespace {
using Handle = std::unique_ptr<CcNiriWorkspace, decltype(&cc_niri_workspace_destroy)>;
void require(bool condition, const char *message)
{
    if (!condition) { std::fprintf(stderr, "%s\n", message); std::exit(1); }
}
void near(double value, double expected, const char *message)
{
    require(std::isfinite(value) && std::abs(value - expected) < 1e-9, message);
}
Handle create() { return {cc_niri_workspace_create(), cc_niri_workspace_destroy}; }
void endpointsAndProjection()
{
    int samples = 0;
    // Independent long-double polynomial oracle, physical 4K at 100% / 150%,
    // reverse and multi-desktop distances, 60/120/144 Hz, and odd frame times.
    for (const auto duration : {240000000LL, 420000000LL, 800000000LL}) {
        for (const auto hz : {60, 120, 144}) {
            for (const auto target : {CcNiriPoint{0, 1}, {1, 0}, {2, 3}}) {
                auto motion = create();
                require(bool(motion), "workspace allocation failed");
                require(cc_niri_workspace_configure(motion.get(), 4, 4, 0).value, "grid rejected");
                require(cc_niri_workspace_start(motion.get(), {3, 3}, target, 1, 100, duration).value, "start rejected");
                for (int frame = 0; ; ++frame) {
                    const auto elapsed = std::min(duration, 1000000000LL * frame / hz);
                    const auto s = cc_niri_workspace_advance(motion.get(), 100 + elapsed);
                    const long double t = static_cast<long double>(elapsed) / duration;
                    const double p = static_cast<double>(10 * std::pow(t, 3) - 15 * std::pow(t, 4) + 6 * std::pow(t, 5));
                    require(s.status == CC_NIRI_FFI_OK && bool(s.active) == (elapsed < duration), "finite completion failed");
                    near(s.point.x, 3 + (target.x - 3) * p, "X polynomial differential failed");
                    near(s.point.y, 3 + (target.y - 3) * p, "Y polynomial differential failed");
                    for (const auto size : {CcNiriPoint{3840, 2160}, {2560, 1440}}) {
                        for (int x = 0; x < 4; ++x) for (int y = 0; y < 4; ++y) {
                            const auto projection = cc_niri_workspace_projection(motion.get(), {double(x), double(y)}, size.x, size.y, 45, 20);
                            const double tx = (x - s.point.x) * (size.x + 45), ty = (y - s.point.y) * (size.y + 20);
                            require(bool(projection.visible) == (std::abs(tx) < size.x && std::abs(ty) < size.y), "desktop visibility failed");
                            if (projection.visible) { near(projection.translation.x, tx, "X projection failed"); near(projection.translation.y, ty, "Y projection failed"); }
                            ++samples;
                        }
                    }
                    if (elapsed == duration) break;
                }
                const auto s = cc_niri_workspace_advance(motion.get(), 100 + duration + 1);
                require(s.point.x == target.x && s.point.y == target.y && !s.active, "endpoint not exact");
            }
        }
    }
    std::printf("Workspace polynomial / 4K projection differential: %d samples\n", samples);
}
void continuityAndErrors()
{
    auto motion = create();
    require(cc_niri_workspace_start(motion.get(), {0, 0}, {0, 1}, 1, 100, 420).value, "start failed");
    near(cc_niri_workspace_advance(motion.get(), 205).point.y, .103515625, "quarter-time golden failed");
    const auto painted = cc_niri_workspace_advance(motion.get(), 310);
    near(painted.point.y, .5, "midpoint golden failed");
    require(cc_niri_workspace_start(motion.get(), {0, 1}, {0, 0}, 2, 400, 420).value, "reverse rejected");
    near(cc_niri_workspace_advance(motion.get(), 400).point.y, painted.point.y, "retarget jumped to committed desktop");
    near(cc_niri_workspace_advance(motion.get(), 310).point.y, painted.point.y, "backwards time changed the pose");
    require(!cc_niri_workspace_start(motion.get(), {0, 1}, {0, 1}, 1, 410, 420).value, "stale epoch accepted");
    require(!cc_niri_workspace_start(motion.get(), {0, 1}, {0, 1}, 3, 410, 0).value, "zero duration accepted");
    require(!cc_niri_workspace_gesture(motion.get(), {0, NAN}, 3, 410).value, "invalid gesture accepted");
    near(cc_niri_workspace_advance(motion.get(), 400).point.y, .5, "rejection mutated motion");
    require(!cc_niri_workspace_advance(motion.get(), 820).active, "reverse failed to settle");
    for (int epoch = 3; epoch < 1003; ++epoch) {
        const auto now = 1000LL * epoch;
        const auto before = cc_niri_workspace_advance(motion.get(), now);
        require(cc_niri_workspace_start(motion.get(), {0, before.point.y}, {0, double(epoch % 2)}, epoch, now, 420).value, "repeated ownership failed");
        cc_niri_workspace_advance(motion.get(), now + 420);
    }
    require(cc_niri_workspace_advance(nullptr, 0).status == CC_NIRI_FFI_INVALID_HANDLE, "null advance status failed");
    require(cc_niri_workspace_configure(nullptr, 1, 2, 0).status == CC_NIRI_FFI_INVALID_HANDLE, "null configure failed");
    require(cc_niri_workspace_start(nullptr, {0,0}, {0,1}, 1, 0, 420).status == CC_NIRI_FFI_INVALID_HANDLE, "null start failed");
    require(cc_niri_workspace_gesture(nullptr, {0,0}, 1, 0).status == CC_NIRI_FFI_INVALID_HANDLE, "null gesture failed");
    require(cc_niri_workspace_projection(nullptr, {0,0}, 2560, 1440, 45, 20).status == CC_NIRI_FFI_INVALID_HANDLE, "null projection failed");
    cc_niri_workspace_destroy(nullptr);
}
void sixtyHzFrameDisplacement()
{
    auto motion = create();
    require(cc_niri_workspace_start(motion.get(), {0,0}, {0,1}, 1, 0, 420000000).value, "60Hz start failed");
    // KWin Slide's stock 300 / 1.1 spring is only a reference for peak step;
    // this deliberate animation change does not promise identical trajectories.
    const CcNiri::Spring spring(0, 1, 0, {1.1, 300, 1e-5, 1});
    double previous = 0, previousSpring = 0, peak = 0, springPeak = 0;
    for (int frame = 0; frame <= 60; ++frame) {
        const auto ns = std::chrono::nanoseconds(1000000000LL * frame / 60);
        const auto point = cc_niri_workspace_advance(motion.get(), ns.count());
        require(point.point.y >= previous && point.point.y <= 1, "60Hz motion overshot or reversed");
        peak = std::max(peak, point.point.y - previous);
        const auto old = spring.sample(ns).position;
        springPeak = std::max(springPeak, old - previousSpring);
        previous = point.point.y; previousSpring = old;
    }
    require(peak < springPeak && peak * 1460 < 110, "60Hz peak displacement regressed");
    std::printf("60Hz logical peak step: finite=%.3fpx, stock Slide spring=%.3fpx\n", peak * 1460, springPeak * 1460);
}
void smoothRetargetPolynomialAndBrake()
{
    // Long-double boundary algebra oracle; independent of production Horner /
    // Bernstein representation, including the piecewise brake deadline.
    for (const auto time : {20000000LL, 80000000LL, 180000000LL}) {
        for (const double target : {0.0, 2.0, 4.0}) {
            auto motion = create();
            require(cc_niri_workspace_configure(motion.get(), 1, 5, 0).value, "smooth grid failed");
            require(cc_niri_workspace_start_with_policy(motion.get(), {0,0}, {0,1}, 1, 0, 420000000, 1).value, "smooth start failed");
            cc_niri_workspace_advance(motion.get(), time);
            require(cc_niri_workspace_mark_painted(motion.get()).value, "paint commit failed");
            const auto painted = cc_niri_workspace_state(motion.get());
            // Unpainted prediction must not become the retarget anchor.
            cc_niri_workspace_advance(motion.get(), time+10000000);
            require(cc_niri_workspace_start_with_policy(motion.get(), {0,1}, {0,target}, 2, time-10000000, 420000000, 1).value, "prediction-leading start failed");
            const auto initial = cc_niri_workspace_state(motion.get());
            near(initial.point.y, painted.point.y, "C0 failed");
            near(initial.initial_velocity.y, painted.velocity.y, "C1 failed");
            require(initial.started_at_ns == painted.time_ns, "clock anchor failed");
            require(initial.strategies[1] != 4, "unexpected reset");
            if (initial.strategies[1] == 1) near(initial.initial_acceleration.y, painted.acceleration.y, "C2 failed");
            require(initial.brake_y_ns <= 50000000 && std::abs(initial.brake_distance.y) <= .02, "workspace brake bound failed");
            for (long long elapsed = 0; elapsed <= 420000000; elapsed += 1000000) {
                const auto sample = cc_niri_workspace_advance(motion.get(), initial.started_at_ns+elapsed);
                const auto state = cc_niri_workspace_state(motion.get());
                long double position, velocity, acceleration;
                const long double x0 = initial.origin.y, v0 = initial.initial_velocity.y, a0 = initial.initial_acceleration.y;
                if (elapsed < initial.brake_y_ns) {
                    const long double dt = elapsed*1e-9L, bt = initial.brake_y_ns*1e-9L;
                    acceleration = -v0/bt; velocity = v0+acceleration*dt;
                    position = x0+v0*dt+acceleration*dt*dt/2;
                } else {
                    const long double T = (initial.duration_ns-initial.brake_y_ns)*1e-9L;
                    const long double u = (elapsed-initial.brake_y_ns)*1e-9L/T;
                    const long double origin = x0+initial.brake_distance.y;
                    const long double c1 = initial.brake_y_ns ? 0 : v0*T;
                    const long double c2 = initial.brake_y_ns ? 0 : a0*T*T/2;
                    const long double A = target-origin-c1-c2, B=-c1-2*c2, C=-2*c2;
                    const long double c3=10*A-4*B+C/2, c4=-15*A+7*B-C, c5=6*A-3*B+C/2;
                    position=origin+c1*u+c2*std::pow(u,2)+c3*std::pow(u,3)+c4*std::pow(u,4)+c5*std::pow(u,5);
                    velocity=(c1+2*c2*u+3*c3*std::pow(u,2)+4*c4*std::pow(u,3)+5*c5*std::pow(u,4))/T;
                    acceleration=(2*c2+6*c3*u+12*c4*std::pow(u,2)+20*c5*std::pow(u,3))/(T*T);
                }
                near(sample.point.y, double(position), "long-double smooth position failed");
                near(state.velocity.y, double(velocity), "long-double smooth velocity failed");
                near(state.acceleration.y, double(acceleration), "long-double smooth acceleration failed");
                require(bool(sample.active) == (elapsed < 420000000), "fixed-duration completion failed");
            }
            require(!cc_niri_workspace_start_with_policy(motion.get(), {0,0}, {0,1}, 3, 1000000000, 420000000, 2).value, "bad policy accepted");
        }
    }
    require(cc_niri_workspace_state(nullptr).status == CC_NIRI_FFI_INVALID_HANDLE, "null state failed");
    require(cc_niri_workspace_mark_painted(nullptr).status == CC_NIRI_FFI_INVALID_HANDLE, "null painted failed");
    std::puts("Workspace smooth C0/C1, conditional C2, bounded brake and long-double oracle passed");
}
}
static void logicalClockContract()
{
    constexpr int64_t interval = 16666667;
    constexpr int64_t start = 1000000000;
    double peakOff = 0, peakOn = 0;
    int64_t finishedOff = 0, finishedOn = 0;
    for (bool enabled : {false, true}) {
        auto motion = create();
        require(cc_niri_workspace_clock_configure(motion.get(), enabled).value, "clock configure rejected");
        const auto event = cc_niri_workspace_clock_event(motion.get(), start);
        require(cc_niri_workspace_start_with_policy(motion.get(), {0,0}, {0,1}, 1, event.logical_ns, 420000000, 1).value, "clock start failed");
        double previous = 0, peak = 0;
        int64_t finished = 0;
        // One 50ms physical gap near peak velocity. Both variants receive the
        // SAME physical inputs; these synthetic data are not framePresented.
        for (int frame = 1; frame < 60; ++frame) {
            const int64_t real = start + frame*interval + (frame >= 10 ? 2*interval : 0);
            const auto clock = cc_niri_workspace_clock_frame(motion.get(), real, real-1000000, 60000);
            require(clock.status == CC_NIRI_FFI_OK && clock.advance, "clock frame failed");
            const auto sample = cc_niri_workspace_advance(motion.get(), clock.logical_ns);
            const auto state = cc_niri_workspace_state(motion.get());
            const long double u = std::min(1.0L, static_cast<long double>(clock.logical_ns-start)/420000000);
            near(sample.point.y, double(10*std::pow(u,3)-15*std::pow(u,4)+6*std::pow(u,5)), "logical polynomial oracle failed");
            require(state.time_ns == clock.logical_ns && state.started_at_ns == start, "mixed clock domains");
            peak = std::max(peak, sample.point.y-previous);
            previous = sample.point.y;
            require(cc_niri_workspace_mark_painted(motion.get()).value, "clock paint anchor failed");
            const auto duplicate = cc_niri_workspace_clock_frame(motion.get(), real, real, 60000);
            require(!duplicate.advance && duplicate.logical_ns == clock.logical_ns, "same frame advanced twice");
            if (!sample.active) { finished = real-start; break; }
        }
        require(finished > 0, "clamped motion failed to finish");
        if (enabled) { peakOn = peak; finishedOn = finished; }
        else { peakOff = peak; finishedOff = finished; }
    }
    require(peakOn < peakOff && finishedOn > finishedOff, "visual/time tradeoff not exposed");
    std::printf("Synthetic same 50ms gap (not FPS): peak cell step off=%.9f on=%.9f, wall completion off=%.3fms on=%.3fms\n", peakOff, peakOn, finishedOff/1e6, finishedOn/1e6);
    for (const double target : {0.0, 2.0}) {
        auto motion = create();
        require(cc_niri_workspace_configure(motion.get(), 1, 5, 0).value, "clock grid rejected");
        require(cc_niri_workspace_clock_configure(motion.get(), 1).value, "retarget clock rejected");
        auto clock = cc_niri_workspace_clock_event(motion.get(), start);
        require(cc_niri_workspace_start_with_policy(motion.get(), {0,0}, {0,1}, 1, clock.logical_ns, 420000000, 1).value, "retarget start failed");
        for (int n = 1; n <= 6; ++n) {
            clock = cc_niri_workspace_clock_frame(motion.get(), start+n*interval, start+n*interval-1, 60000);
            cc_niri_workspace_advance(motion.get(), clock.logical_ns);
            cc_niri_workspace_mark_painted(motion.get());
        }
        const auto painted = cc_niri_workspace_state(motion.get());
        // A sampled but unpainted frame cannot become the retarget anchor.
        clock = cc_niri_workspace_clock_frame(motion.get(), start+9*interval, start+9*interval-1, 60000);
        cc_niri_workspace_advance(motion.get(), clock.logical_ns);
        clock = cc_niri_workspace_clock_event(motion.get(), start+10*interval);
        require(cc_niri_workspace_start_with_policy(motion.get(), {0,1}, {0,target}, 2, clock.logical_ns, 420000000, 1).value, "logical retarget rejected");
        const auto initial = cc_niri_workspace_state(motion.get());
        near(initial.point.y, painted.point.y, "clamped retarget C0 failed");
        near(initial.initial_velocity.y, painted.velocity.y, "clamped retarget C1 failed");
        if (initial.strategies[1] == 1) near(initial.initial_acceleration.y, painted.acceleration.y, "clamped C2 failed");
        require(initial.started_at_ns == clock.logical_ns && initial.brake_y_ns <= 50000000 && std::abs(initial.brake_distance.y) <= .02, "clamped anchor time/brake failed");
        clock = cc_niri_workspace_clock_event(motion.get(), start+11*interval);
        require(cc_niri_workspace_gesture(motion.get(), {0,.5}, 3, clock.logical_ns).value, "mapped gesture rejected");
        near(cc_niri_workspace_state(motion.get()).point.y, .5, "gesture pose changed");
        require(cc_niri_workspace_start_with_policy(motion.get(), {0,0}, {0,1}, 4, clock.logical_ns, 420000000, 1).value, "gesture release rejected");
        near(cc_niri_workspace_state(motion.get()).initial_velocity.y, 0, "gesture inherited stale velocity");
        clock = cc_niri_workspace_clock_frame(motion.get(), start+2000000000, start+2000000000, 60000);
        require(clock.reason == 5 && clock.limiting == 0, "pause fallback not absolute");
        require(!cc_niri_workspace_advance(motion.get(), clock.logical_ns).active, "paused animation stuck");
        require(cc_niri_workspace_clock_configure(motion.get(), 1).value, "idle clock reset rejected");
        require(cc_niri_workspace_clock_state(motion.get()).lag_ns == 0, "reset retained lag");
    }
    require(cc_niri_workspace_clock_event(nullptr, 0).status == CC_NIRI_FFI_INVALID_HANDLE, "null clock event");
    require(cc_niri_workspace_clock_frame(nullptr, 1, 0, 60000).status == CC_NIRI_FFI_INVALID_HANDLE, "null clock frame");
    require(cc_niri_workspace_clock_configure(nullptr, 1).status == CC_NIRI_FFI_INVALID_HANDLE, "null clock configure");
    require(cc_niri_workspace_clock_state(nullptr).status == CC_NIRI_FFI_INVALID_HANDLE, "null clock state");
    std::puts("PASS logical clock ABI, physical-input preservation, retarget/gesture/pause and idle reset");
}
int main() { endpointsAndProjection(); continuityAndErrors(); sixtyHzFrameDisplacement(); smoothRetargetPolynomialAndBrake(); logicalClockContract(); }
