// SPDX-License-Identifier: GPL-2.0-or-later
//! Bounded input sequence ownership. No platform objects, clocks or allocation.
#[derive(Clone, Copy, Debug)]
struct Slot {
    id: u64,
    suppressed: bool,
}
#[derive(Clone, Debug, Default)]
pub struct PartialInputState {
    buttons: [Option<Slot>; 32],
    touches: [Option<Slot>; 32],
    button_overflow: bool,
    touch_overflow: bool,
    tools: [Option<Slot>; 32],
    tool_overflow: bool,
    release_frame: bool,
}
impl PartialInputState {
    pub fn preserves_native_grab(&self) -> bool {
        self.release_frame
            || self
                .buttons
                .iter()
                .chain(&self.touches)
                .chain(&self.tools)
                .flatten()
                .any(|s| !s.suppressed)
    }
    pub fn pending(&self) -> (u32, u32) {
        (
            self.buttons
                .iter()
                .flatten()
                .filter(|s| s.suppressed)
                .count() as u32
                + u32::from(self.button_overflow)
                + self.tools.iter().flatten().filter(|s| s.suppressed).count() as u32
                + u32::from(self.tool_overflow),
            self.touches
                .iter()
                .flatten()
                .filter(|s| s.suppressed)
                .count() as u32
                + u32::from(self.touch_overflow),
        )
    }
    // motion/down/up/axis/touch-down/move/up/cancel/frame = 0..8.
    // flags: native delegate=1, physical pointer idle=2, touch idle=4.
    pub fn event(&mut self, kind: u32, id: u64, blocked: bool, flags: u32) -> (bool, bool) {
        if (9..=12).contains(&kind) {
            let mut tool = Self {
                buttons: self.tools,
                button_overflow: self.tool_overflow,
                release_frame: self.release_frame,
                ..Self::default()
            };
            let result = if kind == 12 {
                let consume = tool
                    .buttons
                    .iter()
                    .flatten()
                    .any(|s| s.id == id && s.suppressed)
                    || tool.button_overflow;
                for slot in &mut tool.buttons {
                    if slot.is_some_and(|s| s.id == id) {
                        if slot.is_some_and(|s| !s.suppressed) {
                            tool.release_frame = true;
                        }
                        *slot = None;
                    }
                }
                // One proximity leave does not prove other overflowed tools
                // are idle. Keep fail-closed ownership without unbounded IDs.
                if flags & 2 != 0 {
                    tool.button_overflow = false;
                }
                (consume, false)
            } else {
                tool.event(
                    match kind {
                        9 => 1,
                        10 => 0,
                        _ => 2,
                    },
                    id,
                    blocked,
                    flags & 1,
                )
            };
            self.tools = tool.buttons;
            self.tool_overflow = tool.button_overflow;
            self.release_frame = tool.release_frame;
            return result;
        }
        let native = flags & 1 != 0;
        let buttons = self
            .buttons
            .iter()
            .flatten()
            .filter(|s| s.suppressed)
            .count() as u32
            + u32::from(self.button_overflow);
        let touches = self.pending().1;
        match kind {
            0 | 3 => (
                buttons > 0
                    || (kind == 3
                        && blocked
                        && !native
                        && !self.buttons.iter().flatten().any(|s| !s.suppressed)),
                false,
            ),
            1 | 4 => {
                let touch = kind == 4;
                let pending = if touch { touches } else { buttons };
                let slots = if touch {
                    &mut self.touches
                } else {
                    &mut self.buttons
                };
                if let Some(s) = slots.iter().flatten().find(|s| s.id == id) {
                    return (s.suppressed, false);
                }
                let forwarded = slots.iter().flatten().any(|s| !s.suppressed);
                let suppress = pending > 0 || (blocked && !native && !forwarded);
                if let Some(slot) = slots.iter_mut().find(|slot| slot.is_none()) {
                    *slot = Some(Slot {
                        id,
                        suppressed: suppress,
                    });
                } else if suppress {
                    if touch {
                        self.touch_overflow = true;
                    } else {
                        self.button_overflow = true;
                    }
                }
                (suppress, suppress && pending == 0)
            }
            2 | 6 => {
                let touch = kind == 6;
                let overflow = if touch {
                    self.touch_overflow
                } else {
                    self.button_overflow
                };
                let slots = if touch {
                    &mut self.touches
                } else {
                    &mut self.buttons
                };
                if let Some(slot) = slots
                    .iter_mut()
                    .find(|slot| slot.is_some_and(|s| s.id == id))
                {
                    let suppressed = slot.take().is_some_and(|s| s.suppressed);
                    if !suppressed {
                        self.release_frame = true;
                    }
                    return (suppressed, false);
                }
                (overflow, false)
            }
            5 => (
                self.touch_overflow
                    || self
                        .touches
                        .iter()
                        .flatten()
                        .any(|s| s.id == id && s.suppressed),
                false,
            ),
            7 => {
                self.touches = [None; 32];
                self.touch_overflow = false;
                (touches > 0, false)
            }
            8 => {
                // Seat delivery happens after our filter. Protect the last
                // forwarded release until the platform's end-of-input-frame.
                self.release_frame = false;
                if flags & 2 != 0 {
                    self.button_overflow = false;
                    for s in &mut self.buttons {
                        if s.is_some_and(|s| !s.suppressed) {
                            *s = None;
                        }
                    }
                }
                if flags & 4 != 0 {
                    self.touch_overflow = false;
                    for s in &mut self.touches {
                        if s.is_some_and(|s| !s.suppressed) {
                            *s = None;
                        }
                    }
                }
                (false, false)
            }
            _ => (false, false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_release_stays_protected_until_frame_delivery() {
        let mut s = PartialInputState::default();
        assert!(!s.preserves_native_grab());
        s.event(1, 272, false, 0);
        assert!(s.preserves_native_grab());
        assert_eq!(s.event(2, 272, true, 0), (false, false));
        assert!(s.preserves_native_grab());
        s.event(8, 0, false, 6);
        assert!(!s.preserves_native_grab());
        s.event(1, 272, true, 0);
        assert!(!s.preserves_native_grab());
        assert_eq!(s.event(2, 272, false, 1), (true, false));
        assert!(!s.preserves_native_grab());
    }
    #[test]
    fn tablet_touch_and_pointer_ownership_are_independent() {
        let mut s = PartialInputState::default();
        let tool = u64::MAX;
        assert_eq!(s.event(9, tool, true, 0), (true, true));
        assert_eq!(s.event(10, tool, false, 1), (true, false));
        assert_eq!(s.event(1, 272, false, 0), (false, false));
        assert_eq!(s.event(4, 7, true, 0), (true, true));
        assert_eq!(s.event(5, 7, false, 1), (true, false));
        assert_eq!(s.event(8, 0, false, 6), (false, false));
        assert_eq!(s.pending(), (1, 1));
        assert_eq!(s.event(11, tool, false, 1), (true, false));
        assert_eq!(s.event(2, 272, true, 0), (false, false));
        assert_eq!(s.event(7, 0, false, 0), (true, false));
        assert_eq!(s.pending(), (0, 0));
        assert_eq!(s.event(9, tool, true, 1), (false, false));
        assert_eq!(s.event(9, 2, true, 0), (false, false));
        assert_eq!(s.event(12, tool, false, 0), (false, false));
        assert_eq!(s.event(12, 2, false, 0), (false, false));
        assert_eq!(s.event(9, tool, true, 0), (true, true));
        assert_eq!(s.event(12, tool, false, 1), (true, false));
        assert_eq!(s.pending(), (0, 0));
    }
    #[test]
    fn pairing_native_grab_and_bounded_overflow() {
        let mut s = PartialInputState::default();
        assert_eq!(s.event(1, 272, true, 0), (true, true));
        assert_eq!(s.event(1, 273, true, 1), (true, false));
        assert_eq!(s.event(2, 272, false, 1), (true, false));
        assert_eq!(s.event(2, 273, false, 0), (true, false));
        assert_eq!(s.pending(), (0, 0));
        assert_eq!(s.event(1, 272, false, 0), (false, false));
        assert_eq!(s.event(1, 273, true, 0), (false, false));
        s.event(2, 272, true, 0);
        s.event(2, 273, true, 0);
        for id in 0..100 {
            assert!(s.event(4, id, true, 0).0);
        }
        assert!(s.pending().1 <= 33);
        for id in 0..100 {
            assert!(s.event(6, id, false, 1).0);
        }
        s.event(8, 0, false, 6);
        assert_eq!(s.pending(), (0, 0));
    }
}
