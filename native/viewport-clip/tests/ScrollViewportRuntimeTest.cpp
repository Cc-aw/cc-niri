/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "ScrollViewportRuntime.h"
#include <iostream>
#include <cstdlib>
using namespace CcNiri;
using namespace std::chrono_literals;
void check(bool value, const char *message) { if (!value) { std::cerr << message << std::endl; std::exit(1); } }
QJsonObject state(const QString &session = QStringLiteral("s"), const QString &workspace = QStringLiteral("a")) {
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("sessionId"), session},
        {QStringLiteral("workspaceId"), workspace}, {QStringLiteral("targetOutput"), QStringLiteral("eDP-1")},
        {QStringLiteral("generation"), 1}};
}
QJsonObject plan(int epoch, double from, double to) {
    QJsonArray entries;
    for (int i = 0; i < 5; ++i) {
        const double logical = i * 1260.25;
        auto visible = [&](double offset) { return logical >= offset && logical + 1252.25 <= offset + 2512.5; };
        if (!visible(from) && !visible(to)) continue;
        entries.append(QJsonObject{{QStringLiteral("windowId"), QString::number(i)}, {QStringLiteral("columnId"), i},
            {QStringLiteral("logicalX"), logical}, {QStringLiteral("pixelWidth"), 1252.25},
            {QStringLiteral("oldPlacement"), visible(from) ? QStringLiteral("visible") : QStringLiteral("parked")},
            {QStringLiteral("newPlacement"), visible(to) ? QStringLiteral("visible") : QStringLiteral("parked")}});
    }
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("type"), QStringLiteral("SCROLL")},
        {QStringLiteral("sessionId"), QStringLiteral("s")}, {QStringLiteral("workspaceId"), QStringLiteral("a")},
        {QStringLiteral("targetOutput"), QStringLiteral("eDP-1")}, {QStringLiteral("issuedAt"), 1},
        {QStringLiteral("epoch"), epoch}, {QStringLiteral("oldScrollOffsetX"), from},
        {QStringLiteral("newScrollOffsetX"), to}, {QStringLiteral("entries"), entries},
        {QStringLiteral("viewport"), QJsonObject{{QStringLiteral("x"), -1920.5}, {QStringLiteral("y"), 50.25},
            {QStringLiteral("width"), 2512.5}, {QStringLiteral("height"), 1320.25}}}};
}
int main() {
    ScrollViewportRuntime runtime;
    const auto first = plan(1, 0, 1260.25);
    check(!runtime.arm(first, 0ns), "no authority");
    check(runtime.updateContext(state()), "context");
    check(runtime.arm(first, 0ns), "arm");
    check(runtime.targets().size() == 1, "continuing only");
    const auto rect = runtime.targets().value(QStringLiteral("1"));
    check(!runtime.projection(QStringLiteral("0"), rect), "outgoing excluded");
    check(!runtime.projection(QStringLiteral("2"), rect), "incoming excluded");
    check(!runtime.projection(QStringLiteral("1"), rect.translated(1260.25, 0)), "pre-commit old geometry excluded");
    check(runtime.projection(QStringLiteral("1"), rect)->translationX == 1260.25, "first sample is old projection");
    check(runtime.advance(100ms), "animation active");
    const auto sample = runtime.projection(QStringLiteral("1"), rect)->translationX;
    check(sample > 0 && sample < 1260.25, "spring intermediate");
    check(runtime.projection(QStringLiteral("1"), rect)->translationX == sample, "paint does not resample clock");
    check(runtime.arm(first, 100ms), "duplicate idempotent");
    check(runtime.projection(QStringLiteral("1"), rect)->translationX == sample, "duplicate does not restart");
    auto conflict = first; conflict.insert(QStringLiteral("issuedAt"), 2);
    check(!runtime.arm(conflict, 100ms), "conflicting same epoch rejected");
    // Same continuing column on reversal; projection is continuous across real geometry commits.
    check(runtime.arm(plan(2, 1260.25, 0), 150ms), "reverse retarget");
    const auto reverseRect = runtime.targets().value(QStringLiteral("1"));
    check(std::abs((rect.x() + sample) - (reverseRect.x() + runtime.projection(QStringLiteral("1"), reverseRect)->translationX)) < 1e-8, "retarget visual continuity");
    runtime.cancel(QStringLiteral("wrong"), 2); check(runtime.active(), "wrong-session cancel ignored");
    runtime.cancel(QStringLiteral("s"), 1); check(runtime.active(), "old cancel cannot clear newer epoch");
    runtime.cancel(QStringLiteral("s"), 2); check(!runtime.active(), "cancel clears");
    check(!runtime.arm(plan(2, 1260.25, 0), 150ms), "late cancelled arm blocked");
    check(runtime.arm(plan(3, 0, 1260.25), 150ms), "new epoch after cancel");
    check(!runtime.advance(4s) && !runtime.active(), "settles and clears ownership");
    check(!runtime.arm(plan(3, 0, 1260.25), 4s), "settled duplicate cannot resurrect");
    check(runtime.arm(plan(4, 0, 1260.25), 4s), "new epoch");
    runtime.updateContext(state(QStringLiteral("s"), QStringLiteral("b")));
    check(!runtime.active() && !runtime.arm(plan(5, 0, 1260.25), 4s), "workspace barrier");
    runtime.updateContext(state()); check(runtime.arm(plan(6, 0, 1260.25), 4s), "return workspace");
    runtime.remove(QStringLiteral("1")); check(!runtime.active(), "close last window");
    runtime.updateContext({}); check(!runtime.arm(plan(7, 0, 1260.25), 4s), "invalid context clears authority");
    runtime.updateContext(state()); check(runtime.arm(first, 0ns), "reload resets motion epoch and clock");
    check(!runtime.arm(plan(2, 1260.25, 3780.75), 1ms), "nonoverlap falls back");
    ScrollViewportRuntime shared;
    shared.updateContext(state());
    auto wider = plan(1, 0, 1260.25);
    auto viewport = wider.value(QStringLiteral("viewport")).toObject();
    viewport.insert(QStringLiteral("width"), 3772.75);
    wider.insert(QStringLiteral("viewport"), viewport);
    QJsonArray wideEntries;
    for (int i = 0; i < 4; ++i) {
        wideEntries.append(QJsonObject{{QStringLiteral("windowId"), QString::number(i)}, {QStringLiteral("columnId"), i},
            {QStringLiteral("logicalX"), i * 1260.25}, {QStringLiteral("pixelWidth"), 1252.25},
            {QStringLiteral("oldPlacement"), i < 3 ? QStringLiteral("visible") : QStringLiteral("parked")},
            {QStringLiteral("newPlacement"), i > 0 ? QStringLiteral("visible") : QStringLiteral("parked")}});
    }
    wider.insert(QStringLiteral("entries"), wideEntries);
    check(shared.arm(wider, 0ns) && shared.targets().size() == 2, "multi-column shared viewport");
    shared.advance(100ms);
    const auto targets = shared.targets();
    check(shared.projection(QStringLiteral("1"), targets.value(QStringLiteral("1")))->translationX
        == shared.projection(QStringLiteral("2"), targets.value(QStringLiteral("2")))->translationX, "same frame means identical translation");
    std::cout << "PASS native scroll projection ownership and lifecycle" << std::endl;
}
