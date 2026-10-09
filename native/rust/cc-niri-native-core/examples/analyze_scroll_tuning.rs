// SPDX-License-Identifier: GPL-2.0-or-later
//! Offline model comparison, not a measurement of compositor presentation.
use cc_niri_native_core::scroll_retarget::MotionBounds;
use cc_niri_native_core::scroll_visual::{settled, OutputFacts};
use cc_niri_native_core::spring::{Spring, SpringParams};
use cc_niri_native_core::viewport_motion::{MotionKind, MotionSample, ViewportMotion};

fn first_ns(mut predicate: impl FnMut(i64) -> bool) -> i64 {
    let (mut lo, mut hi) = (0, 3_000_000_000);
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if predicate(mid) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    lo
}
fn main() {
    println!("stiffness,scale,hz,threshold_px,t95_ms,visual_ms,numerical_ms,phase_periods,max_step_px,first_sample_px,reverse_velocity_sign_ms,reverse_strategy");
    for stiffness in [800.0, 600.0, 500.0] {
        let params = SpringParams {
            stiffness,
            ..SpringParams::default()
        };
        let spring = Spring::new(0.0, 1260.0, 0.0, params);
        let t95 = first_ns(|t| (spring.sample(t).position - 1260.0).abs() <= 63.0);
        let numerical = first_ns(|t| spring.is_settled(spring.sample(t)));
        // Identical event sequence: L at 0, L at 60ms, H at 100ms.
        let mut motion = ViewportMotion::new(params);
        let bounds = MotionBounds {
            lower: 0.0,
            upper: 5040.0,
            reverse_limit: 50.24,
        };
        motion
            .start_bounded(0.0, 1260.0, 0.0, bounds, 1, 0)
            .unwrap();
        let anchor = motion.sample(60_000_000);
        motion
            .start_bounded(
                anchor.current,
                2520.0,
                anchor.velocity,
                bounds,
                2,
                60_000_000,
            )
            .unwrap();
        let anchor = motion.sample(100_000_000);
        let reverse = motion
            .start_bounded(anchor.current, 0.0, anchor.velocity, bounds, 3, 100_000_000)
            .unwrap();
        let reverse_sign = (0..=100_000)
            .find(|us| motion.sample(100_000_000 + us * 1000).velocity < 0.0)
            .unwrap();
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for hz in [59.94, 60.0, 120.0, 144.0] {
                let facts = OutputFacts {
                    valid: true,
                    scale,
                    refresh_hz: hz,
                };
                for threshold in [0.125, 0.25, 0.5] {
                    let visual = first_ns(|t| {
                        let raw = spring.sample(t);
                        settled(
                            MotionSample {
                                current: raw.position,
                                velocity: raw.velocity,
                                target: 1260.0,
                                kind: MotionKind::Animation,
                                epoch: 1,
                            },
                            params,
                            facts,
                            threshold,
                        )
                    });
                    for phase in [0.0, 0.5, 0.9] {
                        let mut previous = 0.0;
                        let mut max_step: f64 = 0.0;
                        let mut first = 0.0;
                        for frame in 0..=180 {
                            let ns = ((frame as f64 + phase) * 1e9 / hz) as i64;
                            let x = spring.sample(ns).position;
                            if frame == 0 {
                                first = x * scale;
                            }
                            max_step = max_step.max((x - previous).abs() * scale);
                            previous = x;
                        }
                        println!("{stiffness},{scale},{hz},{threshold},{:.6},{:.6},{:.6},{phase},{max_step:.6},{first:.6},{:.6},{}",
                            t95 as f64 / 1e6, visual as f64 / 1e6, numerical as f64 / 1e6,
                            reverse_sign as f64 / 1000.0, reverse.strategy as u32);
                    }
                }
            }
        }
    }
}
