#include "ScrollDockBridge.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QStandardPaths>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLoggingCategory>
#include <QTimer>
#include <QDateTime>
#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusVariant>

Q_LOGGING_CATEGORY(logBridge, "cc.scroll.dock.bridge")

namespace
{
constexpr qsizetype MaxPendingCommands = 64;
constexpr qsizetype MaxRecentCommandIds = 128;

constexpr qint64 MaxStateBytes = 1024 * 1024;

QString normalizedUuid(const QJsonValue &value)
{
    if (!value.isString()) return {};
    QString uuid = value.toString().trimmed().toLower();
    if (uuid.startsWith('{')) uuid.remove(0, 1);
    if (uuid.endsWith('}')) uuid.chop(1);
    return uuid;
}

bool validColumns(const QJsonValue &value, QStringList *order = nullptr, QSet<QString> *owners = nullptr)
{
    if (!value.isArray()) return false;
    QSet<QString> seen;
    for (const QJsonValue &column : value.toArray()) {
        if (!column.isObject()) return false;
        const QString uuid = normalizedUuid(column.toObject().value(QStringLiteral("uuid")));
        if (uuid.isEmpty() || seen.contains(uuid) || (owners && owners->contains(uuid))) return false;
        seen.insert(uuid);
        if (owners) owners->insert(uuid);
        if (order) order->append(uuid);
    }
    return true;
}

bool validState(const QJsonObject &state)
{
    const int protocol = state.value(QStringLiteral("protocol")).toInt();
    if ((protocol != 1 && protocol != 2) ||
        state.value(QStringLiteral("sessionId")).toString().isEmpty() ||
        state.value(QStringLiteral("generation")).toInteger(-1) < 0 ||
        !state.value(QStringLiteral("columns")).isArray()) return false;
    if (protocol == 1) return true;
    const QString activeId = state.value(QStringLiteral("workspaceId")).toString().trimmed();
    if (activeId.isEmpty() || state.value(QStringLiteral("targetOutput")).toString().isEmpty() ||
        !state.value(QStringLiteral("workspaces")).isArray()) return false;
    QStringList activeOrder, rootOrder;
    if (!validColumns(state.value(QStringLiteral("columns")), &rootOrder)) return false;
    QSet<QString> ids, owners;
    QJsonArray activeColumns;
    for (const QJsonValue &value : state.value(QStringLiteral("workspaces")).toArray()) {
        if (!value.isObject()) return false;
        const QJsonObject workspace = value.toObject();
        const QString id = workspace.value(QStringLiteral("id")).toString().trimmed();
        QStringList order;
        if (id.isEmpty() || ids.contains(id) || !validColumns(workspace.value(QStringLiteral("columns")), &order, &owners)) return false;
        ids.insert(id);
        if (id == activeId) { activeOrder = order; activeColumns = workspace.value(QStringLiteral("columns")).toArray(); }
    }
    if (!ids.contains(activeId) || activeOrder != rootOrder) return false;
    const QJsonArray rootColumns = state.value(QStringLiteral("columns")).toArray();
    for (qsizetype index = 0; index < rootColumns.size(); ++index) {
        if (rootColumns.at(index).toObject().value(QStringLiteral("widthMode")).toString(QStringLiteral("half")) !=
            activeColumns.at(index).toObject().value(QStringLiteral("widthMode")).toString(QStringLiteral("half"))) return false;
    }
    return true;
}

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

ScrollDockBridge::ScrollDockBridge(QObject *parent, const QString &statePath)
    : QObject(parent)
    , m_statePath(statePath.isEmpty()
        ? QStandardPaths::writableLocation(QStandardPaths::GenericStateLocation) + QStringLiteral("/cc-niri/workspaces.json")
        : statePath)
{
    QFile file(m_statePath);
    if (!file.exists()) return;
    if (!file.open(QIODevice::ReadOnly) || file.size() > MaxStateBytes) {
        qCWarning(logBridge) << "workspace cache unavailable or too large";
        return;
    }
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll());
    if (!document.isObject() || !validState(document.object())) {
        qCWarning(logBridge) << "ignoring invalid workspace cache";
        return;
    }
    // Only recovery data is loaded. Commands require a newly published live session.
    m_lastState = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
}

bool ScrollDockBridge::PublishState(const QString &json)
{
    QJsonParseError error;
    if (json.toUtf8().size() > MaxStateBytes) return false;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        qCWarning(logBridge) << "rejecting invalid state JSON" << error.errorString();
        return false;
    }

    const QJsonObject state = document.object();
    const QString sessionId = state.value(QStringLiteral("sessionId")).toString();
    const qint64 generation = state.value(QStringLiteral("generation")).toInteger(-1);
    if (!validState(state)) {
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
    if (!m_scrollPlans.updateContext(state)) m_scrollPlans = {};
    m_lastState = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
    {
        m_lastSaveSucceeded = false;
        QSaveFile file(m_statePath);
        const QByteArray bytes = m_lastState.toUtf8();
        if (!QDir().mkpath(QFileInfo(m_statePath).absolutePath()) || !file.open(QIODevice::WriteOnly) ||
            file.write(bytes) != bytes.size() || !file.commit()) {
            qCWarning(logBridge) << "workspace cache write failed" << file.errorString();
        } else {
            m_lastSaveSucceeded = true;
        }
    }
    Q_EMIT StateChanged(m_lastState);
    return true;
}

bool ScrollDockBridge::PublishMotionPlan(const QString &json)
{
    if (json.toUtf8().size() > CcNiri::MaxMotionPlanBytes) return false;
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        qCWarning(logBridge) << "rejecting invalid motion plan JSON";
        return false;
    }
    const QJsonObject plan = document.object();
    const QString type = plan.value(QStringLiteral("type")).toString();
    const QJsonArray entries = plan.value(QStringLiteral("entries")).toArray();
    if (type == QStringLiteral("SCROLL")) {
        // Resolve membership against the last authoritative active workspace.
        // Never alter Wide completion tokens when publishing scroll telemetry.
        const auto state = QJsonDocument::fromJson(m_lastState.toUtf8()).object();
        if (m_sessionId.isEmpty() || plan.value(QStringLiteral("sessionId")).toString() != m_sessionId
            || plan.value(QStringLiteral("workspaceId")) != state.value(QStringLiteral("workspaceId"))
            || plan.value(QStringLiteral("targetOutput")) != state.value(QStringLiteral("targetOutput"))) return false;
        QSet<QString> owners;
        for (const auto &value : state.value(QStringLiteral("columns")).toArray()) {
            owners.insert(normalizedUuid(value.toObject().value(QStringLiteral("uuid"))));
        }
        for (const auto &value : entries) {
            if (!owners.contains(value.toObject().value(QStringLiteral("windowId")).toString())) return false;
        }
        const auto disposition = m_scrollPlans.observe(plan);
        if (disposition == CcNiri::ScrollPlanDisposition::Rejected) return false;
        if (disposition == CcNiri::ScrollPlanDisposition::Duplicate) return true;
        Q_EMIT MotionPlanChanged(QString::fromUtf8(document.toJson(QJsonDocument::Compact)));
        return true;
    }
    if (plan.value(QStringLiteral("protocol")).toInt() != 1 ||
            plan.value(QStringLiteral("sessionId")).toString() != m_sessionId ||
            m_sessionId.isEmpty() ||
            plan.value(QStringLiteral("epoch")).toInteger(-1) < 0 ||
            plan.value(QStringLiteral("issuedAt")).toInteger(-1) < 0 ||
            (type != QStringLiteral("WIDE_TO_PAIR") &&
             type != QStringLiteral("PAIR_TO_WIDE")) ||
            (entries.size() != 1 && entries.size() != 2)) {
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
    // A solo Full column uses the same presentation transaction, without an
    // invented neighbor. Two-window Pair/Wide envelopes remain unchanged.
    if (entries.size() == 1 && entries.first().toObject()
            .value(QStringLiteral("role")).toString() != QStringLiteral("target")) return false;
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
            (completion.value(QStringLiteral("type")).toString() != QStringLiteral("PAIR_TO_WIDE") &&
             completion.value(QStringLiteral("type")).toString() != QStringLiteral("WIDE_TO_PAIR"))) {
        return false;
    }
    const QJsonObject command{
        {QStringLiteral("protocol"), 1},
        {QStringLiteral("commandId"), m_sessionId +
            (completion.value(QStringLiteral("type")).toString() == QStringLiteral("WIDE_TO_PAIR")
                ? QStringLiteral("-wide-exit-motion-complete-") : QStringLiteral("-wide-motion-complete-")) + token},
        {QStringLiteral("sessionId"), m_sessionId},
        {QStringLiteral("baseGeneration"), m_generation},
        {QStringLiteral("type"), completion.value(QStringLiteral("type")).toString() == QStringLiteral("WIDE_TO_PAIR")
            ? QStringLiteral("finalize-contextual-wide-exit") : QStringLiteral("finalize-contextual-wide")},
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

bool ScrollDockBridge::EnsureVerticalDesktopLayout(int expectedCount)
{
    if (expectedCount <= 0) return false;
    const auto bus = QDBusConnection::sessionBus();
    const QString interface = QStringLiteral("org.kde.KWin.VirtualDesktopManager");
    const auto property = [&](const QString &name, uint &value) {
        auto message = QDBusMessage::createMethodCall(QStringLiteral("org.kde.KWin"),
            QStringLiteral("/VirtualDesktopManager"), QStringLiteral("org.freedesktop.DBus.Properties"),
            QStringLiteral("Get"));
        message.setArguments({interface, name});
        const auto reply = bus.call(message, QDBus::Block, 1000);
        if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().size() != 1) return false;
        bool ok = false;
        value = reply.arguments().first().value<QDBusVariant>().variant().toUInt(&ok);
        return ok;
    };
    uint count = 0, rows = 0;
    // Reject delayed requests for a topology that KDE has already replaced.
    if (!property(QStringLiteral("count"), count) || count != static_cast<uint>(expectedCount) ||
        !property(QStringLiteral("rows"), rows)) return false;
    if (rows == count) return true;
    auto message = QDBusMessage::createMethodCall(QStringLiteral("org.kde.KWin"),
        QStringLiteral("/VirtualDesktopManager"), QStringLiteral("org.freedesktop.DBus.Properties"),
        QStringLiteral("Set"));
    message.setArguments({interface, QStringLiteral("rows"), QVariant::fromValue(QDBusVariant(count))});
    return bus.call(message, QDBus::Block, 1000).type() == QDBusMessage::ReplyMessage;
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
