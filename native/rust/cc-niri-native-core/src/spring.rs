// SPDX-License-Identifier: GPL-2.0-or-later
//! Closed-form oscillator, preserving the C++ Spring reference's arithmetic.

#[derive(Clone, Copy, Debug)]
pub struct SpringParams {
    pub damping_ratio: f64,
    pub stiffness: f64,
    pub epsilon: f64,
    pub mass: f64,
}

impl Default for SpringParams {
    fn default() -> Self {
        Self {
            damping_ratio: 1.0,
            stiffness: 800.0,
            epsilon: 0.0001,
            mass: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpringSample {
    pub position: f64,
    pub velocity: f64,
}

#[derive(Clone, Copy, Debug)]
enum Regime {
    Critical,
    Under,
    Over,
}

#[derive(Clone, Debug)]
pub struct Spring {
    valid: bool,
    regime: Regime,
    params: SpringParams,
    from: f64,
    target: f64,
    initial_velocity: f64,
    omega: f64,
    decay: f64,
    frequency: f64,
    a: f64,
    b: f64,
    slow: f64,
    fast: f64,
}

impl Spring {
    pub fn new(from: f64, target: f64, initial_velocity: f64, params: SpringParams) -> Self {
        let mut spring = Self {
            valid: false,
            regime: Regime::Critical,
            params,
            from,
            target,
            initial_velocity,
            omega: 0.0,
            decay: 0.0,
            frequency: 0.0,
            a: 0.0,
            b: 0.0,
            slow: 0.0,
            fast: 0.0,
        };
        if !from.is_finite()
            || !target.is_finite()
            || !initial_velocity.is_finite()
            || !params.damping_ratio.is_finite()
            || params.damping_ratio < 0.0
            || !params.stiffness.is_finite()
            || params.stiffness <= 0.0
            || !params.mass.is_finite()
            || params.mass <= 0.0
            || !params.epsilon.is_finite()
            || params.epsilon <= 0.0
        {
            return spring;
        }
        let displacement = from - target;
        spring.omega = params.stiffness.sqrt() / params.mass.sqrt();
        spring.decay = params.damping_ratio * spring.omega;
        let numerator = initial_velocity + spring.decay * displacement;
        if !displacement.is_finite()
            || !spring.omega.is_finite()
            || spring.omega <= 0.0
            || !spring.decay.is_finite()
            || !numerator.is_finite()
            || !(params.epsilon * spring.omega).is_finite()
        {
            return spring;
        }
        if params.damping_ratio == 1.0 {
            spring.a = displacement;
            spring.b = numerator;
        } else if params.damping_ratio < 1.0 {
            spring.regime = Regime::Under;
            spring.frequency =
                spring.omega * ((1.0 - params.damping_ratio) * (1.0 + params.damping_ratio)).sqrt();
            spring.a = displacement;
            spring.b = numerator / spring.frequency;
        } else {
            spring.regime = Regime::Over;
            let root = (params.damping_ratio - 1.0).sqrt() * (params.damping_ratio + 1.0).sqrt();
            spring.slow = -spring.omega / (params.damping_ratio + root);
            spring.fast = -spring.omega * (params.damping_ratio + root);
            spring.a =
                (initial_velocity - spring.fast * displacement) / (spring.slow - spring.fast);
            spring.b = displacement - spring.a;
        }
        spring.valid = spring.a.is_finite()
            && spring.b.is_finite()
            && spring.frequency.is_finite()
            && spring.slow.is_finite()
            && spring.fast.is_finite();
        spring
    }

    pub fn is_valid(&self) -> bool {
        self.valid
    }

    /// Signed nanoseconds, matching std::chrono::nanoseconds at the C ABI.
    pub fn sample(&self, elapsed_ns: i64) -> SpringSample {
        if !self.valid {
            return SpringSample {
                position: if self.target.is_finite() {
                    self.target
                } else {
                    0.0
                },
                velocity: 0.0,
            };
        }
        if elapsed_ns <= 0 {
            return SpringSample {
                position: self.from,
                velocity: self.initial_velocity,
            };
        }
        let t = elapsed_ns as f64 / 1_000_000_000.0;
        let (displacement, velocity) = match self.regime {
            Regime::Critical => {
                let envelope = (-self.decay * t).exp();
                let polynomial = self.a + self.b * t;
                (
                    envelope * polynomial,
                    envelope * (self.b - self.decay * polynomial),
                )
            }
            Regime::Under => {
                let envelope = (-self.decay * t).exp();
                let cosine = (self.frequency * t).cos();
                let sine = (self.frequency * t).sin();
                let wave = self.a * cosine + self.b * sine;
                (
                    envelope * wave,
                    envelope
                        * (self.frequency * (self.b * cosine - self.a * sine) - self.decay * wave),
                )
            }
            Regime::Over => {
                let slow = self.a * (self.slow * t).exp();
                let fast = self.b * (self.fast * t).exp();
                (slow + fast, self.slow * slow + self.fast * fast)
            }
        };
        let position = self.target + displacement;
        if !position.is_finite() || !velocity.is_finite() {
            return SpringSample {
                position: self.target,
                velocity: 0.0,
            };
        }
        SpringSample { position, velocity }
    }

    pub fn is_settled(&self, sample: SpringSample) -> bool {
        self.valid
            && sample.position.is_finite()
            && sample.velocity.is_finite()
            && (sample.position - self.target).abs() <= self.params.epsilon
            && sample.velocity.abs() <= self.params.epsilon * self.omega
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Independent RK4 ODE integration, not another closed-form oscillator.
    fn reference(
        from: f64,
        target: f64,
        velocity: f64,
        duration: f64,
        p: SpringParams,
    ) -> SpringSample {
        let (mut x, mut v) = (from - target, velocity);
        let h = duration / 4000.0;
        let k = p.stiffness / p.mass;
        let damping = 2.0 * p.damping_ratio * k.sqrt();
        let acceleration = |x: f64, v: f64| -k * x - damping * v;
        for _ in 0..4000 {
            let (p1, a1) = (v, acceleration(x, v));
            let p2 = v + h * a1 / 2.0;
            let a2 = acceleration(x + h * p1 / 2.0, p2);
            let p3 = v + h * a2 / 2.0;
            let a3 = acceleration(x + h * p2 / 2.0, p3);
            let p4 = v + h * a3;
            let a4 = acceleration(x + h * p3, p4);
            x += h * (p1 + 2.0 * p2 + 2.0 * p3 + p4) / 6.0;
            v += h * (a1 + 2.0 * a2 + 2.0 * a3 + a4) / 6.0;
        }
        SpringSample {
            position: target + x,
            velocity: v,
        }
    }

    #[test]
    fn agrees_with_independent_ode() {
        for ratio in [0.0, 0.65, 1.0, 1.7] {
            let p = SpringParams {
                damping_ratio: ratio,
                mass: 2.0,
                ..Default::default()
            };
            let spring = Spring::new(400.0, 2520.0, -25.0, p);
            assert!(spring.is_valid());
            for ns in [10_000_000, 60_000_000, 400_000_000] {
                let actual = spring.sample(ns);
                let expected = reference(400.0, 2520.0, -25.0, ns as f64 / 1e9, p);
                assert!((actual.position - expected.position).abs() <= 1e-5);
                assert!((actual.velocity - expected.velocity).abs() <= 1e-5);
            }
        }
    }

    #[test]
    fn time_boundaries_and_history_are_preserved() {
        let spring = Spring::new(400.25, 1260.5, -25.5, SpringParams::default());
        for ns in [i64::MIN, -1, 0] {
            assert_eq!(
                spring.sample(ns),
                SpringSample {
                    position: 400.25,
                    velocity: -25.5
                }
            );
        }
        let expected = spring.sample(60_000_000);
        spring.sample(i64::MAX);
        assert_eq!(spring.sample(60_000_000), expected);
        assert!(spring.is_settled(spring.sample(i64::MAX)));
    }

    #[test]
    fn default_is_monotonic_and_underdamped_can_overshoot() {
        let critical = Spring::new(0.0, 1260.0, 0.0, SpringParams::default());
        let mut previous = 0.0;
        for ms in 0..=3000 {
            let sample = critical.sample(ms * 1_000_000);
            assert!(sample.position >= previous && sample.position <= 1260.0);
            previous = sample.position;
        }
        assert!(critical.is_settled(critical.sample(1_000_000_000)));
        let under = Spring::new(
            0.0,
            1260.0,
            0.0,
            SpringParams {
                damping_ratio: 0.65,
                ..Default::default()
            },
        );
        assert!((0..1000).any(|ms| under.sample(ms * 1_000_000).position > 1260.0));
        assert!(!under.is_settled(SpringSample {
            position: 1260.0,
            velocity: 100.0
        }));
    }

    #[test]
    fn invalid_values_fall_back_before_time_handling() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for (from, target, velocity) in
                [(value, 2.0, 0.0), (0.0, value, 0.0), (0.0, 2.0, value)]
            {
                let spring = Spring::new(from, target, velocity, SpringParams::default());
                assert!(!spring.is_valid());
                for ns in [-1, 0, i64::MAX] {
                    let sample = spring.sample(ns);
                    assert_eq!(
                        sample,
                        SpringSample {
                            position: if target.is_finite() { target } else { 0.0 },
                            velocity: 0.0
                        }
                    );
                    assert!(!spring.is_settled(sample));
                }
            }
        }
        assert!(!Spring::new(-1e308, 1e308, 0.0, SpringParams::default()).is_valid());
    }

    #[test]
    fn completion_uses_both_thresholds_inclusively() {
        let params = SpringParams {
            epsilon: 0.25,
            stiffness: 16.0,
            ..Default::default()
        };
        let spring = Spring::new(4.0, 0.0, 0.0, params);
        assert!(spring.is_settled(SpringSample {
            position: 0.25,
            velocity: 1.0
        }));
        assert!(!spring.is_settled(SpringSample {
            position: 0.25 + f64::EPSILON,
            velocity: 1.0
        }));
        assert!(!spring.is_settled(SpringSample {
            position: 0.25,
            velocity: 1.0 + f64::EPSILON
        }));
        assert!(!spring.is_settled(SpringSample {
            position: f64::NAN,
            velocity: 0.0
        }));
    }
}
