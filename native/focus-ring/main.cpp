/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingEffect.h"
#include "effect/effecthandler.h"
namespace KWin {
KWIN_EFFECT_FACTORY_SUPPORTED(CcNiriFocusRingEffect, "metadata.json", return effects->isOpenGLCompositing();)
}
#include "main.moc"
