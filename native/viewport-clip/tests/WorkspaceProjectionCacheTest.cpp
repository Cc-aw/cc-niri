/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "WorkspaceProjectionCache.h"
#include "virtualdesktops.h"
#include <QCoreApplication>
#include <QRectF>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <new>

namespace {
std::atomic<size_t> allocations = 0;
std::atomic<bool> trackAllocations = false;
void check(bool value, const char *message)
{
    if (!value) { std::fprintf(stderr, "workspace projection: %s\n", message); std::exit(1); }
}
using Cache = KWin::WorkspaceProjectionCache<KWin::VirtualDesktop>;
struct SharedDesktopRange {
    QList<KWin::VirtualDesktop *> values;
    bool *mutableIteration;
    auto begin() { *mutableIteration = true; return values.begin(); }
    auto end() { *mutableIteration = true; return values.end(); }
    auto begin() const { return values.cbegin(); }
    auto end() const { return values.cend(); }
};
struct Plan {
    std::array<CcNiriWorkspaceProjection, 16> projections{};
    size_t size = 0;
    void append(CcNiriWorkspaceProjection p) { check(size < projections.size(), "plan capacity"); projections[size++] = p; }
};
void equal(const Plan &a, const Plan &b)
{
    check(a.size == b.size, "cached and legacy drawing count");
    for (size_t i = 0; i < a.size; ++i) {
        check(a.projections[i].visible == b.projections[i].visible
            && a.projections[i].translation.x == b.projections[i].translation.x
            && a.projections[i].translation.y == b.projections[i].translation.y,
            "exact Rust projection and drawing order");
        // Clipping is intentionally unchanged, including mixed DPI and negative
        // output origins. Compare device bounds without a GPU or scene capture.
        for (double scale : {1.0, 1.5, 2.0}) {
            const auto clip = [scale](const auto &p) {
                const QRectF screen(-2560, -120, 2560, 1440);
                const auto r = screen.translated(p.translation.x, p.translation.y).intersected(screen);
                return QRectF(r.x()*scale, r.y()*scale, r.width()*scale, r.height()*scale).toAlignedRect();
            };
            check(clip(a.projections[i]) == clip(b.projections[i]), "unchanged physical clip bounds");
        }
    }
}
}
void *operator new(size_t size)
{
    if (trackAllocations.load(std::memory_order_relaxed)) ++allocations;
    if (auto *p = std::malloc(size ? size : 1)) return p;
    std::abort();
}
void *operator new[](size_t size) { return ::operator new(size); }
void operator delete(void *p) noexcept { std::free(p); }
void operator delete[](void *p) noexcept { std::free(p); }
void operator delete(void *p, size_t) noexcept { std::free(p); }
void operator delete[](void *p, size_t) noexcept { std::free(p); }

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    std::array<std::unique_ptr<KWin::VirtualDesktop>, 9> owners;
    std::array<KWin::VirtualDesktop *, 9> desktops{};
    for (size_t i = 0; i < desktops.size(); ++i) {
        owners[i] = std::make_unique<KWin::VirtualDesktop>();
        owners[i]->setX11DesktopNumber(i + 1);
        desktops[i] = owners[i].get();
    }
    const auto motion = std::unique_ptr<CcNiriWorkspace, decltype(&cc_niri_workspace_destroy)>(
        cc_niri_workspace_create(), cc_niri_workspace_destroy);
    check(bool(motion), "Rust handle");
    Cache cache;
    int64_t epoch = 0;
    const auto project = [&](KWin::VirtualDesktop *d) {
        const auto i = d->x11DesktopNumber() - 1;
        return cc_niri_workspace_projection(motion.get(), {double(i % 3), double(i / 3)}, 2560, 1440, 45, 20);
    };
    const auto compare = [&](const auto &belongs) {
        Plan oldPlan, newPlan, fallbackPlan;
        for (auto *d : desktops) if (belongs(d)) {
            const auto p = project(d);
            if (p.visible) oldPlan.append(p);
        }
        cache.paint(cache.complete(), [&] { return desktops; }, belongs, project,
            [&](auto p) { newPlan.append(p); }, [] { return true; }, [] { return true; });
        equal(oldPlan, newPlan);
        cache.paint(false, [&] { return desktops; }, belongs, project,
            [&](auto p) { fallbackPlan.append(p); }, [] { return true; }, [] { return false; });
        equal(oldPlan, fallbackPlan);
    };
    // Exhaustively compare the legacy traversal to memoized Rust projections
    // across ordinary, wrap, nonadjacent and fractional gesture positions.
    for (bool wrap : {false, true}) {
        check(cc_niri_workspace_configure(motion.get(), 3, 3, wrap).value, "grid");
        for (double y : {0.0, .5, 1.0, 1.5, 2.0, 2.9}) for (double x : {0.0, .5, 1.0, 1.5, 2.0, 2.9}) {
            check(cc_niri_workspace_gesture(motion.get(), {x, y}, ++epoch, 0).value, "gesture");
            trackAllocations = true;
            const auto count = allocations.load();
            check(cache.prepare(desktops, project), "complete Rust visible set");
            for (size_t member = 0; member < desktops.size(); ++member)
                compare([&](auto *d) { return d == desktops[member]; });
            compare([](auto *) { return true; }); // Sticky background.
            compare([&](auto *d) { return d == desktops[0] || d == desktops[8]; });
            check(allocations.load() == count, "no new C++ frame allocations");
            trackAllocations = false;
        }
    }
    // Actual finite curves, nonadjacent target and a reverse retarget from the
    // last marked paint use the same cache without changing the Rust clock.
    cc_niri_workspace_configure(motion.get(), 3, 3, false);
    check(cc_niri_workspace_start_with_policy(motion.get(), {0, 0}, {2, 2}, ++epoch, 0, 420000000, true).value, "nonadjacent finite curve");
    for (int64_t time : {0, 80000000, 160000000, 240000000, 420000000}) {
        cc_niri_workspace_advance(motion.get(), time);
        check(cache.prepare(desktops, project), "finite curve precompute");
        compare([](auto *) { return true; });
        check(cc_niri_workspace_mark_painted(motion.get()).status == CC_NIRI_FFI_OK, "last actual drawing anchor");
        if (time == 80000000)
            check(cc_niri_workspace_start_with_policy(motion.get(), {2, 2}, {0, 0}, ++epoch, time, 420000000, true).value, "reverse retarget");
    }
    // Count the actual legacy membership-before-projection path, rather than
    // pretending that every membership check called Rust.
    cc_niri_workspace_configure(motion.get(), 1, 9, false);
    check(cc_niri_workspace_gesture(motion.get(), {0, .5}, ++epoch, 420000000).value, "vertical gesture");
    size_t cachedCalls = 0, oldCalls = 0, cachedMembership = 0, oldMembership = 0;
    const auto vertical = [&](auto *d) {
        return cc_niri_workspace_projection(motion.get(), {0, double(d->x11DesktopNumber()-1)}, 2560, 1440, 45, 20);
    };
    cache.prepare(desktops, [&](auto *d) { ++cachedCalls; return vertical(d); });
    for (size_t window = 0; window < 27; ++window) {
        Plan a, b;
        for (auto *d : desktops) {
            ++oldMembership;
            if (d == desktops[window % desktops.size()]) { ++oldCalls; auto p = vertical(d); if (p.visible) a.append(p); }
        }
        cache.paint(true, [&] { return desktops; }, [&](auto *d) {
            ++cachedMembership; return d == desktops[window % desktops.size()];
        }, vertical, [&](auto p) { b.append(p); }, [] { return true; }, [] { return true; });
        equal(a, b);
    }
    check(oldCalls == 27 && cachedCalls == 9, "projection calls 27 to 9 in this fixture");
    check(oldMembership == 243 && cachedMembership == 54, "membership checks 243 to 54");
    // Never truncate visible desktops. Overflow and invalid results return to
    // the complete legacy path, and all borrowed pointers are cleared.
    const auto allVisible = [](auto *) { return CcNiriWorkspaceProjection{{1, 2}, 1, CC_NIRI_FFI_OK}; };
    check(!cache.prepare(desktops, allVisible) && !cache.complete() && !cache.size(), "overflow invalidates whole cache");
    Plan fallback;
    cache.paint(false, [&] { return desktops; }, [](auto *) { return true; }, allVisible,
        [&](auto p) { fallback.append(p); }, [] { return true; }, [] { return false; });
    check(fallback.size == 9, "capacity fallback loses no desktop");
    QList<KWin::VirtualDesktop *> shared;
    for (auto *desktop : desktops) shared.append(desktop);
    bool mutableIteration = false;
    Plan sharedFallback;
    cache.paint(false, [&] { return SharedDesktopRange{shared, &mutableIteration}; }, [](auto *) { return true; }, allVisible,
        [&](auto p) { sharedFallback.append(p); }, [] { return true; }, [] { return false; });
    check(sharedFallback.size == 9 && !mutableIteration, "fallback uses read-only shared Qt desktop snapshot");
    check(!cache.prepare(desktops, [](auto *) { return CcNiriWorkspaceProjection{{}, 1, CC_NIRI_FFI_INVALID_HANDLE}; }), "invalid result fallback");
    check(cache.prepare(desktops, [](auto *) { return CcNiriWorkspaceProjection{{}, 0, CC_NIRI_FFI_OK}; }) && cache.complete() && !cache.size(), "complete empty set");
    std::array<KWin::VirtualDesktop *, 4> four{desktops[0], desktops[1], desktops[2], desktops[3]};
    check(cache.prepare(four, allVisible), "four visible desktops supported");
    // Nested captures invalidate parent reuse; remaining desktops use a fresh
    // traversal, avoiding both stale pointers and duplicate drawing.
    Plan reentered;
    cache.paint(true, [&] { return four; }, [](auto *) { return true; }, allVisible, [&](auto p) {
        reentered.append(p); if (reentered.size == 1) cache.clear();
    }, [] { return true; }, [&] { return cache.complete(); });
    check(reentered.size == 4, "reentrant fallback draws remainder exactly once");
    // Model window/output destruction while the downstream painter is active.
    cache.prepare(four, allVisible);
    bool alive = true;
    size_t calls = 0;
    cache.paint(true, [&] { return four; }, [](auto *) { return true; }, allVisible,
        [&](auto) { ++calls; alive = false; cache.clear(); }, [&] { return alive; }, [] { return true; });
    check(calls == 1, "do not access a destroyed window or binding");
    // Real QObject destruction clears borrowed desktop entries before reuse.
    QObject receiver;
    QObject::connect(owners[0].get(), &KWin::VirtualDesktop::aboutToBeDestroyed, &receiver, [&] { cache.clear(); });
    cache.prepare(four, allVisible); owners[0].reset();
    check(!cache.complete() && !cache.size() && !cache.at(0).desktop, "QObject destruction clears pointers");
    KWin::WorkspaceProjectionPasses scopes;
    scopes.enter(1, true); check(scopes.canCache(1) && !scopes.canCache(2), "output scoped");
    scopes.enter(2, true); check(!scopes.canCache(1) && !scopes.canCache(2), "nested fallback");
    check(scopes.leave() == 2 && scopes.canCache(1), "parent output routing restored");
    scopes.forget(1); check(!scopes.canCache(1) && scopes.leave() == 0, "removed output pointer forgotten");
    scopes.enter(1, false); check(!scopes.canCache(1), "offscreen has no cache"); scopes.leave();
    for (size_t i = 0; i < 10; ++i) scopes.enter(i+1, true);
    check(scopes.leave() == 0 && scopes.leave() == 0 && scopes.leave() == 8, "overflow safely returns to tracked scopes");
    for (size_t i = 0; i < 7; ++i) scopes.leave();
    check(scopes.leave() == 0, "unbalanced post is harmless");
    // The same platform scopes also protect the optional Rust sampling clock:
    // nested/offscreen/overflow passes cannot consume an output's logical time.
    auto clockMotion = std::unique_ptr<CcNiriWorkspace, decltype(&cc_niri_workspace_destroy)>(
        cc_niri_workspace_create(), cc_niri_workspace_destroy);
    check(cc_niri_workspace_clock_configure(clockMotion.get(), 1).value, "clock opt in");
    cc_niri_workspace_clock_event(clockMotion.get(), 1000000000);
    const auto tick = [&](int64_t predicted) {
        if (scopes.canCache(scopes.currentOutput()))
            return cc_niri_workspace_clock_frame(clockMotion.get(), predicted, predicted-1, 60000).advance;
        return uint32_t(0);
    };
    scopes.enter(1, false); check(!tick(1016666667), "offscreen must not tick"); scopes.leave();
    scopes.enter(1, true); check(tick(1016666667), "real outer clock tick");
    scopes.enter(2, true); check(!tick(1033333334), "nested other output must not tick");
    check(scopes.currentOutput() == 2, "nested post routes current output"); scopes.leave();
    check(scopes.currentOutput() == 1 && !tick(1016666667), "parent repeat has no second tick"); scopes.leave();
    for (size_t i = 0; i < 10; ++i) scopes.enter(i+1, true);
    check(!scopes.currentOutput() && !tick(1100000000), "untracked overflow has no clock");
    for (size_t i = 0; i < 10; ++i) scopes.leave();
    scopes.enter(1, true); check(tick(1066666667), "next real frame advances after filtering"); scopes.leave();
    check(cc_niri_workspace_clock_state(clockMotion.get()).lag_ns == 33333333, "nested filtering preserves physical delta");
    check(sizeof(Cache) <= 256 && sizeof(scopes) <= 144, "fixed small platform caches");
    std::printf("PASS Rust projection parity, lifecycle, nesting, no C++ allocation; cache=%zu pass-stack=%zu bytes; calls=27->9 membership=243->54\n", sizeof(Cache), sizeof(scopes));
}
