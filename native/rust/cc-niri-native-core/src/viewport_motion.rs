// SPDX-License-Identifier: GPL-2.0-or-later
//! Position-continuous motion with the legacy epoch and monotonic-time barriers.
use crate::native_protocol::Epoch;
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
        self.kind = if from == target {
            MotionKind::Static
        } else {
            MotionKind::Animation
        };
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
        let value = self.spring.sample(elapsed);
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
        true
    }
    pub fn snap(&mut self, offset: f64) -> bool {
        if !offset.is_finite() {
            return false;
        }
        self.from = offset;
        self.target = offset;
        self.kind = MotionKind::Static;
        // Preserve epoch and time barriers, including after cancellation.
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
