// SPDX-License-Identifier: GPL-2.0-or-later
//! Event-time planning in workspace cells; constant-cost finite-time sampling.
#[repr(u32)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Strategy {
    #[default]
    Rest = 0,
    CarryC2 = 1,
    CarryC1 = 2,
    BrakeC1 = 3,
    Reset = 4,
    Keep = 5,
}
#[repr(u32)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Reason {
    #[default]
    None = 0,
    Acceleration = 1,
    Envelope = 2,
    HardBoundary = 3,
    InvalidMath = 4,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct AxisSample {
    pub position: f64,
    pub velocity: f64,
    pub acceleration: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Quintic {
    from: f64,
    target: f64,
    v0: f64,
    a0: f64,
    duration: i64,
    coefficients: [f64; 6],
    controls: [f64; 6],
}
impl Quintic {
    fn new(from: f64, target: f64, v0: f64, a0: f64, duration: i64) -> Self {
        let seconds = duration as f64 * 1e-9;
        let v = v0 * seconds;
        let a = a0 * seconds * seconds;
        let d = target - from;
        Self {
            from,
            target,
            v0,
            a0,
            duration,
            coefficients: [
                from,
                v,
                a * 0.5,
                10.0 * d - 6.0 * v - 1.5 * a,
                -15.0 * d + 8.0 * v + 1.5 * a,
                6.0 * d - 3.0 * v - 0.5 * a,
            ],
            controls: [
                from,
                from + v / 5.0,
                from + 2.0 * v / 5.0 + a / 20.0,
                target,
                target,
                target,
            ],
        }
    }
    pub fn sample(self, elapsed: i64) -> AxisSample {
        if elapsed >= self.duration {
            return AxisSample {
                position: self.target,
                ..AxisSample::default()
            };
        }
        if elapsed <= 0 {
            return AxisSample {
                position: self.from,
                velocity: self.v0,
                acceleration: self.a0,
            };
        }
        let u = elapsed as f64 / self.duration as f64;
        let seconds = self.duration as f64 * 1e-9;
        if self.v0 == 0.0 && self.a0 == 0.0 {
            // Preserve the existing rest-to-rest arithmetic, including stable.
            let d = self.target - self.from;
            let p = u * u * u * (10.0 + u * (-15.0 + 6.0 * u));
            return AxisSample {
                position: self.from + d * p,
                velocity: d * 30.0 * u * u * (1.0 - u) * (1.0 - u) / seconds,
                acceleration: d * 60.0 * u * (1.0 - u) * (1.0 - 2.0 * u) / (seconds * seconds),
            };
        }
        let c = self.coefficients;
        AxisSample {
            position: c[0] + u * (c[1] + u * (c[2] + u * (c[3] + u * (c[4] + u * c[5])))),
            velocity: (c[1]
                + u * (2.0 * c[2] + u * (3.0 * c[3] + u * (4.0 * c[4] + u * 5.0 * c[5]))))
                / seconds,
            acceleration: (2.0 * c[2] + u * (6.0 * c[3] + u * (12.0 * c[4] + u * 20.0 * c[5])))
                / (seconds * seconds),
        }
    }
    fn safe(self, lower: f64, upper: f64) -> bool {
        if !self
            .coefficients
            .into_iter()
            .chain(self.controls)
            .all(f64::is_finite)
        {
            return false;
        }
        // Bernstein variation bounds roots of velocity in (0,1). At most one
        // turn allows braking/reversal, but forbids a second oscillation.
        let mut previous = 0.0_f64;
        let mut variations = 0;
        for pair in self.controls.windows(2) {
            let sign = (pair[1] - pair[0]).signum();
            if pair[1] == pair[0] {
                continue;
            }
            if previous != 0.0 && sign != previous {
                variations += 1;
            }
            previous = sign;
        }
        variations <= 1 && enclosed(self.controls, lower, upper, 12)
    }
}
fn enclosed(mut b: [f64; 6], lower: f64, upper: f64, depth: u32) -> bool {
    // Convex hull proof, never frame sampling. If subdivision cannot certify
    // the whole interval, reject conservatively. Only runs on control events.
    let tolerance = 1e-12 * (1.0 + lower.abs().max(upper.abs()));
    if b.iter()
        .all(|v| *v >= lower - tolerance && *v <= upper + tolerance)
    {
        return true;
    }
    if depth == 0
        || b[0] < lower - tolerance
        || b[0] > upper + tolerance
        || b[5] < lower - tolerance
        || b[5] > upper + tolerance
    {
        return false;
    }
    let mut left = [0.0; 6];
    let mut right = [0.0; 6];
    left[0] = b[0];
    right[5] = b[5];
    for level in 1..6 {
        for i in 0..6 - level {
            b[i] = (b[i] + b[i + 1]) * 0.5;
        }
        left[level] = b[0];
        right[5 - level] = b[5 - level];
    }
    enclosed(left, lower, upper, depth - 1) && enclosed(right, lower, upper, depth - 1)
}
#[derive(Clone, Copy, Debug)]
pub struct AxisTrajectory {
    curve: Quintic,
    brake_start: AxisSample,
    pub brake_ns: i64,
    pub brake_distance: f64,
    pub strategy: Strategy,
    pub reason: Reason,
}
impl AxisTrajectory {
    pub fn rest(from: f64, target: f64, duration: i64) -> Self {
        Self {
            curve: Quintic::new(from, target, 0.0, 0.0, duration),
            brake_start: AxisSample::default(),
            brake_ns: 0,
            brake_distance: 0.0,
            strategy: Strategy::Rest,
            reason: Reason::None,
        }
    }
    pub fn plan(
        s: AxisSample,
        target: f64,
        duration: i64,
        grid_lower: f64,
        grid_upper: f64,
    ) -> Self {
        // Maximum excursion is 0.02 workspace cells, not logical pixels.
        // Intersect the endpoint corridor with the hard grid; wrap is unwrapped.
        let lower = grid_lower.max(s.position.min(target) - 0.02);
        let upper = grid_upper.min(s.position.max(target) + 0.02);
        let mut result = Self::rest(s.position, target, duration);
        if s.velocity == 0.0 && s.acceleration == 0.0 {
            return result;
        }
        let c2 = Quintic::new(s.position, target, s.velocity, s.acceleration, duration);
        if c2.safe(lower, upper) {
            result.curve = c2;
            result.strategy = Strategy::CarryC2;
            return result;
        }
        let c1 = Quintic::new(s.position, target, s.velocity, 0.0, duration);
        if c1.safe(lower, upper) {
            result.curve = c1;
            result.strategy = Strategy::CarryC1;
            result.reason = Reason::Acceleration;
            return result;
        }
        let room = if s.velocity > 0.0 {
            upper - s.position
        } else {
            s.position - lower
        };
        if !s.velocity.is_finite() || !s.acceleration.is_finite() || !room.is_finite() {
            result.strategy = Strategy::Reset;
            result.reason = Reason::InvalidMath;
            return result;
        }
        if room <= 0.0 || s.velocity == 0.0 {
            result.strategy = Strategy::Reset;
            result.reason = Reason::HardBoundary;
            return result;
        }
        let brake_ns = (2.0 * room.min(0.02) / s.velocity.abs() * 1e9)
            .min(50_000_000.0)
            .min((duration / 4) as f64)
            .floor() as i64;
        if brake_ns < 1 {
            result.strategy = Strategy::Reset;
            result.reason = Reason::InvalidMath;
            return result;
        }
        let displacement = s.velocity * 0.5 * (brake_ns as f64 * 1e-9);
        let end = s.position + displacement;
        result.curve = Quintic::new(end, target, 0.0, 0.0, duration - brake_ns);
        result.brake_start = s;
        result.brake_ns = brake_ns;
        result.brake_distance = displacement;
        result.strategy = Strategy::BrakeC1;
        result.reason = Reason::Envelope;
        result
    }
    pub fn sample(self, elapsed: i64) -> AxisSample {
        if self.brake_ns > 0 && elapsed < self.brake_ns {
            let seconds = elapsed.max(0) as f64 * 1e-9;
            let length = self.brake_ns as f64 * 1e-9;
            let a = -self.brake_start.velocity / length;
            return AxisSample {
                position: self.brake_start.position
                    + self.brake_start.velocity * seconds
                    + 0.5 * a * seconds * seconds,
                velocity: self.brake_start.velocity + a * seconds,
                acceleration: a,
            };
        }
        self.curve.sample(elapsed.saturating_sub(self.brake_ns))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn close(a: f64, b: f64) {
        assert!(
            (a - b).abs() <= 1e-9 + 1e-10 * a.abs().max(b.abs()),
            "{a} != {b}"
        );
    }
    #[test]
    fn boundaries_derivatives_and_independent_bezier_evaluation() {
        for v in [-4.0, 0.0, 3.0] {
            for a in [-20.0, 0.0, 15.0] {
                let q = Quintic::new(0.3, 1.0, v, a, 420_000_000);
                let start = q.sample(0);
                close(start.position, 0.3);
                close(start.velocity, v);
                close(start.acceleration, a);
                let end = q.sample(420_000_000);
                assert_eq!(end.position, 1.0);
                assert_eq!(end.velocity, 0.0);
                assert_eq!(end.acceleration, 0.0);
                for i in 1..100 {
                    let ns = i * 4_200_000;
                    let u = i as f64 / 100.0;
                    let mut b = q.controls;
                    for level in 1..6 {
                        for j in 0..6 - level {
                            b[j] = (1.0 - u) * b[j] + u * b[j + 1];
                        }
                    }
                    let s = q.sample(ns);
                    close(s.position, b[0]);
                    let seconds = 0.42;
                    let mut velocity = [0.0; 5];
                    for (j, value) in velocity.iter_mut().enumerate() {
                        *value = 5.0 * (q.controls[j + 1] - q.controls[j]) / seconds;
                    }
                    let mut acceleration = [0.0; 4];
                    for (j, value) in acceleration.iter_mut().enumerate() {
                        *value = 4.0 * (velocity[j + 1] - velocity[j]) / seconds;
                    }
                    for level in 1..5 {
                        for j in 0..5 - level {
                            velocity[j] = (1.0 - u) * velocity[j] + u * velocity[j + 1];
                        }
                    }
                    for level in 1..4 {
                        for j in 0..4 - level {
                            acceleration[j] = (1.0 - u) * acceleration[j] + u * acceleration[j + 1];
                        }
                    }
                    close(s.velocity, velocity[0]);
                    close(s.acceleration, acceleration[0]);
                }
            }
        }
    }
    #[test]
    fn envelope_brake_fixed_deadline_and_hard_boundary_reset() {
        let start = AxisSample {
            position: 0.7,
            velocity: 4.0,
            acceleration: 30.0,
        };
        let p = AxisTrajectory::plan(start, 0.0, 420_000_000, 0.0, 3.0);
        assert_eq!(p.strategy, Strategy::BrakeC1);
        assert!(p.brake_ns <= 50_000_000 && p.brake_distance <= 0.02);
        close(p.sample(0).position, start.position);
        close(p.sample(0).velocity, start.velocity);
        close(
            p.sample(p.brake_ns - 1).position,
            p.sample(p.brake_ns).position,
        );
        assert!(p.sample(p.brake_ns - 1).velocity.abs() < 1e-6);
        for i in 0..=4200 {
            let s = p.sample(i * 100_000);
            assert!(s.position >= 0.0 && s.position <= 0.72 + 1e-12);
        }
        assert_eq!(p.sample(420_000_000).position, 0.0);
        let edge = AxisTrajectory::plan(
            AxisSample {
                position: 3.0,
                ..start
            },
            0.0,
            420_000_000,
            0.0,
            3.0,
        );
        assert_eq!(edge.strategy, Strategy::Reset);
        assert_eq!(edge.reason, Reason::HardBoundary);
        assert_eq!(edge.sample(0).position, 3.0);
        assert_eq!(edge.sample(0).velocity, 0.0);
        let bad = AxisTrajectory::plan(
            AxisSample {
                velocity: f64::INFINITY,
                ..start
            },
            0.0,
            420_000_000,
            0.0,
            3.0,
        );
        assert_eq!(bad.reason, Reason::InvalidMath);
    }
    #[test]
    fn acceleration_only_degradation_and_hull_rejects_hidden_excursion() {
        let p = AxisTrajectory::plan(
            AxisSample {
                position: 0.0,
                velocity: 0.0,
                acceleration: -100.0,
            },
            1.0,
            420_000_000,
            0.0,
            3.0,
        );
        assert_eq!(p.strategy, Strategy::CarryC1);
        assert_eq!(p.sample(0).velocity, 0.0);
        let q = Quintic::new(0.5, 0.0, 4.0, 40.0, 420_000_000);
        assert!(!q.safe(0.0, 0.52));
        assert!(Quintic::new(0.2, 2.0, 1.0, 2.0, 420_000_000).safe(0.0, 3.0));
    }
}
