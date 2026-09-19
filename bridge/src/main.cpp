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
