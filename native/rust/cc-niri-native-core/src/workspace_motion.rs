// SPDX-License-Identifier: GPL-2.0-or-later
//! Finite workspace camera motion. No desktop authority or platform clock.
use crate::native_protocol::{Epoch, NativeError};

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
        }
    }
}
impl WorkspaceMotion {
    pub fn configure(&mut self, width: u32, height: u32, wrap: bool) -> Result<(), NativeError> {
        if !(1..=4096).contains(&width) || !(1..=4096).contains(&height) {
            return Err(NativeError::InvalidGeometry);
        }
        self.grid = Point {
            x: f64::from(width),
            y: f64::from(height),
        };
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
        self.validate(target, epoch, now)?;
        if !from.valid() || !(1..=3_000_000_000).contains(&duration) {
            return Err(NativeError::InvalidGeometry);
        }
        // Retarget from the last painted sample, including a gesture. The caller
        // cannot accidentally restart from KDE's already committed desktop.
        self.from = self.inside(if self.active { self.current } else { from });
        let target = self.inside(target);
        self.target = Point {
            x: self.from.x + Self::distance(target.x - self.from.x, self.grid.x, self.wrap),
            y: self.from.y + Self::distance(target.y - self.from.y, self.grid.y, self.wrap),
        };
        self.current = self.from;
        self.epoch = epoch;
        self.started_at = now;
        self.last_time = now;
        self.duration = duration;
        self.active = self.from != self.target;
        self.gesture = false;
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
        Ok(())
    }

    pub fn advance(&mut self, now: i64) -> (Point, bool) {
        if !self.active || self.gesture || now < self.last_time {
            return (self.current, self.active);
        }
        self.last_time = now;
        let elapsed = now.saturating_sub(self.started_at);
        if elapsed >= self.duration {
            self.current = self.target;
            self.active = false;
        } else {
            let t = elapsed as f64 / self.duration as f64;
            // Quintic smoothstep: zero velocity and acceleration at both ends,
            // no overshoot and no resolution-dependent spring settling tail.
            let p = t * t * t * (10.0 + t * (-15.0 + 6.0 * t));
            self.current = Point {
                x: self.from.x + (self.target.x - self.from.x) * p,
                y: self.from.y + (self.target.y - self.from.y) * p,
            };
        }
        (self.current, self.active)
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
