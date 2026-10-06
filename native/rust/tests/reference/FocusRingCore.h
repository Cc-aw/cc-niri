/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#ifndef CC_NIRI_GOLDEN_REFERENCE
#error "Frozen C++ reference is test-only; production must use Rust Native Core"
#endif
#include "cc_niri_native_core.h"
namespace CcNiri::FocusRingReference {
CcNiriRingCorners corners(double configured,double rounded,bool loaded);
CcNiriRingRadius radius(CcNiriRingCorners config,const double native[4],double width,double height);
bool geometryValid(double width,double height,const double radii[4]);
CcNiriRingFrameResult capture(const CcNiriRingFrame &frame);
CcNiriRingMetricsResult metrics(const CcNiriRingInput &input);
CcNiriRingLayout layout(const CcNiriRingMetrics &metrics);
CcNiriRect damage(CcNiriRect inner,CcNiriRingMetrics metrics);
double padding(double requested);
double devicePadding(double requested,double scale);
}
