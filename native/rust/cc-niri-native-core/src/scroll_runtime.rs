// SPDX-License-Identifier: GPL-2.0-or-later
//! Scroll authority, shared motion and projection. No platform objects or clock reads.
pub use crate::native_protocol::*;
use crate::scroll_retarget::{MotionBounds, ResetReason, RetargetDecision, RetargetStrategy};
use crate::scroll_visual::{OutputFacts, VisualFallback};
use crate::spring::SpringParams;
use crate::viewport_motion::{MotionKind, MotionSample, ViewportMotion};
use std::collections::HashMap;

#[path = "scroll_client_paint.rs"]
mod client_paint;
pub use client_paint::ClientPaint;
#[path = "scroll_geometry_runtime.rs"]
mod geometry_runtime;
pub use geometry_runtime::{GeometryClientFact, GeometrySourceRequest};

#[derive(Clone, Copy, Debug)]
pub struct ScrollFrameSample {
    pub motion: MotionSample,
    pub time_ns: i64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RetargetStats {
    pub degraded: u64,
    pub carried: u64,
    pub braked: u64,
    pub kept: u64,
    pub reasons: [u64; 4],
    pub last: RetargetDecision,
}
impl RetargetStats {
    fn record(&mut self, decision: RetargetDecision) {
        match decision.strategy {
            RetargetStrategy::Carry => self.carried = self.carried.saturating_add(1),
            RetargetStrategy::Brake => self.braked = self.braked.saturating_add(1),
            RetargetStrategy::Keep => self.kept = self.kept.saturating_add(1),
            RetargetStrategy::Reset => {
                self.degraded = self.degraded.saturating_add(1);
                let count = &mut self.reasons[decision.reason as usize];
                *count = count.saturating_add(1);
            }
            RetargetStrategy::Rest => {}
        }
        self.last = decision;
    }
}

#[derive(Clone, Debug)]
pub struct ScrollViewportRuntime {
    sequence: ScrollSequence,
    motion: ViewportMotion,
    cancelled_epoch: i64,
    columns: HashMap<WindowId, Rect>,
    source_frames: HashMap<WindowId, Rect>,
    visual_targets: HashMap<WindowId, Rect>,
    roles: HashMap<WindowId, WindowRole>,
    client_paints: HashMap<WindowId, (f64, Option<ClientPaint>)>,
    client_serial: u64,
    geometry: Option<crate::column_geometry::ColumnGeometryTransition>,
    paint_basis: Option<PartialScrollConfig>,
    geometry_observation: Option<crate::column_geometry::GeometrySource>,
    geometry_completion_serial: u64,
    closing: HashMap<WindowId, (Rect, Rect, Rect)>,
    viewport: Rect,
    frame_offset: f64,
    // prepare_frame projects a pending sample. Only mark_painted promotes it
    // to the retarget anchor and publishes numerical completion.
    anchor_offset: f64,
    frame_sample: Option<ScrollFrameSample>,
    painted_sample: Option<ScrollFrameSample>,
    origin_sample: Option<ScrollFrameSample>,
    completed: bool,
    fuzzy_zero: bool,
    clip_partial: bool,
    partial: Option<PartialScrollConfig>,
    pub partial_input: crate::partial_input::PartialInputState,
    windows: WindowRegistry,
    smooth_motion: bool,
    retarget: RetargetStats,
    pub visual_fallback: VisualFallback,
    pub output_facts: OutputFacts,
    pub visual_completed: u64,
    pub visual_fallback_counts: [u64; 3],
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
            client_paints: HashMap::new(),
            client_serial: 0,
            geometry: None,
            paint_basis: None,
            geometry_observation: None,
            geometry_completion_serial: 0,
            closing: HashMap::new(),
            viewport: Rect::default(),
            frame_offset: 0.0,
            anchor_offset: 0.0,
            frame_sample: None,
            painted_sample: None,
            origin_sample: None,
            completed: false,
            fuzzy_zero,
            clip_partial: false,
            partial: None,
            partial_input: crate::partial_input::PartialInputState::default(),
            windows: WindowRegistry::default(),
            smooth_motion: false,
            retarget: RetargetStats::default(),
            visual_fallback: VisualFallback::Disabled,
            output_facts: OutputFacts::default(),
            visual_completed: 0,
            visual_fallback_counts: [0; 3],
        }
    }
    // Stable per-runtime tokens avoid string conversion/allocation on projection.
    pub fn intern(&mut self, name: Text) -> WindowId {
        self.windows.intern(name)
    }
    pub fn label(&self, id: WindowId) -> Option<&Text> {
        self.windows.label(id)
    }
    // Adapter-owned copies freeze a rendered pose for workspace departure and
    // clip handoff. An unused prePaint sample must not become that pose.
    pub fn clone_for_paint(&self) -> Self {
        let mut copy = self.clone();
        copy.geometry = self.geometry.as_ref().map(|g| g.clone_for_paint());
        copy.frame_offset = self.anchor_offset;
        copy.frame_sample = self
            .painted_sample
            .filter(|s| s.motion.epoch == self.epoch());
        copy
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
        self.client_paints.clear();
        self.client_serial = 0;
        self.geometry = None;
        self.geometry_completion_serial = 0;
        self.closing.clear();
        self.paint_basis = None;
        self.geometry_observation = None;
        self.completed = false;
        self.clip_partial = false;
        self.partial = None;
        self.frame_sample = None;
        self.painted_sample = None;
        self.origin_sample = None;
        self.visual_fallback = VisualFallback::Disabled;
        self.output_facts = OutputFacts::default();
        self.motion.snap(self.motion.sample(0).target);
    }
    pub fn remove(&mut self, id: WindowId) {
        self.geometry_observation = None;
        self.columns.remove(&id);
        self.source_frames.remove(&id);
        self.visual_targets.remove(&id);
        self.roles.remove(&id);
        self.client_paints.remove(&id);
        self.closing.remove(&id);
        if let Some(g) = &mut self.geometry {
            g.remove(id);
        }
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
        self.arm_with_policy(plan, now, frames, false)
    }
    pub fn arm_with_policy(
        &mut self,
        plan: ScrollPlan,
        now: i64,
        frames: &HashMap<WindowId, Rect>,
        smooth: bool,
    ) -> bool {
        let Ok(validated) = ValidatedScrollPlan::new(plan, &self.windows) else {
            return false;
        };
        self.arm_validated(validated, 0.0, now, frames, smooth, None)
    }
    pub fn arm_partial(
        &mut self,
        plan: ScrollPlan,
        now: i64,
        frames: &HashMap<WindowId, Rect>,
        smooth: bool,
        actual_output: Rect,
    ) -> bool {
        if plan.partial.is_none() {
            return false;
        }
        let Ok(validated) = ValidatedScrollPlan::new(plan, &self.windows) else {
            return false;
        };
        self.arm_validated(validated, 0.0, now, frames, smooth, Some(actual_output))
    }
    pub fn arm_reindex(
        &mut self,
        plan: ScrollPlan,
        source: WindowId,
        source_logical_x: f64,
        now: i64,
        frames: &HashMap<WindowId, Rect>,
        smooth: bool,
    ) -> bool {
        let Ok((validated, shift)) =
            ValidatedScrollPlan::new_reindex(plan, source, source_logical_x, &self.windows)
        else {
            return false;
        };
        self.arm_validated(validated, shift, now, frames, smooth, None)
    }
    fn arm_validated(
        &mut self,
        mut validated: ValidatedScrollPlan,
        basis_shift: f64,
        now: i64,
        frames: &HashMap<WindowId, Rect>,
        smooth: bool,
        actual_output: Option<Rect>,
    ) -> bool {
        let epoch = validated.epoch().0;
        if epoch <= self.cancelled_epoch {
            return false;
        }
        match self.sequence.observe_validated(&mut validated) {
            Ok(PlanDisposition::Accepted) => {}
            Ok(PlanDisposition::Duplicate) => {
                return self.active()
                    && (!validated.is_partial()
                        || (self.partial.is_some()
                            && self.epoch() == epoch
                            && actual_output == Some(self.viewport)))
                    && (basis_shift == 0.0 || self.motion.sample(0).epoch == epoch)
            }
            _ => return false,
        }
        if self.geometry.is_some() {
            return false;
        }
        let plan = validated.into_wire();
        let partial = plan.partial.clone();
        if partial.is_some() && actual_output != Some(plan.viewport) {
            return false;
        }
        let clip_partial = plan.clip_partial == 2;
        let rect = plan.viewport;
        let layout = partial.as_ref().map_or(rect, |p| p.layout);
        let target = plan.new_offset;
        let old_offset = plan.old_offset + basis_shift;
        let continuing = self.active()
            && self.viewport.equivalent(rect, self.fuzzy_zero)
            && match (&self.partial, &partial) {
                (None, None) => true,
                (Some(a), Some(b)) => a.scope_revision == b.scope_revision && a.layout == b.layout,
                _ => false,
            };
        if basis_shift != 0.0
            && continuing
            && plan
                .entries
                .iter()
                .filter(|e| e.old_placement == Placement::Visible)
                .any(|e| !self.visual_targets.contains_key(&e.window_id))
        {
            return false;
        }
        let mut columns = HashMap::new();
        let mut visual_targets = HashMap::new();
        let mut source_frames = HashMap::new();
        let mut roles = HashMap::new();
        let mut client_paints = HashMap::new();
        for entry in plan.entries {
            let id = entry.window_id;
            let outgoing = entry.new_placement == Placement::Parked
                && entry.old_placement == Placement::Visible;
            if !outgoing && entry.new_placement != Placement::Visible {
                continue;
            }
            if partial.is_some() {
                client_paints.insert(id, (entry.column_id, None));
            }
            if continuing {
                if let Some(previous) = self.visual_targets.get(&id) {
                    if (previous.x + self.motion.sample(0).target + basis_shift
                        - layout.x
                        - entry.logical_x)
                        .abs()
                        > GEOMETRY_EPSILON
                        || (previous.width - entry.pixel_width).abs() > GEOMETRY_EPSILON
                    {
                        return false;
                    }
                }
            }
            let old_rect = Rect {
                x: layout.x + entry.logical_x - old_offset,
                y: layout.y,
                width: entry.pixel_width,
                height: layout.height,
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
            // P3 is a same-size camera contract. Resizes require the P4 typed
            // geometry/configure transaction, including incoming parked clients.
            if partial.is_some()
                && (frames.get(&id).is_none()
                    || !source.valid_viewport()
                    || (source.width - entry.pixel_width).abs() > 0.000001
                    || (source.height - layout.height).abs() > 0.000001)
            {
                return false;
            }
            let old_anchor = if partial.is_some() {
                Self::partial_anchor(old_rect, rect)
            } else {
                old_rect
            };
            if partial.is_some()
                && entry.old_placement == Placement::Visible
                && !source.near(old_anchor)
                && !(continuing
                    && (self.columns.get(&id).is_some_and(|r| source.near(*r))
                        || self.source_frames.get(&id).is_some_and(|r| source.near(*r))))
            {
                return false;
            }
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
                x: layout.x + entry.logical_x - target,
                y: layout.y,
                width: entry.pixel_width,
                height: layout.height,
            };
            columns.insert(
                id,
                if outgoing {
                    source
                } else if partial.is_some() {
                    Self::partial_anchor(visual, rect)
                } else {
                    visual
                },
            );
            visual_targets.insert(id, visual);
        }
        if continuing {
            for (id, column) in &self.columns {
                if columns.contains_key(id)
                    || (partial.is_none() && self.roles.get(id) != Some(&WindowRole::Outgoing))
                {
                    continue;
                }
                columns.insert(*id, *column);
                source_frames.insert(
                    *id,
                    if partial.is_some() {
                        self.source_frames.get(id).copied().unwrap_or(*column)
                    } else {
                        *column
                    },
                );
                let mut visual = self.visual_targets.get(id).copied().unwrap_or_default();
                visual.x += self.motion.sample(0).target + basis_shift - target;
                visual_targets.insert(*id, visual);
                roles.insert(*id, WindowRole::Outgoing);
                if let Some((column_id, _)) = self.client_paints.get(id) {
                    client_paints.insert(*id, (*column_id, None));
                }
            }
        }
        if columns.is_empty() {
            self.clear();
            return false;
        }
        if partial.is_some()
            && visual_targets.iter().any(|(id, a)| {
                visual_targets
                    .iter()
                    .any(|(other, b)| id != other && a.x < b.x + b.width && a.x + a.width > b.x)
            })
        {
            return false;
        }
        let from = if continuing {
            self.anchor_offset + basis_shift
        } else {
            old_offset
        };
        // Context switches clear samples before arm; same-frame targets keep
        // reusing the same painted sample, even when its epoch is older.
        let carry = continuing
            && self.smooth_motion
            && smooth
            && (partial.is_some() || (!self.clip_partial && !clip_partial));
        let painted = self.painted_sample.filter(|_| carry);
        let start_time = if now >= 0 {
            // A cancelled P4 arm may have started at the predicted next real
            // presentation. Hydration cannot move the shared clock backwards.
            let now = if partial.is_some() {
                now.max(self.motion.started_at())
            } else {
                now
            };
            painted.map_or(now, |s| now.max(s.time_ns))
        } else {
            now
        };
        let use_smooth = smooth && (!clip_partial || partial.is_some());
        let mut candidate_motion = self.motion.clone();
        candidate_motion.set_scroll_parameters(use_smooth);
        let mut kept = false;
        let decision = if use_smooth {
            // Held window footprints define extra camera travel; the adapter
            // neither supplies nor invents a second workspace/layout boundary.
            let lower = visual_targets
                .values()
                .map(|r| r.x - rect.x + target)
                .fold(f64::INFINITY, f64::min);
            let upper = visual_targets
                .values()
                .map(|r| r.x - rect.x + target + r.width - rect.width)
                .fold(f64::NEG_INFINITY, f64::max);
            let (lower, upper) = partial
                .as_ref()
                .map_or((lower, upper), |p| (0.0, p.max_offset));
            let bounds = MotionBounds {
                lower,
                upper,
                reverse_limit: rect.width * 0.02,
            };
            if carry && basis_shift == 0.0 && candidate_motion.can_keep_curve(target, bounds) {
                if !candidate_motion.keep_curve(epoch, start_time) {
                    return false;
                }
                kept = true;
                RetargetDecision {
                    strategy: RetargetStrategy::Keep,
                    reason: ResetReason::None,
                    lower,
                    upper,
                    ..self.retarget.last
                }
            } else {
                let velocity = painted
                    .filter(|s| s.motion.kind == MotionKind::Animation)
                    .map_or(0.0, |s| s.motion.velocity);
                let Some(decision) = candidate_motion
                    .start_bounded(from, target, velocity, bounds, epoch, start_time)
                else {
                    return false;
                };
                decision
            }
        } else {
            if !candidate_motion.start(from, target, epoch, now) {
                return false;
            }
            RetargetDecision::default()
        };
        self.motion = candidate_motion;
        self.columns = columns;
        self.visual_targets = visual_targets;
        self.source_frames = source_frames;
        self.roles = roles;
        self.client_paints = client_paints;
        self.client_serial = 0;
        self.paint_basis = None;
        self.geometry_observation = None;
        self.viewport = rect;
        let origin = if kept {
            let mut origin = self.origin_sample.expect("active motion has an origin");
            origin.motion.epoch = epoch;
            origin
        } else {
            ScrollFrameSample {
                motion: self.motion.sample(start_time),
                time_ns: start_time,
            }
        };
        self.origin_sample = Some(origin);
        self.frame_offset = if kept {
            self.anchor_offset
        } else {
            origin.motion.current
        };
        self.anchor_offset = self.frame_offset;
        self.frame_sample = None;
        if !continuing {
            self.painted_sample = None;
        } else if let Some(sample) = &mut self.painted_sample {
            // Preserve the actual painted pose and velocity in the new basis.
            sample.motion.current += basis_shift;
            sample.motion.target += basis_shift;
        }
        self.completed = false;
        self.clip_partial = clip_partial;
        self.partial = partial;
        self.smooth_motion = use_smooth;
        self.visual_fallback = if use_smooth {
            VisualFallback::AwaitingFrame
        } else {
            VisualFallback::Disabled
        };
        self.output_facts = OutputFacts::default();
        self.retarget.record(decision);
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
        if self.geometry.is_some() {
            return self.prepare_frame(now);
        }
        if self.completed {
            return true;
        }
        let sample = ScrollFrameSample {
            motion: self.motion.sample(now),
            time_ns: now,
        };
        self.frame_offset = sample.motion.current;
        self.anchor_offset = self.frame_offset;
        self.frame_sample = Some(sample);
        self.painted_sample = Some(sample);
        if sample.motion.kind == MotionKind::Static {
            self.motion.finish(self.epoch(), now);
            self.frame_offset = self.motion.sample(0).target;
            self.completed = true;
        }
        true
    }
    pub fn frame_sample(&self, painted: bool) -> Option<ScrollFrameSample> {
        if painted {
            self.painted_sample
        } else {
            self.frame_sample
        }
    }
    pub fn origin_sample(&self) -> Option<ScrollFrameSample> {
        self.origin_sample
    }
    pub fn retarget_stats(&self) -> RetargetStats {
        self.retarget
    }
    pub fn effective_smooth(&self, configured: bool) -> bool {
        if self.active() {
            self.smooth_motion
        } else {
            configured
        }
    }
    pub fn effective_stiffness(&self, configured: bool) -> f64 {
        if self.active() {
            self.motion.stiffness()
        } else {
            crate::scroll_visual::parameters(configured).stiffness
        }
    }
    pub fn prepare_frame(&mut self, now: i64) -> bool {
        self.prepare_frame_with_output(now, OutputFacts::default())
    }
    pub fn prepare_frame_with_output(&mut self, now: i64, facts: OutputFacts) -> bool {
        if !self.active() || now < 0 || self.frame_sample.is_some_and(|s| now < s.time_ns) {
            return false;
        }
        if !self.completed {
            self.output_facts = facts;
            self.visual_fallback = if self.smooth_motion {
                facts.fallback()
            } else {
                VisualFallback::Disabled
            };
            if (2..=4).contains(&(self.visual_fallback as u32)) {
                let count = &mut self.visual_fallback_counts[self.visual_fallback as usize - 2];
                *count = count.saturating_add(1);
            }
        }
        let sample = ScrollFrameSample {
            motion: if self.smooth_motion {
                self.motion.sample_visual(now, facts)
            } else {
                self.motion.sample(now)
            },
            time_ns: now,
        };
        if let Some(g) = &mut self.geometry {
            if !g.prepare_frame(sample.motion, now, facts) {
                return false;
            }
        }
        self.frame_offset = sample.motion.current;
        self.frame_sample = Some(sample);
        true
    }
    pub fn mark_painted(&mut self, epoch: i64, time_ns: i64) -> bool {
        let Some(sample) = self.frame_sample else {
            return false;
        };
        if !self.active()
            || epoch != self.epoch()
            || epoch != sample.motion.epoch
            || time_ns != sample.time_ns
        {
            return false;
        }
        self.anchor_offset = sample.motion.current;
        self.painted_sample = Some(sample);
        if sample.motion.kind == MotionKind::Static {
            if self.smooth_motion {
                if !self.completed && self.motion.sample(time_ns).kind == MotionKind::Animation {
                    self.visual_completed = self.visual_completed.saturating_add(1);
                }
                self.motion.snap(sample.motion.target);
            } else {
                self.motion.finish(epoch, time_ns);
            }
            self.completed = self.geometry.as_ref().is_none_or(|g| g.completed());
        }
        true
    }
    pub fn projection(&self, id: WindowId, geometry: Rect) -> Option<ScrollProjection> {
        if let Some(g) = &self.geometry {
            return g.projection(id, geometry).map(|p| ScrollProjection {
                translation_x: p.translation_x,
                viewport: p.viewport,
            });
        }
        let target = self.columns.get(&id)?;
        if self.partial.is_some() {
            let visual = self.visual_targets.get(&id)?;
            if (geometry.width - visual.width).abs() > 0.000001
                || (geometry.height - visual.height).abs() > 0.000001
                || (geometry.y - visual.y).abs() > 0.000001
                || !geometry.valid_viewport()
            {
                return None;
            }
        }
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
    fn partial_anchor(mut visual: Rect, output: Rect) -> Rect {
        visual.x = visual
            .x
            .clamp(output.x, output.x + output.width - visual.width);
        visual
    }
    pub fn partial_config(&self) -> Option<&PartialScrollConfig> {
        self.partial.as_ref().filter(|_| self.active())
    }
    pub fn visual_targets(&self) -> &HashMap<WindowId, Rect> {
        &self.visual_targets
    }
    pub fn painted_target(&self, id: WindowId) -> Option<Rect> {
        self.partial_config()?;
        if self.geometry.is_some() {
            return self.client_paint(id).map(|p| p.visual);
        }
        let sample = self.painted_sample?;
        let mut rect = *self.visual_targets.get(&id)?;
        rect.x += self.motion.sample(0).target - sample.motion.current;
        Some(rect)
    }
    pub fn partial_hit(&self, x: f64, y: f64) -> Option<WindowId> {
        self.partial_config()?;
        if !x.is_finite()
            || !y.is_finite()
            || x < self.viewport.x
            || y < self.viewport.y
            || x >= self.viewport.x + self.viewport.width
            || y >= self.viewport.y + self.viewport.height
        {
            return None;
        }
        if self.geometry.is_some() {
            return self.geometry_hit(x, y).0;
        }
        self.visual_targets.iter().find_map(|(id, r)| {
            let left = r.x + self.motion.sample(0).target - self.anchor_offset;
            (x >= left && x < left + r.width && y >= r.y && y < r.y + r.height).then_some(*id)
        })
    }
    fn geometry_hit(&self, x: f64, y: f64) -> (Option<WindowId>, bool) {
        let Some(sample) = self.painted_sample else {
            return (None, false);
        };
        let mut hit = None;
        for (id, (_, pose)) in &self.client_paints {
            if let Some(p) = pose {
                if p.epoch == sample.motion.epoch
                    && p.time_ns == sample.time_ns
                    && p.serial == self.client_serial
                    && x >= p.visual.x
                    && x < p.visual.x + p.visual.width
                    && y >= p.visual.y
                    && y < p.visual.y + p.visual.height
                {
                    if hit.is_some() {
                        return (None, true);
                    }
                    hit = Some(*id);
                }
            }
        }
        (hit, false)
    }
    pub fn partial_point_ambiguous(&self, x: f64, y: f64) -> bool {
        self.partial_config().is_some()
            && self.geometry.is_some()
            && x.is_finite()
            && y.is_finite()
            && x >= self.viewport.x
            && x < self.viewport.x + self.viewport.width
            && y >= self.viewport.y
            && y < self.viewport.y + self.viewport.height
            && self.geometry_hit(x, y).1
    }
    pub fn partial_input_blocked(&self, id: WindowId, geometry: Rect, x: f64, y: f64) -> bool {
        if self.partial_config().is_none() || !self.columns.contains_key(&id) {
            return false;
        }
        if self.projection(id, geometry).is_none() {
            return true;
        }
        if self.geometry.is_some() {
            return self
                .client_paint(id)
                .is_none_or(|p| p.frame != geometry || p.visual != geometry)
                || self.partial_hit(x, y) != Some(id);
        }
        let painted_x =
            self.visual_targets[&id].x + self.motion.sample(0).target - self.anchor_offset;
        // Input uses actual paint, not prePaint prediction.
        (painted_x - geometry.x).abs() > 0.000001
            || (geometry.y - self.visual_targets[&id].y).abs() > 0.000001
            || (geometry.width - self.visual_targets[&id].width).abs() > 0.000001
            || (geometry.height - self.visual_targets[&id].height).abs() > 0.000001
            || self.partial_hit(x, y) != Some(id)
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
            partial: None,
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
    fn pending_frames_do_not_replace_paint_anchor_or_publish_completion() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = plan(&mut r, 1.0, 0.0, 1260.25);
        assert!(r.arm(p, 0, &HashMap::new()));
        assert!(r.prepare_frame(60_000_000));
        assert!(r.mark_painted(1, 60_000_000));
        let painted = r.frame_sample(true).unwrap();
        assert!(r.prepare_frame(200_000_000));
        assert!(r.frame_sample(false).unwrap().motion.current > painted.motion.current);
        let frozen = r.clone_for_paint();
        assert_eq!(frozen.frame_offset, painted.motion.current);
        assert_eq!(frozen.frame_sample(false).unwrap().time_ns, painted.time_ns);
        assert_eq!(r.frame_sample(true).unwrap().time_ns, 60_000_000);
        let p = plan(&mut r, 2.0, 1260.25, 2520.5);
        assert!(r.arm(p, 60_000_000, &HashMap::new()));
        assert_eq!(r.frame_offset, painted.motion.current);
        assert!(r.frame_sample(false).is_none());
        assert!(!r.mark_painted(1, 200_000_000));
        assert!(r.prepare_frame(60_000_000));
        assert_eq!(r.frame_sample(false).unwrap().motion.epoch, 2);
        assert!(r.mark_painted(2, 60_000_000));
        assert!(r.prepare_frame(4_000_000_000));
        assert!(!r.completed());
        assert!(!r.mark_painted(2, 3_000_000_000));
        assert!(r.mark_painted(2, 4_000_000_000));
        assert!(r.completed() && r.active());
        let outgoing = r.intern(Text::from_utf8("0"));
        assert_eq!(r.role(outgoing), Some(WindowRole::Outgoing));
        r.cancel(&Text::from_utf8("s"), 2);
        assert!(!r.active() && r.frame_sample(true).is_none());
    }
    fn smooth_arm(r: &mut ScrollViewportRuntime, epoch: f64, from: f64, to: f64, now: i64) {
        let p = plan(r, epoch, from, to);
        assert!(r.arm_with_policy(p, now, &HashMap::new(), true));
    }
    fn painted(r: &mut ScrollViewportRuntime, now: i64) -> ScrollFrameSample {
        assert!(r.prepare_frame(now));
        assert!(r.mark_painted(r.epoch(), now));
        r.frame_sample(true).unwrap()
    }
    #[test]
    fn visual_completion_commits_only_on_paint_and_interruption_uses_painted_velocity() {
        let facts = OutputFacts {
            valid: true,
            scale: 1.5,
            refresh_hz: 60.0,
        };
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        smooth_arm(&mut r, 1.0, 0.0, 1260.25, 0);
        assert_eq!(r.effective_stiffness(false), 600.0);
        assert!(r.prepare_frame_with_output(300_000_000, facts));
        assert!(r.mark_painted(1, 300_000_000));
        let anchor = r.frame_sample(true).unwrap();
        assert!(r.prepare_frame_with_output(500_000_000, facts));
        assert_eq!(
            r.frame_sample(false).unwrap().motion.kind,
            MotionKind::Static
        );
        assert!(!r.completed() && r.visual_completed == 0);
        assert_eq!(r.clone_for_paint().frame_offset, anchor.motion.current);
        smooth_arm(&mut r, 2.0, 1260.25, 2520.5, 310_000_000);
        assert!(!r.mark_painted(1, 500_000_000));
        assert_eq!(
            r.origin_sample().unwrap().motion.velocity,
            anchor.motion.velocity
        );
        assert!(r.prepare_frame_with_output(900_000_000, facts));
        assert!(r.mark_painted(2, 900_000_000));
        assert!(r.completed() && r.active() && r.visual_completed == 1);
        assert_eq!(r.frame_offset, 2520.5);
        let outgoing = r.intern(Text::from_utf8("0"));
        assert_eq!(r.role(outgoing), Some(WindowRole::Outgoing));
        r.cancel(&Text::from_utf8("s"), 2);
        assert!(!r.active());
    }

    #[test]
    fn facts_are_current_scale_changes_recheck_pending_and_fallback_keeps_numerical_tail() {
        let facts = OutputFacts {
            valid: true,
            scale: 1.0,
            refresh_hz: 60.0,
        };
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        smooth_arm(&mut r, 1.0, 0.0, 1260.25, 0);
        let now = 450_000_000;
        assert!(r.prepare_frame_with_output(now, facts));
        assert_eq!(
            r.frame_sample(false).unwrap().motion.kind,
            MotionKind::Static
        );
        assert!(r.prepare_frame_with_output(
            now,
            OutputFacts {
                scale: 2.0,
                ..facts
            }
        ));
        assert_eq!(
            r.frame_sample(false).unwrap().motion.kind,
            MotionKind::Animation
        );
        for (facts, reason) in [
            (OutputFacts::default(), VisualFallback::MissingOutput),
            (
                OutputFacts {
                    scale: 0.0,
                    ..facts
                },
                VisualFallback::InvalidScale,
            ),
            (
                OutputFacts {
                    refresh_hz: 0.0,
                    ..facts
                },
                VisualFallback::UnknownRefresh,
            ),
        ] {
            assert!(r.prepare_frame_with_output(600_000_000, facts));
            assert_eq!(
                r.frame_sample(false).unwrap().motion.kind,
                MotionKind::Animation
            );
            assert_eq!(r.visual_fallback, reason);
        }
        assert_eq!(r.visual_fallback_counts, [1, 1, 1]);
        assert!(r.prepare_frame_with_output(1_000_000_000, OutputFacts::default()));
        assert!(r.mark_painted(1, 1_000_000_000) && r.completed());
        assert_eq!(r.visual_completed, 0);
        r.cancel(&Text::from_utf8("s"), 1);
        let mut p = plan(&mut r, 2.0, 1260.25, 0.0);
        p.clip_partial = 2;
        assert!(r.arm_with_policy(p, 1_000_000_000, &HashMap::new(), true));
        assert_eq!(r.effective_stiffness(true), 800.0);
        assert!(!r.effective_smooth(true));
        assert!(r.prepare_frame_with_output(1_500_000_000, facts));
        assert_eq!(r.visual_fallback, VisualFallback::Disabled);
        assert_eq!(
            r.frame_sample(false).unwrap().motion.kind,
            MotionKind::Animation
        );
    }
    fn close(a: f64, b: f64) {
        assert!(
            (a - b).abs() <= 1e-8 + 1e-10 * b.abs().max(1.0),
            "{a} != {b}"
        );
    }
    #[test]
    fn smooth_production_arm_preserves_painted_velocity_and_same_frame_anchor() {
        for delay in [30_000_000, 60_000_000, 120_000_000] {
            let mut r = ScrollViewportRuntime::new(true);
            r.update_context(context("s", 1.0));
            smooth_arm(&mut r, 1.0, 0.0, 1260.25, 0);
            let anchor = painted(&mut r, delay);
            // A pending future sample must not leak into either x0 or v0.
            assert!(r.prepare_frame(delay + 50_000_000));
            smooth_arm(&mut r, 2.0, 1260.25, 2520.5, delay - 1);
            let start = r.origin_sample().unwrap();
            close(start.motion.current, anchor.motion.current);
            close(start.motion.velocity, anchor.motion.velocity);
            assert_eq!(start.time_ns, anchor.time_ns);
            assert_eq!(r.retarget.last.strategy, RetargetStrategy::Carry);
            smooth_arm(&mut r, 3.0, 2520.5, 3780.75, delay + 1);
            let start = r.origin_sample().unwrap();
            close(start.motion.current, anchor.motion.current);
            close(start.motion.velocity, anchor.motion.velocity);
            assert_eq!(r.retarget.carried, 2);
            let outgoing = r.intern(Text::from_utf8("0"));
            assert_eq!(r.role(outgoing), Some(WindowRole::Outgoing));
            painted(&mut r, 4_000_000_000);
            assert!(r.completed() && r.active());
            r.cancel(&Text::from_utf8("s"), 3);
            assert!(!r.active());
        }
    }
    #[test]
    fn smooth_reverse_brakes_within_the_held_region_without_sample_clamping() {
        for delay in [20_000_000, 50_000_000, 130_000_000, 250_000_000] {
            let mut r = ScrollViewportRuntime::new(true);
            r.update_context(context("s", 1.0));
            smooth_arm(&mut r, 1.0, 0.0, 1260.25, 0);
            let anchor = painted(&mut r, delay);
            smooth_arm(&mut r, 2.0, 1260.25, 0.0, delay);
            let start = r.origin_sample().unwrap();
            close(start.motion.current, anchor.motion.current);
            close(start.motion.velocity, anchor.motion.velocity);
            assert_ne!(r.retarget.last.strategy, RetargetStrategy::Reset);
            let d = r.retarget.last;
            assert!(d.brake_ns <= 50_000_000);
            if delay <= 50_000_000 {
                assert_eq!(d.strategy, RetargetStrategy::Brake);
            }
            for step in 0..=1000 {
                let value = r.motion.sample(delay + step * 1_000_000);
                assert!(
                    value.current >= 0.0 && value.current <= anchor.motion.current + 2512.5 * 0.02
                );
            }
            if d.brake_ns > 0 {
                let left = r.motion.sample(delay + d.brake_ns - 1);
                let right = r.motion.sample(delay + d.brake_ns);
                close(left.current, right.current);
                assert!(left.velocity.abs() < 0.01 && right.velocity == 0.0);
            }
        }
    }
    #[test]
    fn same_target_updates_epoch_and_entries_without_restarting_the_curve() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        smooth_arm(&mut r, 1.0, 0.0, 1260.25, 0);
        let anchor = painted(&mut r, 60_000_000);
        let before = r.motion.clone();
        smooth_arm(&mut r, 2.0, 1260.25, 1260.25, 70_000_000);
        assert_eq!(r.retarget.last.strategy, RetargetStrategy::Keep);
        assert_eq!(r.retarget.kept, 1);
        close(r.frame_offset, anchor.motion.current);
        assert_eq!(r.origin_sample().unwrap().time_ns, 0);
        for now in [70_000_000, 80_000_000, 100_000_000, 300_000_000] {
            close(r.motion.sample(now).current, before.sample(now).current);
            close(r.motion.sample(now).velocity, before.sample(now).velocity);
            assert_eq!(r.motion.sample(now).epoch, 2);
        }
        let duplicate = plan(&mut r, 2.0, 1260.25, 1260.25);
        assert!(r.arm_with_policy(duplicate, 71_000_000, &HashMap::new(), true));
        assert_eq!(r.retarget.kept, 1);
        let bad = plan(&mut r, 1.0, 1260.25, 0.0);
        assert!(!r.arm_with_policy(bad, 72_000_000, &HashMap::new(), true));
        assert_eq!(r.epoch(), 2);
    }
    #[test]
    fn closing_a_held_edge_window_records_a_safe_velocity_reset() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        smooth_arm(&mut r, 1.0, 0.0, 1260.25, 0);
        let anchor = painted(&mut r, 50_000_000);
        let removed = r.intern(Text::from_utf8("0"));
        r.remove(removed);
        smooth_arm(&mut r, 2.0, 1260.25, 2520.5, 50_000_000);
        close(
            r.origin_sample().unwrap().motion.current,
            anchor.motion.current,
        );
        assert_eq!(r.origin_sample().unwrap().motion.velocity, 0.0);
        assert_eq!(r.retarget.last.reason, ResetReason::Coverage);
        assert_eq!(r.retarget.degraded, 1);
        assert_eq!(r.retarget.reasons[3], 1);
        r.cancel(&Text::from_utf8("s"), 2);
        assert_eq!(r.retarget_stats().degraded, 1);
    }
    #[test]
    fn no_painted_frame_context_changes_and_script_partial_never_inherit_velocity() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        smooth_arm(&mut r, 1.0, 0.0, 1260.25, 0);
        r.prepare_frame(50_000_000);
        smooth_arm(&mut r, 2.0, 1260.25, 2520.5, 10_000_000);
        assert_eq!(r.origin_sample().unwrap().motion.velocity, 0.0);
        painted(&mut r, 60_000_000);
        let mut partial = plan(&mut r, 3.0, 2520.5, 1260.25);
        partial.clip_partial = 2;
        assert!(r.arm_with_policy(partial, 60_000_000, &HashMap::new(), true));
        assert_eq!(r.origin_sample().unwrap().motion.velocity, 0.0);
        let mut changed = context("s", 2.0);
        changed.output = Text::from_utf8("DP-2");
        assert!(r.update_context(changed));
        assert!(!r.active());
        let mut p = plan(&mut r, 4.0, 0.0, 1260.25);
        p.output = Text::from_utf8("DP-2");
        assert!(r.arm_with_policy(p, 70_000_000, &HashMap::new(), true));
        assert_eq!(r.origin_sample().unwrap().motion.velocity, 0.0);
        let removed = r.intern(Text::from_utf8("0"));
        r.remove(removed); // Window removal leaves other ownership valid.
        let allocations = crate::allocation_checks::count(|| {
            for now in 1..500 {
                r.prepare_frame_with_output(
                    now * 1_000_000,
                    OutputFacts {
                        valid: true,
                        scale: 1.5,
                        refresh_hz: 60.0,
                    },
                );
                r.mark_painted(r.epoch(), now * 1_000_000);
                std::hint::black_box(r.retarget_stats());
                std::hint::black_box(r.effective_stiffness(true));
            }
        });
        assert_eq!(allocations, 0);
    }
    #[test]
    fn unpainted_first_frame_and_invalid_times_preserve_the_static_anchor() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = plan(&mut r, 1.0, 0.0, 1260.25);
        assert!(r.arm(p, 0, &HashMap::new()));
        assert!(!r.prepare_frame(-1));
        assert!(r.prepare_frame(100_000_000));
        assert!(!r.prepare_frame(99_000_000));
        assert_eq!(r.frame_sample(false).unwrap().time_ns, 100_000_000);
        let p = plan(&mut r, 2.0, 1260.25, 0.0);
        assert!(r.arm(p, 10_000_000, &HashMap::new()));
        assert_eq!(r.frame_offset, 0.0);
        assert!(r.frame_sample(true).is_none());
        let allocations = crate::allocation_checks::count(|| {
            for now in 0..1000 {
                r.prepare_frame(now * 1_000_000);
                std::hint::black_box(r.frame_sample(false));
                r.mark_painted(2, now * 1_000_000);
                std::hint::black_box(r.frame_sample(true));
            }
        });
        assert_eq!(allocations, 0);
        r.update_context(context("other-session", 1.0));
        assert!(r.frame_sample(true).is_none());
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

    fn centered(
        r: &mut ScrollViewportRuntime,
        epoch: f64,
        old: f64,
        new: f64,
        rows: &[(&str, f64, Placement)],
        reindex: bool,
    ) -> ScrollPlan {
        let mut p = plan(r, epoch, 0.0, 1260.25);
        p.kind = Text::from_utf8(if reindex { "COLUMN_REINDEX" } else { "SCROLL" });
        p.old_offset = old;
        p.new_offset = new;
        p.viewport.width = 2512.0;
        p.retarget_only = if old == new && !reindex { 2 } else { 0 };
        p.entries = rows
            .iter()
            .enumerate()
            .map(|(i, (name, x, placement))| ScrollEntry {
                window_id: r.intern(Text::from_utf8(name)),
                column_id: i as f64,
                logical_x: *x,
                pixel_width: 1252.0,
                old_placement: *placement,
                new_placement: Placement::Visible,
            })
            .collect();
        p
    }
    #[test]
    fn typed_reindex_starts_at_real_old_basis_and_finishes_centered() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = centered(
            &mut r,
            1.0,
            630.0,
            0.0,
            &[("b", 630.0, Placement::Visible)],
            true,
        );
        let b = p.entries[0].window_id;
        let old = Rect {
            x: p.viewport.x + 1260.0,
            y: p.viewport.y,
            width: 1252.0,
            height: p.viewport.height,
        };
        assert!(!r.arm(p.clone(), 0, &HashMap::new()));
        assert!(r.arm_reindex(p.clone(), b, 1890.0, 0, &HashMap::from([(b, old)]), true));
        let target = r.targets()[&b];
        assert_eq!(
            target.x + r.projection(b, target).unwrap().translation_x,
            old.x
        );
        assert_eq!(old.x + r.projection(b, old).unwrap().translation_x, old.x);
        assert!(r.arm_reindex(p, b, 1890.0, 1, &HashMap::new(), true)); // duplicate
        let allocations = crate::allocation_checks::count(|| {
            for frame in 0..100 {
                r.prepare_frame(frame * 16_666_667);
                let sample = r.frame_sample.unwrap();
                assert!(r.mark_painted(sample.motion.epoch, sample.time_ns));
                std::hint::black_box(r.projection(b, target));
            }
        });
        assert_eq!(allocations, 0);
        assert!(r.completed());
        assert_eq!(r.projection(b, target).unwrap().translation_x, 0.0);
        r.cancel(&Text::from_utf8("s"), 1);
        assert!(!r.active());
        r.remove(b);
        assert!(r.label(b).is_none());
    }
    #[test]
    fn left_insert_and_reverse_reindex_reuse_painted_pose_not_prediction() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = centered(
            &mut r,
            1.0,
            0.0,
            630.0,
            &[
                ("b", 630.0, Placement::Parked),
                ("a", 1890.0, Placement::Visible),
            ],
            true,
        );
        let a = p.entries[1].window_id;
        let b = p.entries[0].window_id;
        assert!(r.arm_reindex(p, a, 630.0, 0, &HashMap::new(), true));
        let geometry = r.targets()[&a];
        assert_eq!(
            geometry.x + r.projection(a, geometry).unwrap().translation_x,
            r.viewport.x + 630.0
        );
        r.prepare_frame(50_000_000);
        assert!(r.mark_painted(1, 50_000_000));
        let painted_x = geometry.x + r.projection(a, geometry).unwrap().translation_x;
        r.prepare_frame(100_000_000); // do not promote this prediction
        r.remove(b);
        let returning = centered(
            &mut r,
            2.0,
            630.0,
            0.0,
            &[("a", 630.0, Placement::Visible)],
            true,
        );
        assert!(r.arm_reindex(returning, a, 1890.0, 100_000_000, &HashMap::new(), true));
        let target = r.targets()[&a];
        assert!(
            (target.x + r.projection(a, target).unwrap().translation_x - painted_x).abs() < 1e-9
        );
        // Same-frame ordinary SCROLL resumes the new canonical basis.
        let next = centered(
            &mut r,
            3.0,
            0.0,
            630.0,
            &[
                ("a", 630.0, Placement::Visible),
                ("c", 1890.0, Placement::Parked),
            ],
            false,
        );
        assert!(r.arm_with_policy(next, 100_000_000, &HashMap::new(), true));
        let target = r.targets()[&a];
        assert!(
            (target.x + r.projection(a, target).unwrap().translation_x - painted_x).abs() < 1e-9
        );
    }
    #[test]
    fn reindex_rejects_unknown_basis_and_consumes_accepted_epoch_on_arm_failure() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let initial = centered(
            &mut r,
            1.0,
            0.0,
            630.0,
            &[
                ("a", 630.0, Placement::Visible),
                ("b", 1890.0, Placement::Parked),
            ],
            false,
        );
        assert!(r.arm_with_policy(initial, 0, &HashMap::new(), true));
        let p = centered(
            &mut r,
            2.0,
            630.0,
            0.0,
            &[("b", 630.0, Placement::Visible)],
            true,
        );
        let b = p.entries[0].window_id;
        let mut wrong = p.clone();
        wrong.fingerprint.push(1);
        assert!(!r.arm_reindex(wrong.clone(), b, 1889.0, 1, &HashMap::new(), true));
        assert_eq!(r.epoch(), 1);
        assert!(!r.arm_reindex(wrong, b, 1889.0, 1, &HashMap::new(), true));
        assert!(!r.arm_reindex(p, b, 1890.0, 1, &HashMap::new(), true));
    }
    #[test]
    fn typed_reindex_validates_scope_source_numbers_widths_and_placements() {
        let mut r = ScrollViewportRuntime::new(true);
        let p = centered(
            &mut r,
            1.0,
            0.0,
            630.0,
            &[
                ("b", 630.0, Placement::Parked),
                ("a", 1890.0, Placement::Visible),
            ],
            true,
        );
        let a = p.entries[1].window_id;
        assert!(ValidatedScrollPlan::new_reindex(p.clone(), a, 630.0, &r.windows).is_ok());
        for source_x in [f64::NAN, f64::INFINITY, -1.0, 1890.0, 1261.0] {
            assert!(ValidatedScrollPlan::new_reindex(p.clone(), a, source_x, &r.windows).is_err());
        }
        assert!(
            ValidatedScrollPlan::new_reindex(p.clone(), WindowId(0), 630.0, &r.windows).is_err()
        );
        for case in 0..16 {
            let mut bad = p.clone();
            match case {
                0 => bad.kind = Text::from_utf8("SCROLL"),
                1 => bad.old_offset = -1.0,
                2 => bad.new_offset = f64::NAN,
                3 => bad.entries[0].old_placement = Placement::Visible,
                4 => bad.entries[1].old_placement = Placement::Parked,
                5 => bad.entries[0].new_placement = Placement::Parked,
                6 => bad.entries[0].window_id = a,
                7 => bad.entries[0].column_id = bad.entries[1].column_id,
                8 => bad.entries[0].pixel_width -= 1.0,
                9 => bad.entries[0].logical_x = -1.0,
                10 => bad.retarget_only = 2,
                11 => bad.clip_partial = 2,
                12 => bad.entries.push(bad.entries[0].clone()),
                13 => bad.entries.clear(),
                14 => bad.epoch = 9007199254740992.0,
                _ => bad.viewport.x = f64::INFINITY,
            }
            assert!(
                ValidatedScrollPlan::new_reindex(bad, a, 630.0, &r.windows).is_err(),
                "case {case}"
            );
        }
    }
    #[test]
    fn stable_reindex_without_paint_reverses_at_origin_and_workspace_switch_retires_it() {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(context("s", 1.0));
        let p = centered(
            &mut r,
            1.0,
            0.0,
            630.0,
            &[
                ("b", 630.0, Placement::Parked),
                ("a", 1890.0, Placement::Visible),
            ],
            true,
        );
        let a = p.entries[1].window_id;
        assert!(r.arm_reindex(p, a, 630.0, 0, &HashMap::new(), false));
        let target = r.targets()[&a];
        let origin = target.x + r.projection(a, target).unwrap().translation_x;
        r.prepare_frame(50_000_000);
        let returning = centered(
            &mut r,
            2.0,
            630.0,
            0.0,
            &[("a", 630.0, Placement::Visible)],
            true,
        );
        assert!(r.arm_reindex(
            returning.clone(),
            a,
            1890.0,
            50_000_000,
            &HashMap::new(),
            false
        ));
        let target = r.targets()[&a];
        assert_eq!(
            target.x + r.projection(a, target).unwrap().translation_x,
            origin
        );
        let mut next = context("s", 2.0);
        next.workspace = Text::from_utf8("other");
        assert!(r.update_context(next));
        assert!(!r.active());
        assert!(!r.arm_reindex(returning, a, 1890.0, 60_000_000, &HashMap::new(), false));
        assert!(r.targets().is_empty() && r.source_frames().is_empty());
    }
}

#[cfg(test)]
mod partial_tests {
    use super::*;
    use crate::native_protocol::{PartialScrollConfig, MAX_SAFE_INTEGER};

    fn fixture() -> (ScrollViewportRuntime, ScrollPlan, HashMap<WindowId, Rect>) {
        let mut r = ScrollViewportRuntime::new(true);
        r.update_context(RuntimeContext {
            protocol: 2.0,
            session: Text::from_utf8("s"),
            workspace: Text::from_utf8("a"),
            output: Text::from_utf8("o"),
            generation: 1.0,
        });
        let layout = Rect {
            x: 0.0,
            y: 66.0,
            width: 2560.0,
            height: 1358.0,
        };
        let a = r.intern(Text::from_utf8("a"));
        let b = r.intern(Text::from_utf8("b"));
        let frames = HashMap::from([
            (
                a,
                Rect {
                    x: 440.0,
                    width: 1680.0,
                    ..layout
                },
            ),
            (
                b,
                Rect {
                    x: 1304.0,
                    width: 1256.0,
                    ..layout
                },
            ),
        ]);
        let p = ScrollPlan {
            shape_valid: true,
            protocol: 3.0,
            kind: Text::from_utf8("PARTIAL_SCROLL"),
            session: Text::from_utf8("s"),
            workspace: Text::from_utf8("a"),
            output: Text::from_utf8("o"),
            epoch: 1.0,
            issued_at: 1.0,
            old_offset: 212.0,
            new_offset: 1060.0,
            retarget_only: 0,
            clip_partial: 2,
            viewport: Rect {
                x: 0.0,
                y: 0.0,
                width: 2560.0,
                height: 1440.0,
            },
            partial: Some(PartialScrollConfig {
                layout,
                max_offset: 1696.0,
                scope_revision: 1.0,
            }),
            entries: vec![
                ScrollEntry {
                    window_id: a,
                    column_id: 1.0,
                    logical_x: 652.0,
                    pixel_width: 1680.0,
                    old_placement: Placement::Visible,
                    new_placement: Placement::Visible,
                },
                ScrollEntry {
                    window_id: b,
                    column_id: 2.0,
                    logical_x: 2348.0,
                    pixel_width: 1256.0,
                    old_placement: Placement::Visible,
                    new_placement: Placement::Visible,
                },
            ],
            fingerprint: b"partial-1".to_vec(),
        };
        (r, p, frames)
    }
    fn paint(r: &mut ScrollViewportRuntime, now: i64) -> ScrollFrameSample {
        assert!(r.prepare_frame(now));
        assert!(r.mark_painted(r.epoch(), now));
        r.frame_sample(true).unwrap()
    }
    #[test]
    fn strict_output_safe_anchors_and_geometry_ack_input() {
        let (mut r, p, frames) = fixture();
        let (a, b) = (p.entries[0].window_id, p.entries[1].window_id);
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        assert_eq!(r.targets()[&a].x, 0.0);
        assert_eq!(r.targets()[&b].x, 1288.0);
        assert_eq!(r.targets()[&a].width, 1680.0);
        assert!(r.painted_target(a).is_none());
        paint(&mut r, 0);
        assert_eq!(r.painted_target(b).unwrap().x, 2136.0);
        assert_eq!(r.partial_hit(2500.0, 100.0), Some(b));
        assert_eq!(r.partial_hit(2560.0, 100.0), None);
        assert_eq!(r.partial_hit(-1.0, 100.0), None);
        assert!(r.partial_input_blocked(b, frames[&b], 2500.0, 100.0));
        assert!(r.partial_input_blocked(a, frames[&a], 2500.0, 100.0));
        assert!(!r.partial_input_blocked(a, frames[&a], 500.0, 100.0));
        // Sampling a future frame without painting it must not enable input.
        r.prepare_frame(4_000_000_000);
        assert_eq!(r.painted_target(b).unwrap().x, 2136.0);
        assert!(r.partial_input_blocked(b, r.targets()[&b], 2500.0, 100.0));
        assert!(r.mark_painted(1, 4_000_000_000));
        assert!(r.completed() && r.active());
        assert_eq!(r.painted_target(b).unwrap().x, 1288.0);
        assert!(!r.partial_input_blocked(b, r.targets()[&b], 2500.0, 100.0));
        assert!(r.partial_input_blocked(b, frames[&b], 2500.0, 100.0));
        assert!(r.partial_input_blocked(a, r.targets()[&a], 100.0, 100.0));
    }
    #[test]
    fn partial_retarget_inherits_last_painted_pose_and_velocity() {
        let (mut r, p, frames) = fixture();
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        let last = paint(&mut r, 55_000_000);
        assert!(last.motion.velocity > 0.0);
        r.prepare_frame(170_000_000);
        let mut next = p.clone();
        next.epoch = 2.0;
        next.old_offset = p.new_offset;
        next.new_offset = p.old_offset;
        next.fingerprint = b"partial-2".to_vec();
        assert!(r.arm_partial(next.clone(), 55_000_000, &frames, true, p.viewport));
        let origin = r.origin_sample.unwrap();
        assert_eq!(origin.motion.current, last.motion.current);
        // Bounded reversal brakes the existing velocity, rather than zeroing it.
        assert!(origin.motion.velocity > 0.0);
        assert_eq!(origin.motion.velocity, last.motion.velocity);
        let pose = r.painted_target(p.entries[0].window_id).unwrap();
        next.epoch = 3.0;
        next.fingerprint = b"partial-3".to_vec();
        assert!(r.arm_partial(next, 55_000_000, &frames, true, p.viewport));
        assert_eq!(r.painted_target(p.entries[0].window_id), Some(pose));
        assert_eq!(r.origin_sample.unwrap().motion.current, last.motion.current);
        assert!(!r.mark_painted(1, 170_000_000));
    }
    #[test]
    fn partial_rejects_resize_spoofing_and_consumes_validated_epochs() {
        let (mut r, p, frames) = fixture();
        let a = p.entries[0].window_id;
        let mut wrong = frames.clone();
        wrong.get_mut(&a).unwrap().width -= 1.0;
        assert!(!r.arm_partial(p.clone(), 0, &wrong, true, p.viewport));
        assert!(!r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        let mut next = p.clone();
        next.epoch = 2.0;
        next.fingerprint = b"2".to_vec();
        assert!(!r.arm_partial(
            next.clone(),
            0,
            &frames,
            true,
            Rect {
                x: 2560.0,
                ..p.viewport
            }
        ));
        assert!(!r.arm_partial(next.clone(), 0, &frames, true, p.viewport));
        next.epoch = 3.0;
        next.fingerprint = b"3".to_vec();
        assert!(r.arm_partial(next, 0, &frames, true, p.viewport));
    }
    #[test]
    fn partial_failed_arm_cannot_ack_a_duplicate_using_older_active_motion() {
        let (mut r, p, frames) = fixture();
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        let mut next = p.clone();
        next.epoch = 2.0;
        next.fingerprint = b"bad-output".to_vec();
        let wrong_output = Rect {
            x: -1.0,
            width: 2561.0,
            ..p.viewport
        };
        assert!(!r.arm_partial(next.clone(), 0, &frames, true, wrong_output));
        assert!(r.active());
        assert_eq!(r.epoch(), 1);
        assert!(!r.arm_partial(next, 0, &frames, true, p.viewport));
        r.cancel(&Text::from_utf8("s"), 2);
        assert!(!r.active());
    }
    #[test]
    fn partial_omitted_live_rows_keep_outgoing_ownership_until_park_or_close() {
        let (mut r, p, frames) = fixture();
        let a = p.entries[0].window_id;
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        paint(&mut r, 55_000_000);
        let mut next = p.clone();
        next.epoch = 2.0;
        next.fingerprint = b"partial-only-b".to_vec();
        next.entries.remove(0);
        assert!(r.arm_partial(next, 55_000_000, &frames, true, p.viewport));
        assert_eq!(r.role(a), Some(WindowRole::Outgoing));
        assert!(r.projection(a, frames[&a]).is_some());
        r.remove(a);
        assert!(r.projection(a, frames[&a]).is_none());
    }
    #[test]
    fn partial_validator_keeps_legacy_contracts_and_rejects_malformed_geometry() {
        let (r, p, _) = fixture();
        assert!(r.valid_plan(&p));
        for case in 0..12 {
            let mut bad = p.clone();
            match case {
                0 => bad.partial.as_mut().unwrap().layout.x = -1.0,
                1 => bad.partial.as_mut().unwrap().max_offset = f64::NAN,
                2 => bad.partial.as_mut().unwrap().max_offset = MAX_SAFE_INTEGER + 1.0,
                3 => bad.partial.as_mut().unwrap().scope_revision = 0.5,
                4 => bad.protocol = 2.0,
                5 => bad.kind = Text::from_utf8("SCROLL"),
                6 => bad.clip_partial = 0,
                7 => bad.entries[1].logical_x = bad.entries[0].logical_x + 1.0,
                8 => bad.entries[1].window_id = bad.entries[0].window_id,
                9 => bad.entries[0].pixel_width = 2561.0,
                10 => bad.entries[0].old_placement = Placement::Parked,
                _ => bad.entries[1].logical_x = f64::INFINITY,
            }
            assert!(!r.valid_plan(&bad), "case {case}");
        }
        let mut legacy = p.clone();
        legacy.partial = None;
        assert!(!r.valid_plan(&legacy));
        assert!(ValidatedScrollPlan::new_reindex(
            p.clone(),
            p.entries[0].window_id,
            652.0,
            &r.windows
        )
        .is_err());
    }
    #[test]
    fn client_source_requires_every_actual_client_paint_not_shared_camera() {
        let (mut r, p, frames) = fixture();
        let (a, b) = (p.entries[0].window_id, p.entries[1].window_id);
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        assert!(r.prepare_frame(50_000_000));
        assert!(r.mark_painted(1, 50_000_000));
        assert!(!r.client_source_complete());
        assert!(r.record_client_painted(a, 1, 50_000_000, 10, frames[&a]));
        assert!(
            !r.client_source_complete(),
            "a shared camera never proves client B painted"
        );
        assert!(r.record_client_painted(b, 1, 50_000_000, 10, frames[&b]));
        assert!(r.client_source_complete());
        let source = r.client_paint(a).unwrap();
        let workspace: Vec<_> = "a".encode_utf16().collect();
        let output_name: Vec<_> = "o".encode_utf16().collect();
        assert!(r.client_source_matches(p.viewport, &workspace, &output_name));
        assert!(!r.client_source_matches(
            Rect {
                width: 2559.0,
                ..p.viewport
            },
            &workspace,
            &output_name
        ));
        assert!(!r.client_source_matches(p.viewport, &[], &output_name));
        assert!(!r.client_source_matches(p.viewport, &workspace, &[]));
        assert_eq!(source.frame, frames[&a]);
        assert_eq!(source.column_id, 1.0);
        assert!((source.logical_x - 652.0).abs() < 1e-9);
        assert_eq!(
            source.velocity_x,
            -r.frame_sample(true).unwrap().motion.velocity
        );
        assert!(r.prepare_frame(100_000_000));
        assert_eq!(
            r.client_paint(a),
            Some(source),
            "an unused prediction is not paint"
        );
        assert!(r.client_source_complete());
        let frozen = r.clone_for_paint();
        assert_eq!(frozen.client_paint(a), Some(source));
        assert!(frozen.client_source_complete());
        assert!(r.record_client_painted(a, 1, 100_000_000, 11, frames[&a]));
        assert!(!r.client_source_complete());
        assert!(r.mark_painted(1, 100_000_000));
        assert!(
            !r.client_source_complete(),
            "mixed pass identities cannot become a source"
        );
        assert!(r.record_client_painted(b, 1, 100_000_000, 11, frames[&b]));
        assert!(r.client_source_complete());
        r.remove(a);
        assert!(r.client_source_complete());
        assert!(!r.record_client_painted(a, 1, 100_000_000, 11, frames[&a]));
        r.clear();
        assert!(!r.client_source_complete());
        assert!(r.client_paint(b).is_none());
    }
    #[test]
    fn client_paint_proof_rejects_near_frames_stale_passes_and_unpainted_epochs() {
        let (mut r, p, frames) = fixture();
        let a = p.entries[0].window_id;
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        assert!(!r.record_client_painted(a, 1, 0, 1, frames[&a]));
        assert!(r.prepare_frame(50_000_000));
        let almost = Rect {
            x: frames[&a].x + 0.01,
            ..frames[&a]
        };
        assert!(
            r.projection(a, almost).is_some(),
            "legacy projection retains its tolerance"
        );
        assert!(!r.record_client_painted(a, 1, 50_000_000, 1, almost));
        for (epoch, time, serial) in [
            (2, 50_000_000, 1),
            (1, 49_000_000, 1),
            (1, 50_000_000, 0),
            (1, 50_000_000, MAX_SAFE_INTEGER as u64 + 1),
        ] {
            assert!(!r.record_client_painted(a, epoch, time, serial, frames[&a]));
        }
        assert!(r.record_client_painted(a, 1, 50_000_000, 10, frames[&a]));
        assert!(r.prepare_frame(60_000_000));
        assert!(!r.record_client_painted(a, 1, 60_000_000, 10, frames[&a]));
        assert!(!r.record_client_painted(a, 1, 60_000_000, 9, frames[&a]));
        let mut next = p.clone();
        next.epoch = 2.0;
        next.fingerprint = b"new-source-epoch".to_vec();
        assert!(r.arm_partial(next, 60_000_000, &frames, true, p.viewport));
        assert!(r.client_paint(a).is_none());
        assert!(!r.client_source_complete());
        assert!(!r.record_client_painted(a, 1, 50_000_000, 10, frames[&a]));
        r.cancel(&Text::from_utf8("s"), 2);
        assert!(!r.client_source_complete());
    }
    #[test]
    fn actual_client_paint_ledger_has_no_hot_path_allocations() {
        let (mut r, p, frames) = fixture();
        let (a, b) = (p.entries[0].window_id, p.entries[1].window_id);
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        let allocations = crate::allocation_checks::count(|| {
            for i in 1..=10_000 {
                let time = i * 16_666_667;
                assert!(r.prepare_frame(time));
                assert!(r.record_client_painted(a, 1, time, i as u64, frames[&a]));
                assert!(r.mark_painted(1, time));
                assert!(r.record_client_painted(b, 1, time, i as u64, frames[&b]));
                assert!(r.client_source_complete());
                std::hint::black_box(r.client_paint(a));
            }
        });
        assert_eq!(allocations, 0);
    }
    #[test]
    fn partial_pairs_survive_clear_remove_cancel_and_hot_queries_allocate_nothing() {
        let (mut r, p, frames) = fixture();
        let a = p.entries[0].window_id;
        assert!(r.arm_partial(p.clone(), 0, &frames, true, p.viewport));
        let allocations = crate::allocation_checks::count(|| {
            for i in 0..10_000 {
                paint(&mut r, i * 16_666_667);
                r.projection(a, r.targets()[&a]);
                r.partial_hit(400.0, 100.0);
                r.partial_input_blocked(a, r.targets()[&a], 400.0, 100.0);
                r.partial_input.event(1, 272, true, 0);
                r.partial_input.event(2, 272, false, 1);
            }
        });
        assert_eq!(allocations, 0);
        assert_eq!(r.partial_input.event(1, 272, true, 0), (true, true));
        r.remove(a);
        r.cancel(&Text::from_utf8("s"), 1);
        r.clear();
        assert_eq!(r.partial_input.pending(), (1, 0));
        assert_eq!(r.partial_input.event(2, 272, false, 1), (true, false));
        assert_eq!(r.partial_input.pending(), (0, 0));
    }
}
