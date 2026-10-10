// SPDX-License-Identifier: GPL-2.0-or-later
//! Finite opacity and gain-profile convergence on one borrowed compositor timeline.

pub const DURATION_NS: i64 = 140_000_000;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Sample {
    pub opacity: f64,
    pub active: u32,
    pub retired: u32,
    pub status: u32,
    pub reserved: u32,
}

#[derive(Default)]
pub struct FocusFade {
    opacity: f64,
    from: f64,
    glow_mix: f64,
    glow_from: f64,
    focused: bool,
    pending: bool,
    start: Option<i64>,
    last_frame: Option<i64>,
}

impl FocusFade {
    /// Weight of the slightly wider cached glow profile; zero is the accepted static profile.
    pub fn glow_mix(&self) -> f64 {
        self.glow_mix
    }
    pub fn sample(&self) -> Sample {
        let active = self.pending || self.start.is_some();
        Sample {
            opacity: self.opacity,
            active: u32::from(active),
            retired: u32::from(!self.focused && !active),
            ..Sample::default()
        }
    }
    pub fn retarget(&mut self, focused: bool) -> Sample {
        if focused != self.focused {
            self.focused = focused;
            self.from = self.opacity;
            // Expand only while fully invisible. A rapid regain continues
            // from the displayed profile, never restarting a visible pulse.
            if focused && self.opacity == 0.0 {
                self.glow_mix = 1.0;
            }
            self.glow_from = self.glow_mix;
            self.start = None;
            self.pending =
                self.opacity != f64::from(u8::from(focused)) || (focused && self.glow_mix != 0.0);
        }
        self.sample()
    }
    pub fn advance(&mut self, presentation_ns: i64) -> Sample {
        if presentation_ns < 0 {
            return Sample {
                status: 2,
                ..self.sample()
            };
        }
        // Nested/duplicate output passes and regressed predictions cannot
        // restart a pending transition or advance it twice.
        if self.last_frame.is_some_and(|last| presentation_ns <= last) {
            return self.sample();
        }
        self.last_frame = Some(presentation_ns);
        if self.pending {
            self.pending = false;
            self.start = Some(presentation_ns);
        }
        if let Some(start) = self.start {
            let elapsed = presentation_ns.saturating_sub(start);
            let target = f64::from(u8::from(self.focused));
            if elapsed >= DURATION_NS {
                self.opacity = target;
                if self.focused {
                    self.glow_mix = 0.0;
                }
                self.start = None;
            } else {
                let t = elapsed as f64 / DURATION_NS as f64;
                let eased = t * t * (3.0 - 2.0 * t);
                self.opacity = self.from + (target - self.from) * eased;
                if self.focused {
                    self.glow_mix = self.glow_from * (1.0 - eased);
                }
            }
        }
        self.sample()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gain_converges_without_visible_expansion_on_loss_or_regain() {
        let mut state = FocusFade::default();
        state.retarget(true);
        assert_eq!(state.glow_mix(), 1.0);
        state.advance(0);
        state.advance(70_000_000);
        assert_eq!(state.glow_mix(), 0.5);
        let mix = state.glow_mix();
        state.retarget(false);
        state.advance(80_000_000);
        state.advance(150_000_000);
        assert_eq!(state.glow_mix(), mix); // Loss only fades the current shape.
        let opacity = state.sample().opacity;
        state.retarget(true);
        assert_eq!(state.sample().opacity, opacity);
        assert_eq!(state.glow_mix(), mix); // Never restart a visible wide halo.
        state.advance(160_000_000);
        assert_eq!(state.advance(160_000_000).opacity, opacity);
        assert_eq!(state.glow_mix(), mix);
        state.retarget(true);
        state.advance(230_000_000);
        assert_eq!(state.glow_mix(), 0.25);
        state.advance(300_000_000);
        assert_eq!(state.glow_mix(), 0.0);
        assert_eq!(state.sample().active, 0);
        state.advance(i64::MAX);
        assert_eq!(state.glow_mix(), 0.0);
    }
    #[test]
    fn finite_crossfade_and_idle() {
        let mut old = FocusFade::default();
        old.retarget(true);
        old.advance(1_000_000_000);
        assert_eq!(old.advance(1_140_000_000).opacity, 1.0);
        assert_eq!(old.sample().active, 0);
        let mut new = FocusFade::default();
        old.retarget(false);
        new.retarget(true);
        for time in [
            1_150_000_000,
            1_185_000_000,
            1_220_000_000,
            1_255_000_000,
            1_290_000_000,
        ] {
            let a = old.advance(time);
            let b = new.advance(time);
            assert!((a.opacity + b.opacity - 1.0).abs() < 1e-12);
        }
        assert_eq!(old.sample().retired, 1);
        assert_eq!(new.sample().opacity, 1.0);
        assert_eq!(new.sample().active, 0);
        assert_eq!(new.advance(i64::MAX).opacity, 1.0);
    }
    #[test]
    fn rapid_reversal_starts_at_last_sample_without_restarting_same_target() {
        let mut state = FocusFade::default();
        state.retarget(true);
        state.advance(10);
        let opacity = state.advance(70_000_010).opacity;
        assert_eq!(opacity, 0.5);
        assert_eq!(state.retarget(false).opacity, opacity);
        assert_eq!(state.advance(70_000_010).opacity, opacity);
        assert_eq!(state.advance(0).opacity, opacity);
        assert_eq!(state.advance(80_000_010).opacity, opacity);
        state.retarget(false);
        let fading = state.advance(150_000_010).opacity;
        assert_eq!(fading, 0.25);
        assert_eq!(state.retarget(true).opacity, fading);
        state.advance(160_000_010);
        assert_eq!(state.advance(300_000_010).opacity, 1.0);
        assert_eq!(state.sample().active, 0);
        assert_eq!(state.advance(-1).status, 2);
        assert_eq!(state.sample().opacity, 1.0);
    }
    #[test]
    fn cancelled_before_first_frame_and_sampling_allocate_nothing() {
        let mut state = FocusFade::default();
        state.retarget(true);
        assert_eq!(state.retarget(false).retired, 1);
        state.retarget(true);
        let count = crate::allocation_checks::count(|| {
            for i in 0..1000 {
                std::hint::black_box(state.advance(i * 1_000_000));
                std::hint::black_box(state.sample());
                std::hint::black_box(state.glow_mix());
            }
        });
        assert_eq!(count, 0);
        assert_eq!(state.sample().active, 0);
    }
}
