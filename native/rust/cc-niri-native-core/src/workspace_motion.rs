// SPDX-License-Identifier: GPL-2.0-or-later
//! Finite workspace camera motion. No desktop authority or platform clock.
use crate::native_protocol::{Epoch, NativeError};
use crate::workspace_curve::{AxisSample, AxisTrajectory, Reason, Strategy};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    fn valid(self) -> bool {
        [self.x, self.y]
            .into_iter()
            .all(|v| v.is_finite() && v.abs() <= 4096.0)
    }
}

#[derive(Clone, Copy, Debug)]
struct PaintedSample {
    point: Point,
    velocity: Point,
    acceleration: Point,
    time: i64,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct WorkspaceState {
    pub point: Point,
    pub velocity: Point,
    pub acceleration: Point,
    pub target: Point,
    pub origin: Point,
    pub initial_velocity: Point,
    pub initial_acceleration: Point,
    pub saved_velocity: Point,
    pub saved_acceleration: Point,
    pub brake_distance: Point,
    pub time_ns: i64,
    pub started_at_ns: i64,
    pub duration_ns: i64,
    pub brake_x_ns: i64,
    pub brake_y_ns: i64,
    pub epoch: i64,
    pub counts: [u64; 5],
    pub strategies: [u32; 2],
    pub reasons: [u32; 2],
    pub active: u32,
    pub gesture: u32,
    pub status: u32,
    pub reserved: u32,
}

#[derive(Clone, Debug)]
pub struct WorkspaceMotion {
    from: Point,
    target: Point,
    current: Point,
    epoch: Epoch,
    started_at: i64,
    last_time: i64,
    duration: i64,
    active: bool,
    gesture: bool,
    grid: Point,
    wrap: bool,
    velocity: Point,
    acceleration: Point,
    axes: [AxisTrajectory; 2],
    painted: Option<PaintedSample>,
    smooth: bool,
    sampled: bool,
    diagnostics: WorkspaceState,
}
impl Default for WorkspaceMotion {
    fn default() -> Self {
        Self {
            from: Point::default(),
            target: Point::default(),
            current: Point::default(),
            epoch: Epoch::NONE,
            started_at: 0,
            last_time: 0,
            duration: 1,
            active: false,
            gesture: false,
            grid: Point {
                x: 4096.0,
                y: 4096.0,
            },
            wrap: false,
            velocity: Point::default(),
            acceleration: Point::default(),
            axes: [AxisTrajectory::rest(0.0, 0.0, 1); 2],
            painted: None,
            smooth: false,
            sampled: false,
            diagnostics: WorkspaceState::default(),
        }
    }
}
impl WorkspaceMotion {
    pub fn configure(&mut self, width: u32, height: u32, wrap: bool) -> Result<(), NativeError> {
        if !(1..=4096).contains(&width) || !(1..=4096).contains(&height) {
            return Err(NativeError::InvalidGeometry);
        }
        let grid = Point {
            x: f64::from(width),
            y: f64::from(height),
        };
        if self.grid != grid || self.wrap != wrap {
            self.painted = None;
            self.smooth = false;
        }
        self.grid = grid;
        self.wrap = wrap;
        Ok(())
    }

    fn inside(&self, point: Point) -> Point {
        Point {
            x: if self.wrap && self.grid.x > 1.0 {
                point.x
            } else {
                point.x.clamp(0.0, self.grid.x - 1.0)
            },
            y: if self.wrap && self.grid.y > 1.0 {
                point.y
            } else {
                point.y.clamp(0.0, self.grid.y - 1.0)
            },
        }
    }
    fn distance(value: f64, extent: f64, wrap: bool) -> f64 {
        if !wrap {
            return value;
        }
        let reduced = value % extent;
        if reduced > extent * 0.5 {
            reduced - extent
        } else if reduced < -extent * 0.5 {
            reduced + extent
        } else {
            reduced
        }
    }
    fn validate(&self, point: Point, epoch: Epoch, now: i64) -> Result<(), NativeError> {
        if !point.valid() {
            return Err(NativeError::InvalidGeometry);
        }
        if epoch.0 < 0 || epoch <= self.epoch {
            return Err(NativeError::InvalidEpoch);
        }
        if now < self.last_time || now < 0 {
            return Err(NativeError::SequenceRejected);
        }
        Ok(())
    }

    pub fn start(
        &mut self,
        from: Point,
        target: Point,
        epoch: Epoch,
        now: i64,
        duration: i64,
    ) -> Result<(), NativeError> {
        self.start_with_policy(from, target, epoch, now, duration, false)
    }
    #[allow(clippy::too_many_arguments)] // Mirrors the existing start plus one typed policy flag.
    pub fn start_with_policy(
        &mut self,
        from: Point,
        target: Point,
        epoch: Epoch,
        now: i64,
        duration: i64,
        smooth: bool,
    ) -> Result<(), NativeError> {
        // Stable retains its clock rejection. Smooth accepts a control event
        // behind prediction, anchored to the last sample actually used to paint.
        self.validate(
            target,
            epoch,
            if smooth { now.max(self.last_time) } else { now },
        )?;
        if now < 0 {
            return Err(NativeError::SequenceRejected);
        }
        if !from.valid() || !(1..=3_000_000_000).contains(&duration) {
            return Err(NativeError::InvalidGeometry);
        }
        // Retarget from the last painted sample, including a gesture. The caller
        // cannot accidentally restart from KDE's already committed desktop.
        let anchor = if smooth && self.smooth && self.active && !self.gesture {
            self.painted
        } else {
            None
        };
        let origin = if let Some(s) = anchor {
            s.point
        } else if self.active {
            if smooth && self.smooth && !self.gesture {
                self.from
            } else {
                self.current
            }
        } else {
            from
        };
        let origin = self.inside(origin);
        let target = self.inside(target);
        let target = Point {
            x: origin.x + Self::distance(target.x - origin.x, self.grid.x, self.wrap),
            y: origin.y + Self::distance(target.y - origin.y, self.grid.y, self.wrap),
        };
        if smooth
            && self.smooth
            && self.active
            && !self.gesture
            && target == self.target
            && duration == self.duration
        {
            self.epoch = epoch;
            self.diagnostics.strategies = [Strategy::Keep as u32; 2];
            self.diagnostics.reasons = [Reason::None as u32; 2];
            self.diagnostics.counts[4] = self.diagnostics.counts[4].saturating_add(1);
            return Ok(());
        }
        self.from = origin;
        self.target = target;
        let v = anchor.map_or(Point::default(), |s| s.velocity);
        let a = anchor.map_or(Point::default(), |s| s.acceleration);
        let limits = |extent: f64| {
            if self.wrap && extent > 1.0 {
                (f64::NEG_INFINITY, f64::INFINITY)
            } else {
                (0.0, extent - 1.0)
            }
        };
        let (lx, ux) = limits(self.grid.x);
        let (ly, uy) = limits(self.grid.y);
        self.axes = if anchor.is_some() {
            [
                AxisTrajectory::plan(
                    AxisSample {
                        position: origin.x,
                        velocity: v.x,
                        acceleration: a.x,
                    },
                    target.x,
                    duration,
                    lx,
                    ux,
                ),
                AxisTrajectory::plan(
                    AxisSample {
                        position: origin.y,
                        velocity: v.y,
                        acceleration: a.y,
                    },
                    target.y,
                    duration,
                    ly,
                    uy,
                ),
            ]
        } else {
            [
                AxisTrajectory::rest(origin.x, target.x, duration),
                AxisTrajectory::rest(origin.y, target.y, duration),
            ]
        };
        self.diagnostics.origin = origin;
        self.diagnostics.saved_velocity = v;
        self.diagnostics.saved_acceleration = a;
        self.diagnostics.strategies = self.axes.map(|s| s.strategy as u32);
        self.diagnostics.reasons = self.axes.map(|s| s.reason as u32);
        self.diagnostics.brake_x_ns = self.axes[0].brake_ns;
        self.diagnostics.brake_y_ns = self.axes[1].brake_ns;
        self.diagnostics.brake_distance = Point {
            x: self.axes[0].brake_distance,
            y: self.axes[1].brake_distance,
        };
        let strategy = *self.diagnostics.strategies.iter().max().unwrap_or(&0);
        if (1..=4).contains(&strategy) {
            self.diagnostics.counts[(strategy - 1) as usize] =
                self.diagnostics.counts[(strategy - 1) as usize].saturating_add(1);
        }
        self.current = self.from;
        self.epoch = epoch;
        self.started_at = anchor.map_or(now, |s| now.max(s.time));
        self.last_time = self.started_at;
        self.duration = duration;
        let x = self.axes[0].sample(0);
        let y = self.axes[1].sample(0);
        self.velocity = Point {
            x: x.velocity,
            y: y.velocity,
        };
        self.acceleration = Point {
            x: x.acceleration,
            y: y.acceleration,
        };
        self.diagnostics.initial_velocity = self.velocity;
        self.diagnostics.initial_acceleration = self.acceleration;
        self.active = self.from != self.target
            || self.velocity != Point::default()
            || self.acceleration != Point::default();
        self.gesture = false;
        self.smooth = smooth;
        self.sampled = false;
        Ok(())
    }

    pub fn gesture(&mut self, point: Point, epoch: Epoch, now: i64) -> Result<(), NativeError> {
        self.validate(point, epoch, now)?;
        let point = self.inside(point);
        self.from = point;
        self.target = point;
        self.current = point;
        self.epoch = epoch;
        self.last_time = now;
        self.active = true;
        self.gesture = true;
        self.velocity = Point::default();
        self.acceleration = Point::default();
        self.painted = None;
        self.sampled = false;
        self.smooth = false;
        self.diagnostics.origin = point;
        self.diagnostics.initial_velocity = Point::default();
        self.diagnostics.initial_acceleration = Point::default();
        self.diagnostics.saved_velocity = Point::default();
        self.diagnostics.saved_acceleration = Point::default();
        self.diagnostics.brake_distance = Point::default();
        self.diagnostics.brake_x_ns = 0;
        self.diagnostics.brake_y_ns = 0;
        self.diagnostics.strategies = [Strategy::Rest as u32; 2];
        self.diagnostics.reasons = [Reason::None as u32; 2];
        Ok(())
    }

    pub fn advance(&mut self, now: i64) -> (Point, bool) {
        if !self.active || self.gesture || now < self.last_time {
            return (self.current, self.active);
        }
        self.last_time = now;
        self.sampled = true;
        let elapsed = now.saturating_sub(self.started_at);
        if elapsed >= self.duration {
            self.current = self.target;
            self.active = false;
            self.velocity = Point::default();
            self.acceleration = Point::default();
        } else {
            let x = self.axes[0].sample(elapsed);
            let y = self.axes[1].sample(elapsed);
            self.current = Point {
                x: x.position,
                y: y.position,
            };
            self.velocity = Point {
                x: x.velocity,
                y: y.velocity,
            };
            self.acceleration = Point {
                x: x.acceleration,
                y: y.acceleration,
            };
        }
        (self.current, self.active)
    }
    pub fn mark_painted(&mut self) -> bool {
        if !self.sampled || self.gesture {
            return false;
        }
        self.painted = Some(PaintedSample {
            point: self.current,
            velocity: self.velocity,
            acceleration: self.acceleration,
            time: self.last_time,
        });
        self.sampled = false;
        true
    }
    pub fn state(&self) -> WorkspaceState {
        WorkspaceState {
            point: self.current,
            velocity: self.velocity,
            acceleration: self.acceleration,
            target: self.target,
            time_ns: self.last_time,
            started_at_ns: self.started_at,
            duration_ns: self.duration,
            epoch: self.epoch.0,
            active: u32::from(self.active),
            gesture: u32::from(self.gesture),
            ..self.diagnostics
        }
    }

    pub fn project(
        &self,
        desktop: Point,
        width: f64,
        height: f64,
        gap_x: f64,
        gap_y: f64,
    ) -> Option<Point> {
        if !desktop.valid()
            || ![width, height, gap_x, gap_y]
                .into_iter()
                .all(f64::is_finite)
            || width <= 0.0
            || height <= 0.0
            || gap_x < 0.0
            || gap_y < 0.0
        {
            return None;
        }
        let translation = Point {
            x: Self::distance(desktop.x - self.current.x, self.grid.x, self.wrap) * (width + gap_x),
            y: Self::distance(desktop.y - self.current.y, self.grid.y, self.wrap)
                * (height + gap_y),
        };
        (translation.x.abs() < width && translation.y.abs() < height).then_some(translation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn near(a: f64, b: f64) {
        assert!(
            (a - b).abs() <= 1e-9 + 1e-10 * a.abs().max(b.abs()),
            "{a} != {b}"
        );
    }
    fn smooth(m: &mut WorkspaceMotion, target: Point, epoch: i64, now: i64) {
        m.start_with_policy(
            Point::default(),
            target,
            Epoch(epoch),
            now,
            420_000_000,
            true,
        )
        .unwrap();
    }
    #[test]
    fn painted_derivatives_same_direction_reverse_and_prediction_lead() {
        for time in [20_000_000, 80_000_000, 180_000_000] {
            for target in [0.0, 2.0, 4.0] {
                let mut m = WorkspaceMotion::default();
                m.configure(1, 5, false).unwrap();
                smooth(&mut m, Point { x: 0.0, y: 1.0 }, 1, 0);
                m.advance(time);
                assert!(m.mark_painted());
                let saved = m.state();
                // Event execution trails the compositor's already painted prediction.
                smooth(&mut m, Point { x: 0.0, y: target }, 2, time - 10_000_000);
                let initial = m.state();
                near(initial.point.y, saved.point.y);
                near(initial.velocity.y, saved.velocity.y);
                assert_eq!(initial.started_at_ns, saved.time_ns);
                assert_eq!(initial.saved_acceleration, saved.acceleration);
                assert_ne!(initial.strategies[1], Strategy::Reset as u32);
                if initial.strategies[1] == Strategy::CarryC2 as u32 {
                    near(initial.acceleration.y, saved.acceleration.y);
                }
                assert!(initial.brake_y_ns <= 50_000_000 && initial.brake_distance.y.abs() <= 0.02);
                let low = saved.point.y.min(target).max(0.0) - 1e-10;
                let high = saved.point.y.max(target) + 0.02 + 1e-10;
                for frame in 0..=420 {
                    let (p, active) = m.advance(time + frame * 1_000_000);
                    assert!(p.y >= low && p.y <= high, "{p:?}");
                    assert_eq!(active, frame < 420);
                }
                let end = m.state();
                assert_eq!(end.point.y, target);
                assert_eq!(end.velocity, Point::default());
                assert_eq!(end.acceleration, Point::default());
            }
        }
    }
    #[test]
    fn pending_is_not_painted_same_frame_retarget_and_keep_deadline() {
        let mut m = WorkspaceMotion::default();
        m.configure(1, 5, false).unwrap();
        smooth(&mut m, Point { x: 0.0, y: 1.0 }, 1, 0);
        m.advance(80_000_000);
        m.mark_painted();
        let saved = m.state();
        m.advance(180_000_000);
        smooth(&mut m, Point { x: 0.0, y: 2.0 }, 2, 90_000_000);
        assert_eq!(m.state().point, saved.point);
        assert_eq!(m.state().velocity, saved.velocity);
        smooth(&mut m, Point { x: 0.0, y: 3.0 }, 3, 90_000_000);
        assert_eq!(m.state().point, saved.point);
        assert_eq!(m.state().velocity, saved.velocity);
        m.advance(200_000_000);
        m.mark_painted();
        let before = m.state();
        smooth(&mut m, Point { x: 0.0, y: 3.0 }, 4, 190_000_000);
        let after = m.state();
        assert_eq!(after.started_at_ns, before.started_at_ns);
        assert_eq!(after.point, before.point);
        assert_eq!(after.velocity, before.velocity);
        assert_eq!(after.strategies, [Strategy::Keep as u32; 2]);
        assert_eq!(after.counts[4], 1);
        assert_eq!(m.advance(510_000_000), (Point { x: 0.0, y: 3.0 }, false));
    }
    #[test]
    fn wrap_grid_no_move_gesture_release_and_output_projection() {
        let mut m = WorkspaceMotion::default();
        m.configure(1, 4, true).unwrap();
        m.start_with_policy(
            Point { x: 0.0, y: 3.0 },
            Point::default(),
            Epoch(1),
            0,
            420_000_000,
            true,
        )
        .unwrap();
        m.advance(80_000_000);
        m.mark_painted();
        smooth(&mut m, Point { x: 0.0, y: 1.0 }, 2, 70_000_000);
        let start = m.state();
        assert!(start.target.y >= 4.0);
        for (w, h) in [
            (3840.0, 2160.0),
            (3072.0, 1728.0),
            (2560.0, 1440.0),
            (2194.0, 1234.0),
            (1920.0, 1080.0),
        ] {
            if let Some(p) = m.project(Point::default(), w, h, 45.0, 20.0) {
                near(
                    p.y,
                    WorkspaceMotion::distance(-start.point.y, 4.0, true) * (h + 20.0),
                );
            }
        }
        m.gesture(Point { x: 0.0, y: 0.5 }, Epoch(3), 90_000_000)
            .unwrap();
        smooth(&mut m, Point::default(), 4, 100_000_000);
        assert_eq!(m.state().initial_velocity, Point::default());
        assert_eq!(m.advance(520_000_000), (Point::default(), false));
        m.configure(1, 1, false).unwrap();
        smooth(&mut m, Point::default(), 5, 600_000_000);
        assert_eq!(m.state().active, 0);
        assert_eq!(m.state().velocity, Point::default());
    }
    #[test]
    fn stable_policy_and_no_paint_do_not_inherit_and_frame_queries_allocate_nothing() {
        let mut m = WorkspaceMotion::default();
        m.configure(1, 5, false).unwrap();
        smooth(&mut m, Point { x: 0.0, y: 1.0 }, 1, 0);
        m.advance(80_000_000);
        smooth(&mut m, Point { x: 0.0, y: 2.0 }, 2, 90_000_000);
        assert_eq!(m.state().point, Point::default());
        assert_eq!(m.state().initial_velocity, Point::default());
        m.advance(180_000_000);
        m.mark_painted();
        m.start(
            Point::default(),
            Point { x: 0.0, y: 3.0 },
            Epoch(3),
            190_000_000,
            420_000_000,
        )
        .unwrap();
        assert_eq!(m.state().initial_velocity, Point::default());
        assert_eq!(
            m.start(
                Point::default(),
                Point::default(),
                Epoch(4),
                180_000_000,
                420_000_000
            ),
            Err(NativeError::SequenceRejected)
        );
        assert_eq!(
            crate::allocation_checks::count(|| {
                for epoch in 4..1004 {
                    let t = epoch * 10_000_000 + 200_000_000;
                    smooth(
                        &mut m,
                        Point {
                            x: 0.0,
                            y: ((epoch % 3) + 1) as f64,
                        },
                        epoch,
                        t,
                    );
                    m.advance(t + 5_000_000);
                    m.mark_painted();
                    m.state();
                    m.project(Point::default(), 2560.0, 1440.0, 45.0, 20.0);
                }
            }),
            0
        );
    }
    #[test]
    fn gesture_edges_wrapping_shortest_path_and_grid_rejection() {
        let mut motion = WorkspaceMotion::default();
        let zero = Point::default();
        motion.configure(1, 4, false).unwrap();
        motion
            .gesture(Point { x: 10.0, y: -0.5 }, Epoch(1), 0)
            .unwrap();
        assert_eq!(motion.advance(1).0, zero);
        motion
            .gesture(Point { x: 10.0, y: 10.0 }, Epoch(2), 1)
            .unwrap();
        assert_eq!(motion.advance(2).0, Point { x: 0.0, y: 3.0 });
        assert_eq!(
            motion.configure(0, 4, true),
            Err(NativeError::InvalidGeometry)
        );
        // The rejected configuration must retain the old grid.
        motion
            .gesture(Point { x: 0.0, y: 10.0 }, Epoch(3), 2)
            .unwrap();
        assert_eq!(motion.advance(3).0.y, 3.0);
        motion.configure(1, 4, true).unwrap();
        motion.start(zero, zero, Epoch(4), 3, 420).unwrap();
        assert_eq!(motion.advance(213).0.y, 3.5);
        assert_eq!(
            motion.project(zero, 2560.0, 1440.0, 45.0, 20.0).unwrap().y,
            730.0
        );
        assert_eq!(
            motion
                .project(Point { x: 0.0, y: 3.0 }, 2560.0, 1440.0, 45.0, 20.0)
                .unwrap()
                .y,
            -730.0
        );
        assert_eq!(motion.advance(423), (Point { x: 0.0, y: 4.0 }, false));
        motion
            .start(zero, Point { x: 0.0, y: 3.0 }, Epoch(5), 423, 420)
            .unwrap();
        assert_eq!(motion.advance(633).0.y, -0.5);
        assert_eq!(
            motion
                .project(Point { x: 0.0, y: 3.0 }, 2560.0, 1440.0, 45.0, 20.0)
                .unwrap()
                .y,
            -730.0
        );
    }
    #[test]
    fn finite_endpoints_monotonic_and_retarget_from_painted_pose() {
        let mut motion = WorkspaceMotion::default();
        let a = Point { x: 0.0, y: 0.0 };
        let b = Point { x: 0.0, y: 1.0 };
        motion.start(a, b, Epoch(1), 1, 420_000_000).unwrap();
        let mut previous = a;
        for frame in 0..=25 {
            let (point, active) = motion.advance(1 + frame * 16_666_667);
            assert!(active);
            assert!(point.y >= previous.y && point.y <= 1.0);
            previous = point;
        }
        assert_eq!(motion.advance(420_000_001), (b, false));
        motion
            .start(b, a, Epoch(2), 500_000_001, 420_000_000)
            .unwrap();
        let (painted, _) = motion.advance(600_000_001);
        motion
            .start(a, b, Epoch(3), 700_000_001, 420_000_000)
            .unwrap();
        assert_eq!(motion.advance(700_000_001).0, painted);
        assert_eq!(
            motion.advance(600_000_001).0,
            painted,
            "backward clock cannot move the scene"
        );
        assert_eq!(
            motion.start(a, a, Epoch(2), 700_000_001, 420_000_000),
            Err(NativeError::InvalidEpoch)
        );
        assert_eq!(motion.advance(1_120_000_001), (b, false));
    }
    #[test]
    fn geometry_gestures_and_frame_operations_allocate_nothing() {
        let mut motion = WorkspaceMotion::default();
        let a = Point::default();
        let b = Point { x: 0.0, y: 1.0 };
        assert!(motion.start(a, b, Epoch(1), 0, 0).is_err());
        assert!(motion
            .start(
                a,
                Point {
                    x: f64::NAN,
                    y: 1.0
                },
                Epoch(1),
                0,
                420_000_000
            )
            .is_err());
        motion
            .gesture(Point { x: 0.0, y: 0.5 }, Epoch(1), 0)
            .unwrap();
        assert_eq!(motion.advance(100).0.y, 0.5);
        assert_eq!(
            motion.project(a, 2560.0, 1440.0, 45.0, 20.0).unwrap().y,
            -730.0
        );
        assert_eq!(
            motion.project(b, 2560.0, 1440.0, 45.0, 20.0).unwrap().y,
            730.0
        );
        assert!(motion.project(b, f64::NAN, 1440.0, 45.0, 20.0).is_none());
        assert_eq!(
            crate::allocation_checks::count(|| {
                for epoch in 2..1002 {
                    motion
                        .start(a, b, Epoch(epoch), epoch * 500_000_000, 420_000_000)
                        .unwrap();
                    motion.advance(epoch * 500_000_000 + 200_000_000);
                    motion.project(b, 2560.0, 1440.0, 45.0, 20.0);
                }
            }),
            0
        );
    }
}
