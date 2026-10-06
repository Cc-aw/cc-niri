/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "cc_niri_native_core.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRectF>
#include <cstdlib>
#include <limits>
#include <vector>

namespace CcNiri::ProtocolAdapter {
inline void check(std::uint32_t status) { if (status != CC_NIRI_FFI_OK) std::abort(); }
inline bool accepted(CcNiriSpringBoolResult result) { check(result.status); return result.value != 0; }
inline CcNiriU16View text(const QString &s) { return {s.utf16(),static_cast<std::uint64_t>(s.size())}; }
inline QString text(CcNiriU16View value) { return QString::fromUtf16(reinterpret_cast<const char16_t*>(value.data), static_cast<qsizetype>(value.len)); }
inline CcNiriRect rect(const QRectF &r) { return {r.x(),r.y(),r.width(),r.height()}; }
inline QRectF rect(CcNiriRect r) { return {r.x,r.y,r.width,r.height}; }
inline double number(const QJsonValue &v) { return v.isDouble() ? v.toDouble() : std::numeric_limits<double>::quiet_NaN(); }
inline std::uint32_t placement(const QJsonValue &v) {
    const auto s=v.toString();
    return s==QStringLiteral("visible") ? 1 : s==QStringLiteral("parked") ? 2 : 0;
}
// Owned Qt values keep every borrowed DTO buffer live for the synchronous call.
// Only representation/JSON kind decoding lives here; numeric and sequence policy
// is enforced in Rust. Both observer and runtime use this exact conversion.
struct ScrollContext {
    QString session,workspace,output;
    CcNiriScrollContext dto;
    explicit ScrollContext(const QJsonObject &state)
        : session(state.value(QStringLiteral("sessionId")).toString()), workspace(state.value(QStringLiteral("workspaceId")).toString()),
          output(state.value(QStringLiteral("targetOutput")).toString()),
          dto{number(state.value(QStringLiteral("protocol"))),number(state.value(QStringLiteral("generation"))),text(session),text(workspace),text(output)} {}
    ScrollContext(const ScrollContext &) = delete;
    ScrollContext &operator=(const ScrollContext &) = delete;
};
struct ScrollPlan {
    QString kind,session,workspace,output;
    QByteArray fingerprint;
    std::vector<CcNiriScrollEntry> rows;
    CcNiriScrollPlan dto;
    template<class Intern> ScrollPlan(const QJsonObject &plan,Intern intern)
        : kind(plan.value(QStringLiteral("type")).toString()), session(plan.value(QStringLiteral("sessionId")).toString()),
          workspace(plan.value(QStringLiteral("workspaceId")).toString()), output(plan.value(QStringLiteral("targetOutput")).toString()),
          fingerprint(QJsonDocument(plan).toJson(QJsonDocument::Compact)) {
        const auto viewport=plan.value(QStringLiteral("viewport")).toObject();
        const auto entries=plan.value(QStringLiteral("entries")).toArray();
        bool shape=plan.value(QStringLiteral("viewport")).isObject() && plan.value(QStringLiteral("entries")).isArray();
        rows.reserve(entries.size());
        for (const auto &value:entries) {
            shape=shape && value.isObject(); const auto e=value.toObject();
            rows.push_back({intern(e.value(QStringLiteral("windowId")).toString()),number(e.value(QStringLiteral("columnId"))),number(e.value(QStringLiteral("logicalX"))),number(e.value(QStringLiteral("pixelWidth"))),placement(e.value(QStringLiteral("oldPlacement"))),placement(e.value(QStringLiteral("newPlacement")))});
        }
        std::uint32_t retarget=0;
        if (plan.contains(QStringLiteral("retargetOnly"))) {
            const auto v=plan.value(QStringLiteral("retargetOnly")); retarget=v.isBool() ? (v.toBool() ? 2 : 1) : 3;
        }
        dto={number(plan.value(QStringLiteral("protocol"))),number(plan.value(QStringLiteral("epoch"))),number(plan.value(QStringLiteral("issuedAt"))),number(plan.value(QStringLiteral("oldScrollOffsetX"))),number(plan.value(QStringLiteral("newScrollOffsetX"))),
            text(kind),text(session),text(workspace),text(output),{number(viewport.value(QStringLiteral("x"))),number(viewport.value(QStringLiteral("y"))),number(viewport.value(QStringLiteral("width"))),number(viewport.value(QStringLiteral("height")))},
            rows.data(),static_cast<std::uint64_t>(rows.size()),{reinterpret_cast<const std::uint8_t*>(fingerprint.constData()),static_cast<std::uint64_t>(fingerprint.size())},static_cast<std::uint32_t>(shape),retarget};
    }
    ScrollPlan(const ScrollPlan &) = delete;
    ScrollPlan &operator=(const ScrollPlan &) = delete;
};
}
