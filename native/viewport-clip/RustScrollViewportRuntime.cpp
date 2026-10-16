/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "RustScrollViewportRuntime.h"
#include "../common/NativeProtocolDto.h"
#include <QJsonDocument>
#include <cstdlib>
#include <limits>
#include <vector>
namespace CcNiri {
using namespace ProtocolAdapter;
void checkStatus(std::uint32_t status) { check(status); }
RustScrollViewportRuntime::RustScrollViewportRuntime()
    : m_handle(cc_niri_scroll_create(QRectF(0,0,1,1)==QRectF(1e-13,0,1,1))) {
    if (!m_handle) std::abort();
}
RustScrollViewportRuntime::RustScrollViewportRuntime(const RustScrollViewportRuntime &other)
    : m_handle(cc_niri_scroll_clone(other.m_handle)), m_ids(other.m_ids), m_names(other.m_names) {
    if (!m_handle) std::abort();
}
RustScrollViewportRuntime &RustScrollViewportRuntime::operator=(const RustScrollViewportRuntime &other) {
    if (this != &other) {
        checkStatus(cc_niri_scroll_copy(m_handle,other.m_handle)); m_ids=other.m_ids; m_names=other.m_names;
    }
    return *this;
}
RustScrollViewportRuntime::~RustScrollViewportRuntime() { cc_niri_scroll_destroy(m_handle); }
std::uint64_t RustScrollViewportRuntime::intern(const QString &id) {
    const auto found=m_ids.constFind(id);
    if (found != m_ids.cend()) return found.value();
    const auto result=cc_niri_scroll_intern(m_handle,text(id)); checkStatus(result.status);
    m_ids.insert(id,result.value); m_names.insert(result.value,id); return result.value;
}
bool RustScrollViewportRuntime::updateContext(const QJsonObject &state) {
    const ProtocolAdapter::ScrollContext decoded(state);
    return accepted(cc_niri_scroll_update_context(m_handle,&decoded.dto));
}
bool RustScrollViewportRuntime::arm(const QJsonObject &plan,ViewportMotionBackend::TimePoint now,const QHash<QString,QRectF> &frames,bool smooth,const QRectF &actualOutput) {
    std::vector<CcNiriWindowFrame> physical; physical.reserve(frames.size());
    for (auto it=frames.cbegin();it!=frames.cend();++it) physical.push_back({intern(it.key()),rect(it.value())});
    if (plan.value(QStringLiteral("type")) == QJsonValue(QStringLiteral("PARTIAL_SCROLL"))) {
        const ProtocolAdapter::PartialScrollPlan decoded(plan,[this](const QString &id) { return intern(id); });
        return accepted(cc_niri_scroll_arm_partial(m_handle,&decoded.dto,now.count(),physical.data(),physical.size(),smooth,rect(actualOutput)));
    }
    if (plan.value(QStringLiteral("type")) == QJsonValue(QStringLiteral("COLUMN_REINDEX"))) {
        const ProtocolAdapter::ReindexPlan decoded(plan,[this](const QString &id) { return intern(id); });
        return accepted(cc_niri_scroll_arm_reindex(m_handle,&decoded.dto,now.count(),physical.data(),physical.size(),smooth));
    }
    const ProtocolAdapter::ScrollPlan decoded(plan,[this](const QString &id) { return intern(id); });
    return accepted(cc_niri_scroll_arm_with_policy(m_handle,&decoded.dto,now.count(),physical.data(),physical.size(),smooth));
}
CcNiriScrollRetargetStatus RustScrollViewportRuntime::retargetStatus() const {
    const auto result=cc_niri_scroll_retarget_status(m_handle);checkStatus(result.status);return result;
}
CcNiriScrollTuningStatus RustScrollViewportRuntime::tuningStatus(bool configuredSmooth) const {
    const auto result=cc_niri_scroll_tuning_status(m_handle,configuredSmooth);checkStatus(result.status);return result;
}
void RustScrollViewportRuntime::cancel(const QString &session,qint64 epoch) { checkStatus(cc_niri_scroll_cancel(m_handle,text(session),epoch)); }
void RustScrollViewportRuntime::clear() { checkStatus(cc_niri_scroll_clear(m_handle)); }
void RustScrollViewportRuntime::remove(const QString &id) {
    const auto found=m_ids.constFind(id);
    if (found != m_ids.cend()) {
        const auto token=found.value(); checkStatus(cc_niri_scroll_remove(m_handle,token));
        m_ids.remove(id); m_names.remove(token);
    }
}
bool RustScrollViewportRuntime::active() const { const auto result=cc_niri_scroll_status(m_handle);checkStatus(result.status);return result.active!=0; }
bool RustScrollViewportRuntime::completed() const { const auto result=cc_niri_scroll_status(m_handle);checkStatus(result.status);return result.completed!=0; }
bool RustScrollViewportRuntime::clipsPartial() const {
    const auto result=cc_niri_scroll_status(m_handle); checkStatus(result.status); return (result.reserved & 1)!=0;
}
bool RustScrollViewportRuntime::inputBlocked(const QString &id, const QPointF &point) const {
    const auto found=m_ids.constFind(id); if (found==m_ids.cend()) return false;
    return accepted(cc_niri_scroll_input_blocked(m_handle,found.value(),point.x(),point.y()));
}
bool RustScrollViewportRuntime::partialInputBlocked(const QString &id,const QRectF &frame,const QPointF &point) const {
    const auto found=m_ids.constFind(id); if (found==m_ids.cend()) return false;
    return accepted(cc_niri_scroll_partial_blocked(m_handle,found.value(),rect(frame),point.x(),point.y()));
}
bool RustScrollViewportRuntime::partialPointAmbiguous(const QPointF &point) const {
    return accepted(cc_niri_scroll_partial_ambiguous(m_handle,point.x(),point.y()));
}
QString RustScrollViewportRuntime::partialHit(const QPointF &point) const {
    const auto result=cc_niri_scroll_partial_hit(m_handle,point.x(),point.y()); checkStatus(result.status);
    return m_names.value(result.value);
}
CcNiriPartialInputResult RustScrollViewportRuntime::partialInput(uint32_t kind,uint64_t id,bool blocked,uint32_t flags) {
    const auto result=cc_niri_scroll_partial_input(m_handle,kind,id,blocked,flags); checkStatus(result.status); return result;
}
CcNiriPartialStatus RustScrollViewportRuntime::partialStatus() const {
    const auto result=cc_niri_scroll_partial_status(m_handle); checkStatus(result.status); return result;
}
QString RustScrollViewportRuntime::contextText(std::uint32_t field) const {
    const auto result=cc_niri_scroll_context_text(m_handle,field); checkStatus(result.status);
    return QString::fromUtf16(reinterpret_cast<const char16_t*>(result.value.data),static_cast<qsizetype>(result.value.len));
}
QJsonObject RustScrollViewportRuntime::status() const {
    const auto result=cc_niri_scroll_status(m_handle); checkStatus(result.status);
    QJsonObject status{{QStringLiteral("sessionId"),contextText(0)},{QStringLiteral("workspaceId"),contextText(1)},
        {QStringLiteral("targetOutput"),contextText(2)},{QStringLiteral("epoch"),static_cast<qint64>(result.epoch)},
        {QStringLiteral("active"),result.active!=0},{QStringLiteral("completed"),result.completed!=0}};
    if (result.reserved & 1) status.insert(QStringLiteral("clipPartial"), true);
    return status;
}
bool RustScrollViewportRuntime::advance(ViewportMotionBackend::TimePoint now) { return accepted(cc_niri_scroll_advance(m_handle,now.count())); }
bool RustScrollViewportRuntime::prepareFrame(ViewportMotionBackend::TimePoint now) { return accepted(cc_niri_scroll_prepare_frame(m_handle,now.count())); }
bool RustScrollViewportRuntime::prepareFrame(ViewportMotionBackend::TimePoint now,bool outputValid,double scale,double refreshHz) {
    return accepted(cc_niri_scroll_prepare_frame_with_output(m_handle,now.count(),outputValid,scale,refreshHz));
}
bool RustScrollViewportRuntime::markPainted(qint64 epoch, qint64 timeNs) { return accepted(cc_niri_scroll_mark_painted(m_handle,epoch,timeNs)); }
CcNiriScrollSample RustScrollViewportRuntime::frameSample(bool painted) const {
    const auto result = cc_niri_scroll_frame_sample(m_handle, painted); checkStatus(result.status); return result;
}
CcNiriScrollSample RustScrollViewportRuntime::originSample() const {
    const auto result = cc_niri_scroll_frame_sample(m_handle, 2); checkStatus(result.status); return result;
}
std::optional<ScrollProjection> RustScrollViewportRuntime::projection(const QString &id,const QRectF &geometry) const {
    const auto found=m_ids.constFind(id); if (found==m_ids.cend()) return std::nullopt;
    if (columnGeometryActive()) {
        const auto p=cc_niri_scroll_geometry_projection(m_handle,found.value(),rect(geometry)); checkStatus(p.status);
        if (!p.active) return std::nullopt;
        return ScrollProjection{p.translation_x,rect(p.viewport),true,p.translation_y};
    }
    const auto result=cc_niri_scroll_projection(m_handle,found.value(),rect(geometry)); checkStatus(result.status);
    if (!result.active) return std::nullopt;
    return ScrollProjection{result.translation_x,rect(result.viewport),(result.active & 2)!=0};
}
QHash<QString,QRectF> RustScrollViewportRuntime::frames(std::uint32_t kind) const {
    const auto count=cc_niri_scroll_frames(m_handle,kind,nullptr,0); checkStatus(count.status);
    std::vector<CcNiriWindowFrame> rows(count.value);
    const auto filled=cc_niri_scroll_frames(m_handle,kind,rows.data(),rows.size()); checkStatus(filled.status);
    QHash<QString,QRectF> result;
    for (const auto &r:rows) result.insert(m_names.value(r.window_id),rect(r.rect));
    return result;
}
QHash<QString,QRectF> RustScrollViewportRuntime::targets() const { return frames(0); }
QHash<QString,QRectF> RustScrollViewportRuntime::sourceFrames() const { return frames(1); }
QString RustScrollViewportRuntime::role(const QString &id) const {
    const auto found=m_ids.constFind(id); if (found==m_ids.cend()) return {};
    const auto result=cc_niri_scroll_role(m_handle,found.value()); checkStatus(result.status);
    switch (result.value) { case 0:return {};case 1:return QStringLiteral("continuing");case 2:return QStringLiteral("incoming");case 3:return QStringLiteral("outgoing");default:std::abort(); }
}
}

namespace CcNiri {
bool RustScrollViewportRuntime::recordClientPainted(const QString &id,qint64 epoch,qint64 timeNs,quint64 serial,const QRectF &frame) {
    const auto found=m_ids.constFind(id);
    return found!=m_ids.cend() && accepted(cc_niri_scroll_record_client_painted(m_handle,found.value(),epoch,timeNs,serial,rect(frame)));
}
QJsonObject RustScrollViewportRuntime::columnGeometrySource(const QRectF &actualOutput,const QString &actualWorkspace,const QString &actualOutputName) const {
    const QJsonObject invalid{{QStringLiteral("valid"),false}};
    if (!accepted(cc_niri_scroll_client_source_complete(m_handle,rect(actualOutput),text(actualWorkspace),text(actualOutputName)))) return invalid;
    const auto sample=frameSample(true);
    if (!sample.valid) return invalid;
    const auto jsonRect=[](const CcNiriRect &r) { return QJsonObject{{QStringLiteral("x"),r.x},
        {QStringLiteral("y"),r.y},{QStringLiteral("width"),r.width},{QStringLiteral("height"),r.height}}; };
    auto result=status();
    result.insert(QStringLiteral("valid"),true);
    result.insert(QStringLiteral("protocol"),4);
    result.insert(QStringLiteral("type"),QStringLiteral("COLUMN_GEOMETRY_SOURCE"));
    result.insert(QStringLiteral("cameraX"),sample.position);
    QJsonArray entries;
    // Event-boundary telemetry only; the actual paint callback never builds JSON.
    const auto targets=frames(0);
    for (auto it=targets.cbegin();it!=targets.cend();++it) {
        const auto p=cc_niri_scroll_client_paint(m_handle,m_ids.value(it.key()));
        checkStatus(p.status);
        if (!p.active || p.epoch!=sample.epoch || p.time_ns!=sample.time_ns) return invalid;
        result.insert(QStringLiteral("scopeRevision"),p.scope_revision);
        result.insert(QStringLiteral("sampleSerial"),qint64(p.serial));
        result.insert(QStringLiteral("maxCamera"),p.max_camera);
        result.insert(QStringLiteral("viewport"),jsonRect(p.viewport));
        result.insert(QStringLiteral("layoutRect"),jsonRect(p.layout));
        entries.append(QJsonObject{{QStringLiteral("windowId"),it.key()}, {QStringLiteral("columnId"),p.column_id},
            {QStringLiteral("logicalX"),p.logical_x}, {QStringLiteral("frameRect"),jsonRect(p.frame)},
            {QStringLiteral("visualRect"),jsonRect(p.visual)}, {QStringLiteral("velocityX"),p.velocity_x},
            {QStringLiteral("velocityY"),p.velocity_y}, {QStringLiteral("owned"),true},
            {QStringLiteral("painted"),true}, {QStringLiteral("acknowledged"),true}});
    }
    result.insert(QStringLiteral("entries"),entries);
    return result;
}
}

namespace CcNiri {
bool RustScrollViewportRuntime::columnGeometryActive() const {
    const auto s=cc_niri_scroll_status(m_handle);checkStatus(s.status);return (s.reserved & 2)!=0;
}
CcNiriGeometrySourceRow RustScrollViewportRuntime::geometryFact(const QString &id,double columnId,const QRectF &frame,double opacity,uint32_t flags) {
    return {intern(id),columnId,rect(frame),opacity,flags,0};
}
bool RustScrollViewportRuntime::armGeometry(const QJsonObject &plan,ViewportMotionBackend::TimePoint now,const std::vector<CcNiriGeometrySourceRow> &facts,bool smooth,const QRectF &actualOutput) {
    const ProtocolAdapter::ColumnGeometryPlan decoded(plan,[this](const QString &id){return intern(id);});
    return accepted(cc_niri_scroll_arm_geometry(m_handle,&decoded.dto,now.count(),facts.data(),facts.size(),smooth,rect(actualOutput)));
}
bool RustScrollViewportRuntime::observeClientFrame(const QString &id,const QRectF &frame) {
    const auto found=m_ids.constFind(id);return found!=m_ids.cend() && accepted(cc_niri_scroll_observe_client_frame(m_handle,found.value(),rect(frame)));
}
bool RustScrollViewportRuntime::finishGeometryFrame(qint64 epoch,qint64 timeNs,quint64 serial,const CcNiriGeometrySourceRow *facts,size_t count) {
    return accepted(cc_niri_scroll_finish_geometry_frame(m_handle,epoch,timeNs,serial,facts,count));
}
QJsonObject RustScrollViewportRuntime::geometrySource(const std::vector<CcNiriGeometrySourceRow> &facts,const QRectF &actualOutput,const QString &workspace,const QString &output) const {
    const QJsonObject invalid{{QStringLiteral("valid"),false}};
    std::vector<CcNiriClientPaint> poses(facts.size());
    const auto source=cc_niri_scroll_geometry_source(m_handle,facts.data(),facts.size(),rect(actualOutput),text(workspace),text(output),poses.data(),poses.size());checkStatus(source.status);
    if (!source.valid || source.count!=facts.size()) return invalid;
    const auto jsonRect=[](const CcNiriRect &r){return QJsonObject{{QStringLiteral("x"),r.x},{QStringLiteral("y"),r.y},{QStringLiteral("width"),r.width},{QStringLiteral("height"),r.height}};};
    auto value=status();value.insert(QStringLiteral("valid"),true);value.insert(QStringLiteral("protocol"),4);value.insert(QStringLiteral("type"),QStringLiteral("COLUMN_GEOMETRY_SOURCE"));
    value.insert(QStringLiteral("epoch"),qint64(source.epoch));value.insert(QStringLiteral("sampleSerial"),qint64(source.serial));value.insert(QStringLiteral("scopeRevision"),source.scope_revision);
    value.insert(QStringLiteral("cameraX"),source.camera_x);value.insert(QStringLiteral("maxCamera"),source.max_camera);
    value.insert(QStringLiteral("viewport"),jsonRect(source.viewport));value.insert(QStringLiteral("layoutRect"),jsonRect(source.layout));
    QJsonArray entries;
    for (size_t i=0;i<poses.size();++i) { const auto &p=poses[i];const bool owned=p.active!=2;
        entries.append(QJsonObject{{QStringLiteral("windowId"),m_names.value(facts[i].window_id)},{QStringLiteral("columnId"),p.column_id},
            {QStringLiteral("frameRect"),jsonRect(p.frame)},{QStringLiteral("logicalX"),owned?QJsonValue(p.logical_x):QJsonValue(QJsonValue::Null)},
            {QStringLiteral("visualRect"),owned?QJsonValue(jsonRect(p.visual)):QJsonValue(QJsonValue::Null)},
            {QStringLiteral("velocityX"),p.velocity_x},{QStringLiteral("velocityY"),p.velocity_y},
            {QStringLiteral("owned"),owned},{QStringLiteral("painted"),p.active==1},{QStringLiteral("hidden"),p.active==2},{QStringLiteral("culled"),p.active==3},{QStringLiteral("acknowledged"),true}});
    }
    value.insert(QStringLiteral("entries"),entries);return value;
}
}

namespace CcNiri {
QJsonObject RustScrollViewportRuntime::geometryCompletion() const {
    const auto proof=cc_niri_scroll_geometry_completion(m_handle);checkStatus(proof.status);
    auto value=status();value.insert(QStringLiteral("protocol"),4);value.insert(QStringLiteral("type"),QStringLiteral("COLUMN_GEOMETRY_COMPLETION"));
    value.insert(QStringLiteral("scopeRevision"),proof.scope_revision);value.insert(QStringLiteral("epoch"),qint64(proof.epoch));
    value.insert(QStringLiteral("sampleSerial"),qint64(proof.serial));value.insert(QStringLiteral("completed"),proof.completed!=0);
    value.insert(QStringLiteral("painted"),proof.completed!=0);return value;
}
}

namespace CcNiri { bool RustScrollViewportRuntime::sourceReady() const {return accepted(cc_niri_scroll_frame_ready(m_handle));} }

namespace CcNiri { bool RustScrollViewportRuntime::needsRepaint() const {return accepted(cc_niri_scroll_needs_repaint(m_handle));} }
