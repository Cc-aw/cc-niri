#include "ScrollDockBridge.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>
#include <QTimer>
#include <QDateTime>
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
    return RequestCommand(json);
}

bool ScrollDockBridge::RequestCommand(const QString &json)
{
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        qCWarning(logBridge) << "rejecting invalid command JSON" << error.errorString();
        return false;
    }

    const QJsonObject command = document.object();
    const QString commandId = command.value(QStringLiteral("commandId")).toString();
    const QString type = command.value(QStringLiteral("type")).toString();
    const bool reorder = type == QStringLiteral("set-column-order") &&
        command.value(QStringLiteral("order")).isArray();
    const QString presentationMode = command.value(QStringLiteral("mode")).toString();
    const bool presentation = type == QStringLiteral("set-presentation-mode") &&
        !command.value(QStringLiteral("windowUuid")).toString().isEmpty() &&
        (presentationMode == QStringLiteral("normal") ||
         presentationMode == QStringLiteral("wide") ||
         presentationMode == QStringLiteral("maximized"));
    const bool dockFocusRight = type == QStringLiteral("focus-column-right") &&
        !command.value(QStringLiteral("windowUuid")).toString().isEmpty();
    const bool emergencyRestore = type == QStringLiteral("emergency-restore");
    const bool deferredWide =
        (type == QStringLiteral("settle-wide-transition") ||
         type == QStringLiteral("check-wide-transition") ||
         type == QStringLiteral("finalize-wide-transition") ||
         type == QStringLiteral("complete-wide-transition")) &&
        !command.value(QStringLiteral("windowUuid")).toString().isEmpty() &&
        !command.value(QStringLiteral("transitionToken")).toString().isEmpty();
    if (command.value(QStringLiteral("protocol")).toInt() != 1 ||
        commandId.isEmpty() ||
        command.value(QStringLiteral("sessionId")).toString().isEmpty() ||
        command.value(QStringLiteral("baseGeneration")).toInteger(-1) < 0 ||
        (!reorder && !presentation && !dockFocusRight && !emergencyRestore &&
         !deferredWide)) {
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

bool ScrollDockBridge::RequestDeferredCommand(const QString &json, int delayMs)
{
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        qCWarning(logBridge) << "rejecting invalid deferred command JSON"
                             << error.errorString();
        return false;
    }

    const QJsonObject command = document.object();
    const QString sessionId = command.value(QStringLiteral("sessionId")).toString();
    const qint64 generation =
        command.value(QStringLiteral("baseGeneration")).toInteger(-1);
    const QString type = command.value(QStringLiteral("type")).toString();
    const bool deferredWide = type == QStringLiteral("settle-wide-transition") ||
        type == QStringLiteral("check-wide-transition") ||
        type == QStringLiteral("finalize-wide-transition") ||
        type == QStringLiteral("complete-wide-transition");
    if (command.value(QStringLiteral("protocol")).toInt() != 1 ||
        !deferredWide ||
        command.value(QStringLiteral("commandId")).toString().isEmpty() ||
        sessionId.isEmpty() || sessionId != m_sessionId || generation < 0 ||
        command.value(QStringLiteral("windowUuid")).toString().isEmpty() ||
        command.value(QStringLiteral("transitionToken")).toString().isEmpty()) {
        qCWarning(logBridge) << "rejecting deferred command with invalid schema";
        return false;
    }

    const int boundedDelayMs = qBound(16, delayMs, 1000);
    QTimer::singleShot(boundedDelayMs, this,
        [this, json, sessionId, generation]() {
            /* A newer state means that focus or presentation changed while the
             * reveal was rendering. Do not let the stale timer change it. */
            if (m_sessionId != sessionId || m_generation != generation) return;
            RequestCommand(json);
        });
    return true;
}

bool ScrollDockBridge::RequestEmergencyRestore()
{
    if (m_sessionId.isEmpty() || m_generation < 0) {
        qCWarning(logBridge) << "cannot request emergency restore without KWin state";
        return false;
    }

    QJsonObject command{
        {QStringLiteral("protocol"), 1},
        {QStringLiteral("commandId"), QStringLiteral("emergency-") +
            QString::number(QDateTime::currentMSecsSinceEpoch())},
        {QStringLiteral("sessionId"), m_sessionId},
        {QStringLiteral("baseGeneration"), m_generation},
        {QStringLiteral("type"), QStringLiteral("emergency-restore")},
    };
    return RequestCommand(QString::fromUtf8(
        QJsonDocument(command).toJson(QJsonDocument::Compact)));
}

QString ScrollDockBridge::TakePendingCommand()
{
    const QString command = m_pendingCommand;
    m_pendingCommand.clear();
    return command;
}
