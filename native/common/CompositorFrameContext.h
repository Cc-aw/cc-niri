/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <QObject>
#include <QPointer>
#include <QVariant>
#include <cstdint>
#include <optional>

namespace CcNiri {
inline constexpr char CompositorFrameProperty[] = "ccNiriCompositorFrame";
// A lifetime token requests existing Clip paint hooks only while a finite
// visual transition runs. It does not select timestamps or schedule a timer.
inline constexpr char CompositorFrameDemandProperty[] = "ccNiriCompositorFrameDemand";
struct CompositorFrame {
    uintptr_t output = 0;
    int64_t presentationNs = 0;
    bool real = false;
};
// Clip publishes its already selected time around the synchronous effect
// chain. Consumers copy values, never retain this stack address or own a clock.
class ScopedCompositorFrame {
public:
    ScopedCompositorFrame(QObject *host, CompositorFrame frame) : m_host(host), m_frame(frame) {
        if (!host) return;
        m_previous = host->property(CompositorFrameProperty);
        m_address = QVariant::fromValue(reinterpret_cast<quintptr>(&m_frame));
        host->setProperty(CompositorFrameProperty, m_address);
    }
    Q_DISABLE_COPY_MOVE(ScopedCompositorFrame)
    ~ScopedCompositorFrame() {
        if (m_host && m_host->property(CompositorFrameProperty) == m_address)
            m_host->setProperty(CompositorFrameProperty, m_previous);
    }
    static std::optional<CompositorFrame> snapshot(QObject *host) {
        const auto address = host ? host->property(CompositorFrameProperty).value<quintptr>() : 0;
        return address ? std::optional<CompositorFrame>(*reinterpret_cast<const CompositorFrame *>(address)) : std::nullopt;
    }
private:
    QPointer<QObject> m_host;
    CompositorFrame m_frame;
    QVariant m_previous, m_address;
};
}
