/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "reference/Spring.h"
#include "RustSpring.h"
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

using namespace CcNiri;
using namespace std::chrono_literals;
static_assert(sizeof(CcNiriSpringParams) == 32 && sizeof(CcNiriSpringSample) == 16);
static_assert(sizeof(CcNiriSpringSampleResult) == 24 && sizeof(CcNiriSpringBoolResult) == 8);

namespace {
constexpr std::uint64_t Seed = 0x43434e4952495231ULL;
constexpr double AbsTolerance = 1e-8, RelTolerance = 1e-12;
std::uint64_t cases = 0, samples = 0;
double maxPositionError = 0.0, maxVelocityError = 0.0;

void require(bool condition, const char *message)
{
    if (!condition) { std::fprintf(stderr, "%s\n", message); std::exit(1); }
}
void compare(const Spring &cpp, const RustSpring &rust, double from, double target,
             double velocity, SpringParams params, std::chrono::nanoseconds elapsed)
{
    const auto a = cpp.sample(elapsed), b = rust.sample(elapsed);
    const auto near = [](double a, double b) {
        return std::isfinite(a) && std::isfinite(b)
            && std::abs(a - b) <= AbsTolerance + RelTolerance * std::max(std::abs(a), std::abs(b));
    };
    if (cpp.isValid() != rust.isValid() || !near(a.position, b.position) || !near(a.velocity, b.velocity)
        || cpp.isSettled(a) != rust.isSettled(b)
        || cpp.isSettled(a) != rust.isSettled(a)) {
        std::fprintf(stderr, "Spring differential FAIL seed=%llu case=%llu ns=%lld\n"
            "from=%.17g target=%.17g velocity=%.17g ratio=%.17g stiffness=%.17g epsilon=%.17g mass=%.17g\n"
            "cpp=(%.17g,%.17g) rust=(%.17g,%.17g) valid=%d/%d settled=%d/%d\n",
            static_cast<unsigned long long>(Seed), static_cast<unsigned long long>(cases),
            static_cast<long long>(elapsed.count()), from, target, velocity,
            params.dampingRatio, params.stiffness, params.epsilon, params.mass,
            a.position, a.velocity, b.position, b.velocity, cpp.isValid(), rust.isValid(), cpp.isSettled(a), rust.isSettled(b));
        std::exit(1);
    }
    if (!cpp.isValid() || elapsed.count() <= 0) {
        require(std::bit_cast<std::uint64_t>(a.position) == std::bit_cast<std::uint64_t>(b.position)
            && std::bit_cast<std::uint64_t>(a.velocity) == std::bit_cast<std::uint64_t>(b.velocity),
            "fallback / initial sample must match bitwise, including signed zero");
    }
    maxPositionError = std::max(maxPositionError, std::abs(a.position - b.position));
    maxVelocityError = std::max(maxVelocityError, std::abs(a.velocity - b.velocity));
    ++samples;
}
void check(double from, double target, double velocity, SpringParams params = {})
{
    ++cases;
    const Spring cpp(from, target, velocity, params);
    const RustSpring rust(from, target, velocity, params);
    for (const auto ns : {std::numeric_limits<std::int64_t>::min(), std::int64_t{-1}, std::int64_t{0},
                         std::int64_t{1}, std::int64_t{1000}, std::int64_t{1000000}, std::int64_t{60000000},
                         std::int64_t{333000000}, std::int64_t{1000000000}, std::int64_t{3000000000},
                         std::numeric_limits<std::int64_t>::max()}) {
        compare(cpp, rust, from, target, velocity, params, std::chrono::nanoseconds(ns));
    }
    // Sampling is stateless, including repeat and backwards timestamps.
    for (const auto ns : {400ms, 10ms, 400ms}) compare(cpp, rust, from, target, velocity, params, ns);
    for (const int hz : {60, 120, 144}) {
        for (int frame = 0; frame < hz; ++frame) {
            const auto ns = std::chrono::nanoseconds(static_cast<std::int64_t>(1e9 * frame / hz));
            compare(cpp, rust, from, target, velocity, params, ns);
        }
    }
    const double threshold = params.epsilon * (std::sqrt(params.stiffness) / std::sqrt(params.mass));
    for (const SpringSample sample : {SpringSample{target + params.epsilon, threshold},
        {std::nextafter(target + params.epsilon, INFINITY), threshold},
        {target, std::nextafter(threshold, INFINITY)}, {target, 0.0}, {target, 100.0},
        {NAN, 0.0}, {target, INFINITY}}) {
        require(cpp.isSettled(sample) == rust.isSettled(sample), "completion threshold differs");
    }
}
void deterministicMatrix()
{
    check(-0.0, -0.0, -0.0);
    for (const double ratio : {0.0, 0.65, 1.0, 1.7, 1.0 - 1e-12, 1.0 + 1e-12}) {
        SpringParams params; params.dampingRatio = ratio;
        for (const auto pair : {std::pair{0.0, 1260.0}, std::pair{1260.0, 0.0},
            std::pair{400.25, 2520.5}, std::pair{400.25, 400.25}}) {
            for (const double v : {0.0, -25.5, 20000.0}) check(pair.first, pair.second, v, params);
        }
    }
    for (const double value : {NAN, INFINITY, -INFINITY}) {
        check(value, 0.0, 0.0); check(0.0, value, 0.0); check(0.0, 0.0, value);
    }
    for (int field = 0; field < 4; ++field) {
        for (const double value : {0.0, -1.0, static_cast<double>(NAN), static_cast<double>(INFINITY), -static_cast<double>(INFINITY)}) {
            SpringParams p;
            if (field == 0) p.dampingRatio = value;
            if (field == 1) p.stiffness = value;
            if (field == 2) p.epsilon = value;
            if (field == 3) p.mass = value;
            check(0.0, 1260.0, 0.0, p);
        }
    }
    check(-1e308, 1e308, 0.0);
    SpringParams p; p.stiffness = 0.01;
    check(1e308, 0.0, 0.0, p); // valid coefficients, unrepresentable late sampling polynomial
    for (const double extreme : {std::numeric_limits<double>::min(), std::numeric_limits<double>::denorm_min(), 1e308}) {
        p = {}; p.mass = extreme; check(0.0, 1260.0, 0.0, p);
        p = {}; p.stiffness = extreme; check(0.0, 1260.0, 0.0, p);
        p = {}; p.dampingRatio = extreme; check(0.0, 1260.0, 0.0, p);
        p = {}; p.epsilon = extreme; check(0.0, 1260.0, 0.0, p);
    }
}
void randomMatrix()
{
    auto state = Seed;
    const auto random = [&state] {
        state ^= state << 13; state ^= state >> 7; state ^= state << 17;
        return static_cast<double>(state >> 11) / 9007199254740992.0;
    };
    for (int i = 0; i < 1000; ++i) {
        SpringParams p;
        p.dampingRatio = i % 3 == 0 ? 1.0 : random() * 3.0;
        p.stiffness = 0.01 + random() * 10000.0;
        p.mass = 0.01 + random() * 10.0;
        p.epsilon = 1e-6 + random() * 1e-3;
        // Explicit evaluation order keeps the input sequence portable.
        const double from = random() * 50000.0 - 25000.0;
        const double target = random() * 50000.0 - 25000.0;
        const double velocity = random() * 40000.0 - 20000.0;
        check(from, target, velocity, p);
    }
}
void retargetSequences()
{
    for (const std::vector<int> directions : {std::vector<int>{1, 1}, {1, -1}, {1, 1, -1}, {-1, 1, -1, 1}}) {
        for (const int hz : {60, 120, 144, 1000}) {
            Spring cpp(0.0, 1260.0);
            RustSpring rust(0.0, 1260.0);
            double target = 1260.0;
            double from = 0.0;
            for (int repeat = 0; repeat < 100; ++repeat) {
                for (const int direction : directions) {
                    const auto elapsed = std::chrono::nanoseconds(1000000000 / hz);
                    const double painted = cpp.sample(elapsed).position;
                    compare(cpp, rust, from, target, 0.0, {}, elapsed);
                    from = painted;
                    target += direction * 1260.0;
                    // Mirror Motion's zero-velocity restart from last painted offset.
                    cpp = Spring(painted, target);
                    rust = RustSpring(painted, target);
                    require(cpp.sample(0ns).position == rust.sample(0ns).position, "retarget origin exact");
                    require(rust.sample(0ns).velocity == 0.0, "retarget resets velocity");
                }
            }
            compare(cpp, rust, from, target, 0.0, {}, 1s);
        }
    }
}
void ownershipAndAbi()
{
    const auto saved = [] {
        RustSpring original(0.0, 1260.0);
        const RustSpring copy(original);
        return copy; // copy must survive original destruction
    }();
    require(saved.isValid() && saved.isSettled(saved.sample(1s)), "copy lifetime");
    RustSpring assigned(0.0, 42.0);
    assigned = saved; assigned = assigned;
    require(assigned.sample(60ms).position == saved.sample(60ms).position, "assignment/self-assignment");
    require(cc_niri_spring_is_valid(nullptr).status == CC_NIRI_FFI_INVALID_HANDLE, "null validity status");
    require(cc_niri_spring_sample(nullptr, 0).status == CC_NIRI_FFI_INVALID_HANDLE, "null sample status");
    require(cc_niri_spring_is_settled(nullptr, {0, 0}).status == CC_NIRI_FFI_INVALID_HANDLE, "null settled status");
    require(!cc_niri_spring_clone(nullptr), "null clone"); cc_niri_spring_destroy(nullptr);
}
}

int main()
{
    deterministicMatrix(); randomMatrix(); retargetSequences(); ownershipAndAbi();
    std::printf("PASS Spring differential cases=%llu samples=%llu seed=%llu max position delta=%.17g velocity delta=%.17g tolerance=1e-8+1e-12*scale\n",
        static_cast<unsigned long long>(cases), static_cast<unsigned long long>(samples),
        static_cast<unsigned long long>(Seed), maxPositionError, maxVelocityError);
}
