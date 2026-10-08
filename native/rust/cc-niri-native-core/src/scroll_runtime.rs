// SPDX-License-Identifier: GPL-2.0-or-later
//! Scroll authority, shared motion and projection. No platform objects or clock reads.
pub use crate::native_protocol::*;
use crate::spring::SpringParams;
use crate::viewport_motion::{MotionKind, ViewportMotion};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct ScrollViewportRuntime {
    sequence: ScrollSequence,
    motion: ViewportMotion,
    cancelled_epoch: i64,
    columns: HashMap<WindowId, Rect>,
    source_frames: HashMap<WindowId, Rect>,
    visual_targets: HashMap<WindowId, Rect>,
    roles: HashMap<WindowId, WindowRole>,
    viewport: Rect,
    frame_offset: f64,
    completed: bool,
    fuzzy_zero: bool,
    clip_partial: bool,
    windows: WindowRegistry,
}
impl ScrollViewportRuntime {
    pub fn new(fuzzy_zero: bool) -> Self {
        Self {
            sequence: ScrollSequence::default(),
            motion: ViewportMotion::new(SpringParams::default()),
            cancelled_epoch: -1,
            columns: HashMap::new(),
            source_frames: HashMap::new(),
            visual_targets: HashMap::new(),
            roles: HashMap::new(),
            viewport: Rect::default(),
            frame_offset: 0.0,
            completed: false,
            fuzzy_zero,
            clip_partial: false,
            windows: WindowRegistry::default(),
        }
    }
    // Stable per-runtime tokens avoid string conversion/allocation on projection.
    pub fn intern(&mut self, name: Text) -> WindowId {
        self.windows.intern(name)
    }
    pub fn label(&self, id: WindowId) -> Option<&Text> {
        self.windows.label(id)
    }
    pub fn targets(&self) -> &HashMap<WindowId, Rect> {
        &self.columns
    }
    pub fn source_frames(&self) -> &HashMap<WindowId, Rect> {
        &self.source_frames
    }
    pub fn role(&self, id: WindowId) -> Option<WindowRole> {
        self.roles.get(&id).copied()
    }
    pub fn active(&self) -> bool {
        !self.columns.is_empty()
    }
    pub fn status(&self) -> RuntimeStatus {
        RuntimeStatus {
            context: self.context().cloned(),
            epoch: Epoch(self.epoch()),
            active: self.active(),
            completed: self.completed,
        }
    }
    pub fn epoch(&self) -> i64 {
        self.motion.sample(0).epoch
    }
    pub fn clips_partial(&self) -> bool {
        self.active() && self.clip_partial
    }
    pub fn input_blocked(&self, id: WindowId, x: f64, y: f64) -> bool {
        self.clips_partial()
            && self.columns.contains_key(&id)
            && (x < self.viewport.x
                || y < self.viewport.y
                || x >= self.viewport.x + self.viewport.width
                || y >= self.viewport.y + self.viewport.height)
    }
    pub fn completed(&self) -> bool {
        self.completed
    }
    pub fn context(&self) -> Option<&Context> {
        self.sequence.context.as_ref()
    }
    pub fn clear(&mut self) {
        self.columns.clear();
        self.source_frames.clear();
        self.visual_targets.clear();
        self.roles.clear();
        self.completed = false;
        self.clip_partial = false;
        self.motion.snap(self.motion.sample(0).target);
    }
    pub fn remove(&mut self, id: WindowId) {
        self.columns.remove(&id);
        self.source_frames.remove(&id);
        self.visual_targets.remove(&id);
        self.roles.remove(&id);
        self.windows.remove(id);
    }
    pub fn update_context(&mut self, raw: RuntimeContext) -> bool {
        let old = self.context().cloned();
        if self.sequence.update(raw).is_err() || self.context().is_none() {
            self.clear();
            self.sequence = ScrollSequence::default();
            self.motion = ViewportMotion::new(SpringParams::default());
            self.cancelled_epoch = -1;
            return false;
        }
        let next = self.context().expect("validated context");
        let new_session = old.as_ref().is_none_or(|c| c.session != next.session);
        let switched = old.as_ref().is_none_or(|c| {
            c.session != next.session || c.workspace != next.workspace || c.output != next.output
        });
        if switched {
            self.clear();
        }
        if new_session {
            self.motion = ViewportMotion::new(SpringParams::default());
            self.cancelled_epoch = -1;
        }
        true
    }
    pub fn valid_plan(&self, plan: &ScrollPlan) -> bool {
        valid_scroll_plan(plan, &self.windows)
    }
    pub fn arm(&mut self, plan: ScrollPlan, now: i64, frames: &HashMap<WindowId, Rect>) -> bool {
        let Ok(mut validated) = ValidatedScrollPlan::new(plan, &self.windows) else {
            return false;
        };
        let epoch = validated.epoch().0;
        if epoch <= self.cancelled_epoch {
            return false;
        }
        match self.sequence.observe_validated(&mut validated) {
            Ok(PlanDisposition::Accepted) => {}
            Ok(PlanDisposition::Duplicate) => return self.active(),
            _ => return false,
        }
        let plan = validated.into_wire();
        let clip_partial = plan.clip_partial == 2;
        let rect = plan.viewport;
        let target = plan.new_offset;
        let old_offset = plan.old_offset;
        let continuing = self.active() && self.viewport.equivalent(rect, self.fuzzy_zero);
        let mut columns = HashMap::new();
        let mut visual_targets = HashMap::new();
        let mut source_frames = HashMap::new();
        let mut roles = HashMap::new();
        for entry in plan.entries {
            let id = entry.window_id;
            let outgoing = entry.new_placement == Placement::Parked
                && entry.old_placement == Placement::Visible;
            if !outgoing && entry.new_placement != Placement::Visible {
                continue;
            }
            if continuing {
                if let Some(previous) = self.visual_targets.get(&id) {
                    if (previous.x + self.motion.sample(0).target - rect.x - entry.logical_x).abs()
                        > GEOMETRY_EPSILON
                        || (previous.width - entry.pixel_width).abs() > GEOMETRY_EPSILON
                    {
                        return false;
                    }
                }
            }
            let old_rect = Rect {
                x: rect.x + entry.logical_x - old_offset,
                y: rect.y,
                width: entry.pixel_width,
                height: rect.height,
            };
            let source = frames
                .get(&id)
                .copied()
                .or_else(|| {
                    if continuing {
                        self.columns.get(&id).copied()
                    } else {
                        None
                    }
                })
                .unwrap_or(old_rect);
            if (entry.old_placement == Placement::Visible
                || (continuing && self.columns.contains_key(&id)))
                && source.intersects(rect)
            {
                source_frames.insert(id, source);
            }
            roles.insert(
                id,
                if outgoing {
                    WindowRole::Outgoing
                } else if entry.old_placement == Placement::Parked {
                    WindowRole::Incoming
                } else {
                    WindowRole::Continuing
                },
            );
            let visual = Rect {
                x: rect.x + entry.logical_x - target,
                y: rect.y,
                width: entry.pixel_width,
                height: rect.height,
            };
            columns.insert(id, if outgoing { source } else { visual });
            visual_targets.insert(id, visual);
        }
        if continuing {
            for (id, column) in &self.columns {
                if columns.contains_key(id) || self.roles.get(id) != Some(&WindowRole::Outgoing) {
                    continue;
                }
                columns.insert(*id, *column);
                source_frames.insert(*id, *column);
                let mut visual = self.visual_targets.get(id).copied().unwrap_or_default();
                visual.x += self.motion.sample(0).target - target;
                visual_targets.insert(*id, visual);
                roles.insert(*id, WindowRole::Outgoing);
            }
        }
        if columns.is_empty() {
            self.clear();
            return false;
        }
        if !self.motion.start(
            if continuing {
                self.frame_offset
            } else {
                old_offset
            },
            target,
            epoch,
            now,
        ) {
            return false;
        }
        self.columns = columns;
        self.visual_targets = visual_targets;
        self.source_frames = source_frames;
        self.roles = roles;
        self.viewport = rect;
        self.frame_offset = self.motion.sample(now).current;
        self.completed = false;
        self.clip_partial = clip_partial;
        true
    }
    pub fn cancel(&mut self, session: &Text, epoch: i64) {
        if self.context().is_none_or(|c| &c.session.0 != session) || epoch < 0 {
            return;
        }
        self.cancelled_epoch = self.cancelled_epoch.max(epoch);
        if self.epoch() <= epoch {
            self.clear();
        }
    }
    pub fn advance(&mut self, now: i64) -> bool {
        if !self.active() {
            return false;
        }
        if self.completed {
            return true;
        }
        self.frame_offset = self.motion.sample(now).current;
        if self.motion.sample(now).kind == MotionKind::Static {
            self.motion.finish(self.epoch(), now);
            self.frame_offset = self.motion.sample(0).target;
            self.completed = true;
        }
        true
    }
    pub fn projection(&self, id: WindowId, geometry: Rect) -> Option<ScrollProjection> {
        let target = self.columns.get(&id)?;
        if !geometry.near(*target)
            && !self
                .source_frames
                .get(&id)
                .is_some_and(|source| geometry.near(*source))
        {
            return None;
        }
        Some(ScrollProjection {
            translation_x: self.visual_targets.get(&id)?.x - geometry.x
                + self.motion.sample(0).target
                - self.frame_offset,
            viewport: self.viewport,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context(session: &str, generation: f64) -> RuntimeContext {
        RuntimeContext {
            protocol: 2.0,
            session: Text::from_utf8(session),
            workspace: Text::from_utf8("a"),
            output: Text::from_utf8("eDP-1"),
            generation,
        }
    }
    fn plan(runtime: &mut ScrollViewportRuntime, epoch: f64, from: f64, to: f64) -> ScrollPlan {
        let mut entries = Vec::new();
        for i in 0..5 {
            let x = f64::from(i) * 1260.25;
            let visible = |offset: f64| x >= offset && x + 1252.25 <= offset + 2512.5;
            if !visible(from) && !visible(to) {
                continue;
            }
            entries.push(ScrollEntry {
                window_id: runtime.intern(Text::from_utf8(&i.to_string())),
                column_id: f64::from(i),
                logical_x: x,
                pixel_width: 1252.25,
                old_placement: if visible(from) {
                    Placement::Visible
                } else {
                    Placement::Parked
                },
                new_placement: if visible(to) {
                    Placement::Visible
                } else {
                    Placement::Parked
                },
            });
        }
        ScrollPlan {
            shape_valid: true,
            protocol: 2.0,
            kind: Text::from_utf8("SCROLL"),
            session: Text::from_utf8("s"),
            workspace: Text::from_utf8("a"),
            output: Text::from_utf8("eDP-1"),
            epoch,
            issued_at: 1.0,
            old_offset: from,
            new_offset: to,
            retarget_only: if from == to { 2 } else { 0 },
            clip_partial: 0,
            viewport: Rect {
                x: -1920.5,
                y: 50.25,
                width: 2512.5,
                height: 1320.25,
            },
            entries,
            fingerprint: format!("{epoch}/{from}/{to}").into_bytes(),
        }
    }
    #[test]
    fn retarget_uses_last_painted_offset_and_holds_outgoing() {
        let mut runtime = ScrollViewportRuntime::new(true);
        assert!(runtime.update_context(context("s", 1.0)));
        let p = plan(&mut runtime, 1.0, 0.0, 1260.25);
        assert!(runtime.arm(p, 0, &HashMap::new()));
        assert!(runtime.advance(60_000_000));
        let id = runtime.intern(Text::from_utf8("1"));
        let outgoing = runtime.intern(Text::from_utf8("0"));
        let before = runtime.columns[&id];
        let painted = before.x + runtime.projection(id, before).unwrap().translation_x;
        let frames = runtime.targets().clone();
        let p = plan(&mut runtime, 2.0, 1260.25, 2520.5);
        assert!(runtime.arm(p, 63_000_000, &frames));
        let after = runtime.columns[&id];
        assert!(
            (painted - after.x - runtime.projection(id, after).unwrap().translation_x).abs() < 1e-8
        );
        assert_eq!(runtime.role(outgoing), Some(WindowRole::Outgoing));
        runtime.advance(4_000_000_000);
        assert!(runtime.completed());
        assert!(runtime.active());
        let rect = runtime.columns[&outgoing];
        let p = runtime.projection(outgoing, rect).unwrap();
        assert!(rect.x + rect.width + p.translation_x <= p.viewport.x);
        runtime.cancel(&Text::from_utf8("s"), 1);
        assert!(runtime.active());
        runtime.cancel(&Text::from_utf8("s"), 2);
        assert!(!runtime.active());
        assert!(!runtime.completed());
    }
    #[test]
    fn rejected_geometry_consumes_sequence_but_preserves_motion() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = plan(&mut r, 1.0, 0.0, 1260.25);
        assert!(r.arm(p, 10, &HashMap::new()));
        let mut p = plan(&mut r, 2.0, 1260.25, 0.0);
        p.entries[1].pixel_width = 1200.0;
        assert!(!r.arm(p.clone(), 11, &HashMap::new()));
        assert_eq!(r.epoch(), 1);
        assert!(r.arm(p.clone(), 12, &HashMap::new()));
        assert_eq!(r.epoch(), 1);
        r.clear();
        assert!(!r.arm(p, 13, &HashMap::new()));
        assert!(!r.update_context(context("s", 0.0)));
        assert_eq!(r.epoch(), -1);
        r.update_context(context("s", 1.0));
        let p = plan(&mut r, 0.0, 0.0, 1260.25);
        assert!(r.arm(p, 0, &HashMap::new()));
    }
    #[test]
    fn full_half_partial_preserves_width_and_static_clip_until_retired() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let mut p = plan(&mut r, 1.0, 0.0, 1260.25);
        p.clip_partial = 2;
        p.entries.truncate(2);
        p.entries[0].pixel_width = 2512.5;
        p.entries[0].new_placement = Placement::Visible;
        p.entries[1].logical_x = 2520.5;
        p.entries[1].old_placement = Placement::Parked;
        let full = p.entries[0].window_id;
        let half = p.entries[1].window_id;
        let viewport = p.viewport;
        let mut bad = p.clone();
        bad.clip_partial = 0;
        assert!(!r.arm(bad, 0, &HashMap::new()));
        let mut bad = p.clone();
        bad.clip_partial = 3;
        assert!(!r.arm(bad, 0, &HashMap::new()));
        assert!(r.arm(p, 0, &HashMap::new()));
        let geometry = r.targets()[&full];
        assert_eq!(geometry.width, viewport.width);
        assert!(r.advance(10_000_000_000));
        assert!(r.completed() && r.clips_partial());
        assert_eq!(r.role(full), Some(WindowRole::Continuing));
        assert_eq!(r.projection(full, geometry).unwrap().translation_x, 0.0);
        let allocations = crate::allocation_checks::count(|| {
            for _ in 0..1000 {
                assert!(!r.input_blocked(full, viewport.x, viewport.y));
                assert!(r.input_blocked(full, viewport.x - 1.0, viewport.y));
                assert!(r.input_blocked(half, viewport.x + viewport.width, viewport.y));
                assert!(!r.input_blocked(WindowId(u64::MAX), viewport.x - 1.0, viewport.y));
            }
        });
        assert_eq!(allocations, 0);
        let frozen = r.clone();
        r.cancel(&Text::from_utf8("s"), 1);
        assert!(!r.clips_partial());
        assert!(!r.input_blocked(full, viewport.x - 1.0, viewport.y));
        assert!(frozen.projection(full, geometry).is_some());
    }
    #[test]
    fn frame_operations_allocate_nothing() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = plan(&mut r, 1.0, 0.0, 1260.25);
        r.arm(p, 0, &HashMap::new());
        let id = r.intern(Text::from_utf8("1"));
        let geometry = r.targets()[&id];
        let allocations = crate::allocation_checks::count(|| {
            for frame in 0..1000 {
                std::hint::black_box(r.advance(frame * 1_000_000));
                std::hint::black_box(r.projection(id, geometry));
                std::hint::black_box((r.active(), r.completed(), r.epoch(), r.role(id)));
                std::hint::black_box(r.targets());
                std::hint::black_box(r.source_frames());
            }
        });
        assert_eq!(allocations, 0);
    }
    #[test]
    fn source_projection_bounds_and_registry_lifecycle() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = plan(&mut r, 1.0, 0.0, 1260.25);
        r.arm(p, 0, &HashMap::new());
        let id = r.intern(Text::from_utf8("1"));
        let rect = r.columns[&id];
        assert!(r
            .projection(
                id,
                Rect {
                    x: rect.x + 0.5,
                    ..rect
                }
            )
            .is_some());
        assert!(r
            .projection(
                id,
                Rect {
                    x: rect.x + 0.500001,
                    ..rect
                }
            )
            .is_none());
        assert!(r
            .projection(
                id,
                Rect {
                    width: rect.width + 1.0,
                    ..rect
                }
            )
            .is_none());
        r.remove(id);
        assert!(r.projection(id, rect).is_none());
        assert!(r.label(id).is_none());
        let new_id = r.intern(Text::from_utf8("1"));
        assert_ne!(id, new_id);
        assert!(Text::from_utf8("i̇𐐨").canonical_window());
        assert!(!Text::from_utf8("İ").canonical_window());
        assert!(!Text(vec![0x85, 0xa0]).valid());
        assert!(Text(vec![0xd800]).canonical_window());
    }
}
