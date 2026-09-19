#include "ScrollDockBridge.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>

Q_LOGGING_CATEGORY(logBridge, "cc.scroll.dock.bridge")

ScrollDockBridge::ScrollDockBridge(QObject *parent)
    : QObject(parent)
{
}

namespace
{
void wakeKWinCommandPump()
{
    QDBusMessage message = QDBusMessage::createMethodCall(
        QStringLiteral("org.kde.kglobalaccel"),
        QStringLiteral("/component/kwin"),
        QStringLiteral("org.kde.kglobalaccel.Component"),
        QStringLiteral("invokeShortcut"));
    message << QStringLiteral("CCScrollApplyDockCommand");
    QDBusConnection::sessionBus().asyncCall(message);
}
}

bool ScrollDockBridge::PublishState(const QString &json)
{
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        qCWarning(logBridge) << "rejecting invalid state JSON" << error.errorString();
        return false;
    }

    const QJsonObject state = document.object();
    const QString sessionId = state.value(QStringLiteral("sessionId")).toString();
    const qint64 generation = state.value(QStringLiteral("generation")).toInteger(-1);
    if (state.value(QStringLiteral("protocol")).toInt() != 1 ||
        sessionId.isEmpty() || generation < 0 ||
        !state.value(QStringLiteral("columns")).isArray()) {
        qCWarning(logBridge) << "rejecting state with invalid schema";
        return false;
    }

    if (!m_sessionId.isEmpty() && sessionId == m_sessionId && generation < m_generation) {
        qCWarning(logBridge) << "rejecting regressed generation" << generation << m_generation;
        return false;
    }

    if (sessionId != m_sessionId) {
        qCInfo(logBridge) << "new KWin session" << sessionId;
        m_pendingCommand.clear();
        m_lastCommandId.clear();
    }
    m_sessionId = sessionId;
    m_generation = generation;
    m_lastState = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
    Q_EMIT StateChanged(m_lastState);
    return true;
}

QString ScrollDockBridge::GetState() const
{
    return m_lastState;
}

bool ScrollDockBridge::RequestReorder(const QString &json)
{
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        qCWarning(logBridge) << "rejecting invalid command JSON" << error.errorString();
        return false;
    }

    const QJsonObject command = document.object();
    const QString commandId = command.value(QStringLiteral("commandId")).toString();
    if (command.value(QStringLiteral("protocol")).toInt() != 1 ||
        commandId.isEmpty() ||
        command.value(QStringLiteral("sessionId")).toString().isEmpty() ||
        command.value(QStringLiteral("baseGeneration")).toInteger(-1) < 0 ||
        command.value(QStringLiteral("type")).toString() != QStringLiteral("set-column-order") ||
        !command.value(QStringLiteral("order")).isArray()) {
        qCWarning(logBridge) << "rejecting command with invalid schema";
        return false;
    }

    if (commandId == m_lastCommandId) {
        return true;
    }
    m_lastCommandId = commandId;
    m_pendingCommand = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
    wakeKWinCommandPump();
    return true;
}

QString ScrollDockBridge::TakePendingCommand()
{
    const QString command = m_pendingCommand;
    m_pendingCommand.clear();
    return command;
}
