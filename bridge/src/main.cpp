#include "CCNiriBridge.h"
#include "LegacyScrollDockAdaptor.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QLoggingCategory>

namespace
{
constexpr auto Service = "org.cc.CCNiriBridge";
constexpr auto ObjectPath = "/CCNiriBridge";
constexpr auto Interface = "org.cc.CCNiriBridge1";
constexpr auto LegacyService = "org.cc.ScrollDockBridge";
constexpr auto LegacyObjectPath = "/ScrollDock";
constexpr auto LegacyInterface = "org.cc.ScrollDockBridge1";

bool unavailable(const QDBusMessage &reply)
{
    return reply.type() == QDBusMessage::ErrorMessage &&
        (reply.errorName() == QStringLiteral("org.freedesktop.DBus.Error.ServiceUnknown") ||
         reply.errorName() == QStringLiteral("org.freedesktop.DBus.Error.NameHasNoOwner"));
}

void requestFreshKWinState()
{
    QDBusMessage message = QDBusMessage::createMethodCall(
        QStringLiteral("org.kde.kglobalaccel"),
        QStringLiteral("/component/kwin"),
        QStringLiteral("org.kde.kglobalaccel.Component"),
        QStringLiteral("invokeShortcut"));
    message << QStringLiteral("CCScrollPublishRuntimeState");
    QDBusConnection::sessionBus().asyncCall(message);
}
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("cc-niri-bridge"));

    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected()) {
        qCritical() << "session D-Bus is unavailable";
        return 1;
    }

    CCNiriBridge bridge;
    if (app.arguments().contains(QStringLiteral("--save-current-state"))) {
        const QDBusMessage request = QDBusMessage::createMethodCall(
            QString::fromLatin1(Service), QString::fromLatin1(ObjectPath),
            QString::fromLatin1(Interface), QStringLiteral("GetState"));
        QDBusMessage reply = bus.call(request);
        if (unavailable(reply)) {
            // Read the live pre-P8 process before stopping it during an upgrade.
            reply = bus.call(QDBusMessage::createMethodCall(
                QString::fromLatin1(LegacyService), QString::fromLatin1(LegacyObjectPath),
                QString::fromLatin1(LegacyInterface), QStringLiteral("GetState")));
        }
        if (reply.type() == QDBusMessage::ErrorMessage) {
            if (unavailable(reply)) return 0;
            qCritical() << "cannot preserve previous Bridge state" << reply.errorMessage();
            return 4;
        }
        const QString previous = reply.arguments().value(0).toString();
        return previous.isEmpty() || (bridge.PublishState(previous) && bridge.lastSaveSucceeded()) ? 0 : 5;
    }
    new LegacyScrollDockAdaptor(&bridge);
    if (!bus.registerObject(
            QString::fromLatin1(ObjectPath),
            &bridge,
            QDBusConnection::ExportAllSlots | QDBusConnection::ExportAllSignals)) {
        qCritical() << "failed to register object" << bus.lastError();
        return 2;
    }
    if (!bus.registerObject(QString::fromLatin1(LegacyObjectPath), &bridge,
            QDBusConnection::ExportAdaptors)) {
        qCritical() << "failed to register compatibility object" << bus.lastError();
        return 2;
    }
    if (!bus.registerService(QString::fromLatin1(Service))) {
        qCritical() << "failed to register service" << bus.lastError();
        return 3;
    }
    if (!bus.registerService(QString::fromLatin1(LegacyService))) {
        qCritical() << "failed to register compatibility service; another Bridge is running" << bus.lastError();
        return 3;
    }

    requestFreshKWinState();
    return app.exec();
}
