/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingContext.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QUuid>
#include <cmath>

namespace CcNiri {
void FocusRingContext::clear() {
    session.clear(); workspace.clear(); output.clear(); generation = -1; windows.clear();
}
bool FocusRingContext::update(const QString &json) {
    const auto reject = [this] { clear(); return false; };
    if (json.toUtf8().size() > 256 * 1024) return reject();
    const auto document = QJsonDocument::fromJson(json.toUtf8());
    if (!document.isObject()) return reject();
    const auto state = document.object();
    const auto nextSession = state.value(QStringLiteral("sessionId")).toString();
    const auto nextWorkspace = state.value(QStringLiteral("workspaceId")).toString();
    const auto nextOutput = state.value(QStringLiteral("targetOutput")).toString();
    const auto value = state.value(QStringLiteral("generation"));
    const double revision = value.toDouble(-1);
    if (state.value(QStringLiteral("protocol")) != QJsonValue(2)
        || nextSession.isEmpty() || nextWorkspace.isEmpty() || nextOutput.isEmpty()
        || !value.isDouble() || !std::isfinite(revision) || revision < 0
        || revision > 9007199254740991.0 || std::floor(revision) != revision
        || !state.value(QStringLiteral("columns")).isArray()) return reject();
    QSet<QString> nextWindows;
    const auto columns = state.value(QStringLiteral("columns")).toArray();
    if (columns.size() > 256) return reject();
    for (const auto &column : columns) {
        if (!column.isObject()) return reject();
        const auto raw = column.toObject().value(QStringLiteral("uuid")).toString();
        const QUuid uuid(raw);
        if (uuid.isNull()) return reject();
        const auto id = uuid.toString(QUuid::WithoutBraces).toLower();
        if (nextWindows.contains(id)) return reject();
        nextWindows.insert(id);
    }
    if (nextSession == session && revision <= generation) {
        // A late reply cannot resurrect old membership. Conflicting snapshots
        // of the same generation are also rejected without replacing authority.
        return revision == generation && nextWorkspace == workspace
            && nextOutput == output && nextWindows == windows;
    }
    session = nextSession; workspace = nextWorkspace; output = nextOutput;
    generation = static_cast<qint64>(revision); windows = nextWindows;
    return true;
}
bool FocusRingContext::permits(const FocusRingCandidate &window) const {
    return !session.isEmpty() && window.active && window.managed && window.normal
        && window.visible && window.onCurrentActivity && window.onCurrentDesktop && !window.minimized
        && !window.deleted && !window.fullscreen && window.insideOutput
        && std::isfinite(window.opacity) && window.opacity > 0
        && window.output == output && window.workspace == workspace
        && windows.contains(window.id);
}
}
