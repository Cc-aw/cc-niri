/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "ViewportMotionBackend.h"
#include "SpringBackend.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <utility>

using namespace CcNiri;
using namespace std::chrono_literals;

void require(bool ok, const char *message)
{
    if (!ok) {
        std::fprintf(stderr, "viewport motion: %s\n", message);
        std::exit(1);
    }
}

void near(double actual, double expected, double tolerance, const char *message)
{
    require(std::isfinite(actual) && std::abs(actual - expected) <= tolerance, message);
}

// Independent ODE integration as a reference for the closed-form sampler.
// Production never integrates frame-by-frame.
SpringSample reference(double from, double target, double velocity,
                       double duration, SpringParams params)
{
    double x = from - target;
    double v = velocity;
    const double h = duration / 4000.0;
    const double stiffness = params.stiffness / params.mass;
    const double damping = 2.0 * params.dampingRatio * std::sqrt(stiffness);
    const auto acceleration = [&](double p, double speed) { return -stiffness * p - damping * speed; };
    for (int i = 0; i < 4000; ++i) {
        const double a1 = acceleration(x, v), p1 = v;
        const double p2 = v + h * a1 / 2.0, a2 = acceleration(x + h * p1 / 2.0, p2);
        const double p3 = v + h * a2 / 2.0, a3 = acceleration(x + h * p2 / 2.0, p3);
        const double p4 = v + h * a3, a4 = acceleration(x + h * p3, p4);
        x += h * (p1 + 2.0 * p2 + 2.0 * p3 + p4) / 6.0;
        v += h * (a1 + 2.0 * a2 + 2.0 * a3 + a4) / 6.0;
    }
    return {target + x, v};
}

void checkSpring()
{
    for (const double ratio : {0.0, 0.65, 1.0, 1.7}) {
        SpringParams params;
        params.dampingRatio = ratio;
        params.mass = 2.0;
        SpringBackend spring(400.0, 2520.0, -25.0, params);
        require(spring.isValid(), "valid damping regimes accepted");
        for (const auto elapsed : {10ms, 60ms, 400ms}) {
            const auto value = spring.sample(elapsed);
            const auto expected = reference(400.0, 2520.0, -25.0,
                                            std::chrono::duration<double>(elapsed).count(), params);
            near(value.position, expected.position, 0.00001, "closed-form position agrees with ODE");
            near(value.velocity, expected.velocity, 0.00001, "closed-form velocity agrees with ODE");
        }
        near(spring.sample(-1ms).position, 400.0, 0.0, "negative elapsed stays at origin");
        near(spring.sample(0ns).velocity, -25.0, 0.0, "initial velocity preserved by pure math");
    }
    for (const double ratio : {1.0 - 1e-12, 1.0 + 1e-12}) {
        SpringParams params;
        params.dampingRatio = ratio;
        near(SpringBackend(0.0, 1260.0, 0.0, params).sample(60ms).position,
             SpringBackend(0.0, 1260.0).sample(60ms).position, 0.00001, "near-critical numerics remain continuous");
    }
    SpringBackend critical(0.0, 1260.0);
    double previous = 0.0;
    for (int ms = 0; ms <= 3000; ++ms) {
        const auto value = critical.sample(std::chrono::milliseconds(ms));
        require(value.position >= previous && value.position <= 1260.0,
                "default critical spring is monotonic without overshoot");
        previous = value.position;
    }
    require(critical.isSettled(critical.sample(1s)), "default spring converges before timeout");
    require(!critical.isSettled({1260.0, 100.0}), "crossing the target at speed is not settled");
    require(std::isfinite(critical.sample(std::chrono::nanoseconds::max()).position), "huge elapsed is finite");

    const double nan = std::numeric_limits<double>::quiet_NaN();
    const double inf = std::numeric_limits<double>::infinity();
    require(!SpringBackend(nan, 0.0).isValid() && !SpringBackend(0.0, inf).isValid()
            && !SpringBackend(0.0, 1.0, inf).isValid(), "invalid coordinates and velocity rejected");
    for (int field = 0; field < 4; ++field) {
        for (const double value : {nan, inf, -1.0}) {
            SpringParams params;
            if (field == 0) params.dampingRatio = value;
            if (field == 1) params.stiffness = value;
            if (field == 2) params.mass = value;
            if (field == 3) params.epsilon = value;
            require(!SpringBackend(0.0, 1260.0, 0.0, params).isValid(), "invalid parameters rejected");
        }
    }
    SpringParams params;
    params.stiffness = 0.0;
    require(!SpringBackend(0.0, 1.0, 0.0, params).isValid(), "zero stiffness rejected");
    params = {}; params.mass = 0.0;
    require(!SpringBackend(0.0, 1.0, 0.0, params).isValid(), "zero mass rejected");
    params = {}; params.epsilon = 0.0;
    require(!SpringBackend(0.0, 1.0, 0.0, params).isValid(), "zero precision rejected");
    require(!SpringBackend(-1e308, 1e308).isValid(), "unrepresentable displacement rejected");
}

void checkMotion()
{
    for (const auto endpoints : {std::pair{0.0, 1260.0}, {1260.0, 0.0},
                                 {400.0, 2520.0}, {800.0, 0.0}}) {
        ViewportMotionBackend motion;
        require(motion.start(endpoints.first, endpoints.second, 1, 10s), "documented start accepted");
        near(motion.current(10s), endpoints.first, 0.0, "starts at exact origin");
        near(motion.target(), endpoints.second, 0.0, "logical target immediately available");
        require(motion.isActive(10s + 1ms), "not a fixed instant transition");
        require(motion.isDone(11s), "default motion settles");
        near(motion.current(11s), endpoints.second, 0.0, "completion snaps exactly to target");
    }
    for (const int hz : {60, 120, 144}) {
        ViewportMotionBackend motion;
        require(motion.start(0.0, 1260.0, 1, 0ns), "cadence start");
        for (int frame = 0; frame < hz; ++frame) {
            const auto elapsed = std::chrono::nanoseconds(static_cast<long long>(1e9 * frame / hz));
            require(std::isfinite(motion.current(elapsed)), "every cadence sample finite");
        }
        near(motion.current(333ms), SpringBackend(0.0, 1260.0).sample(333ms).position,
             0.0, "same elapsed yields identical position regardless of cadence/history");
    }

    ViewportMotionBackend motion;
    require(motion.start(0.0, 1260.0, 1, 1s), "retarget start");
    const double at60 = motion.current(1s + 60ms);
    require(motion.retarget(2520.0, 2, 1s + 60ms), "forward retarget accepted");
    near(motion.current(1s + 60ms), at60, 0.0, "retarget preserves painted position");
    near(motion.sample(1s + 60ms).velocity, 0.0, 0.0, "first version resets velocity");
    const double at90 = motion.current(1s + 90ms);
    require(motion.retarget(0.0, 3, 1s + 90ms), "reverse retarget accepted");
    near(motion.current(1s + 90ms), at90, 0.0, "reverse keeps position continuous");
    require(motion.current(1s + 100ms) < at90, "reverse moves toward new target");
    const double sample = motion.current(1s + 120ms);
    require(motion.retarget(0.0, 3, 1s + 120ms), "duplicate epoch idempotent");
    near(motion.current(1s + 120ms), sample, 0.0, "duplicate does not restart spring");
    require(!motion.retarget(1260.0, 3, 1s + 120ms), "conflicting duplicate rejected");
    require(!motion.retarget(2520.0, 2, 1s + 120ms), "old epoch rejected");
    require(!motion.finish(2, 10s), "old completion cannot finish new motion");
    require(!motion.finish(3, 1s + 120ms), "premature completion rejected");
    require(!motion.retarget(std::numeric_limits<double>::quiet_NaN(), 4, 2s), "invalid retarget rejected");
    require(motion.epoch() == 3 && motion.target() == 0.0, "rejection preserves state");
    require(!motion.retarget(1260.0, 4, 1s), "backwards retarget clock rejected");
    require(motion.finish(3, 2s), "matching settled completion accepted");
    near(motion.current(1s), 0.0, 0.0, "finished motion stays static");

    require(motion.start(0.0, 1260.0, 4, 3s), "new epoch after finish");
    const auto before = motion.current(3s + 60ms);
    require(motion.start(0.0, 1260.0, 4, 3s + 60ms), "duplicate start accepted");
    near(motion.current(3s + 60ms), before, 0.0, "duplicate start preserves time origin");
    require(motion.snap(800.0), "snap cancels motion");
    near(motion.current(10s), 800.0, 0.0, "snap persists");
    require(!motion.retarget(0.0, 3, 10s), "snap keeps stale-epoch barrier");
    require(!motion.snap(std::numeric_limits<double>::infinity()), "invalid snap rejected");
    near(motion.current(10s), 800.0, 0.0, "invalid snap preserves state");
    require(!motion.start(0.0, 1.0, -1, 0ns) && !motion.start(0.0, 1.0, 5, -1ns), "invalid epoch/time rejected");

    SpringParams slow;
    slow.stiffness = 0.01;
    ViewportMotionBackend timeout(slow);
    require(timeout.start(0.0, 1260.0, 0, 0ns), "slow spring start");
    require(timeout.isActive(2999ms), "timeout not early");
    require(timeout.isDone(3s), "three-second failsafe stops slow spring");
    near(timeout.current(3s), 1260.0, 0.0, "failsafe exact target");
    ViewportMotionBackend extremeTime;
    require(extremeTime.start(0.0, 1260.0, 0, std::chrono::nanoseconds::max() - 1s), "large clock accepted");
    require(extremeTime.isDone(std::chrono::nanoseconds::max()), "large clock subtraction safe");
    ViewportMotionBackend fresh;
    require(!fresh.retarget(0.0, -1, 0ns), "uninitialized duplicate epoch rejected");
    require(!fresh.retarget(0.0, 0, -1ns), "negative retarget timestamp rejected");
    ViewportMotionBackend same;
    require(same.start(400.0, 400.0, 0, 0ns) && same.isDone(0ns), "no-op motion static");
}

int main()
{
    checkSpring();
    checkMotion();
    std::printf("PASS spring=%s viewport motion=%s\n", SpringBackendName, ViewportMotionBackendName);
}
