#include "ScrollDockBridge.h"

#include <QCoreApplication>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QLoggingCategory>

namespace
{
constexpr auto Service = "org.cc.ScrollDockBridge";
constexpr auto ObjectPath = "/ScrollDock";

void requestFreshKWinState()
{
    QDBusMessage message = QDBusMessage::createMethodCall(
        QStringLiteral("org.kde.kglobalaccel"),
        QStringLiteral("/component/kwin"),
        QStringLiteral("org.kde.kglobalaccel.Component"),
        QStringLiteral("invokeShortcut"));
    message << QStringLiteral("CCScrollPublishDockState");
    QDBusConnection::sessionBus().asyncCall(message);
}
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QCoreApplication::setApplicationName(QStringLiteral("cc-scroll-dock-bridge"));

    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected()) {
        qCritical() << "session D-Bus is unavailable";
        return 1;
    }

    ScrollDockBridge bridge;
    if (app.arguments().contains(QStringLiteral("--save-current-state"))) {
        const QDBusMessage request = QDBusMessage::createMethodCall(
            QString::fromLatin1(Service), QString::fromLatin1(ObjectPath),
            QStringLiteral("org.cc.ScrollDockBridge1"), QStringLiteral("GetState"));
        const QDBusMessage reply = bus.call(request);
        if (reply.type() == QDBusMessage::ErrorMessage) {
            if (reply.errorName() == QStringLiteral("org.freedesktop.DBus.Error.ServiceUnknown") ||
                reply.errorName() == QStringLiteral("org.freedesktop.DBus.Error.NameHasNoOwner")) return 0;
            qCritical() << "cannot preserve previous Bridge state" << reply.errorMessage();
            return 4;
        }
        const QString previous = reply.arguments().value(0).toString();
        return previous.isEmpty() || (bridge.PublishState(previous) && bridge.lastSaveSucceeded()) ? 0 : 5;
    }
    if (!bus.registerObject(
            QString::fromLatin1(ObjectPath),
            &bridge,
            QDBusConnection::ExportAllSlots | QDBusConnection::ExportAllSignals)) {
        qCritical() << "failed to register object" << bus.lastError();
        return 2;
    }
    if (!bus.registerService(QString::fromLatin1(Service))) {
        qCritical() << "failed to register service" << bus.lastError();
        return 3;
    }

    requestFreshKWinState();
    return app.exec();
}
