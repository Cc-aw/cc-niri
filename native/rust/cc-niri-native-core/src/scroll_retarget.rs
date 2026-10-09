// SPDX-License-Identifier: GPL-2.0-or-later
//! Bounded scroll-only planning. No clocks, layout authority or per-frame clamp.
use crate::spring::{Spring, SpringParams, SpringSample};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u32)]
pub enum RetargetStrategy {
    #[default]
    Rest = 0,
    Carry = 1,
    Brake = 2,
    Reset = 3,
    Keep = 4,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u32)]
pub enum ResetReason {
    #[default]
    None = 0,
    NoBrakeSpace = 1,
    InvalidMath = 2,
    Coverage = 3,
}
#[derive(Clone, Copy, Debug)]
pub struct MotionBounds {
    pub lower: f64,
    pub upper: f64,
    pub reverse_limit: f64,
}
impl MotionBounds {
    pub fn contains(self, x: f64) -> bool {
        x.is_finite() && x >= self.lower && x <= self.upper
    }
    fn valid(self) -> bool {
        self.lower.is_finite()
            && self.upper.is_finite()
            && self.lower <= self.upper
            && self.reverse_limit.is_finite()
            && self.reverse_limit >= 0.0
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct RetargetDecision {
    pub strategy: RetargetStrategy,
    pub reason: ResetReason,
    pub initial_velocity: f64,
    pub saved_velocity: f64,
    pub brake_ns: i64,
    pub brake_distance: f64,
    pub lower: f64,
    pub upper: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Brake {
    pub from: f64,
    pub velocity: f64,
    pub duration_ns: i64,
}
impl Brake {
    pub fn end(self) -> f64 {
        self.from + self.velocity * (self.duration_ns as f64 / 1e9) / 2.0
    }
    pub fn sample(self, elapsed_ns: i64) -> SpringSample {
        let t = elapsed_ns.max(0) as f64 / 1e9;
        let duration = self.duration_ns as f64 / 1e9;
        SpringSample {
            position: self.from + self.velocity * (t - t * t / (2.0 * duration)),
            velocity: self.velocity * (1.0 - t / duration),
        }
    }
}
pub struct PlannedSpring {
    pub spring: Spring,
    pub brake: Option<Brake>,
    pub decision: RetargetDecision,
}

// Critical damping has at most one finite velocity zero. Inspect the entire
// analytic curve, including the asymptotic target, rather than clamping samples.
pub fn critical_range(
    from: f64,
    target: f64,
    velocity: f64,
    params: SpringParams,
) -> Option<(f64, f64)> {
    if params.damping_ratio != 1.0 || !Spring::new(from, target, velocity, params).is_valid() {
        return None;
    }
    let omega = params.stiffness.sqrt() / params.mass.sqrt();
    let b = velocity + omega * (from - target);
    let mut low = from.min(target);
    let mut high = from.max(target);
    let denominator = omega * b;
    if !denominator.is_finite() {
        return None;
    }
    if denominator != 0.0 {
        let turn = velocity / denominator;
        if turn.is_finite() && turn > 0.0 {
            let peak = target + (-omega * turn).exp() * (from - target + b * turn);
            if !peak.is_finite() {
                return None;
            }
            low = low.min(peak);
            high = high.max(peak);
        }
    }
    Some((low, high))
}
pub fn plan(
    from: f64,
    target: f64,
    velocity: f64,
    bounds: MotionBounds,
    params: SpringParams,
) -> Option<PlannedSpring> {
    let rest = Spring::new(from, target, 0.0, params);
    if !rest.is_valid() {
        return None;
    }
    let mut decision = RetargetDecision {
        saved_velocity: velocity,
        lower: bounds.lower,
        upper: bounds.upper,
        ..Default::default()
    };
    let reset = |reason, mut decision: RetargetDecision| {
        decision.strategy = RetargetStrategy::Reset;
        decision.reason = reason;
        PlannedSpring {
            spring: rest.clone(),
            brake: None,
            decision,
        }
    };
    if !velocity.is_finite() {
        return Some(reset(ResetReason::InvalidMath, decision));
    }
    if velocity == 0.0 {
        return Some(PlannedSpring {
            spring: rest,
            brake: None,
            decision,
        });
    }
    if !bounds.valid() || !bounds.contains(from) || !bounds.contains(target) {
        return Some(reset(ResetReason::Coverage, decision));
    }
    let mut permitted = bounds;
    if velocity * (target - from) <= 0.0 {
        // The extra old-direction excursion is limited by both coverage and 2%
        // of the safe logical viewport, not by an independent screen-size guess.
        if velocity > 0.0 {
            permitted.upper = permitted.upper.min(from + bounds.reverse_limit);
        } else {
            permitted.lower = permitted.lower.max(from - bounds.reverse_limit);
        }
    }
    let Some((low, high)) = critical_range(from, target, velocity, params) else {
        return Some(reset(ResetReason::InvalidMath, decision));
    };
    if permitted.contains(low) && permitted.contains(high) {
        decision.strategy = RetargetStrategy::Carry;
        decision.initial_velocity = velocity;
        return Some(PlannedSpring {
            spring: Spring::new(from, target, velocity, params),
            brake: None,
            decision,
        });
    }
    let room = if velocity > 0.0 {
        permitted.upper - from
    } else {
        from - permitted.lower
    };
    let duration = (0.050_f64.min(2.0 * room / velocity.abs()) * 1e9).floor();
    if !duration.is_finite() || duration < 1.0 {
        return Some(reset(ResetReason::NoBrakeSpace, decision));
    }
    let brake = Brake {
        from,
        velocity,
        duration_ns: duration as i64,
    };
    let end = brake.end();
    let spring = Spring::new(end, target, 0.0, params);
    if !permitted.contains(end) || !spring.is_valid() || !(velocity / (duration / 1e9)).is_finite()
    {
        return Some(reset(ResetReason::InvalidMath, decision));
    }
    decision.strategy = RetargetStrategy::Brake;
    decision.initial_velocity = velocity;
    decision.brake_ns = brake.duration_ns;
    decision.brake_distance = end - from;
    Some(PlannedSpring {
        spring,
        brake: Some(brake),
        decision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_brake_is_c1_and_degradation_is_explicit() {
        let bounds = MotionBounds {
            lower: 0.0,
            upper: 1260.0,
            reverse_limit: 50.0,
        };
        let planned = plan(500.0, 0.0, 12000.0, bounds, SpringParams::default()).unwrap();
        assert_eq!(planned.decision.strategy, RetargetStrategy::Brake);
        let brake = planned.brake.unwrap();
        assert!(brake.duration_ns <= 50_000_000);
        assert!(brake.end() - brake.from <= 50.0);
        let left = brake.sample(brake.duration_ns);
        let right = planned.spring.sample(0);
        assert!((left.position - right.position).abs() < 1e-8 && left.velocity.abs() < 1e-8);
        for t in 0..=1000 {
            assert!(bounds.contains(brake.sample(t * brake.duration_ns / 1000).position));
        }
        let reset = plan(1260.0, 0.0, 12000.0, bounds, SpringParams::default()).unwrap();
        assert_eq!(reset.decision.reason, ResetReason::NoBrakeSpace);
        assert_eq!(reset.decision.initial_velocity, 0.0);
        assert_eq!(reset.spring.sample(0).position, 1260.0);
        assert_eq!(
            plan(500.0, 0.0, f64::NAN, bounds, SpringParams::default())
                .unwrap()
                .decision
                .reason,
            ResetReason::InvalidMath
        );
        assert_eq!(
            plan(
                500.0,
                0.0,
                1.0,
                MotionBounds {
                    lower: 600.0,
                    ..bounds
                },
                SpringParams::default()
            )
            .unwrap()
            .decision
            .reason,
            ResetReason::Coverage
        );
    }
    #[test]
    fn analytic_extrema_bound_an_independent_ode() {
        // RK4 independently integrates x'' = -800(x-target) - 2sqrt(800)x'.
        for (from, target, v) in [
            (0.0, 1260.0, 12000.0),
            (500.0, 0.0, 12000.0),
            (500.0, 510.0, 15000.0),
            (500.0, 1260.0, -12000.0),
            (500.0, 500.0, 1000.0),
        ] {
            let (low, high) = critical_range(from, target, v, SpringParams::default()).unwrap();
            let (mut x, mut velocity) = (from, v);
            let h = 0.00005;
            let accel = |x: f64, v: f64| -800.0 * (x - target) - 2.0 * 800_f64.sqrt() * v;
            for _ in 0..20000 {
                assert!(x >= low - 1e-7 && x <= high + 1e-7);
                let a1 = accel(x, velocity);
                let v2 = velocity + h * a1 / 2.0;
                let a2 = accel(x + h * velocity / 2.0, v2);
                let v3 = velocity + h * a2 / 2.0;
                let a3 = accel(x + h * v2 / 2.0, v3);
                let v4 = velocity + h * a3;
                let a4 = accel(x + h * v3, v4);
                x += h * (velocity + 2.0 * v2 + 2.0 * v3 + v4) / 6.0;
                velocity += h * (a1 + 2.0 * a2 + 2.0 * a3 + a4) / 6.0;
            }
        }
    }
}
