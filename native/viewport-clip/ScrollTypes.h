/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QRectF>

namespace CcNiri {
inline constexpr qsizetype MaxMotionPlanBytes = 256 * 1024;
enum class ScrollPlanDisposition { Rejected, Duplicate, Accepted };
struct ScrollProjection { double translationX; QRectF viewport; };
}
