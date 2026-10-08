/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "CCNiriBridge.h"
#include <QCoreApplication>
#include <QTemporaryDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#define CHECK(condition) do { if (!(condition)) qFatal("scroll plan failed at line %d: %s", __LINE__, #condition); } while (false)
static QString json(const QJsonObject &value) { return QString::fromUtf8(QJsonDocument(value).toJson(QJsonDocument::Compact)); }
static QJsonObject entry(const QString &id, int column, double x, const QString &oldPlace, const QString &newPlace)
{
    return {{"windowId", id}, {"columnId", column}, {"logicalX", x}, {"pixelWidth", 1252.0},
            {"oldPlacement", oldPlace}, {"newPlacement", newPlace}};
}
int main(int argc, char **argv)
{
    qputenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent-cc-niri-scroll-test");
    QCoreApplication app(argc, argv);
    QTemporaryDir dir;
    CCNiriBridge bridge(nullptr, dir.filePath("state.json"));
    const QJsonArray columns{QJsonObject{{"uuid", "a"}}, QJsonObject{{"uuid", "b"}}, QJsonObject{{"uuid", "c"}}};
    QJsonObject state{{"protocol", 2}, {"sessionId", "live"}, {"generation", 0}, {"workspaceId", "desktop-a"},
        {"targetOutput", "eDP-1"}, {"columns", columns}, {"workspaces", QJsonArray{QJsonObject{{"id", "desktop-a"}, {"columns", columns}}}}};
    QJsonObject plan{{"protocol", 2}, {"type", "SCROLL"}, {"sessionId", "live"}, {"workspaceId", "desktop-a"},
        {"targetOutput", "eDP-1"}, {"epoch", 10}, {"issuedAt", 1000}, {"oldScrollOffsetX", 0.0}, {"newScrollOffsetX", 1260.0},
        {"viewport", QJsonObject{{"x", 24}, {"y", 50}, {"width", 2512}, {"height", 1320}}},
        {"entries", QJsonArray{entry("a", 1, 0, "visible", "parked"), entry("b", 2, 1260, "visible", "visible"),
                              entry("c", 3, 2520, "parked", "visible")}}};
    int emitted = 0;
    QJsonObject received;
    QObject::connect(&bridge, &CCNiriBridge::MotionPlanChanged, [&](const QString &value) {
        ++emitted;
        received = QJsonDocument::fromJson(value.toUtf8()).object();
    });
    CHECK(!bridge.PublishMotionPlan(json(plan))); // No live state, including cached sessions.
    CHECK(bridge.PublishState(json(state)));
    CHECK(bridge.PublishMotionPlan(json(plan)));
    CHECK(emitted == 1 && received == plan);
    CHECK(bridge.PublishMotionPlan(json(plan)) && emitted == 1); // Idempotent, no duplicate signal.

    auto rejected = [&](QJsonObject invalid, bool advanceCandidate = true) {
        if (advanceCandidate && invalid["epoch"] == plan["epoch"]) invalid["epoch"] = 1000;
        const int before = emitted;
        CHECK(!bridge.PublishMotionPlan(json(invalid)));
        CHECK(emitted == before);
    };
    for (const char *field : {"protocol", "epoch", "issuedAt", "oldScrollOffsetX", "newScrollOffsetX", "viewport", "entries", "workspaceId", "sessionId", "targetOutput"}) {
        auto invalid = plan; invalid.remove(field); rejected(invalid);
    }
    for (const char *field : {"epoch", "issuedAt", "oldScrollOffsetX", "newScrollOffsetX"}) {
        auto invalid = plan; invalid[field] = "123"; rejected(invalid);
    }
    auto invalid = plan; invalid["epoch"] = 10.5; rejected(invalid);
    invalid = plan; invalid["epoch"] = 9; rejected(invalid);
    invalid = plan; invalid["epoch"] = 9007199254740992.0; rejected(invalid);
    invalid = plan; invalid["newScrollOffsetX"] = 2520; rejected(invalid); // Placements do not match projection.
    invalid = plan; invalid["issuedAt"] = 1001; rejected(invalid, false); // Valid schema, same epoch conflict.
    invalid = plan; invalid["oldScrollOffsetX"] = -1; rejected(invalid);
    invalid = plan; invalid["newScrollOffsetX"] = 0; rejected(invalid); // No-op.
    invalid = plan; invalid["workspaceId"] = "desktop-b"; rejected(invalid);
    invalid = plan; invalid["targetOutput"] = "HDMI-A-1"; rejected(invalid);
    invalid = plan; invalid["sessionId"] = "previous"; rejected(invalid);
    invalid = plan; invalid["entries"] = QJsonArray{}; rejected(invalid);
    for (const char *field : {"windowId", "columnId", "logicalX", "pixelWidth", "oldPlacement", "newPlacement"}) {
        invalid = plan;
        auto first = plan["entries"].toArray().first().toObject(); first.remove(field);
        invalid["entries"] = QJsonArray{first}; rejected(invalid);
    }
    for (const auto &first : {entry("unknown", 1, 0, "visible", "parked"), entry("A", 1, 0, "visible", "parked"),
                             entry("a", 1, -1, "visible", "parked"), entry("a", 1, 0, "parked", "parked")}) {
        invalid = plan; invalid["entries"] = QJsonArray{first}; rejected(invalid);
    }
    invalid = plan; invalid["entries"] = QJsonArray{plan["entries"].toArray().first(), plan["entries"].toArray().first()}; rejected(invalid);
    auto second = entry("b", 1, 1260, "visible", "visible");
    invalid["entries"] = QJsonArray{plan["entries"].toArray().first(), second}; rejected(invalid); // Duplicate column.
    invalid = plan; auto viewport = plan["viewport"].toObject(); viewport["width"] = 0; invalid["viewport"] = viewport; rejected(invalid);
    invalid = plan; invalid["padding"] = QString(CcNiri::MaxMotionPlanBytes, 'x'); rejected(invalid);
    CHECK(bridge.PublishMotionPlan(json(plan)) && emitted == 1); // Rejections did not advance sequence.

    // The native observer uses the same production sequence/authority class.
    CcNiri::ViewportScrollPlanSequence observer;
    CHECK(observer.observe(plan) == CcNiri::ScrollPlanDisposition::Rejected);
    CHECK(observer.updateContext(state));
    CHECK(observer.observe(plan) == CcNiri::ScrollPlanDisposition::Accepted);
    CHECK(observer.observe(plan) == CcNiri::ScrollPlanDisposition::Duplicate);
    auto reverse = plan; reverse["epoch"] = 11; reverse["oldScrollOffsetX"] = 1260; reverse["newScrollOffsetX"] = 0;
    reverse["entries"] = QJsonArray{entry("a", 1, 0, "parked", "visible"), entry("b", 2, 1260, "visible", "visible"), entry("c", 3, 2520, "visible", "parked")};
    CHECK(observer.observe(reverse) == CcNiri::ScrollPlanDisposition::Accepted);
    CHECK(observer.observe(plan) == CcNiri::ScrollPlanDisposition::Rejected);
    CHECK(bridge.PublishMotionPlan(json(reverse)) && emitted == 2);

    // Legacy Wide continues to use protocol 1 and two visual rectangles.
    const QJsonObject rect{{"x", 24}, {"y", 50}, {"width", 1252}, {"height", 1320}};
    const QJsonArray wideEntries{QJsonObject{{"windowId", "a"}, {"oldVisualRect", rect}, {"newVisualRect", rect}},
                                 QJsonObject{{"windowId", "b"}, {"oldVisualRect", rect}, {"newVisualRect", rect}}};
    const QJsonObject wide{{"protocol", 1}, {"sessionId", "live"}, {"epoch", 12}, {"issuedAt", 1001},
                          {"type", "PAIR_TO_WIDE"}, {"transitionToken", "wide-token"}, {"targetWindowUuid", "a"}, {"entries", wideEntries}};
    CHECK(bridge.PublishMotionPlan(json(wide)));
    auto next = plan; next["epoch"] = 13;
    CHECK(bridge.PublishMotionPlan(json(next)));
    CHECK(bridge.ReportMotionComplete(json(QJsonObject{{"type", "PAIR_TO_WIDE"}, {"sessionId", "live"},
         {"transitionToken", "wide-token"}, {"targetWindowUuid", "a"}}))); // SCROLL did not erase Wide token.

    const auto enteringCompletion = QJsonDocument::fromJson(bridge.TakePendingCommand().toUtf8()).object();
    CHECK(enteringCompletion.value("type") == QJsonValue("finalize-contextual-wide"));
    const QJsonObject exitCompletion{{"type", "WIDE_TO_PAIR"}, {"sessionId", "live"},
        {"transitionToken", "wide-token"}, {"targetWindowUuid", "a"}};
    CHECK(bridge.ReportMotionComplete(json(exitCompletion)));
    const auto exitingCompletion = QJsonDocument::fromJson(bridge.TakePendingCommand().toUtf8()).object();
    CHECK(exitingCompletion.value("type") == QJsonValue("finalize-contextual-wide-exit"));
    CHECK(exitingCompletion.value("motionCompleted").toBool());
    CHECK(exitingCompletion.value("commandId") != enteringCompletion.value("commandId"));
    CHECK(bridge.ReportMotionComplete(json(exitCompletion)) && bridge.TakePendingCommand().isEmpty());

    CHECK(bridge.ReportMotionParked(json(QJsonObject{{"type", "PAIR_TO_WIDE"}, {"sessionId", "live"}, {"transitionToken", "wide-token"}, {"targetWindowUuid", "a"}})));

    // Full can animate a solo target through the same protocol-1 endpoint.
    auto solo = wide;
    auto soloEntry = wideEntries.first().toObject();
    soloEntry["role"] = "target";
    solo["entries"] = QJsonArray{soloEntry};
    CHECK(bridge.PublishMotionPlan(json(solo)) && received == solo);
    soloEntry["role"] = "neighbor";
    solo["entries"] = QJsonArray{soloEntry};
    rejected(solo, false);
    solo["entries"] = QJsonArray{}; rejected(solo, false);
    solo["entries"] = QJsonArray{soloEntry, soloEntry, soloEntry}; rejected(solo, false);

    // Switching desktops keeps the epoch barrier and changes authority.
    state["generation"] = 1; state["workspaceId"] = "desktop-b";
    state["workspaces"] = QJsonArray{QJsonObject{{"id", "desktop-b"}, {"columns", columns}}};
    CHECK(bridge.PublishState(json(state)));
    rejected(next);
    next["workspaceId"] = "desktop-b"; next["epoch"] = 14;
    CHECK(bridge.PublishMotionPlan(json(next)));
    CHECK(observer.updateContext(state));
    CHECK(observer.observe(next) == CcNiri::ScrollPlanDisposition::Accepted);
    auto returning = next;
    returning["epoch"] = 15; returning["newScrollOffsetX"] = 0;
    returning["entries"] = QJsonArray{entry("a", 1, 0, "visible", "visible"), entry("b", 2, 1260, "visible", "visible")};
    rejected(returning); // Equal offsets require an explicit native return plan.
    returning["retargetOnly"] = true;
    CHECK(bridge.PublishMotionPlan(json(returning)));
    const int returnSignals = emitted;
    CHECK(bridge.PublishMotionPlan(json(returning)) && emitted == returnSignals);
    CHECK(observer.observe(returning) == CcNiri::ScrollPlanDisposition::Accepted);
    auto malformedReturn = returning; malformedReturn["epoch"] = 16; malformedReturn["retargetOnly"] = "true"; rejected(malformedReturn);
    malformedReturn = next; malformedReturn["epoch"] = 16; malformedReturn["retargetOnly"] = true; rejected(malformedReturn);
    malformedReturn = returning; malformedReturn["epoch"] = 16; malformedReturn["retargetOnly"] = false; rejected(malformedReturn);
    CHECK(observer.observe(next) == CcNiri::ScrollPlanDisposition::Rejected);
    state["generation"] = 0;
    CHECK(!observer.updateContext(state));
    state["generation"] = 2; state["sessionId"] = "reload";
    CHECK(bridge.PublishState(json(state)));
    rejected(next);
    next["sessionId"] = "reload"; next["epoch"] = 0;
    CHECK(bridge.PublishMotionPlan(json(next)));
    // Dock State accepts legacy metadata sizes; stricter motion metadata must
    // fail closed rather than leave the previous session as live authority.
    state["sessionId"] = QString(300, 'x');
    CHECK(bridge.PublishState(json(state)));
    rejected(next);
    next["sessionId"] = state["sessionId"];
    rejected(next);
    qInfo("PASS SCROLL protocol, ownership, sessions, epochs, observer and legacy Wide isolation");
}
