#pragma once

#include <QDBusAbstractAdaptor>
#include "CCNiriBridge.h"

// Compatibility transport only. State, validation and queues belong to the
// same CCNiriBridge used by the canonical endpoint.
class LegacyScrollDockAdaptor final : public QDBusAbstractAdaptor
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.ScrollDockBridge1")

public:
    explicit LegacyScrollDockAdaptor(CCNiriBridge *bridge);

public Q_SLOTS:
    bool PublishState(const QString &json) { return m_bridge->PublishState(json); }
    bool PublishMotionPlan(const QString &json) { return m_bridge->PublishMotionPlan(json); }
    bool ReportMotionComplete(const QString &json) { return m_bridge->ReportMotionComplete(json); }
    bool ReportMotionParked(const QString &json) { return m_bridge->ReportMotionParked(json); }
    QString GetState() const { return m_bridge->GetState(); }
    bool EnsureVerticalDesktopLayout(int count) { return m_bridge->EnsureVerticalDesktopLayout(count); }
    bool RequestReorder(const QString &json) { return m_bridge->RequestReorder(json); }
    bool RequestCommand(const QString &json) { return m_bridge->RequestCommand(json); }
    bool RequestDeferredCommand(const QString &json, int delayMs) { return m_bridge->RequestDeferredCommand(json, delayMs); }
    bool RequestEmergencyRestore() { return m_bridge->RequestEmergencyRestore(); }
    QString TakePendingCommand() { return m_bridge->TakePendingCommand(); }

Q_SIGNALS:
    void StateChanged(const QString &json);
    void MotionPlanChanged(const QString &json);
    void MotionParked(const QString &json);

private:
    CCNiriBridge *m_bridge;
};
