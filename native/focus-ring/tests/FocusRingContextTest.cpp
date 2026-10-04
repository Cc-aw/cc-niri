/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingContext.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <cmath>
#include <cstdlib>
#include <iostream>
using namespace CcNiri;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
static const QString A = QStringLiteral("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
static const QString B = QStringLiteral("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
static QJsonObject snapshot(int generation = 1) {
    return {{QStringLiteral("protocol"), 2}, {QStringLiteral("sessionId"), QStringLiteral("s")},
        {QStringLiteral("workspaceId"), QStringLiteral("w")}, {QStringLiteral("targetOutput"), QStringLiteral("eDP-1")},
        {QStringLiteral("generation"), generation}, {QStringLiteral("columns"), QJsonArray{
            QJsonObject{{QStringLiteral("uuid"), A}}, QJsonObject{{QStringLiteral("uuid"), B}}}}};
}
static QString json(const QJsonObject &value) { return QString::fromUtf8(QJsonDocument(value).toJson(QJsonDocument::Compact)); }
static FocusRingCandidate eligible() {
    FocusRingCandidate window;
    window.id = A; window.output = QStringLiteral("eDP-1"); window.workspace = QStringLiteral("w");
    window.active = window.managed = window.normal = window.visible = window.onCurrentActivity = window.onCurrentDesktop = window.insideOutput = true;
    window.opacity = 1;
    return window;
}
int main() {
    FocusRingContext context;
    check(!context.permits(eligible()), "no context means no ring");
    check(context.update(json(snapshot())), "valid read-only membership");
    check(context.permits(eligible()), "actual active main managed window");
    check(context.update(json(snapshot())), "duplicate is idempotent");
    // Candidate policy never mutates membership and uses actual native focus,
    // rather than the persisted logical focusedUuid.
    for (bool FocusRingCandidate::*field : {&FocusRingCandidate::active, &FocusRingCandidate::managed,
            &FocusRingCandidate::normal, &FocusRingCandidate::visible, &FocusRingCandidate::onCurrentActivity, &FocusRingCandidate::onCurrentDesktop,
            &FocusRingCandidate::insideOutput}) {
        auto candidate = eligible(); candidate.*field = false;
        check(!context.permits(candidate), "missing positive eligibility");
    }
    for (bool FocusRingCandidate::*field : {&FocusRingCandidate::minimized, &FocusRingCandidate::deleted, &FocusRingCandidate::fullscreen}) {
        auto candidate = eligible(); candidate.*field = true;
        check(!context.permits(candidate), "hidden fullscreen or deleted");
    }
    auto candidate = eligible(); candidate.fullscreen = true;
    check(!context.permits(candidate), "fullscreen hides"); candidate.fullscreen = false;
    check(context.permits(candidate), "fullscreen exit restores without a new membership message");
    candidate.output = QStringLiteral("DP-1"); check(!context.permits(candidate), "secondary output");
    candidate = eligible(); candidate.workspace = QStringLiteral("other"); check(!context.permits(candidate), "old workspace during J/K");
    candidate = eligible(); candidate.id = QStringLiteral("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    check(!context.permits(candidate), "dialog floating or nonmember");
    for (double opacity : {0.0, -1.0, std::nan(""), static_cast<double>(INFINITY)}) {
        candidate = eligible(); candidate.opacity = opacity; check(!context.permits(candidate), "opacity hidden or nonfinite");
    }
    auto fresh = snapshot(3); fresh.insert(QStringLiteral("columns"), QJsonArray{QJsonObject{{QStringLiteral("uuid"), B}}});
    check(context.update(json(fresh)), "new membership");
    check(!context.permits(eligible()), "removed/parked-floating owner cannot retain a ring");
    check(!context.update(json(snapshot(2))) && !context.permits(eligible()), "late snapshot cannot resurrect removed owner");
    check(!context.update(json(snapshot(3))) && !context.permits(eligible()), "conflicting same generation cannot replace authority");
    auto empty = snapshot(4); empty.insert(QStringLiteral("columns"), QJsonArray());
    check(context.update(json(empty)) && context.windows.isEmpty(), "empty workspace is valid");
    auto next = snapshot(0); next.insert(QStringLiteral("sessionId"), QStringLiteral("reloaded"));
    check(context.update(json(next)) && context.permits(eligible()), "reload starts a new session");
    // Invalid snapshots fail closed, including duplicate normalized UUIDs.
    for (const auto &key : {QStringLiteral("sessionId"), QStringLiteral("workspaceId"), QStringLiteral("targetOutput"), QStringLiteral("columns")}) {
        check(context.update(json(next)), "restore valid context before rejection");
        auto broken = next; broken.remove(key); check(!context.update(json(broken)) && context.windows.isEmpty(), "missing required metadata");
    }
    auto broken = next; broken.insert(QStringLiteral("generation"), 0.5);
    check(!context.update(json(broken)), "fractional generation");
    broken = next; broken.insert(QStringLiteral("columns"), QJsonArray{QJsonObject{{QStringLiteral("uuid"), A}},
        QJsonObject{{QStringLiteral("uuid"), QString(QStringLiteral("{") + A.toUpper() + QStringLiteral("}"))}}});
    check(!context.update(json(broken)), "canonical UUID deduplication");
    broken = next; broken.insert(QStringLiteral("columns"), QJsonArray{QJsonObject{{QStringLiteral("uuid"), QStringLiteral("not-a-uuid")}}});
    check(!context.update(json(broken)), "invalid window UUID");
    check(!context.update(QString(256 * 1024 + 1, QLatin1Char('x'))), "bounded message size");
    check(!context.update(QStringLiteral("[]")), "object required");
    check(context.update(json(next)), "restore before explicit shutdown");context.clear();
    check(!context.permits(eligible()), "Bridge loss or shutdown clears authority");
    std::cout << "PASS focus-ring context and visibility policy\n";
}
