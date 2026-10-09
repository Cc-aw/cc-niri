// SPDX-License-Identifier: GPL-2.0-or-later
//! Position-continuous motion with the legacy epoch and monotonic-time barriers.
use crate::native_protocol::Epoch;
use crate::scroll_retarget::{self, Brake, MotionBounds, RetargetDecision};
use crate::spring::{Spring, SpringParams};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MotionKind {
    Static,
    Animation,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionSample {
    pub kind: MotionKind,
    pub current: f64,
    pub target: f64,
    pub velocity: f64,
    pub epoch: i64,
}

#[derive(Clone, Debug)]
pub struct ViewportMotion {
    params: SpringParams,
    spring: Spring,
    kind: MotionKind,
    from: f64,
    target: f64,
    epoch: Epoch,
    started_at: i64,
    brake: Option<Brake>,
    curve_range: Option<(f64, f64)>,
}

impl ViewportMotion {
    pub const MAX_SPRING_TIME_NS: i64 = 3_000_000_000;
    pub fn new(params: SpringParams) -> Self {
        Self {
            params,
            spring: Spring::new(0.0, 0.0, 0.0, params),
            kind: MotionKind::Static,
            from: 0.0,
            target: 0.0,
            epoch: Epoch::NONE,
            started_at: 0,
            brake: None,
            curve_range: None,
        }
    }
    pub fn start(&mut self, from: f64, target: f64, epoch: i64, now: i64) -> bool {
        if epoch < 0 || Epoch(epoch) < self.epoch || now < 0 {
            return false;
        }
        if Epoch(epoch) == self.epoch {
            return from == self.from && target == self.target;
        }
        if now < self.started_at {
            return false;
        }
        let candidate = Spring::new(from, target, 0.0, self.params);
        if !candidate.is_valid() {
            return false;
        }
        self.spring = candidate;
        self.from = from;
        self.target = target;
        self.epoch = Epoch(epoch);
        self.started_at = now;
        self.brake = None;
        self.curve_range = None;
        self.kind = if from == target {
            MotionKind::Static
        } else {
            MotionKind::Animation
        };
        true
    }
    pub fn set_scroll_parameters(&mut self, smooth: bool) {
        let params = crate::scroll_visual::parameters(smooth);
        if self.params.stiffness != params.stiffness {
            self.curve_range = None;
        }
        self.params = params;
    }
    pub fn stiffness(&self) -> f64 {
        self.params.stiffness
    }
    // Scroll smooth60 entry only. Legacy start / retarget retain their oracle.
    pub fn start_bounded(
        &mut self,
        from: f64,
        target: f64,
        velocity: f64,
        bounds: MotionBounds,
        epoch: i64,
        now: i64,
    ) -> Option<RetargetDecision> {
        if epoch < 0 || Epoch(epoch) <= self.epoch || now < 0 || now < self.started_at {
            return None;
        }
        let planned = scroll_retarget::plan(from, target, velocity, bounds, self.params)?;
        self.curve_range = if let Some(brake) = planned.brake {
            Some((
                from.min(target).min(brake.end()),
                from.max(target).max(brake.end()),
            ))
        } else {
            scroll_retarget::critical_range(
                from,
                target,
                planned.decision.initial_velocity,
                self.params,
            )
        };
        self.spring = planned.spring;
        self.brake = planned.brake;
        self.from = from;
        self.target = target;
        self.epoch = Epoch(epoch);
        self.started_at = now;
        self.kind = if from == target && planned.decision.initial_velocity == 0.0 {
            MotionKind::Static
        } else {
            MotionKind::Animation
        };
        Some(planned.decision)
    }
    pub fn can_keep_curve(&self, target: f64, bounds: MotionBounds) -> bool {
        self.target == target
            && self
                .curve_range
                .is_some_and(|(low, high)| bounds.contains(low) && bounds.contains(high))
    }
    pub fn keep_curve(&mut self, epoch: i64, now: i64) -> bool {
        if epoch < 0 || Epoch(epoch) <= self.epoch || now < 0 || now < self.started_at {
            return false;
        }
        self.epoch = Epoch(epoch);
        true
    }
    pub fn retarget(&mut self, target: f64, epoch: i64, now: i64) -> bool {
        if epoch < 0 || now < 0 {
            return false;
        }
        if Epoch(epoch) == self.epoch {
            return target.is_finite() && target == self.target;
        }
        if now < self.started_at {
            return false;
        }
        // Legacy policy: preserve position, restart with zero velocity.
        self.start(self.sample(now).current, target, epoch, now)
    }
    pub fn sample(&self, now: i64) -> MotionSample {
        let completed = MotionSample {
            kind: MotionKind::Static,
            current: self.target,
            target: self.target,
            velocity: 0.0,
            epoch: self.epoch.0,
        };
        if self.kind == MotionKind::Static {
            return completed;
        }
        // Accepted start times are nonnegative; this subtraction cannot overflow.
        let elapsed = if now <= self.started_at {
            0
        } else {
            now - self.started_at
        };
        if elapsed >= Self::MAX_SPRING_TIME_NS {
            return completed;
        }
        let value = match self.brake {
            Some(brake) if elapsed < brake.duration_ns => brake.sample(elapsed),
            Some(brake) => self.spring.sample(elapsed - brake.duration_ns),
            None => self.spring.sample(elapsed),
        };
        if self.spring.is_settled(value) {
            return completed;
        }
        MotionSample {
            kind: MotionKind::Animation,
            current: value.position,
            target: self.target,
            velocity: value.velocity,
            epoch: self.epoch.0,
        }
    }
    pub fn finish(&mut self, epoch: i64, now: i64) -> bool {
        if Epoch(epoch) != self.epoch || epoch < 0 || self.sample(now).kind != MotionKind::Static {
            return false;
        }
        self.kind = MotionKind::Static;
        self.brake = None;
        self.curve_range = None;
        true
    }
    // Visual completion is pending until ScrollRuntime commits an actual paint.
    // Braking is explicitly excluded, even if its instantaneous pose is close.
    pub fn sample_visual(
        &self,
        now: i64,
        facts: crate::scroll_visual::OutputFacts,
    ) -> MotionSample {
        if self.kind == MotionKind::Animation {
            if let Some(brake) = self
                .brake
                .filter(|b| now.saturating_sub(self.started_at) < b.duration_ns)
            {
                let raw = brake.sample(now.saturating_sub(self.started_at));
                return MotionSample {
                    kind: MotionKind::Animation,
                    current: raw.position,
                    velocity: raw.velocity,
                    target: self.target,
                    epoch: self.epoch.0,
                };
            }
        }
        let sample = self.sample(now);
        if sample.kind == MotionKind::Animation
            && crate::scroll_visual::settled(
                sample,
                self.params,
                facts,
                crate::scroll_visual::VISUAL_THRESHOLD_PX,
            )
        {
            MotionSample {
                kind: MotionKind::Static,
                current: sample.target,
                velocity: 0.0,
                ..sample
            }
        } else {
            sample
        }
    }
    pub fn snap(&mut self, offset: f64) -> bool {
        if !offset.is_finite() {
            return false;
        }
        self.from = offset;
        self.target = offset;
        self.kind = MotionKind::Static;
        self.brake = None;
        self.curve_range = None;
        // Preserve epoch and time barriers, including after cancellation.
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn even_subpixel_brake_must_finish_before_visual_snap() {
        let mut motion = ViewportMotion::new(crate::scroll_visual::parameters(true));
        assert!(motion.start(0.0, 0.00001, 1, 0));
        motion.brake = Some(Brake {
            from: 0.0,
            velocity: 0.0001,
            duration_ns: 50_000_000,
        });
        let facts = crate::scroll_visual::OutputFacts {
            valid: true,
            scale: 1.5,
            refresh_hz: 60.0,
        };
        assert_eq!(
            motion.sample_visual(40_000_000, facts).kind,
            MotionKind::Animation
        );
    }
    #[test]
    fn retarget_preserves_position_and_resets_velocity() {
        let mut motion = ViewportMotion::new(SpringParams::default());
        assert!(motion.start(0.0, 1260.0, 0, 100));
        let before = motion.sample(50_000_100);
        assert_ne!(before.velocity, 0.0);
        assert!(motion.retarget(-1260.0, 1, 50_000_100));
        let after = motion.sample(50_000_100);
        assert_eq!(after.current, before.current);
        assert_eq!(after.velocity, 0.0);
    }
    #[test]
    fn duplicates_snap_and_rejections_preserve_barriers() {
        let mut motion = ViewportMotion::new(SpringParams::default());
        assert!(!motion.start(0.0, 0.0, -1, 0));
        assert!(motion.start(0.0, 100.0, 5, 100));
        assert!(motion.start(0.0, 100.0, 5, 0));
        assert!(motion.retarget(100.0, 5, 0));
        let before = motion.sample(100_000_100);
        for (target, epoch, now) in [
            (f64::NAN, 6, 100),
            (10.0, 4, 100),
            (10.0, 6, 99),
            (10.0, 6, -1),
        ] {
            assert!(!motion.retarget(target, epoch, now));
            assert_eq!(motion.sample(100_000_100), before);
        }
        assert!(motion.snap(42.0));
        assert!(!motion.retarget(10.0, 4, 100));
        assert!(!motion.retarget(10.0, 6, 99));
        assert!(motion.start(42.0, 42.0, 5, 0));
        assert!(motion.finish(5, -1));
    }
    #[test]
    fn timeout_and_extreme_clock_do_not_mutate_sampling_state() {
        let mut motion = ViewportMotion::new(SpringParams {
            stiffness: 0.01,
            ..SpringParams::default()
        });
        assert!(motion.start(0.0, 100.0, i64::MAX, 1));
        assert_eq!(motion.sample(3_000_000_000).kind, MotionKind::Animation);
        assert_eq!(motion.sample(3_000_000_001).kind, MotionKind::Static);
        assert_eq!(motion.sample(i64::MIN).current, 0.0);
        assert!(!motion.finish(i64::MAX, 2));
        assert!(motion.finish(i64::MAX, i64::MAX));
        assert_eq!(motion.sample(2).kind, MotionKind::Static);
        let mut edge = ViewportMotion::new(SpringParams::default());
        assert!(edge.start(0.0, 100.0, 0, i64::MAX - 100));
        assert_eq!(edge.sample(i64::MIN).current, 0.0);
        assert!(edge.sample(i64::MAX).current.is_finite());
    }
}
