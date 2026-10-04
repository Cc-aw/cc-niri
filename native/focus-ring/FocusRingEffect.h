/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "effect/effect.h"
#include "effect/effectwindow.h"
#include "FocusRingContext.h"
#include "FocusRingItem.h"
#include <QPointer>
#include <QSet>

namespace KWin {
class CcNiriFocusRingEffect : public Effect {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.cc.NiriFocusRingPoc1")
public:
    CcNiriFocusRingEffect();
    ~CcNiriFocusRingEffect() override;
    bool isActive() const override;
    bool blocksDirectScanout() const override;
public Q_SLOTS:
    Q_SCRIPTABLE QString GetFocusRingStatus() const;
private Q_SLOTS:
    void onDockStateChanged(const QString &json);
private:
    void requestContext();
    void watchWindow(EffectWindow *window);
    void refresh();
    bool eligible(EffectWindow *window) const;
    void clearRing();
    CcNiri::FocusRingContext m_context;
    FocusRingItem m_ring;
    QPointer<EffectWindow> m_owner;
    QSet<EffectWindow *> m_watched;
    QSet<QString> m_closedIds;
    quint64 m_contextRevision = 0;
    bool m_endpointRegistered = false;
};
}
