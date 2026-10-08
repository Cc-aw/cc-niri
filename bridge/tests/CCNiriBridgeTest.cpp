#include "CCNiriBridge.h"
#include <QCoreApplication>
#include <QTemporaryDir>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QFile>
#include <QDir>
#define CHECK(condition) do { if (!(condition)) qFatal("check failed at line %d: %s", __LINE__, #condition); } while (false)
static QString json(const QJsonObject &value) { return QString::fromUtf8(QJsonDocument(value).toJson(QJsonDocument::Compact)); }
int main(int argc, char **argv) {
    // Direct object tests must never wake the real desktop command pump.
    qputenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent-cc-niri-test-bus");
    QCoreApplication app(argc, argv); QTemporaryDir directory; CHECK(directory.isValid());
    const QString cache = directory.filePath("state/workspaces.json");
    const QJsonArray active{QJsonObject{{"uuid", "b1"}, {"widthMode", "half"}}};
    const QJsonObject a{{"id", "A"}, {"columns", QJsonArray{QJsonObject{{"uuid", "a2"}, {"widthMode", "third"}, {"persistentWide", true}}, QJsonObject{{"uuid", "a1"}}}},
        {"focusedUuid", "a2"}, {"viewportAnchor", QJsonObject{{"uuid", "a1"}, {"delta", 40}}}};
    const QJsonObject b{{"id", "B"}, {"columns", active}};
    QJsonObject state{{"protocol", 2}, {"sessionId", "old"}, {"generation", 10}, {"targetOutput", "eDP-1"},
        {"workspaceId", "B"}, {"columns", active}, {"workspaces", QJsonArray{a, b}}};
    {
        CCNiriBridge bridge(nullptr, cache); CHECK(bridge.GetState().isEmpty());
        CHECK(bridge.PublishState(json(state))); CHECK(bridge.lastSaveSucceeded()); CHECK(QFile::exists(cache));
        const QString previous = bridge.GetState();
        for (const QJsonArray &workspaces : {QJsonArray{a, a, b}, QJsonArray{a},
            QJsonArray{a, QJsonObject{{"id", "B"}, {"columns", QJsonArray{QJsonObject{{"uuid", "{A2}"}}}}}}}) {
            auto invalid = state; invalid["workspaces"] = workspaces;
            CHECK(!bridge.PublishState(json(invalid))); CHECK(bridge.GetState() == previous);
        }
        auto regressed = state; regressed["generation"] = 9;
        CHECK(!bridge.PublishState(json(regressed)));
        CHECK(bridge.RequestCommand(json(QJsonObject{{"protocol", 1}, {"sessionId", "old"}, {"baseGeneration", 10}, {"commandId", "focus"}, {"type", "focus-column-right"}, {"windowUuid", "b1"}})));
        CHECK(QJsonDocument::fromJson(bridge.TakePendingCommand().toUtf8()).object()["protocol"].toInt() == 1);
    }
    {
        CCNiriBridge restarted(nullptr, cache);
        CHECK(QJsonDocument::fromJson(restarted.GetState().toUtf8()).object()["workspaces"].toArray().size() == 2);
        CHECK(!restarted.RequestEmergencyRestore()); // Cached data is not a live KWin session.
        state["sessionId"] = "new"; state["generation"] = 1;
        CHECK(restarted.PublishState(json(state))); CHECK(restarted.RequestEmergencyRestore());
        CHECK(QJsonDocument::fromJson(restarted.TakePendingCommand().toUtf8()).object()["protocol"].toInt() == 1);
    }
    {
        QFile file(cache); CHECK(file.open(QIODevice::WriteOnly)); file.write("broken"); file.close();
        CCNiriBridge broken(nullptr, cache); CHECK(broken.GetState().isEmpty());
        QJsonObject legacy{{"protocol", 1}, {"sessionId", "legacy"}, {"generation", 1}, {"columns", active}};
        CHECK(broken.PublishState(json(legacy))); CHECK(!broken.GetState().isEmpty());
    }
    {
        const QString fullCache = directory.filePath("full/workspaces.json");
        auto fullState = state;
        const QJsonArray fullColumns{QJsonObject{{"uuid", "b1"}, {"widthMode", "full"},
            {"previousNonFullWidthMode", "twoThirds"}, {"persistentWide", true}}};
        fullState["columns"] = fullColumns;
        fullState["workspaces"] = QJsonArray{a, QJsonObject{{"id", "B"}, {"columns", fullColumns}}};
        {
            CCNiriBridge full(nullptr, fullCache);
            CHECK(full.PublishState(json(fullState))); CHECK(full.lastSaveSucceeded());
            QFile saved(fullCache); CHECK(saved.open(QIODevice::ReadOnly));
            CHECK(QJsonDocument::fromJson(saved.readAll()).object() == fullState);
            auto mismatch = fullState; mismatch["columns"] = active;
            CHECK(!full.PublishState(json(mismatch)));
            CHECK(QJsonDocument::fromJson(full.GetState().toUtf8()).object() == fullState);
        }
        CCNiriBridge fullRestarted(nullptr, fullCache);
        CHECK(QJsonDocument::fromJson(fullRestarted.GetState().toUtf8()).object() == fullState);
        CHECK(!fullRestarted.RequestEmergencyRestore());
    }
    {
        // Persistence failure must not freeze live Dock updates.
        CCNiriBridge unwritable(nullptr, directory.path());
        CHECK(unwritable.PublishState(json(state))); CHECK(!unwritable.lastSaveSucceeded()); CHECK(!unwritable.GetState().isEmpty());
    }
    qInfo("PASS native Bridge protocol 2 validation, disk restart, corruption and protocol 1 commands");
}
