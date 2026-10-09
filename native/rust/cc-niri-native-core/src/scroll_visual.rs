// SPDX-License-Identifier: GPL-2.0-or-later
//! Scroll-only tuning and physical-pixel completion; no output or clock authority.
use crate::scroll_retarget::critical_range;
use crate::spring::SpringParams;
use crate::viewport_motion::MotionSample;

pub const SMOOTH_STIFFNESS: f64 = 600.0;
pub const VISUAL_THRESHOLD_PX: f64 = 0.25;

pub fn parameters(smooth: bool) -> SpringParams {
    SpringParams {
        stiffness: if smooth { SMOOTH_STIFFNESS } else { 800.0 },
        ..SpringParams::default()
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct OutputFacts {
    pub valid: bool,
    pub scale: f64,
    pub refresh_hz: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u32)]
pub enum VisualFallback {
    #[default]
    Disabled = 0,
    None = 1,
    MissingOutput = 2,
    InvalidScale = 3,
    UnknownRefresh = 4,
    AwaitingFrame = 5,
}

impl OutputFacts {
    pub fn fallback(self) -> VisualFallback {
        if !self.valid {
            VisualFallback::MissingOutput
        } else if !self.scale.is_finite() || self.scale <= 0.0 {
            VisualFallback::InvalidScale
        } else if !self.refresh_hz.is_finite() || self.refresh_hz <= 0.0 {
            VisualFallback::UnknownRefresh
        } else {
            VisualFallback::None
        }
    }
}

pub fn settled(sample: MotionSample, params: SpringParams, facts: OutputFacts, px: f64) -> bool {
    if facts.fallback() != VisualFallback::None || !px.is_finite() || px <= 0.0 {
        return false;
    }
    if (sample.target - sample.current).abs() * facts.scale > px
        || sample.velocity.abs() / facts.refresh_hz * facts.scale > px
    {
        return false;
    }
    // A slow target crossing may satisfy both instantaneous tests but still
    // depart afterwards. Bound the whole remaining analytic critical curve.
    critical_range(sample.current, sample.target, sample.velocity, params).is_some_and(
        |(low, high)| {
            (low - sample.target)
                .abs()
                .max((high - sample.target).abs())
                * facts.scale
                <= px
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spring::Spring;
    use crate::viewport_motion::{MotionKind, ViewportMotion};

    #[test]
    fn crossing_requires_future_envelope_and_invalid_facts_fail_closed() {
        let facts = OutputFacts {
            valid: true,
            scale: 1.0,
            refresh_hz: 144.0,
        };
        let sample = MotionSample {
            kind: MotionKind::Animation,
            current: 0.0,
            target: 0.0,
            velocity: 30.0,
            epoch: 1,
        };
        assert!(sample.velocity / facts.refresh_hz < VISUAL_THRESHOLD_PX);
        assert!(!settled(
            sample,
            parameters(true),
            facts,
            VISUAL_THRESHOLD_PX
        ));
        for bad in [
            OutputFacts::default(),
            OutputFacts {
                scale: 0.0,
                ..facts
            },
            OutputFacts {
                scale: f64::NAN,
                ..facts
            },
            OutputFacts {
                refresh_hz: 0.0,
                ..facts
            },
            OutputFacts {
                refresh_hz: f64::INFINITY,
                ..facts
            },
        ] {
            assert!(!settled(
                MotionSample {
                    velocity: 0.0,
                    ..sample
                },
                parameters(true),
                bad,
                VISUAL_THRESHOLD_PX
            ));
        }
    }

    #[test]
    fn scales_rates_distances_velocities_and_long_frames_keep_tail_inside_threshold() {
        for scale in [1.0, 1.25, 1.5, 1.75, 2.0] {
            for refresh_hz in [59.94, 60.0, 120.0, 144.0] {
                let facts = OutputFacts {
                    valid: true,
                    scale,
                    refresh_hz,
                };
                for target in [0.05, 8.0, 1260.0, 10080.0] {
                    for velocity in [-8000.0, 0.0, 8000.0] {
                        let p = parameters(true);
                        let spring = Spring::new(0.0, target, velocity, p);
                        let mut found = false;
                        for frame in 0..=400 {
                            // Fixed output refresh despite intermittent 33ms / 100ms gaps.
                            let ns = (frame as f64 * 1e9 / refresh_hz) as i64;
                            let raw = spring.sample(ns);
                            let sample = MotionSample {
                                current: raw.position,
                                target,
                                velocity: raw.velocity,
                                kind: MotionKind::Animation,
                                epoch: 1,
                            };
                            if settled(sample, p, facts, VISUAL_THRESHOLD_PX) {
                                for after in 0..=1000 {
                                    assert!(
                                        (spring.sample(ns + after * 1_000_000).position - target)
                                            .abs()
                                            * scale
                                            <= VISUAL_THRESHOLD_PX + 1e-8
                                    );
                                }
                                found = true;
                                break;
                            }
                        }
                        assert!(found);
                    }
                }
                let mut motion = ViewportMotion::new(parameters(true));
                assert!(motion.start(0.0, 1260.0, 1, 0));
                assert_eq!(
                    motion.sample_visual(2_000_000_000, facts).kind,
                    MotionKind::Static
                );
            }
        }
    }
}
