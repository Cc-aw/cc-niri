/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSet>
#include <cmath>

namespace CcNiri
{
inline constexpr qsizetype MaxMotionPlanBytes = 256 * 1024;

inline bool scrollPlanNumber(const QJsonValue &value)
{
    return value.isDouble() && std::isfinite(value.toDouble());
}
inline bool scrollPlanInteger(const QJsonValue &value)
{
    return scrollPlanNumber(value) && value.toDouble() >= 0.0
           && value.toDouble() <= 9007199254740991.0
           && std::floor(value.toDouble()) == value.toDouble();
}
inline bool scrollPlanText(const QJsonValue &value)
{
    return value.isString() && !value.toString().trimmed().isEmpty()
           && value.toString().size() <= 256;
}
inline bool validViewportScrollPlan(const QJsonObject &plan)
{
    if (plan.value(QStringLiteral("protocol")) != QJsonValue(2) || plan.value(QStringLiteral("type")) != QJsonValue(QStringLiteral("SCROLL"))
        || !scrollPlanText(plan.value(QStringLiteral("sessionId"))) || !scrollPlanText(plan.value(QStringLiteral("workspaceId")))
        || !scrollPlanText(plan.value(QStringLiteral("targetOutput"))) || !scrollPlanInteger(plan.value(QStringLiteral("epoch")))
        || !scrollPlanInteger(plan.value(QStringLiteral("issuedAt")))) return false;
    for (const auto &key : {QStringLiteral("oldScrollOffsetX"), QStringLiteral("newScrollOffsetX")}) {
        if (!scrollPlanNumber(plan.value(key)) || plan.value(key).toDouble() < 0.0) return false;
    }
    const bool sameTarget = plan.value(QStringLiteral("oldScrollOffsetX")) == plan.value(QStringLiteral("newScrollOffsetX"));
    // Returning to the committed target can still reverse an armed, uncommitted
    // Spring. Equal logical offsets are allowed only for this explicit form.
    if (plan.contains(QStringLiteral("retargetOnly")) && !plan.value(QStringLiteral("retargetOnly")).isBool()) return false;
    if (sameTarget != (plan.value(QStringLiteral("retargetOnly")) == QJsonValue(true))) return false;
    if (!plan.value(QStringLiteral("viewport")).isObject() || !plan.value(QStringLiteral("entries")).isArray()) return false;
    const auto viewport = plan.value(QStringLiteral("viewport")).toObject();
    for (const auto &key : {QStringLiteral("x"), QStringLiteral("y"), QStringLiteral("width"), QStringLiteral("height")}) {
        if (!scrollPlanNumber(viewport.value(key))) return false;
    }
    if (viewport.value(QStringLiteral("width")).toDouble() <= 0.0 || viewport.value(QStringLiteral("height")).toDouble() <= 0.0
        || !std::isfinite(viewport.value(QStringLiteral("x")).toDouble() + viewport.value(QStringLiteral("width")).toDouble())
        || !std::isfinite(viewport.value(QStringLiteral("y")).toDouble() + viewport.value(QStringLiteral("height")).toDouble())) return false;
    const auto entries = plan.value(QStringLiteral("entries")).toArray();
    if (entries.isEmpty() || entries.size() > 256) return false;
    QSet<QString> windows;
    QSet<qint64> columns;
    for (const auto &value : entries) {
        if (!value.isObject()) return false;
        const auto entry = value.toObject();
        const auto id = entry.value(QStringLiteral("windowId")).toString();
        if (!scrollPlanText(entry.value(QStringLiteral("windowId"))) || id != id.trimmed().toLower()
            || id.contains(QStringLiteral("{")) || id.contains(QStringLiteral("}")) || windows.contains(id)
            || !scrollPlanInteger(entry.value(QStringLiteral("columnId")))
            || columns.contains(entry.value(QStringLiteral("columnId")).toInteger())
            || !scrollPlanNumber(entry.value(QStringLiteral("logicalX"))) || entry.value(QStringLiteral("logicalX")).toDouble() < 0.0
            || !scrollPlanNumber(entry.value(QStringLiteral("pixelWidth"))) || entry.value(QStringLiteral("pixelWidth")).toDouble() <= 0.0
            || !std::isfinite(entry.value(QStringLiteral("logicalX")).toDouble() + entry.value(QStringLiteral("pixelWidth")).toDouble())) return false;
        for (const auto &key : {QStringLiteral("oldPlacement"), QStringLiteral("newPlacement")}) {
            const auto placement = entry.value(key).toString();
            if (placement != QStringLiteral("visible") && placement != QStringLiteral("parked")) return false;
        }
        const auto placementMatches = [&](const char *offsetKey, const QString &placementKey) {
            const auto left = viewport.value(QStringLiteral("x")).toDouble()
                + entry.value(QStringLiteral("logicalX")).toDouble()
                - plan.value(QString::fromLatin1(offsetKey)).toDouble();
            const auto right = left + entry.value(QStringLiteral("pixelWidth")).toDouble();
            if (!std::isfinite(left) || !std::isfinite(right)) return false;
            const bool visible = left >= viewport.value(QStringLiteral("x")).toDouble()
                && right <= viewport.value(QStringLiteral("x")).toDouble() + viewport.value(QStringLiteral("width")).toDouble();
            return entry.value(placementKey).toString() == (visible ? QStringLiteral("visible") : QStringLiteral("parked"));
        };
        if (!placementMatches("oldScrollOffsetX", QStringLiteral("oldPlacement"))
            || !placementMatches("newScrollOffsetX", QStringLiteral("newPlacement"))) return false;
        if (entry.value(QStringLiteral("oldPlacement")) == QJsonValue(QStringLiteral("parked"))
            && entry.value(QStringLiteral("newPlacement")) == QJsonValue(QStringLiteral("parked"))) return false;
        windows.insert(id);
        columns.insert(entry.value(QStringLiteral("columnId")).toInteger());
    }
    return true;
}

enum class ScrollPlanDisposition { Rejected, Duplicate, Accepted };

// Bridge and observer share authority/sequence checks. Authority is established
// only by Dock State, never by an untrusted plan switching its own session.
class ViewportScrollPlanSequence
{
public:
    bool hasAuthority() const { return !m_session.isEmpty(); }
    bool updateContext(const QJsonObject &state)
    {
        if (state.value(QStringLiteral("protocol")) == QJsonValue(1)) {
            *this = {};
            return true;
        }
        if (state.value(QStringLiteral("protocol")) != QJsonValue(2) || !scrollPlanText(state.value(QStringLiteral("sessionId")))
            || !scrollPlanText(state.value(QStringLiteral("workspaceId"))) || !scrollPlanText(state.value(QStringLiteral("targetOutput")))
            || !scrollPlanInteger(state.value(QStringLiteral("generation")))) return false;
        const auto session = state.value(QStringLiteral("sessionId")).toString();
        const auto generation = state.value(QStringLiteral("generation")).toInteger();
        if (session == m_session && generation < m_generation) return false;
        if (session != m_session) {
            m_epoch = -1;
            m_fingerprint.clear();
        }
        m_session = session;
        m_generation = generation;
        m_workspace = state.value(QStringLiteral("workspaceId")).toString();
        m_output = state.value(QStringLiteral("targetOutput")).toString();
        return true;
    }
    ScrollPlanDisposition observe(const QJsonObject &plan)
    {
        if (!hasAuthority() || !validViewportScrollPlan(plan)
            || plan.value(QStringLiteral("sessionId")).toString() != m_session
            || plan.value(QStringLiteral("workspaceId")).toString() != m_workspace
            || plan.value(QStringLiteral("targetOutput")).toString() != m_output) return ScrollPlanDisposition::Rejected;
        const auto epoch = plan.value(QStringLiteral("epoch")).toInteger();
        if (epoch < m_epoch) return ScrollPlanDisposition::Rejected;
        const auto fingerprint = QJsonDocument(plan).toJson(QJsonDocument::Compact);
        if (epoch == m_epoch) return fingerprint == m_fingerprint
            ? ScrollPlanDisposition::Duplicate : ScrollPlanDisposition::Rejected;
        m_epoch = epoch;
        m_fingerprint = fingerprint;
        return ScrollPlanDisposition::Accepted;
    }

private:
    QString m_session;
    QString m_workspace;
    QString m_output;
    qint64 m_generation = -1;
    qint64 m_epoch = -1;
    QByteArray m_fingerprint;
};
}
