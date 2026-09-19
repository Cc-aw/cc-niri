#pragma once

#include <QObject>
#include <QString>

class ScrollDockBridge final : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.ScrollDockBridge1")

public:
    explicit ScrollDockBridge(QObject *parent = nullptr);

public Q_SLOTS:
    bool PublishState(const QString &json);
    QString GetState() const;
    bool RequestReorder(const QString &json);
    QString TakePendingCommand();

Q_SIGNALS:
    void StateChanged(const QString &json);

private:
    QString m_lastState;
    QString m_sessionId;
    QString m_pendingCommand;
    QString m_lastCommandId;
    qint64 m_generation = -1;
};
