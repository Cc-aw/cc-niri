/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include "FocusRingCore.h"
#if defined(CC_NIRI_USE_RUST_FOCUS_RING_CORE) && CC_NIRI_USE_RUST_FOCUS_RING_CORE
namespace CcNiri::FocusRingCore {
inline CcNiriRingCorners corners(double a,double b,bool loaded) { return cc_niri_ring_corners(a,b,loaded); }
inline CcNiriRingRadius radius(CcNiriRingCorners c,const double native[4],double w,double h) { return cc_niri_ring_radius(c,native,w,h); }
inline bool geometryValid(double w,double h,const double r[4]) { return cc_niri_ring_geometry_valid(w,h,r); }
inline CcNiriRingFrameResult capture(const CcNiriRingFrame &f) { return cc_niri_ring_capture(&f); }
inline CcNiriRingMetricsResult metrics(const CcNiriRingInput &i) { return cc_niri_ring_metrics(&i); }
inline CcNiriRingLayout layout(const CcNiriRingMetrics &m) { return cc_niri_ring_layout(&m); }
inline CcNiriRect damage(CcNiriRect r,CcNiriRingMetrics m) { return cc_niri_ring_damage(r,m); }
inline double padding(double p) { return cc_niri_ring_padding(p); }
inline double devicePadding(double p,double s) { return cc_niri_ring_device_padding(p,s); }
}
namespace CcNiri { inline constexpr const char *FocusRingCoreBackendName = "Rust"; }
#else
namespace CcNiri {
namespace FocusRingCore = FocusRingReference;
inline constexpr const char *FocusRingCoreBackendName = "C++";
}
#endif
