/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "ScrollRuntimeTestBackend.h"
#include "SpringBackend.h"
#include "ScrollClipHandoff.h"
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
    ScrollRuntimeTestBackend runtime;
    const auto first = plan(1, 0, 1260.25);
    check(!runtime.arm(first, 0ns), "no authority");
    check(runtime.updateContext(state()), "context");
    check(runtime.arm(first, 0ns), "arm");
    check(runtime.targets().size() == 3, "continuing incoming and outgoing");
    const auto rect = runtime.targets().value(QStringLiteral("1"));
    const auto outgoingRect = runtime.targets().value(QStringLiteral("0"));
    check(runtime.role(QStringLiteral("0")) == QStringLiteral("outgoing"), "outgoing ownership role");
    check(runtime.projection(QStringLiteral("0"), outgoingRect)->translationX == 0, "outgoing first frame retained");
    const auto incomingRect = runtime.targets().value(QStringLiteral("2"));
    check(runtime.role(QStringLiteral("2")) == QStringLiteral("incoming"), "incoming ownership role");
    check(runtime.role(QStringLiteral("1")) == QStringLiteral("continuing"), "continuing ownership role");
    check(!runtime.projection(QStringLiteral("2"), QRectF(-99999, 50.25, 1252.25, 1320.25)), "parking geometry cannot be projected");
    const auto incoming = runtime.projection(QStringLiteral("2"), incomingRect);
    check(incoming.has_value() && incomingRect.x() + incoming->translationX == incoming->viewport.right() + 8, "incoming starts beyond the right strip edge");
    check(runtime.projection(QStringLiteral("1"), rect.translated(1260.25, 0))->translationX == 0, "pre-commit source remains at its old visual position");
    check(runtime.projection(QStringLiteral("1"), rect)->translationX == 1260.25, "first sample is old projection");
    check(runtime.advance(100ms), "animation active");
    const auto sample = runtime.projection(QStringLiteral("1"), rect)->translationX;
    check(sample > 0 && sample < 1260.25, "spring intermediate");
    auto moving = runtime;
    ScrollClipHandoff frozenHandoff;
    frozenHandoff.retain(moving, 2, {QStringLiteral("1")});
    moving.advance(200ms);
    check(frozenHandoff.projection(QStringLiteral("1"), rect)->translationX == sample,
        "handoff holds the last Rust paint sample without advancing another clock");
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
    check(runtime.advance(4s) && runtime.completed(), "settles and holds until parking ACK");
    check(runtime.status().value(QStringLiteral("epoch")).toInteger() == 3
        && runtime.status().value(QStringLiteral("completed")).toBool(), "scoped completion status");
    const auto heldRect = runtime.targets().value(QStringLiteral("0"));
    const auto heldProjection = runtime.projection(QStringLiteral("0"), heldRect);
    check(heldRect.right() + heldProjection->translationX <= heldProjection->viewport.left(), "completed outgoing stays outside viewport");
    runtime.cancel(QStringLiteral("s"), 3);
    check(!runtime.active() && !runtime.completed(), "parking ACK clears projection and completion");
    check(!runtime.arm(plan(3, 0, 1260.25), 4s), "settled duplicate cannot resurrect");
    check(runtime.arm(plan(4, 0, 1260.25), 4s), "new epoch");
    runtime.updateContext(state(QStringLiteral("s"), QStringLiteral("b")));
    check(!runtime.active() && !runtime.arm(plan(5, 0, 1260.25), 4s), "workspace barrier");
    runtime.updateContext(state()); check(runtime.arm(plan(6, 0, 1260.25), 4s), "return workspace");
    runtime.remove(QStringLiteral("1")); check(runtime.active(), "incoming survives continuing close");
    runtime.remove(QStringLiteral("0"));
    runtime.remove(QStringLiteral("2")); check(!runtime.active() && runtime.role(QStringLiteral("2")).isEmpty(), "close last window clears role");
    runtime.updateContext({}); check(!runtime.arm(plan(7, 0, 1260.25), 4s), "invalid context clears authority");
    runtime.updateContext(state()); check(runtime.arm(first, 0ns), "reload resets motion epoch and clock");
    check(runtime.arm(plan(2, 1260.25, 3780.75), 1ms), "nonoverlap incoming projection");
    ScrollRuntimeTestBackend shared;
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
    check(shared.arm(wider, 0ns) && shared.targets().size() == 4, "multi-column shared viewport");
    shared.advance(100ms);
    const auto targets = shared.targets();
    check(shared.projection(QStringLiteral("1"), targets.value(QStringLiteral("1")))->translationX
        == shared.projection(QStringLiteral("2"), targets.value(QStringLiteral("2")))->translationX, "same frame means identical translation");
    // Each production-frame sample must keep adjacent new-visible columns attached.
    for (bool reverse : {false, true}) {
        ScrollRuntimeTestBackend attached;
        attached.updateContext(state());
        check(attached.arm(plan(1, reverse ? 1260.25 : 0, reverse ? 0 : 1260.25), 0ns), "bidirectional incoming arm");
        const auto newTargets = attached.targets();
        const auto leftId = reverse ? QStringLiteral("0") : QStringLiteral("1");
        const auto rightId = reverse ? QStringLiteral("1") : QStringLiteral("2");
        if (reverse) {
            auto initial = attached.projection(leftId, newTargets.value(leftId));
            check(newTargets.value(leftId).right() + initial->translationX == initial->viewport.left() - 8, "incoming starts beyond left edge");
        }
        for (auto time : {0ms, 7ms, 20ms, 60ms, 100ms, 220ms, 400ms}) {
            check(attached.advance(time), "frame active");
            auto left = attached.projection(leftId, newTargets.value(leftId));
            auto right = attached.projection(rightId, newTargets.value(rightId));
            check(left && right, "both new-visible columns project");
            const double gap = newTargets.value(rightId).x() + right->translationX
                - newTargets.value(leftId).right() - left->translationX;
            check(std::abs(gap - 8) < 1e-8, "fixed gap throughout spring in either direction");
            const auto outgoingId = reverse ? QStringLiteral("2") : QStringLiteral("0");
            const auto outgoingFrame = newTargets.value(outgoingId);
            const auto outgoingProjection = attached.projection(outgoingId, outgoingFrame);
            check(outgoingProjection.has_value(), "outgoing remains drawable throughout spring");
            const double outgoingGap = reverse
                ? outgoingFrame.x() + outgoingProjection->translationX - newTargets.value(rightId).right() - right->translationX
                : newTargets.value(leftId).x() + left->translationX - outgoingFrame.right() - outgoingProjection->translationX;
            check(std::abs(outgoingGap - 8) < 1e-8, "outgoing and continuing share fixed gap");
        }
        attached.cancel(QStringLiteral("s"), 1);
        check(!attached.active() && attached.role(leftId).isEmpty(), "cancel clears all incoming roles");
    }
    // Repeated keys retarget before settling, preserving all painted windows,
    // including outgoing that is absent from both new logical snapshots.
    for (bool reverse : {false, true}) {
        ScrollRuntimeTestBackend chain; chain.updateContext(state());
        const double step = 1260.25;
        const double initial = reverse ? 3 * step : 0;
        const double direction = reverse ? -step : step;
        check(chain.arm(plan(1, initial, initial + direction), 0ns), "chain first arm");
        for (int epoch = 2; epoch <= 3; ++epoch) {
            const auto lastFrame = (epoch - 1) * 40ms;
            check(chain.advance(lastFrame), "chain sample remains active");
            const auto frames = chain.targets();
            QHash<QString, double> painted;
            for (auto it = frames.cbegin(); it != frames.cend(); ++it) {
                auto projection = chain.projection(it.key(), it.value());
                check(projection.has_value(), "old frame has projection");
                painted.insert(it.key(), it.value().x() + projection->translationX);
            }
            check(chain.arm(plan(epoch, initial + (epoch - 1) * direction, initial + epoch * direction), lastFrame + 3ms, frames), "retarget without wait");
            check(!chain.completed(), "new epoch owns completion");
            for (auto it = painted.cbegin(); it != painted.cend(); ++it) {
                const auto newFrame = chain.targets().value(it.key());
                auto afterCommit = chain.projection(it.key(), newFrame);
                auto beforeCommit = chain.projection(it.key(), frames.value(it.key()));
                check(afterCommit && beforeCommit, "both source and target survive retarget ACK");
                check(std::abs(newFrame.x() + afterCommit->translationX - it.value()) < 1e-8, "after geometry retarget continuity");
                check(std::abs(frames.value(it.key()).x() + beforeCommit->translationX - it.value()) < 1e-8, "before geometry retarget continuity");
            }
        }
        check(chain.targets().size() == 5, "all unfinished outgoing retained across three keys");
        chain.advance(120ms);
        const auto targets = chain.targets();
        for (int i = 0; i < 4; ++i) {
            const auto left = targets.value(QString::number(i));
            const auto right = targets.value(QString::number(i + 1));
            const auto lp = chain.projection(QString::number(i), left);
            const auto rp = chain.projection(QString::number(i + 1), right);
            check(lp && rp && std::abs(right.x() + rp->translationX - left.right() - lp->translationX - 8) < 1e-8, "fixed gap for retained chain");
        }
        chain.cancel(QStringLiteral("s"), 1); chain.cancel(QStringLiteral("s"), 2);
        check(chain.active() && chain.status().value(QStringLiteral("epoch")).toInteger() == 3, "old epochs cannot finish latest retarget");
        chain.advance(4s); check(chain.completed(), "latest chain completes");
        chain.cancel(QStringLiteral("s"), 3); check(!chain.active(), "latest finalization clears full chain");
    }
    // An arm can be superseded before any geometry ACK. The origin is still the
    // last painted sample, rather than the uncommitted logical target.
    ScrollRuntimeTestBackend uncommitted; uncommitted.updateContext(state());
    check(uncommitted.arm(plan(1, 0, 1260.25), 0ns), "uncommitted arm");
    uncommitted.advance(40ms); const auto source = uncommitted.sourceFrames().value(QStringLiteral("1"));
    const double paintedX = source.x() + uncommitted.projection(QStringLiteral("1"), source)->translationX;
    QHash<QString, QRectF> sourceMap{{QStringLiteral("1"), source}};
    check(uncommitted.arm(plan(2, 0, 2520.5), 43ms, sourceMap), "supersede uncommitted geometry");
    check(std::abs(source.x() + uncommitted.projection(QStringLiteral("1"), source)->translationX - paintedX) < 1e-8, "uncommitted sample continuity");
    // Mid-flight reversals preserve every painted position and restart with v0=0.
    ScrollRuntimeTestBackend reversing; reversing.updateContext(state());
    check(reversing.arm(plan(1, 0, 1260.25), 0ns), "reverse initial arm");
    reversing.advance(60ms);
    auto reverseFrames = reversing.targets();
    QHash<QString, double> reversePainted;
    for (auto it = reverseFrames.cbegin(); it != reverseFrames.cend(); ++it)
        reversePainted.insert(it.key(), it.value().x() + reversing.projection(it.key(), it.value())->translationX);
    const double reverseFrom = -1920.5 + 1260.25 - reversePainted.value(QStringLiteral("1"));
    check(reversing.arm(plan(2, 1260.25, 0), 63ms, reverseFrames), "L then H retarget");
    check(reversing.role(QStringLiteral("0")) == QStringLiteral("incoming"), "old outgoing re-enters");
    check(reversing.role(QStringLiteral("2")) == QStringLiteral("outgoing"), "old incoming retires");
    for (auto it = reversePainted.cbegin(); it != reversePainted.cend(); ++it) {
        auto targetFrame = reversing.targets().value(it.key());
        auto before = reversing.projection(it.key(), reverseFrames.value(it.key()));
        auto after = reversing.projection(it.key(), targetFrame);
        check(before && after, "reversal source and target ownership");
        check(std::abs(reverseFrames.value(it.key()).x() + before->translationX - it.value()) < 1e-8, "reverse before ACK continuous");
        check(std::abs(targetFrame.x() + after->translationX - it.value()) < 1e-8, "reverse after ACK continuous");
    }
    reversing.advance(73ms);
    const auto reverseTarget = reversing.targets().value(QStringLiteral("1"));
    const double reverseOffset = -1920.5 + 1260.25 - reverseTarget.x() - reversing.projection(QStringLiteral("1"), reverseTarget)->translationX;
    check(std::abs(reverseOffset - SpringBackend(reverseFrom, 0, 0).sample(10ms).position) < 1e-8, "reverse resets velocity to zero");
    // Alternating targets transfer incoming/outgoing until the last completion.
    for (int epoch = 3; epoch <= 9; ++epoch) {
        reversing.advance(epoch * 60ms);
        const auto frames = reversing.targets();
        QHash<QString, double> painted;
        for (auto it = frames.cbegin(); it != frames.cend(); ++it)
            painted.insert(it.key(), it.value().x() + reversing.projection(it.key(), it.value())->translationX);
        const double from = epoch % 2 ? 0 : 1260.25;
        const double to = epoch % 2 ? 1260.25 : 0;
        check(reversing.arm(plan(epoch, from, to), epoch * 60ms + 3ms, frames), "alternating direction arm");
        reversing.cancel(QStringLiteral("s"), epoch - 1);
        for (auto it = painted.cbegin(); it != painted.cend(); ++it) {
            const auto frame = reversing.targets().value(it.key());
            check(std::abs(frame.x() + reversing.projection(it.key(), frame)->translationX - it.value()) < 1e-8, "alternating position continuity");
        }
        const auto framesNow = reversing.targets();
        for (int i = 0; i < 2; ++i) {
            const auto l = framesNow.value(QString::number(i)), r = framesNow.value(QString::number(i + 1));
            check(std::abs(r.x() + reversing.projection(QString::number(i + 1), r)->translationX
                - l.right() - reversing.projection(QString::number(i), l)->translationX - 8) < 1e-8, "alternating fixed gap");
        }
        check(reversing.status().value(QStringLiteral("epoch")).toInteger() == epoch && !reversing.completed(), "only latest reversal owns completion");
    }
    reversing.advance(4s); check(reversing.completed(), "latest reversal settles");
    reversing.cancel(QStringLiteral("s"), 8); check(reversing.active(), "old completion cannot clear settled latest epoch");
    reversing.cancel(QStringLiteral("s"), 9); check(!reversing.active(), "latest completion clears reversal");

    // Equal logical offsets can reverse an armed but uncommitted target.
    ScrollRuntimeTestBackend returning; returning.updateContext(state());
    check(returning.arm(plan(1, 0, 1260.25), 0ns), "return initial arm");
    returning.advance(60ms); auto realFrames = returning.sourceFrames();
    const auto original = realFrames.value(QStringLiteral("1"));
    const double originalPaint = original.x() + returning.projection(QStringLiteral("1"), original)->translationX;
    auto returnPlan = plan(2, 0, 0);
    check(!returning.arm(returnPlan, 63ms, realFrames), "implicit equal offset forbidden");
    returnPlan.insert(QStringLiteral("retargetOnly"), true);
    check(returning.arm(returnPlan, 63ms, realFrames), "explicit return plan accepted");
    const auto finalFrame = returning.targets().value(QStringLiteral("1"));
    check(std::abs(finalFrame.x() + returning.projection(QStringLiteral("1"), finalFrame)->translationX - originalPaint) < 1e-8, "equal-offset return does not snap");
    check(returning.targets().size() == 2, "uncommitted hidden incoming never retained as drawable outgoing");
    returning.cancel(QStringLiteral("s"), 1); check(returning.active(), "old uncommitted arm cannot cancel return");
    returning.advance(4s); check(returning.completed(), "return completes");
    returning.cancel(QStringLiteral("s"), 2); check(!returning.active(), "return cleared");
    ScrollRuntimeTestBackend coldReturn; coldReturn.updateContext(state());
    check(coldReturn.arm(returnPlan, 0ns) && coldReturn.advance(0ns) && coldReturn.completed(), "return before first native arm is an immediate static completion");
    ScrollRuntimeTestBackend boundary; boundary.updateContext(state());
    check(boundary.arm(plan(1, 0, 1260.25), 0ns), "completion boundary first arm");
    boundary.advance(4s); check(boundary.completed(), "old segment already settled");
    const auto settled = boundary.targets();
    check(boundary.arm(plan(2, 1260.25, 0), 4s + 3ms, settled), "reverse takes over settled pending segment");
    boundary.cancel(QStringLiteral("s"), 1);
    check(boundary.active() && !boundary.completed(), "old completion cannot cancel boundary reversal");
    const auto b1 = boundary.targets().value(QStringLiteral("1"));
    check(std::abs(b1.x() + boundary.projection(QStringLiteral("1"), b1)->translationX
        - settled.value(QStringLiteral("1")).x()) < 1e-8, "completion boundary position continuity");
    // Opt-in partial placement shares the existing Spring and keeps static clipping.
    ScrollRuntimeTestBackend partial; partial.updateContext(state());
    auto p = plan(1, 0, 1260.25);
    p.insert(QStringLiteral("clipPartial"), true);
    auto a = p.value(QStringLiteral("entries")).toArray()[0].toObject();
    auto b = p.value(QStringLiteral("entries")).toArray()[1].toObject();
    a.insert(QStringLiteral("pixelWidth"), 2512.5);
    a.insert(QStringLiteral("newPlacement"), QStringLiteral("visible"));
    b.insert(QStringLiteral("logicalX"), 2520.5);
    b.insert(QStringLiteral("oldPlacement"), QStringLiteral("parked"));
    p.insert(QStringLiteral("entries"), QJsonArray{a, b});
    auto malformed = p; malformed.insert(QStringLiteral("clipPartial"), QStringLiteral("true"));
    check(!partial.arm(malformed, 0ns), "partial flag must be a boolean");
    check(partial.arm(p, 0ns), "Full/half partial arm");
    check(partial.advance(4s) && partial.completed() && partial.clipsPartial(), "partial clip survives Spring completion");
    const auto full = partial.targets().value(QStringLiteral("0"));
    check(full.width() == 2512.5 && full.x() < -1920.5, "Full width preserved beyond left edge");
    check(partial.projection(QStringLiteral("0"), full)->translationX == 0, "settled physical frame is projected unchanged");
    check(!partial.inputBlocked(QStringLiteral("0"), QPointF(-1920.5, 100)), "visible surface remains clickable");
    check(partial.inputBlocked(QStringLiteral("0"), QPointF(-1921, 100)), "hidden surface excluded from input");
    check(!partial.inputBlocked(QStringLiteral("unknown"), QPointF(-1921, 100)), "unmanaged surface input unaffected");
    auto frozen = partial;
    partial.updateContext(state(QStringLiteral("s"), QStringLiteral("b")));
    check(!partial.clipsPartial() && frozen.projection(QStringLiteral("0"), full).has_value(), "workspace clone holds last paint until adapter retires it");
    // Pair/Wide keeps its paint clock while a cold static handle clips the
    // Full neighbor. Its target resize may still await a Wayland frame ACK.
    for (const bool neighborLeft : {false, true}) {
        ScrollRuntimeTestBackend widthClip; widthClip.updateContext(state());
        auto clip = plan(1, neighborLeft ? 1260.25 : 0, neighborLeft ? 1260.25 : 0);
        clip.insert(QStringLiteral("retargetOnly"), true);
        clip.insert(QStringLiteral("clipPartial"), true);
        auto target = clip.value(QStringLiteral("entries")).toArray()[0].toObject();
        auto neighbor = clip.value(QStringLiteral("entries")).toArray()[1].toObject();
        target.insert(QStringLiteral("windowId"), QStringLiteral("0"));
        target.insert(QStringLiteral("columnId"), 0);
        neighbor.insert(QStringLiteral("windowId"), QStringLiteral("1"));
        neighbor.insert(QStringLiteral("columnId"), 1);
        target.insert(QStringLiteral("logicalX"), neighborLeft ? 2520.5 : 0);
        neighbor.insert(QStringLiteral("logicalX"), neighborLeft ? 0 : 1260.25);
        neighbor.insert(QStringLiteral("pixelWidth"), 2512.5);
        for (auto *entry : {&target, &neighbor}) {
            entry->insert(QStringLiteral("oldPlacement"), QStringLiteral("visible"));
            entry->insert(QStringLiteral("newPlacement"), QStringLiteral("visible"));
        }
        clip.insert(QStringLiteral("entries"), QJsonArray{target, neighbor});
        const QRectF awaitingTarget(-1920.5, 50.25, 2512.5, 1320.25);
        check(widthClip.arm(clip, 0ns, {{QStringLiteral("0"), awaitingTarget}}), "static width clip accepts a pending real Full frame");
        check(widthClip.projection(QStringLiteral("0"), awaitingTarget).has_value(), "pending target stays owned until geometry ACK");
        check(widthClip.advance(0ns) && widthClip.completed() && widthClip.clipsPartial(), "clip does not add another animation clock");
        const auto neighborFrame = widthClip.targets().value(QStringLiteral("1"));
        check(widthClip.projection(QStringLiteral("1"), neighborFrame)->translationX == 0, "Full neighbor translation belongs to Script");
        check(widthClip.inputBlocked(QStringLiteral("1"), QPointF(-1921, 100)), "width clip blocks the left hidden surface");
        check(widthClip.inputBlocked(QStringLiteral("1"), QPointF(593, 100)), "width clip blocks the right hidden surface");
        ScrollClipHandoff handoff;
        handoff.retain(widthClip, 2, {QStringLiteral("0"), QStringLiteral("1")});
        // Reverse after disarming the old epoch, retaining the neighbor's real
        // frame while the legacy outgoing animation moves it to a virtual edge.
        widthClip.cancel(QStringLiteral("s"), 1);
        check(!widthClip.active() && handoff.active(), "old runtime cancellation does not leave a paint/input gap");
        check(handoff.projection(QStringLiteral("1"), neighborFrame)->viewport == QRectF(-1920.5, 50.25, 2512.5, 1320.25), "frozen handoff clips the real Full frame to the original primary viewport");
        check(handoff.inputBlocked(QStringLiteral("1"), QPointF(593, 100)), "secondary output cannot hit the Full surface during handoff");
        check(!handoff.projection(QStringLiteral("unmanaged"), neighborFrame), "handoff is scoped to published window membership");
        handoff.cancel(QStringLiteral("wrong"), 2); handoff.cancel(QStringLiteral("s"), 1);
        handoff.release(QStringLiteral("1"), 1);
        check(handoff.active() && handoff.projection(QStringLiteral("1"), neighborFrame).has_value(), "stale cancellation and old Script clip cannot retire the replacement handoff");
        handoff.release(QStringLiteral("0"), 2);
        check(handoff.active() && !handoff.projection(QStringLiteral("0"), awaitingTarget), "each real Script clip takes over its own window");
        handoff.release(QStringLiteral("1"), 2);
        check(!handoff.active(), "last replacement Script clip releases the frozen handle");
        clip.insert(QStringLiteral("epoch"), 2);
        target.insert(QStringLiteral("pixelWidth"), 2512.5);
        clip.insert(QStringLiteral("entries"), QJsonArray{target, neighbor});
        check(widthClip.arm(clip, 1ms), "static width clip accepts overlapping retained real frames after cancellation");
        handoff.retain(widthClip, 3, {QStringLiteral("1")});
        handoff.cancel(QStringLiteral("s"), 3);
        check(!handoff.active(), "failed replacement cancellation retires its handoff");
        handoff.retain(widthClip, 3, {QStringLiteral("1")});
        handoff.updateContext(state(QStringLiteral("s"), QStringLiteral("b")));
        check(!handoff.active(), "workspace context clears the old handoff");
        handoff.retain(widthClip, 3, {QStringLiteral("1")});
        handoff.remove(QStringLiteral("1"));
        check(!handoff.active(), "window lifecycle releases the handoff handle");
    }
    std::cout << "PASS native scroll projection ownership and lifecycle with incoming fixed gap" << std::endl;
}
