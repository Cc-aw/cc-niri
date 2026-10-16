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
inline CcNiriRect jsonRect(const QJsonValue &v) {
    const auto r=v.toObject();
    return {number(r.value(QStringLiteral("x"))),number(r.value(QStringLiteral("y"))),
        number(r.value(QStringLiteral("width"))),number(r.value(QStringLiteral("height")))};
}
inline bool integer(const QJsonValue &v) { return accepted(cc_niri_json_integer_valid(number(v))); }
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
    template<class Intern> ScrollPlan(const QJsonObject &plan,Intern intern,bool decodeEntries=true)
        : kind(plan.value(QStringLiteral("type")).toString()), session(plan.value(QStringLiteral("sessionId")).toString()),
          workspace(plan.value(QStringLiteral("workspaceId")).toString()), output(plan.value(QStringLiteral("targetOutput")).toString()),
          fingerprint(QJsonDocument(plan).toJson(QJsonDocument::Compact)) {
        const auto viewport=plan.value(QStringLiteral("viewport")).toObject();
        const auto entries=plan.value(QStringLiteral("entries")).toArray();
        bool shape=plan.value(QStringLiteral("viewport")).isObject() && plan.value(QStringLiteral("entries")).isArray();
        if (decodeEntries) rows.reserve(entries.size());
        if (decodeEntries) for (const auto &value:entries) {
            shape=shape && value.isObject(); const auto e=value.toObject();
            rows.push_back({intern(e.value(QStringLiteral("windowId")).toString()),number(e.value(QStringLiteral("columnId"))),number(e.value(QStringLiteral("logicalX"))),number(e.value(QStringLiteral("pixelWidth"))),placement(e.value(QStringLiteral("oldPlacement"))),placement(e.value(QStringLiteral("newPlacement")))});
        }
        std::uint32_t partial=0;
        if (plan.contains(QStringLiteral("clipPartial"))) {
            const auto v=plan.value(QStringLiteral("clipPartial")); partial=v.isBool() ? (v.toBool() ? 2 : 1) : 3;
        }
        std::uint32_t retarget=0;
        if (plan.contains(QStringLiteral("retargetOnly"))) {
            const auto v=plan.value(QStringLiteral("retargetOnly")); retarget=v.isBool() ? (v.toBool() ? 2 : 1) : 3;
        }
        dto={number(plan.value(QStringLiteral("protocol"))),number(plan.value(QStringLiteral("epoch"))),number(plan.value(QStringLiteral("issuedAt"))),number(plan.value(QStringLiteral("oldScrollOffsetX"))),number(plan.value(QStringLiteral("newScrollOffsetX"))),
            text(kind),text(session),text(workspace),text(output),{number(viewport.value(QStringLiteral("x"))),number(viewport.value(QStringLiteral("y"))),number(viewport.value(QStringLiteral("width"))),number(viewport.value(QStringLiteral("height")))},
            rows.data(),static_cast<std::uint64_t>(rows.size()),{reinterpret_cast<const std::uint8_t*>(fingerprint.constData()),static_cast<std::uint64_t>(fingerprint.size())},static_cast<std::uint32_t>(shape),retarget,partial};
    }
    ScrollPlan(const ScrollPlan &) = delete;
    ScrollPlan &operator=(const ScrollPlan &) = delete;
};
struct ReindexPlan {
    ScrollPlan plan;
    CcNiriReindexPlan dto;
    template<class Intern> ReindexPlan(const QJsonObject &value, Intern intern)
        : plan(value, intern), dto{plan.dto,
              intern(value.value(QStringLiteral("sourceWindowId")).toString()),
              number(value.value(QStringLiteral("sourceLogicalX")))} {}
    ReindexPlan(const ReindexPlan &) = delete;
    ReindexPlan &operator=(const ReindexPlan &) = delete;
};
struct PartialScrollPlan {
    ScrollPlan plan;
    CcNiriPartialScrollPlan dto;
    template<class Intern> PartialScrollPlan(const QJsonObject &value, Intern intern)
        : plan(value, intern) {
        const auto layout=value.value(QStringLiteral("layoutRect")).toObject();
        if (!value.value(QStringLiteral("layoutRect")).isObject()) plan.dto.shape_valid=0;
        dto={plan.dto,{number(layout.value(QStringLiteral("x"))),number(layout.value(QStringLiteral("y"))),
            number(layout.value(QStringLiteral("width"))),number(layout.value(QStringLiteral("height")))},
            number(value.value(QStringLiteral("maxCamera"))),number(value.value(QStringLiteral("scopeRevision")))};
    }
    PartialScrollPlan(const PartialScrollPlan &)=delete;
    PartialScrollPlan &operator=(const PartialScrollPlan &)=delete;
};
struct ColumnGeometryPlan {
    ScrollPlan plan;
    std::vector<CcNiriColumnGeometryEntry> rows;
    CcNiriColumnGeometryPlan dto;
    template<class Intern> ColumnGeometryPlan(const QJsonObject &value,Intern intern)
        : plan(value,intern,false) {
        bool shape=plan.dto.shape_valid && value.value(QStringLiteral("oldLayoutRect")).isObject()
            && value.value(QStringLiteral("layoutRect")).isObject();
        const auto entries=value.value(QStringLiteral("entries")).toArray();
        if (entries.size()>256) { plan.dto.shape_valid=0; dto={}; dto.plan=plan.dto; return; }
        rows.reserve(entries.size());
        for (const auto &raw:entries) {
            const auto e=raw.toObject();
            const bool culled=e.value(QStringLiteral("sourceKind"))==QJsonValue(QStringLiteral("culled"));
            const bool painted=culled || e.value(QStringLiteral("sourceKind"))==QJsonValue(QStringLiteral("painted"));
            const bool parked=e.value(QStringLiteral("sourceKind"))==QJsonValue(QStringLiteral("parked"));
            shape=shape && raw.isObject() && (painted || parked)
                && e.value(QStringLiteral("oldFrameRect")).isObject() && e.value(QStringLiteral("committedTargetRect")).isObject()
                && (painted ? e.value(QStringLiteral("oldVisualRect")).isObject()
                    : e.value(QStringLiteral("oldVisualRect")).isNull() && e.value(QStringLiteral("oldLogicalX")).isNull());
            rows.push_back({intern(e.value(QStringLiteral("windowId")).toString()),number(e.value(QStringLiteral("columnId"))),
                painted ? number(e.value(QStringLiteral("oldLogicalX"))) : 0.0,number(e.value(QStringLiteral("newLogicalX"))),
                number(e.value(QStringLiteral("oldPixelWidth"))),number(e.value(QStringLiteral("newPixelWidth"))),
                jsonRect(e.value(QStringLiteral("oldFrameRect"))),painted ? jsonRect(e.value(QStringLiteral("oldVisualRect"))) : CcNiriRect{},
                jsonRect(e.value(QStringLiteral("committedTargetRect"))),culled ? 3u : painted ? 1u : 2u,
                placement(e.value(QStringLiteral("oldPlacement"))),placement(e.value(QStringLiteral("newPlacement"))),0});
        }
        plan.dto.shape_valid=shape;
        dto={plan.dto,jsonRect(value.value(QStringLiteral("oldLayoutRect"))),jsonRect(value.value(QStringLiteral("layoutRect"))),
            number(value.value(QStringLiteral("oldMaxCamera"))),number(value.value(QStringLiteral("maxCamera"))),
            number(value.value(QStringLiteral("scopeRevision"))),number(value.value(QStringLiteral("sourceEpoch"))),
            number(value.value(QStringLiteral("sourceSampleSerial"))),rows.data(),static_cast<std::uint64_t>(rows.size())};
    }
    ColumnGeometryPlan(const ColumnGeometryPlan &)=delete;
    ColumnGeometryPlan &operator=(const ColumnGeometryPlan &)=delete;
};
}
