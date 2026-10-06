/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "reference/ViewportMotion.h"
#include "RustViewportMotion.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <random>
#include <string_view>
#include <type_traits>

using namespace CcNiri;
using Time = ViewportMotion::TimePoint;
namespace {
constexpr std::uint64_t Seed = 0x43434e4952495232ULL;
std::size_t checks = 0, actions = 0, histories = 0;
double maxPosition = 0, maxVelocity = 0;
std::size_t history = 0, step = 0;
const char *operation = "initial";
double inputFrom = 0, inputTarget = 0;
SpringParams inputParams;
std::int64_t inputEpoch = 0, inputTime = 0;
[[noreturn]] void fail(const char *reason, std::int64_t sampleTime = 0) {
    std::fprintf(stderr, "FAIL motion seed=%llu history=%zu step=%zu op=%s from=%.17g target=%.17g epoch=%lld now=%lld sample=%lld: %s\n",
        static_cast<unsigned long long>(Seed), history, step, operation, inputFrom, inputTarget,
        static_cast<long long>(inputEpoch), static_cast<long long>(inputTime), static_cast<long long>(sampleTime), reason);
    std::fprintf(stderr, "params damping=%.17g stiffness=%.17g epsilon=%.17g mass=%.17g\n",
        inputParams.dampingRatio, inputParams.stiffness, inputParams.epsilon, inputParams.mass);
    std::abort();
}
void equal(double a, double b, const char *reason, std::int64_t now) {
    if (!std::isfinite(a) || !std::isfinite(b) || std::abs(a - b) > 1e-8 + 1e-12 * std::max(std::abs(a), std::abs(b))) fail(reason, now);
}
void compare(const ViewportMotion &cpp, const RustViewportMotion &rust, std::int64_t now) {
    const auto a = cpp.sample(Time(now)), b = rust.sample(Time(now));
    ++checks;
    if (a.kind != b.kind || a.epoch != b.epoch) fail("kind/epoch", now);
    equal(a.current, b.current, "current", now);
    equal(a.target, b.target, "target", now);
    equal(a.velocity, b.velocity, "velocity", now);
    maxPosition = std::max(maxPosition, std::abs(a.current - b.current));
    maxVelocity = std::max(maxVelocity, std::abs(a.velocity - b.velocity));
    if (cpp.target() != rust.target() || cpp.epoch() != rust.epoch()
        || cpp.isActive(Time(now)) != rust.isActive(Time(now)) || cpp.isDone(Time(now)) != rust.isDone(Time(now))) fail("accessors", now);
    equal(cpp.current(Time(now)), rust.current(Time(now)), "current accessor", now);
}
void probes(const ViewportMotion &cpp, const RustViewportMotion &rust, std::int64_t now) {
    for (const auto t : {std::numeric_limits<std::int64_t>::min(), std::int64_t(-1), std::int64_t(0), now,
        std::int64_t(16'666'667), std::int64_t(1'000'000'000), std::int64_t(2'999'999'999),
        std::int64_t(3'000'000'000), std::numeric_limits<std::int64_t>::max()}) compare(cpp, rust, t);
    // Completion sampling must not mutate the stored state.
    compare(cpp, rust, now);
}
void apply(ViewportMotion &cpp, RustViewportMotion &rust, unsigned op, double from, double target, std::int64_t epoch, std::int64_t now) {
    inputFrom = from; inputTarget = target; inputEpoch = epoch; inputTime = now;
    ++actions;
    bool a = true, b = true;
    switch (op) {
    case 0: operation = "start"; a = cpp.start(from, target, epoch, Time(now)); b = rust.start(from, target, epoch, Time(now)); break;
    case 1: operation = "retarget"; a = cpp.retarget(target, epoch, Time(now)); b = rust.retarget(target, epoch, Time(now)); break;
    case 2: operation = "finish"; a = cpp.finish(epoch, Time(now)); b = rust.finish(epoch, Time(now)); break;
    case 3: operation = "snap"; a = cpp.snap(target); b = rust.snap(target); break;
    default: operation = "sample"; break;
    }
    if (a != b) fail("accept/reject");
    probes(cpp, rust, now);
}
void copies(ViewportMotion &cpp, RustViewportMotion &rust, std::int64_t now) {
    operation = "copy";
    const ViewportMotion reference = cpp;
    RustViewportMotion clone = rust;
    clone.snap(71.25);
    probes(cpp, rust, now); // Independent clone mutation must not affect original.
    clone = rust;
    clone = clone;
    probes(reference, clone, now);
    RustViewportMotion assigned;
    assigned = clone;
    probes(reference, assigned, now);
}
void namedSequences() {
    for (const double ratio : {0.0, 0.65, 1.0, 1.0 - 1e-12, 1.0 + 1e-12, 1.7}) {
        for (const int hz : {60, 120, 144, 1000}) {
            for (const auto sequence : {std::string_view("LL"), std::string_view("LH"), std::string_view("LLH"), std::string_view("HLHL")}) {
                ++histories; history = histories;
                SpringParams params; params.dampingRatio = ratio;
                inputParams = params;
                ViewportMotion cpp(params); RustViewportMotion rust(params);
                std::int64_t now = 0, epoch = 0;
                apply(cpp, rust, 0, 0, 1260, epoch++, now);
                for (step = 0; step < 100 * sequence.size(); ++step) {
                    now += 1'000'000'000 / hz;
                    const double target = cpp.target() + (sequence[step % sequence.size()] == 'L' ? 1260 : -1260);
                    apply(cpp, rust, 1, 0, target, epoch++, now);
                    // Duplicate, conflicting and stale submissions during rapid input.
                    apply(cpp, rust, 1, 0, target, epoch - 1, now - 1);
                    apply(cpp, rust, 1, 0, target + 1, epoch - 1, now);
                    apply(cpp, rust, 1, 0, target, epoch - 2, now);
                }
                copies(cpp, rust, now);
                apply(cpp, rust, 2, 0, 0, epoch - 1, now + 3'000'000'000);
                apply(cpp, rust, 3, 0, 12.5, 0, now);
                apply(cpp, rust, 1, 0, 300, epoch - 2, now);
            }
        }
    }
}
void randomHistories() {
    std::mt19937_64 rng(Seed);
    const double nan = std::numeric_limits<double>::quiet_NaN(), inf = std::numeric_limits<double>::infinity();
    for (unsigned run = 0; run < 1000; ++run) {
        ++histories; history = histories;
        SpringParams params;
        params.dampingRatio = double(rng() % 2500) / 1000;
        if (run % 17 == 0) params.stiffness = 0.01;
        if (run % 31 == 0) params.epsilon = 0;
        if (run % 43 == 0) params.mass = nan;
        inputParams = params;
        ViewportMotion cpp(params); RustViewportMotion rust(params);
        std::int64_t clock = run % 19 == 0 ? std::numeric_limits<std::int64_t>::max() - 10'000'000'000LL : 0;
        for (step = 0; step < 200; ++step) {
            clock += std::int64_t(rng() % 40'000'000);
            const auto epoch = cpp.epoch() + std::int64_t(rng() % 5) - 1;
            double from = double(std::int64_t(rng() % 200000) - 100000) / 8;
            double target = double(std::int64_t(rng() % 200000) - 100000) / 8;
            if (step % 11 == 0) target = cpp.target();
            if (step % 37 == 0) target = nan;
            if (step % 41 == 0) from = inf;
            const auto now = step % 13 == 0 ? std::int64_t(-1) : step % 7 == 0 ? std::int64_t(0) : clock;
            apply(cpp, rust, unsigned(rng() % 5), from, target, epoch, now);
            if (step % 17 == 0) copies(cpp, rust, now);
        }
        apply(cpp, rust, 0, -0.0, 0.0, std::numeric_limits<std::int64_t>::max(), clock);
        apply(cpp, rust, 1, 0, 0, std::numeric_limits<std::int64_t>::max(), 0);
    }
}
}
int main() {
    static_assert(sizeof(CcNiriMotionSample) == 40);
    static_assert(std::is_standard_layout_v<CcNiriMotionSample>);
    namedSequences(); randomHistories();
    std::printf("PASS viewport motion differential seed=%llu histories=%zu actions=%zu samples=%zu max-position-delta=%.17g max-velocity-delta=%.17g\n",
        static_cast<unsigned long long>(Seed), histories, actions, checks, maxPosition, maxVelocity);
}
