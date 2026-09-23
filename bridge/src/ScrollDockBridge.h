#pragma once

#include <QObject>
#include <QQueue>
#include <QSet>
#include <QString>

class ScrollDockBridge final : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.ScrollDockBridge1")

public:
    explicit ScrollDockBridge(QObject *parent = nullptr);

public Q_SLOTS:
    bool PublishState(const QString &json);
    bool PublishMotionPlan(const QString &json);
    bool ReportMotionComplete(const QString &json);
    bool ReportMotionParked(const QString &json);
    QString GetState() const;
    bool RequestReorder(const QString &json);
    bool RequestCommand(const QString &json);
    bool RequestDeferredCommand(const QString &json, int delayMs);
    bool RequestEmergencyRestore();
    QString TakePendingCommand();

Q_SIGNALS:
    void StateChanged(const QString &json);
    void MotionPlanChanged(const QString &json);
    void MotionParked(const QString &json);

private:
    QString m_lastState;
    QString m_sessionId;
    QString m_lastMotionToken;
    QString m_lastMotionTarget;
    QQueue<QString> m_pendingCommands;
    QSet<QString> m_recentCommandIds;
    QQueue<QString> m_recentCommandOrder;
    qint64 m_generation = -1;
};
