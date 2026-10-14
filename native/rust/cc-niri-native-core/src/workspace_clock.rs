// SPDX-License-Identifier: GPL-2.0-or-later
//! Optional workspace sampling-time adapter. No scheduler or presentation authority.

/// Resume on absolute time after a long pause or excessive accumulated lag.
/// This is a safety fallback, and may visibly catch up; it is not a frame repair.
pub const MAX_LAG_NS: i64 = 250_000_000;

#[repr(u32)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ClockFallback {
    #[default]
    None = 0,
    InvalidPrediction = 1,
    RegressedPrediction = 2,
    InvalidRefresh = 3,
    RefreshChanged = 4,
    Pause = 5,
    LagLimit = 6,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ClockState {
    pub logical_ns: i64,
    pub real_ns: i64,
    pub lag_ns: i64,
    pub clamped_frames: u64,
    pub fallback_count: u64,
    pub enabled: u32,
    pub limiting: u32,
    pub reason: u32,
    pub advance: u32,
    pub status: u32,
    pub reserved: u32,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WorkspaceClock {
    state: ClockState,
    initialized: bool,
    prediction: i64,
    refresh_millihz: u32,
}

impl WorkspaceClock {
    pub fn configure(&mut self, enabled: bool) {
        *self = Self {
            state: ClockState {
                enabled: u32::from(enabled),
                limiting: u32::from(enabled),
                ..ClockState::default()
            },
            ..Self::default()
        };
    }

    pub fn state(&self) -> ClockState {
        self.state
    }

    /// Control events do not consume a frame. Retarget keeps the last sampled
    /// logical domain; WorkspaceMotion independently selects the painted anchor.
    pub fn event(&mut self, now: i64) -> ClockState {
        if now < 0 {
            return ClockState {
                status: 2,
                ..self.state
            };
        }
        if !self.initialized || self.state.enabled == 0 {
            self.state.logical_ns = now;
            self.state.real_ns = now;
            self.initialized = true;
        } else if self.state.limiting == 0 {
            self.state.logical_ns = now.max(self.state.logical_ns);
            self.state.real_ns = now.max(self.state.real_ns);
            self.state.lag_ns = 0;
        } else if now.saturating_sub(self.state.real_ns) > MAX_LAG_NS {
            // A new request after suspension must not start in an old delayed
            // domain and immediately expire when the next real frame resumes.
            self.fallback(ClockFallback::Pause);
            self.state.logical_ns = now.max(self.state.logical_ns);
            self.state.real_ns = now.max(self.state.real_ns);
            self.state.lag_ns = 0;
        }
        self.state.advance = 0;
        self.state
    }

    fn fallback(&mut self, reason: ClockFallback) {
        if self.state.limiting != 0 {
            self.state.fallback_count = self.state.fallback_count.saturating_add(1);
            self.state.reason = reason as u32;
            self.state.limiting = 0;
        }
    }

    /// Called only for an outer real output pass. Positive presentation
    /// predictions identify a frame revision, including repeated preparations
    /// of it. The adapter filters nested/offscreen passes before this call.
    /// Invalid facts latch absolute-time fallback until the binding is reset.
    pub fn frame(&mut self, prediction: i64, monotonic: i64, refresh_millihz: u32) -> ClockState {
        if monotonic < 0 {
            return ClockState {
                status: 2,
                ..self.state
            };
        }
        let stale = prediction > 0
            && prediction == self.prediction
            && monotonic.saturating_sub(self.state.real_ns) > MAX_LAG_NS;
        if prediction > 0 && prediction == self.prediction && !stale {
            return ClockState {
                advance: 0,
                ..self.state
            };
        }
        if !self.initialized {
            self.event(monotonic);
        }
        let valid_prediction = prediction > 0 && prediction >= self.state.real_ns;
        let real = if stale {
            self.fallback(ClockFallback::Pause);
            monotonic.max(self.state.real_ns)
        } else if valid_prediction {
            prediction
        } else {
            if prediction <= 0 {
                self.fallback(ClockFallback::InvalidPrediction);
            } else {
                self.fallback(ClockFallback::RegressedPrediction);
            }
            monotonic.max(self.state.real_ns)
        };
        // Integer milli-Hz is the platform fact; numerical policy stays here.
        let interval = if (1_000..=1_000_000).contains(&refresh_millihz) {
            (1_000_000_000_000i64 + i64::from(refresh_millihz) - 1) / i64::from(refresh_millihz)
        } else {
            self.fallback(ClockFallback::InvalidRefresh);
            0
        };
        if self.refresh_millihz != 0 && self.refresh_millihz != refresh_millihz {
            self.fallback(ClockFallback::RefreshChanged);
        }
        let delta = real.saturating_sub(self.state.real_ns);
        if delta > MAX_LAG_NS {
            self.fallback(ClockFallback::Pause);
        }
        let mut logical = if self.state.limiting != 0 {
            self.state.logical_ns.saturating_add(delta.min(interval))
        } else {
            real.max(self.state.logical_ns)
        };
        if real.saturating_sub(logical) > MAX_LAG_NS {
            self.fallback(ClockFallback::LagLimit);
            logical = real.max(self.state.logical_ns);
        }
        if self.state.limiting != 0 && delta > interval {
            self.state.clamped_frames = self.state.clamped_frames.saturating_add(1);
        }
        self.state.logical_ns = logical;
        self.state.real_ns = real;
        self.state.lag_ns = real.saturating_sub(logical).max(0);
        self.state.advance = 1;
        self.prediction = prediction;
        self.refresh_millihz = refresh_millihz;
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn enabled(start: i64) -> WorkspaceClock {
        let mut clock = WorkspaceClock::default();
        clock.configure(true);
        clock.event(start);
        clock
    }
    #[test]
    fn normal_rates_and_disabled_preserve_absolute_time() {
        for hz in [59_940, 60_000, 120_000, 144_000] {
            let mut clock = enabled(1_000_000_000);
            for n in 1..100 {
                let real = 1_000_000_000 + n * 1_000_000_000_000i64 / i64::from(hz);
                let state = clock.frame(real, real - 1_000_000, hz);
                assert_eq!(state.logical_ns, real);
                assert_eq!(state.lag_ns, 0);
                assert_eq!(state.fallback_count, 0);
            }
        }
        let mut clock = WorkspaceClock::default();
        clock.event(1);
        for real in [16_666_667, 66_666_667, 200_000_000, 500_000_000] {
            assert_eq!(clock.frame(real, real, 60_000).logical_ns, real);
        }
    }
    #[test]
    fn long_frame_retains_lag_and_control_events_do_not_tick() {
        let mut clock = enabled(1_000_000_000);
        let a = clock.frame(1_016_666_667, 1_015_000_000, 60_000);
        let b = clock.frame(1_066_666_667, 1_065_000_000, 60_000);
        assert_eq!(b.logical_ns - a.logical_ns, 16_666_667);
        assert_eq!(b.lag_ns, 33_333_333);
        assert_eq!(b.clamped_frames, 1);
        assert_eq!(clock.event(1_080_000_000).logical_ns, b.logical_ns);
        // The same frame revision cannot tick twice, even after a retarget.
        assert_eq!(clock.frame(1_066_666_667, 1_070_000_000, 60_000).advance, 0);
        let c = clock.frame(1_083_333_334, 1_080_000_000, 60_000);
        assert_eq!(c.logical_ns - b.logical_ns, 16_666_667);
        assert_eq!(c.lag_ns, b.lag_ns);
    }
    #[test]
    fn invalid_facts_latch_safe_absolute_fallback_until_reset() {
        for (prediction, monotonic, rate, reason) in [
            (0, 1_020_000_000, 60_000, ClockFallback::InvalidPrediction),
            (
                999_000_000,
                1_020_000_000,
                60_000,
                ClockFallback::RegressedPrediction,
            ),
            (
                1_020_000_000,
                1_019_000_000,
                0,
                ClockFallback::InvalidRefresh,
            ),
            (1_400_000_000, 1_399_000_000, 60_000, ClockFallback::Pause),
        ] {
            let mut clock = enabled(1_000_000_000);
            let s = clock.frame(prediction, monotonic, rate);
            assert_eq!(s.reason, reason as u32);
            assert_eq!(s.limiting, 0);
            assert_eq!(s.fallback_count, 1);
            assert_eq!(
                clock.frame(1_500_000_000, 1_499_000_000, 60_000).logical_ns,
                1_500_000_000
            );
            assert_eq!(clock.state().fallback_count, 1);
            assert_eq!(clock.event(1_600_000_000).logical_ns, 1_600_000_000);
            assert_eq!(clock.state().lag_ns, 0);
            clock.configure(true);
            assert_eq!(clock.event(2_000_000_000).logical_ns, 2_000_000_000);
            assert_eq!(clock.state().reason, 0);
        }
        let mut clock = enabled(1);
        clock.frame(16_666_667, 16_000_000, 60_000);
        assert_eq!(
            clock.frame(25_000_000, 24_000_000, 120_000).reason,
            ClockFallback::RefreshChanged as u32
        );
        let mut clock = enabled(1);
        for n in 1..=9 {
            clock.frame(n * 50_000_000, n * 50_000_000 - 1, 60_000);
        }
        assert_eq!(clock.state().reason, ClockFallback::LagLimit as u32);
        assert_eq!(clock.state().lag_ns, 0);
    }
    #[test]
    fn independent_outputs_rejections_and_overflow_are_bounded() {
        let mut first = enabled(1);
        let mut second = enabled(1);
        first.frame(50_000_000, 49_000_000, 60_000);
        assert_eq!(second.frame(16_666_667, 16_000_000, 60_000).lag_ns, 0);
        let before = first.state();
        assert_eq!(first.event(-1).status, 2);
        assert_eq!(first.frame(-1, -1, 0).status, 2);
        assert_eq!(first.state(), before);
        first.configure(true);
        first.event(i64::MAX - 10);
        assert_eq!(
            first.frame(i64::MAX, i64::MAX - 1, 60_000).logical_ns,
            i64::MAX
        );
    }
    #[test]
    fn stalled_prediction_and_new_request_after_pause_cannot_stick_or_expire_early() {
        let mut clock = enabled(1_000_000_000);
        clock.frame(1_016_666_667, 1_015_000_000, 60_000);
        let stale = clock.frame(1_016_666_667, 1_500_000_000, 60_000);
        assert_eq!(stale.logical_ns, 1_500_000_000);
        assert_eq!(stale.reason, ClockFallback::Pause as u32);
        assert_eq!(stale.advance, 1);
        let mut clock = enabled(1_000_000_000);
        clock.frame(1_016_666_667, 1_015_000_000, 60_000);
        let request = clock.event(2_000_000_000);
        assert_eq!(request.logical_ns, 2_000_000_000);
        assert_eq!(request.limiting, 0);
        assert_eq!(
            clock.frame(2_016_666_667, 2_015_000_000, 60_000).logical_ns - request.logical_ns,
            16_666_667
        );
    }
}
