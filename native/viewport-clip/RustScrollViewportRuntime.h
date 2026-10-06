/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "ViewportMotionBackend.h"
#include "ScrollTypes.h"
#include "cc_niri_native_core.h"
namespace CcNiri {
// Qt value conversion and handle ownership only. Rust owns protocol/runtime policy.
class RustScrollViewportRuntime {
public:
    RustScrollViewportRuntime();
    RustScrollViewportRuntime(const RustScrollViewportRuntime &other);
    RustScrollViewportRuntime &operator=(const RustScrollViewportRuntime &other);
    ~RustScrollViewportRuntime();
    bool updateContext(const QJsonObject &state);
    bool arm(const QJsonObject &plan, ViewportMotionBackend::TimePoint now, const QHash<QString,QRectF> &frames = {});
    void cancel(const QString &session,qint64 epoch);
    void clear();
    void remove(const QString &id);
    bool active() const;
    bool completed() const;
    QJsonObject status() const;
    bool advance(ViewportMotionBackend::TimePoint now);
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
