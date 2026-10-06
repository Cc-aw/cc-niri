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
}
int main() { endpointsAndProjection(); continuityAndErrors(); sixtyHzFrameDisplacement(); }
