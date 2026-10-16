/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ViewportMotionBackend.h"
#include "ScrollTypes.h"
#include "cc_niri_native_core.h"
#include <vector>
namespace CcNiri {
// Qt value conversion and handle ownership only. Rust owns protocol/runtime policy.
class RustScrollViewportRuntime {
public:
    RustScrollViewportRuntime();
    RustScrollViewportRuntime(const RustScrollViewportRuntime &other);
    RustScrollViewportRuntime &operator=(const RustScrollViewportRuntime &other);
    ~RustScrollViewportRuntime();
    bool updateContext(const QJsonObject &state);
    bool arm(const QJsonObject &plan, ViewportMotionBackend::TimePoint now, const QHash<QString,QRectF> &frames = {}, bool smooth = false, const QRectF &actualOutput = {});
    bool armGeometry(const QJsonObject &plan,ViewportMotionBackend::TimePoint now,const std::vector<CcNiriGeometrySourceRow> &facts,bool smooth,const QRectF &actualOutput);
    bool columnGeometryActive() const;
    bool sourceReady() const;
    bool needsRepaint() const;
    QJsonObject geometryCompletion() const;
    CcNiriGeometrySourceRow geometryFact(const QString &id,double columnId,const QRectF &frame,double opacity,uint32_t flags);
    bool observeClientFrame(const QString &id,const QRectF &frame);
    bool finishGeometryFrame(qint64 epoch,qint64 timeNs,quint64 serial,const CcNiriGeometrySourceRow *facts,size_t count);
    QJsonObject geometrySource(const std::vector<CcNiriGeometrySourceRow> &facts,const QRectF &actualOutput,const QString &workspace,const QString &output) const;
    CcNiriScrollRetargetStatus retargetStatus() const;
    CcNiriScrollTuningStatus tuningStatus(bool configuredSmooth) const;
    void cancel(const QString &session,qint64 epoch);
    void clear();
    void remove(const QString &id);
    bool active() const;
    bool completed() const;
    bool clipsPartial() const;
    bool inputBlocked(const QString &id, const QPointF &point) const;
    bool partialInputBlocked(const QString &id, const QRectF &frame, const QPointF &point) const;
    bool partialPointAmbiguous(const QPointF &point) const;
    QString partialHit(const QPointF &point) const;
    CcNiriPartialInputResult partialInput(uint32_t kind,uint64_t id,bool blocked,uint32_t flags);
    CcNiriPartialStatus partialStatus() const;
    QHash<QString,QRectF> paintedTargets() const { return frames(2); }
    QJsonObject status() const;
    bool advance(ViewportMotionBackend::TimePoint now);
    bool prepareFrame(ViewportMotionBackend::TimePoint now);
    bool prepareFrame(ViewportMotionBackend::TimePoint now, bool outputValid, double scale, double refreshHz);
    bool markPainted(qint64 epoch, qint64 timeNs);
    bool recordClientPainted(const QString &id,qint64 epoch,qint64 timeNs,quint64 serial,const QRectF &frame);
    QJsonObject columnGeometrySource(const QRectF &actualOutput,const QString &actualWorkspace,const QString &actualOutputName) const;
    CcNiriScrollSample frameSample(bool painted = false) const;
    CcNiriScrollSample originSample() const;
    std::optional<ScrollProjection> projection(const QString &id,const QRectF &geometry) const;
    QHash<QString,QRectF> targets() const;
    QHash<QString,QRectF> sourceFrames() const;
    QString role(const QString &id) const;
private:
    std::uint64_t intern(const QString &id);
    QHash<QString,QRectF> frames(std::uint32_t kind) const;
    QString contextText(std::uint32_t field) const;
    CcNiriScroll *m_handle;
    QHash<QString,std::uint64_t> m_ids;
    QHash<std::uint64_t,QString> m_names;
};
}
