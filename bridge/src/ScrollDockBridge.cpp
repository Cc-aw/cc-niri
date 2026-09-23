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
constexpr qsizetype MaxPendingCommands = 64;
constexpr qsizetype MaxRecentCommandIds = 128;

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
        m_pendingCommands.clear();
        m_recentCommandIds.clear();
        m_recentCommandOrder.clear();
        m_lastMotionToken.clear();
        m_lastMotionTarget.clear();
    }
    m_sessionId = sessionId;
    m_generation = generation;
    m_lastState = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
    Q_EMIT StateChanged(m_lastState);
    return true;
}

bool ScrollDockBridge::PublishMotionPlan(const QString &json)
{
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        qCWarning(logBridge) << "rejecting invalid motion plan JSON";
        return false;
    }
    const QJsonObject plan = document.object();
    const QString type = plan.value(QStringLiteral("type")).toString();
    const QJsonArray entries = plan.value(QStringLiteral("entries")).toArray();
    if (plan.value(QStringLiteral("protocol")).toInt() != 1 ||
            plan.value(QStringLiteral("sessionId")).toString() != m_sessionId ||
            m_sessionId.isEmpty() ||
            plan.value(QStringLiteral("epoch")).toInteger(-1) < 0 ||
            plan.value(QStringLiteral("issuedAt")).toInteger(-1) < 0 ||
            (type != QStringLiteral("WIDE_TO_PAIR") &&
             type != QStringLiteral("PAIR_TO_WIDE")) ||
            entries.size() != 2) {
        qCWarning(logBridge) << "rejecting motion plan schema";
        return false;
    }
    for (const QJsonValue &value : entries) {
        const QJsonObject entry = value.toObject();
        if (entry.value(QStringLiteral("windowId")).toString().isEmpty() ||
                !entry.value(QStringLiteral("oldVisualRect")).isObject() ||
                !entry.value(QStringLiteral("newVisualRect")).isObject()) {
            qCWarning(logBridge) << "rejecting motion plan entry";
            return false;
        }
    }
    m_lastMotionToken = type == QStringLiteral("PAIR_TO_WIDE")
        ? plan.value(QStringLiteral("transitionToken")).toString() : QString();
    m_lastMotionTarget = type == QStringLiteral("PAIR_TO_WIDE")
        ? plan.value(QStringLiteral("targetWindowUuid")).toString() : QString();
    Q_EMIT MotionPlanChanged(QString::fromUtf8(
        document.toJson(QJsonDocument::Compact)));
    return true;
}

bool ScrollDockBridge::ReportMotionComplete(const QString &json)
{
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return false;
    const QJsonObject completion = document.object();
    const QString token = completion.value(QStringLiteral("transitionToken"))
        .toString();
    const QString target = completion.value(QStringLiteral("targetWindowUuid"))
        .toString();
    if (completion.value(QStringLiteral("sessionId")).toString() != m_sessionId ||
            m_sessionId.isEmpty() || token.isEmpty() || target.isEmpty() ||
            completion.value(QStringLiteral("type")).toString() !=
                QStringLiteral("PAIR_TO_WIDE")) {
        return false;
    }
    const QJsonObject command{
        {QStringLiteral("protocol"), 1},
        {QStringLiteral("commandId"), m_sessionId +
            QStringLiteral("-wide-motion-complete-") + token},
        {QStringLiteral("sessionId"), m_sessionId},
        {QStringLiteral("baseGeneration"), m_generation},
        {QStringLiteral("type"), QStringLiteral("finalize-contextual-wide")},
        {QStringLiteral("transitionToken"), token},
        {QStringLiteral("windowUuid"), target},
        {QStringLiteral("motionCompleted"), true},
    };
    return RequestCommand(QString::fromUtf8(
        QJsonDocument(command).toJson(QJsonDocument::Compact)));
}

bool ScrollDockBridge::ReportMotionParked(const QString &json)
{
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return false;
    const QJsonObject parked = document.object();
    if (parked.value(QStringLiteral("sessionId")).toString() != m_sessionId ||
            m_sessionId.isEmpty() || m_lastMotionToken.isEmpty() ||
            parked.value(QStringLiteral("transitionToken")).toString() !=
                m_lastMotionToken ||
            parked.value(QStringLiteral("targetWindowUuid")).toString() !=
                m_lastMotionTarget ||
            parked.value(QStringLiteral("type")).toString() !=
                QStringLiteral("PAIR_TO_WIDE")) {
        return false;
    }
    m_lastMotionToken.clear();
    m_lastMotionTarget.clear();
    Q_EMIT MotionParked(QString::fromUtf8(
        document.toJson(QJsonDocument::Compact)));
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
    const bool deferredDockScroll = type == QStringLiteral("advance-dock-scroll") &&
        !command.value(QStringLiteral("windowUuid")).toString().isEmpty() &&
        !command.value(QStringLiteral("transitionToken")).toString().isEmpty();
    const bool deferredContextualWide =
        (type == QStringLiteral("finalize-contextual-wide") ||
         type == QStringLiteral("finalize-contextual-wide-exit")) &&
        !command.value(QStringLiteral("windowUuid")).toString().isEmpty() &&
        !command.value(QStringLiteral("transitionToken")).toString().isEmpty();
    if (command.value(QStringLiteral("protocol")).toInt() != 1 ||
        commandId.isEmpty() ||
        command.value(QStringLiteral("sessionId")).toString().isEmpty() ||
        command.value(QStringLiteral("baseGeneration")).toInteger(-1) < 0 ||
        (!reorder && !presentation && !dockFocusRight && !emergencyRestore &&
         !deferredDockScroll && !deferredContextualWide)) {
        qCWarning(logBridge) << "rejecting command with invalid schema";
        return false;
    }

    if (m_recentCommandIds.contains(commandId)) {
        return true;
    }
    if (m_pendingCommands.size() >= MaxPendingCommands && !emergencyRestore) {
        qCWarning(logBridge) << "rejecting command because queue is full";
        return false;
    }

    m_recentCommandIds.insert(commandId);
    m_recentCommandOrder.enqueue(commandId);
    while (m_recentCommandOrder.size() > MaxRecentCommandIds) {
        m_recentCommandIds.remove(m_recentCommandOrder.dequeue());
    }

    const QString compact =
        QString::fromUtf8(document.toJson(QJsonDocument::Compact));
    if (emergencyRestore) m_pendingCommands.prepend(compact);
    else m_pendingCommands.enqueue(compact);
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
    const bool deferredDockScroll = type == QStringLiteral("advance-dock-scroll");
    const bool deferredContextualWide =
        type == QStringLiteral("finalize-contextual-wide") ||
        type == QStringLiteral("finalize-contextual-wide-exit");
    if (command.value(QStringLiteral("protocol")).toInt() != 1 ||
        (!deferredDockScroll && !deferredContextualWide) ||
        command.value(QStringLiteral("commandId")).toString().isEmpty() ||
        sessionId.isEmpty() || sessionId != m_sessionId || generation < 0 ||
        command.value(QStringLiteral("windowUuid")).toString().isEmpty() ||
        command.value(QStringLiteral("transitionToken")).toString().isEmpty()) {
        qCWarning(logBridge) << "rejecting deferred command with invalid schema";
        return false;
    }

    const int boundedDelayMs = qBound(16, delayMs, 1000);
    QTimer::singleShot(boundedDelayMs, this,
        [this, json, sessionId, generation, deferredContextualWide]() {
            /* A newer state means that focus or presentation changed while the
             * reveal was rendering. Do not let the stale timer change it. */
            if (m_sessionId != sessionId ||
                    (!deferredContextualWide && m_generation != generation)) return;
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
    if (m_pendingCommands.isEmpty()) return {};
    const QString command = m_pendingCommands.dequeue();
    if (!m_pendingCommands.isEmpty()) {
        QTimer::singleShot(0, this, wakeKWinCommandPump);
    }
    return command;
}
