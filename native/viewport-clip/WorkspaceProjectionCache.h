/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "cc_niri_native_core.h"
#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>

namespace KWin {
// Memoized Rust results only. Desktop pointers are borrowed for one output
// paint pass; the adapter clears them on every lifecycle/motion change.
template<typename Desktop>
class WorkspaceProjectionCache {
public:
    struct Entry { Desktop *desktop = nullptr; CcNiriWorkspaceProjection projection{}; };
    static constexpr size_t Capacity = 4;
    void clear() { m_entries = {}; m_size = 0; m_complete = false; }
    template<typename Range, typename Project>
    bool prepare(const Range &desktops, Project project)
    {
        clear();
        for (auto *desktop : desktops) {
            if (!desktop) { clear(); return false; }
            const auto projection = project(desktop);
            if (projection.status != CC_NIRI_FFI_OK) { clear(); return false; }
            if (!projection.visible) continue;
            if (m_size == Capacity) { clear(); return false; }
            m_entries[m_size++] = {desktop, projection};
        }
        m_complete = true; // Empty is also a complete projection result.
        return true;
    }
    bool complete() const { return m_complete; }
    size_t size() const { return m_size; }
    const Entry &at(size_t index) const { return m_entries[index]; }
    template<typename Desktops, typename Belongs, typename Project, typename Paint,
             typename Alive, typename Valid>
    void paint(bool cached, Desktops desktops, Belongs belongs, Project project,
               Paint draw, Alive alive, Valid valid) const
    {
        std::array<Desktop *, Capacity> painted{};
        size_t count = 0;
        if (cached) {
            for (size_t i = 0; i < m_size; ++i) {
                if (!alive()) return;
                if (!m_complete || !valid()) break;
                const auto entry = m_entries[i];
                if (belongs(entry.desktop)) {
                    draw(entry.projection);
                    painted[count++] = entry.desktop;
                }
            }
            if (m_complete && valid()) return;
        }
        // Reentrant paint may have invalidated the borrowed entries. Obtain a
        // fresh desktop list and use the original Rust path for the remainder,
        // without duplicating a desktop already drawn by this window pass.
        if (!alive()) return;
        const auto snapshot = desktops(); // Const iteration cannot detach a shared QList.
        for (auto *desktop : snapshot) {
            if (!alive()) return;
            if (std::find(painted.begin(), painted.begin() + count, desktop) != painted.begin() + count) continue;
            if (!belongs(desktop)) continue;
            const auto projection = project(desktop);
            if (projection.status == CC_NIRI_FFI_OK && projection.visible) draw(projection);
        }
    }
private:
    std::array<Entry, Capacity> m_entries{};
    size_t m_size = 0;
    bool m_complete = false;
};

// Rendering scopes, not an animation clock. Nested/offscreen/overflow passes
// cannot use the cache. A nested output restores the parent's routing on exit.
class WorkspaceProjectionPasses {
public:
    void enter(uintptr_t output, bool real)
    {
        if (m_depth < m_passes.size()) m_passes[m_depth] = {output, real};
        ++m_depth;
    }
    uintptr_t leave()
    {
        if (!m_depth) return 0;
        --m_depth;
        if (m_depth >= m_passes.size()) return 0;
        const auto output = m_passes[m_depth].output;
        m_passes[m_depth] = {};
        return output;
    }
    bool canCache(uintptr_t output) const
    {
        return m_depth == 1 && output && m_passes[0].real && m_passes[0].output == output;
    }
    bool nested() const { return m_depth > 1; }
    void forget(uintptr_t output)
    {
        for (auto &pass : m_passes) if (pass.output == output) pass = {};
    }
private:
    struct Pass { uintptr_t output = 0; bool real = false; };
    std::array<Pass, 8> m_passes{};
    size_t m_depth = 0;
};
}
