#include "CCNiriBridge.h"

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
#include <cmath>

Q_LOGGING_CATEGORY(logBridge, "cc.niri.bridge")

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
    if (!value.isArray() || value.toArray().size() > 256) return false;
    QSet<QString> seen;
    for (const QJsonValue &column : value.toArray()) {
        if (!column.isObject()) return false;
        const QString uuid = normalizedUuid(column.toObject().value(QStringLiteral("uuid")));
        if (uuid.isEmpty() || seen.contains(uuid) || (owners && owners->contains(uuid))) return false;
        seen.insert(uuid);
        if (owners) owners->insert(uuid);
        if (order) order->append(uuid);
        const auto width = column.toObject().value(QStringLiteral("widthV2"));
        if (!width.isUndefined()) {
            const auto object = width.toObject();
            const auto mode = object.value(QStringLiteral("widthMode")).toString();
            const auto previous = object.value(QStringLiteral("previousNonFullWidthMode")).toString();
            if (!width.isObject() || object.value(QStringLiteral("version")) != QJsonValue(1) ||
                !QStringList{QStringLiteral("half"), QStringLiteral("twoThirds"), QStringLiteral("full")}.contains(mode) ||
                !QStringList{QStringLiteral("half"), QStringLiteral("twoThirds")}.contains(previous)) return false;
        }
    }
    return true;
}

bool validAnchorV2(const QJsonObject &state)
{
    const auto value = state.value(QStringLiteral("viewportAnchorV2"));
    if (value.isUndefined() || value.isNull()) return true;
    if (!value.isObject()) return false;
    const auto anchor = value.toObject();
    const auto delta = anchor.value(QStringLiteral("delta"));
    if (anchor.value(QStringLiteral("version")) != QJsonValue(1) || !delta.isDouble() ||
        !std::isfinite(delta.toDouble()) || std::abs(delta.toDouble()) > 10000000) return false;
    const auto uuid = normalizedUuid(anchor.value(QStringLiteral("uuid")));
    bool member = false;
    for (const auto &column : state.value(QStringLiteral("columns")).toArray())
        member |= normalizedUuid(column.toObject().value(QStringLiteral("uuid"))) == uuid;
    if (uuid.isEmpty() || !member) return false;
    const auto basis = anchor.value(QStringLiteral("basis")).toObject();
    for (const auto &key : {QStringLiteral("gap"), QStringLiteral("physicalScale")}) {
        const auto number = basis.value(key);
        if (!number.isDouble() || !std::isfinite(number.toDouble()) || number.toDouble() < 0 ||
            (key == QStringLiteral("physicalScale") && (number.toDouble() == 0 || number.toDouble() > 16)) ||
            (key == QStringLiteral("gap") && number.toDouble() > 1000000)) return false;
    }
    for (const auto &key : {QStringLiteral("outputRect"), QStringLiteral("workingArea")}) {
        const auto rect = basis.value(key).toObject();
        for (const auto &field : {QStringLiteral("x"), QStringLiteral("y"), QStringLiteral("width"), QStringLiteral("height")}) {
            const auto number = rect.value(field);
            if (!number.isDouble() || !std::isfinite(number.toDouble()) ||
                std::abs(number.toDouble()) > 10000000 ||
                ((field == QStringLiteral("width") || field == QStringLiteral("height")) && number.toDouble() <= 0)) return false;
        }
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
    if (protocol == 1) return validColumns(state.value(QStringLiteral("columns"))) && validAnchorV2(state);
    const QString activeId = state.value(QStringLiteral("workspaceId")).toString().trimmed();
    if (activeId.isEmpty() || state.value(QStringLiteral("targetOutput")).toString().isEmpty() ||
        !state.value(QStringLiteral("workspaces")).isArray() ||
        state.value(QStringLiteral("workspaces")).toArray().size() > 256 || !validAnchorV2(state)) return false;
    QStringList activeOrder, rootOrder;
    if (!validColumns(state.value(QStringLiteral("columns")), &rootOrder)) return false;
    QSet<QString> ids, owners;
    QJsonArray activeColumns;
    QJsonValue activeAnchor;
    for (const QJsonValue &value : state.value(QStringLiteral("workspaces")).toArray()) {
        if (!value.isObject()) return false;
        const QJsonObject workspace = value.toObject();
        const QString id = workspace.value(QStringLiteral("id")).toString().trimmed();
        QStringList order;
        if (id.isEmpty() || ids.contains(id) || !validColumns(workspace.value(QStringLiteral("columns")), &order, &owners) || !validAnchorV2(workspace)) return false;
        ids.insert(id);
        if (id == activeId) { activeOrder = order; activeColumns = workspace.value(QStringLiteral("columns")).toArray();
            activeAnchor = workspace.value(QStringLiteral("viewportAnchorV2")); }
    }
    if (!ids.contains(activeId) || activeOrder != rootOrder) return false;
    const auto rootAnchor = state.value(QStringLiteral("viewportAnchorV2"));
    if (!(rootAnchor.isUndefined() || rootAnchor.isNull()) || !(activeAnchor.isUndefined() || activeAnchor.isNull()))
        if (rootAnchor != activeAnchor) return false;
    const QJsonArray rootColumns = state.value(QStringLiteral("columns")).toArray();
    for (qsizetype index = 0; index < rootColumns.size(); ++index) {
        if (rootColumns.at(index).toObject().value(QStringLiteral("widthMode")).toString(QStringLiteral("half")) !=
            activeColumns.at(index).toObject().value(QStringLiteral("widthMode")).toString(QStringLiteral("half"))) return false;
        if (rootColumns.at(index).toObject().value(QStringLiteral("widthV2")) !=
            activeColumns.at(index).toObject().value(QStringLiteral("widthV2"))) return false;
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
    message << QStringLiteral("CCScrollApplyRuntimeCommand");
    QDBusConnection::sessionBus().asyncCall(message);
}
}

CCNiriBridge::CCNiriBridge(QObject *parent, const QString &statePath)
    : QObject(parent)
    , m_statePath(statePath.isEmpty()
        ? QStandardPaths::writableLocation(QStandardPaths::GenericStateLocation) + QStringLiteral("/cc-niri/workspaces.json")
        : statePath)
{
    m_sessionWakeTimer.setInterval(100);
    connect(&m_sessionWakeTimer, &QTimer::timeout, this, [this]() {
        if (m_sessionWake.isEmpty() || ++m_sessionWakeAttempts > 3) { m_sessionWakeTimer.stop(); return; }
        wakeKWinCommandPump();
    });
    QDBusConnection::sessionBus().connect(QStringLiteral("org.kde.KWin"),
        QStringLiteral("/ccNiriViewportMotion"), QStringLiteral("org.cc.NiriViewportMotion1"),
        QStringLiteral("SessionStateChanged"), this, SLOT(onSessionStateChanged(QString)));
    QDBusConnection::sessionBus().connect(QStringLiteral("org.kde.KWin"),
        QStringLiteral("/ccNiriViewportMotion"), QStringLiteral("org.cc.NiriViewportMotion1"),
        QStringLiteral("PartialFocusRequested"), this, SLOT(onPartialFocusRequested(QString)));
    for (const auto &signal:{QStringLiteral("ColumnGeometryCompleted"),QStringLiteral("PartialScrollFrameReady")})
        QDBusConnection::sessionBus().connect(QStringLiteral("org.kde.KWin"),QStringLiteral("/ccNiriViewportMotion"),QStringLiteral("org.cc.NiriViewportMotion1"),signal,this,SLOT(onScrollFrameReady(QString)));
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

bool CCNiriBridge::PublishState(const QString &json)
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
        m_recoveryStatus.clear();
        m_runtimeHealth.clear();
        m_sessionWake.clear();
        m_sessionWakeTimer.stop();
        m_restoreRequestId.clear();
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

bool CCNiriBridge::PublishMotionPlan(const QString &json)
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
    if (type == QStringLiteral("SCROLL") || type == QStringLiteral("COLUMN_REINDEX") || type == QStringLiteral("PARTIAL_SCROLL")
        || type == QStringLiteral("COLUMN_GEOMETRY")) {
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
        m_partialEpoch = (type == QStringLiteral("PARTIAL_SCROLL") || type == QStringLiteral("COLUMN_GEOMETRY")) ? plan.value(QStringLiteral("epoch")).toInteger() : -1;
        m_partialScopeRevision = (type == QStringLiteral("PARTIAL_SCROLL") || type == QStringLiteral("COLUMN_GEOMETRY")) ? plan.value(QStringLiteral("scopeRevision")).toInteger() : -1;
        m_partialWorkspace = plan.value(QStringLiteral("workspaceId")).toString();
        m_partialOutput = plan.value(QStringLiteral("targetOutput")).toString();
        m_partialSession = plan.value(QStringLiteral("sessionId")).toString();
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
    m_partialEpoch = -1;
    m_lastMotionTarget = type == QStringLiteral("PAIR_TO_WIDE")
        ? plan.value(QStringLiteral("targetWindowUuid")).toString() : QString();
    Q_EMIT MotionPlanChanged(QString::fromUtf8(
        document.toJson(QJsonDocument::Compact)));
    return true;
}

bool CCNiriBridge::ReportMotionComplete(const QString &json)
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

bool CCNiriBridge::ReportMotionParked(const QString &json)
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

bool CCNiriBridge::EnsureVerticalDesktopLayout(int expectedCount)
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

QString CCNiriBridge::GetRecoveryStatus() const
{
    return m_recoveryStatus;
}

QString CCNiriBridge::GetRuntimeHealth() const { return m_runtimeHealth; }

bool CCNiriBridge::ReportRuntimeHealth(const QString &json)
{
    if (json.toUtf8().size() > 4096 || m_sessionId.isEmpty()) return false;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return false;
    const auto value = document.object();
    const auto sequence = value.value(QStringLiteral("sequence"));
    if (value.value(QStringLiteral("protocol")) != QJsonValue(1)
        || value.value(QStringLiteral("type")) != QJsonValue(QStringLiteral("runtime-health"))
        || value.value(QStringLiteral("sessionId")) != QJsonValue(m_sessionId)
        || !sequence.isDouble() || !cc_niri_json_integer_valid(sequence.toDouble()).value || sequence.toInteger(-1) < 0
        || !value.value(QStringLiteral("reason")).isString() || value.value(QStringLiteral("reason")).toString().size() > 256
        || !QStringList{QStringLiteral("checking"), QStringLiteral("running"), QStringLiteral("locked"),
            QStringLiteral("resuming"), QStringLiteral("blocked"), QStringLiteral("stopped")}
                .contains(value.value(QStringLiteral("state")).toString())) return false;
    const auto previous = QJsonDocument::fromJson(m_runtimeHealth.toUtf8()).object();
    if (!previous.isEmpty() && sequence.toInteger() <= previous.value(QStringLiteral("sequence")).toInteger()) return false;
    m_runtimeHealth = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
    return true;
}

void CCNiriBridge::onSessionStateChanged(const QString &json)
{
    if (m_sessionId.isEmpty() || json.toUtf8().size() > 4096) return;
    const auto value = QJsonDocument::fromJson(json.toUtf8()).object();
    if (value.value(QStringLiteral("type")) != QJsonValue(QStringLiteral("session-state"))) return;
    // One coalescing wake slot, independent of the bounded user command queue.
    // The payload is never treated as proof: JS queries the Native endpoint.
    m_sessionWake = QString::fromUtf8(QJsonDocument(QJsonObject{
        {QStringLiteral("protocol"), 1}, {QStringLiteral("type"), QStringLiteral("session-state-changed")},
        {QStringLiteral("sessionId"), m_sessionId}, {QStringLiteral("baseGeneration"), m_generation},
        {QStringLiteral("commandId"), QStringLiteral("session/%1/%2").arg(m_sessionId).arg(++m_sessionWakeSequence)}})
        .toJson(QJsonDocument::Compact));
    wakeKWinCommandPump();
    // Unlock can precede global shortcut availability. Bounded transport
    // wakeups drain the same single slot; no idle polling or new service.
    m_sessionWakeTimer.stop();
    if (value.value(QStringLiteral("locked")) == QJsonValue(false)) {
        m_sessionWakeAttempts = 0;
        m_sessionWakeTimer.start();
    }
}

bool CCNiriBridge::ReportRecoveryStatus(const QString &json)
{
    // Ephemeral transport proof: never add ACKs or request IDs to workspaces.json.
    if (json.toUtf8().size() > 4096 || m_sessionId.isEmpty()) return false;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return false;
    const auto value = document.object();
    const auto state = value.value(QStringLiteral("state")).toString();
    const auto tokenValue = value.value(QStringLiteral("requestId"));
    const auto token = tokenValue.toString();
    const auto count = value.value(QStringLiteral("restoredCount")).toInteger(-1);
    if (value.value(QStringLiteral("protocol")) != QJsonValue(1) ||
        value.value(QStringLiteral("type")) != QJsonValue(QStringLiteral("recovery-status")) ||
        value.value(QStringLiteral("sessionId")) != QJsonValue(m_sessionId) ||
        (!tokenValue.isNull() && !tokenValue.isString()) || token.size() > 256 ||
        token != m_restoreRequestId || count < 0 || count > 65536 ||
        !QStringList{QStringLiteral("running"), QStringLiteral("pending"), QStringLiteral("restored"), QStringLiteral("blocked")}.contains(state)) return false;
    const auto previous = QJsonDocument::fromJson(m_recoveryStatus.toUtf8()).object();
    if (state == QStringLiteral("running") && !token.isEmpty()) return false;
    if ((state == QStringLiteral("restored") || state == QStringLiteral("blocked")) &&
        (previous.value(QStringLiteral("state")) != QJsonValue(QStringLiteral("pending")) ||
         previous.value(QStringLiteral("requestId")) != tokenValue)) return false;
    m_recoveryStatus = QString::fromUtf8(document.toJson(QJsonDocument::Compact));
    return true;
}

QString CCNiriBridge::GetState() const
{
    return m_lastState;
}

bool CCNiriBridge::RequestReorder(const QString &json)
{
    return RequestCommand(json);
}

bool CCNiriBridge::RequestCommand(const QString &json)
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
    if (emergencyRestore && commandId.size() > 256) return false;
    const bool partialFocus = type == QStringLiteral("focus-partial-column") && currentPartialRequest(command);
    const bool frameReady = type == QStringLiteral("scroll-frame-ready") && currentScrollScope(command);
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
         !deferredDockScroll && !deferredContextualWide && !partialFocus && !frameReady)) {
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
    if (emergencyRestore) {
        m_restoreRequestId = commandId;
        m_recoveryStatus.clear();
        m_pendingCommands.prepend(compact);
    }
    else m_pendingCommands.enqueue(compact);
    wakeKWinCommandPump();
    return true;
}

bool CCNiriBridge::currentScrollScope(const QJsonObject &request) const
{
    if (m_partialEpoch < 0 || m_sessionId.isEmpty() || m_partialSession != m_sessionId
        || !request.value(QStringLiteral("epoch")).isDouble()
        || !cc_niri_json_integer_valid(request.value(QStringLiteral("epoch")).toDouble()).value
        || !request.value(QStringLiteral("scopeRevision")).isDouble()
        || !cc_niri_json_integer_valid(request.value(QStringLiteral("scopeRevision")).toDouble()).value
        || request.value(QStringLiteral("sessionId")).toString() != m_sessionId
        || request.value(QStringLiteral("epoch")).toInteger(-1) != m_partialEpoch
        || request.value(QStringLiteral("scopeRevision")).toInteger(-1) != m_partialScopeRevision
        || request.value(QStringLiteral("workspaceId")).toString() != m_partialWorkspace
        || request.value(QStringLiteral("targetOutput")).toString() != m_partialOutput) return false;
    const auto state = QJsonDocument::fromJson(m_lastState.toUtf8()).object();
    if (state.value(QStringLiteral("workspaceId")).toString() != m_partialWorkspace
        || state.value(QStringLiteral("targetOutput")).toString() != m_partialOutput) return false;
    return true;
}
bool CCNiriBridge::currentPartialRequest(const QJsonObject &request) const
{
    if(!currentScrollScope(request)) return false;
    const auto state=QJsonDocument::fromJson(m_lastState.toUtf8()).object();
    const QString id = request.value(QStringLiteral("windowUuid")).toString();
    if (id.isEmpty()) return false;
    for (const auto &row : state.value(QStringLiteral("columns")).toArray())
        if (normalizedUuid(row.toObject().value(QStringLiteral("uuid"))) == id) return true;
    return false;
}

void CCNiriBridge::onPartialFocusRequested(const QString &json)
{
    // Relay a scoped intent through the existing bounded command pump. JS owns
    // camera and activation; Bridge creates no focus or input authority.
    if (json.toUtf8().size() > 4096) return;
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject() || !currentPartialRequest(document.object())) return;
    auto command = document.object();
    command.insert(QStringLiteral("type"), QStringLiteral("focus-partial-column"));
    command.insert(QStringLiteral("protocol"), 1);
    command.insert(QStringLiteral("baseGeneration"), m_generation);
    command.insert(QStringLiteral("commandId"), QStringLiteral("partial-focus/%1/%2/%3/%4")
        .arg(m_sessionId).arg(m_partialScopeRevision).arg(m_partialEpoch).arg(command.value(QStringLiteral("windowUuid")).toString()));
    RequestCommand(QString::fromUtf8(QJsonDocument(command).toJson(QJsonDocument::Compact)));
}

void CCNiriBridge::onScrollFrameReady(const QString &json)
{
    if(json.toUtf8().size()>4096) return;
    const auto document=QJsonDocument::fromJson(json.toUtf8());
    if(!document.isObject() || !currentScrollScope(document.object())) return;
    auto command=document.object();
    // This is a wakeup only. JS must query Native's typed proof again; public
    // RequestCommand callers cannot manufacture configure/paint completion.
    command.insert(QStringLiteral("type"),QStringLiteral("scroll-frame-ready"));
    command.insert(QStringLiteral("protocol"),1);command.insert(QStringLiteral("baseGeneration"),m_generation);
    command.insert(QStringLiteral("commandId"),QStringLiteral("scroll-ready/%1/%2/%3/%4/%5").arg(m_sessionId).arg(m_partialScopeRevision).arg(m_partialEpoch).arg(command.value(QStringLiteral("sampleSerial")).toInteger()).arg(document.object().value(QStringLiteral("type")).toString()));
    RequestCommand(QString::fromUtf8(QJsonDocument(command).toJson(QJsonDocument::Compact)));
}

bool CCNiriBridge::RequestDeferredCommand(const QString &json, int delayMs)
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

bool CCNiriBridge::RequestEmergencyRestore()
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

QString CCNiriBridge::TakePendingCommand()
{
    if (m_pendingCommands.isEmpty() && m_sessionWake.isEmpty()) return {};
    const bool restoreFirst = !m_pendingCommands.isEmpty() &&
        QJsonDocument::fromJson(m_pendingCommands.head().toUtf8()).object().value(QStringLiteral("type")) == QJsonValue(QStringLiteral("emergency-restore"));
    QString command;
    if (!m_sessionWake.isEmpty() && !restoreFirst) { command = m_sessionWake; m_sessionWake.clear(); m_sessionWakeTimer.stop(); }
    else command = m_pendingCommands.dequeue();
    if (!m_pendingCommands.isEmpty() || !m_sessionWake.isEmpty()) {
        QTimer::singleShot(0, this, wakeKWinCommandPump);
    }
    return command;
}
