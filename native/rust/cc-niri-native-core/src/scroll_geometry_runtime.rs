// SPDX-License-Identifier: GPL-2.0-or-later
//! Composition inside the existing Scroll owner. No second camera, sequence,
//! timer or layout authority; adapter inputs are fresh scalar platform facts.
use super::*;
use crate::column_geometry::{
    ColumnGeometryPlan, ColumnGeometryTransition, ColumnSource, GeometrySource,
    ValidatedColumnGeometryPlan,
};

#[derive(Clone, Copy, Debug)]
pub struct GeometryClientFact {
    pub frame: Rect,
    pub opacity: f64,
    // current desktop, target output, minimized, deleted, fullscreen, normal,
    // managed = bits 0..6. Hidden incoming needs BOTH minimized and opacity=0.
    pub flags: u32,
}
impl GeometryClientFact {
    pub fn hidden(self) -> bool {
        self.flags & 4 != 0 && self.opacity == 0.0
    }
    fn eligible(self) -> bool {
        self.flags & !127 == 0
            && self.flags & 97 == 97
            && self.flags & 24 == 0
            && self.opacity.is_finite()
            && (0.0..=1.0).contains(&self.opacity)
            && (self.flags & 2 != 0 || self.hidden())
    }
}
#[derive(Clone, Copy, Debug)]
pub struct GeometrySourceRequest {
    pub id: WindowId,
    pub column_id: f64,
    pub fact: GeometryClientFact,
}
impl ScrollViewportRuntime {
    pub fn column_geometry_active(&self) -> bool {
        self.geometry.is_some() && self.active()
    }
    pub fn geometry_source(
        &self,
        requests: &[GeometrySourceRequest],
        actual_output: Rect,
    ) -> Option<GeometrySource> {
        if !self.active()
            || actual_output != self.viewport
            || requests.is_empty()
            || requests.len() > 256
        {
            return None;
        }
        let sample = self.painted_sample?;
        let basis = self.paint_basis.as_ref()?;
        if self.client_serial == 0 || sample.motion.epoch < 1 {
            return None;
        }
        let mut rows = HashMap::with_capacity(requests.len());
        for request in requests {
            if !request.fact.eligible()
                || !integer(request.column_id).is_some_and(|_| true)
                || !self
                    .windows
                    .label(request.id)
                    .is_some_and(Text::canonical_window)
                || rows.contains_key(&request.id)
            {
                return None;
            }
            let fact = if request.fact.hidden() {
                // Hidden is independently observed by KWin, including unowned
                // incoming/transit clients. Do not manufacture a painted pose.
                if self
                    .client_paints
                    .get(&request.id)
                    .is_some_and(|(id, _)| *id != request.column_id)
                {
                    return None;
                }
                ColumnSource {
                    column_id: request.column_id,
                    frame: request.fact.frame,
                    visual: None,
                    velocity_x: 0.0,
                    velocity_y: 0.0,
                    acknowledged: true,
                    hidden: true,
                    culled: false,
                }
            } else if let Some(pose) = self.geometry.as_ref().and_then(|g| {
                g.culled_source(
                    request.id,
                    sample.time_ns,
                    self.client_serial,
                    request.fact.frame,
                )
            }) {
                let column_id = self.client_paints.get(&request.id)?.0;
                if column_id != request.column_id {
                    return None;
                }
                ColumnSource {
                    column_id,
                    frame: request.fact.frame,
                    visual: Some(pose.rect),
                    velocity_x: pose.velocity_x,
                    velocity_y: pose.velocity_y,
                    acknowledged: true,
                    hidden: false,
                    culled: true,
                }
            } else {
                let paint = self.client_paint(request.id)?;
                if paint.column_id != request.column_id
                    || paint.frame != request.fact.frame
                    || paint.epoch != sample.motion.epoch
                    || paint.time_ns != sample.time_ns
                    || paint.serial != self.client_serial
                {
                    return None;
                }
                ColumnSource {
                    column_id: paint.column_id,
                    frame: paint.frame,
                    visual: Some(paint.visual),
                    velocity_x: paint.velocity_x,
                    velocity_y: paint.velocity_y,
                    acknowledged: true,
                    hidden: false,
                    culled: false,
                }
            };
            rows.insert(request.id, fact);
        }
        Some(GeometrySource {
            context: self.context()?.clone(),
            viewport: self.viewport,
            layout: basis.layout,
            max_camera: basis.max_offset,
            scope_revision: basis.scope_revision,
            epoch: sample.motion.epoch,
            serial: self.client_serial,
            camera_x: sample.motion.current,
            time_ns: sample.time_ns,
            rows,
        })
    }
    // One bounded event-time lease, never a per-frame history. The wire must
    // match an observation actually issued by Core. Arm then rebases that
    // validated intent to the newest real paint, avoiding a D-Bus round-trip
    // race without freezing presentation or trusting caller-supplied poses.
    pub fn query_geometry_source(
        &mut self,
        requests: &[GeometrySourceRequest],
        output: Rect,
    ) -> Option<GeometrySource> {
        let source = self.geometry_source(requests, output)?;
        self.geometry_observation = Some(source.clone());
        Some(source)
    }
    pub fn arm_geometry(
        &mut self,
        plan: ColumnGeometryPlan,
        now: i64,
        requests: &[GeometrySourceRequest],
        smooth: bool,
        actual_output: Rect,
    ) -> bool {
        let Ok(mut validated) = ValidatedColumnGeometryPlan::new(plan, &self.windows) else {
            return false;
        };
        let epoch = validated.wire().header.epoch as i64;
        if epoch <= self.cancelled_epoch {
            return false;
        }
        match self.sequence.observe_validated(validated.sequence()) {
            Ok(PlanDisposition::Duplicate) => {
                return self.column_geometry_active()
                    && self.epoch() == epoch
                    && actual_output == self.viewport
            }
            Ok(PlanDisposition::Accepted) => {}
            _ => return false,
        }
        let desired: Vec<_> = validated
            .wire()
            .entries
            .iter()
            .filter_map(|e| requests.iter().find(|r| r.id == e.window_id).copied())
            .collect();
        if self.columns.keys().any(|id| {
            !validated.wire().entries.iter().any(|e| e.window_id == *id)
                && requests
                    .iter()
                    .any(|r| r.id == *id && r.fact.eligible() && !r.fact.hidden())
        }) {
            return false;
        }
        let Some(source) = self.geometry_source(&desired, actual_output) else {
            return false;
        };
        let mut wire = validated.wire().clone();
        if !wire.matches_source(&source) {
            let Some(issued) = self.geometry_observation.as_ref() else {
                return false;
            };
            if !wire.matches_source(issued)
                || issued.epoch != source.epoch
                || issued.time_ns > source.time_ns
                || issued.serial > source.serial
                || issued.viewport != source.viewport
                || issued.layout != source.layout
                || issued.scope_revision != source.scope_revision
            {
                return false;
            }
            wire.header.old_offset = source.camera_x;
            // Completion may shrink the retained old camera bound between
            // query and arm. The current real basis is authoritative here too.
            wire.old_max_camera = source.max_camera;
            wire.source_serial = source.serial as f64;
            for entry in &mut wire.entries {
                let Some(fact) = source.rows.get(&entry.window_id) else {
                    return false;
                };
                // ACK/visibility changes are not numerical presentation drift.
                // They require a fresh JS query before geometry may be written.
                let Some(old) = issued.rows.get(&entry.window_id) else {
                    return false;
                };
                if fact.frame != old.frame || fact.hidden != old.hidden {
                    return false;
                }
                entry.old_frame = fact.frame;
                entry.old_visual = fact.visual;
                entry.old_width = fact.frame.width;
                entry.old_logical_x = fact.visual.map(|p| p.x - source.layout.x + source.camera_x);
                entry.source_culled = fact.culled;
                entry.old_placement = if fact.visual.is_some_and(|p| p.intersects(source.viewport))
                {
                    Placement::Visible
                } else {
                    Placement::Parked
                };
            }
            let Ok(rebased) = ValidatedColumnGeometryPlan::new(wire.clone(), &self.windows) else {
                return false;
            };
            validated = rebased;
        }
        // Every continuing owner must appear, unless it has actually closed / left
        // this scope. Requests are resolved against the current KWin stack.
        if desired.len() != wire.entries.len()
            || desired.iter().any(|r| {
                !wire
                    .entries
                    .iter()
                    .any(|e| e.window_id == r.id && e.column_id == r.column_id)
            })
        {
            return false;
        }
        let from = source.camera_x;
        let start = now.max(source.time_ns).max(self.motion.started_at());
        if now < 0 {
            return false;
        }
        let mut motion = self.motion.clone();
        motion.set_scroll_parameters(smooth);
        let velocity = if smooth && self.smooth_motion {
            self.painted_sample.map_or(0.0, |p| p.motion.velocity)
        } else {
            0.0
        };
        let decision = if smooth {
            let Some(d) = motion.start_bounded(
                from,
                wire.header.new_offset,
                velocity,
                MotionBounds {
                    lower: 0.0,
                    upper: source.max_camera.max(wire.max_camera),
                    reverse_limit: wire.header.viewport.width * 0.02,
                },
                epoch,
                start,
            ) else {
                return false;
            };
            d
        } else {
            if !motion.start(from, wire.header.new_offset, epoch, start) {
                return false;
            }
            RetargetDecision::default()
        };
        let origin = ScrollFrameSample {
            motion: motion.sample(start),
            time_ns: start,
        };
        let Ok(geometry) =
            ColumnGeometryTransition::new(validated, &source, origin.motion, start, smooth)
        else {
            return false;
        };
        let mut columns = HashMap::with_capacity(wire.entries.len());
        let mut sources = HashMap::with_capacity(wire.entries.len());
        let mut targets = HashMap::with_capacity(wire.entries.len());
        let mut roles = HashMap::with_capacity(wire.entries.len());
        let mut paints = HashMap::with_capacity(wire.entries.len());
        for e in &wire.entries {
            columns.insert(e.window_id, e.target_frame);
            sources.insert(e.window_id, e.old_frame);
            targets.insert(
                e.window_id,
                Rect {
                    x: wire.layout.x + e.new_logical_x - wire.header.new_offset,
                    y: wire.layout.y,
                    width: e.new_width,
                    height: wire.layout.height,
                },
            );
            roles.insert(
                e.window_id,
                if e.new_placement == Placement::Parked {
                    WindowRole::Outgoing
                } else if e.old_visual.is_none() {
                    WindowRole::Incoming
                } else {
                    WindowRole::Continuing
                },
            );
            paints.insert(e.window_id, (e.column_id, self.client_paint(e.window_id)));
        }
        // KWin may keep a deleted surface alive for its close fade. Freeze its
        // last actual paint/cull position until the real windowDeleted callback;
        // do not put it in the new layout, camera clock or completion barrier.
        for r in requests {
            if r.fact.flags & 8 != 0
                && self.columns.contains_key(&r.id)
                && !columns.contains_key(&r.id)
            {
                let pose = self.client_paint(r.id).map(|p| p.visual).or_else(|| {
                    self.geometry
                        .as_ref()
                        .and_then(|g| {
                            g.culled_source(r.id, source.time_ns, source.serial, r.fact.frame)
                        })
                        .map(|p| p.rect)
                });
                if let Some(pose) = pose {
                    self.closing
                        .insert(r.id, (pose, r.fact.frame, self.viewport));
                }
            }
        }
        self.geometry_completion_serial = 0;
        self.motion = motion;
        self.geometry = Some(geometry);
        self.columns = columns;
        self.source_frames = sources;
        self.visual_targets = targets;
        self.roles = roles;
        self.client_paints = paints;
        self.viewport = wire.header.viewport;
        self.partial = Some(PartialScrollConfig {
            layout: wire.layout,
            max_offset: wire.max_camera,
            scope_revision: wire.scope_revision,
        });
        self.clip_partial = true;
        self.smooth_motion = smooth;
        self.completed = false;
        self.frame_offset = from;
        self.anchor_offset = from;
        self.origin_sample = Some(origin);
        self.frame_sample = None;
        self.retarget.record(decision);
        self.prepare_frame(start)
    }
    pub fn geometry_projection(
        &self,
        id: WindowId,
        frame: Rect,
    ) -> Option<crate::column_geometry::ColumnProjection> {
        if let Some((pose, actual, viewport)) = self.closing.get(&id) {
            return (frame == *actual).then_some(crate::column_geometry::ColumnProjection {
                translation_x: pose.x - frame.x,
                translation_y: pose.y - frame.y,
                viewport: *viewport,
            });
        }
        self.geometry.as_ref()?.projection(id, frame)
    }
    pub fn observe_client_frame(&mut self, id: WindowId, frame: Rect) -> bool {
        if self
            .geometry
            .as_ref()
            .is_none_or(|g| g.column_id(id).is_none())
        {
            return false;
        }
        let valid = self
            .geometry
            .as_mut()
            .is_some_and(|g| g.observe_frame(id, frame));
        if self.geometry.is_some() && !valid {
            self.completed = false;
            self.geometry_completion_serial = 0;
        }
        valid
    }
    pub fn needs_repaint(&self) -> bool {
        self.active()
            && self
                .geometry
                .as_ref()
                .map_or(!self.completed, |g| g.animating())
    }
    pub fn observe_geometry_cull(
        &mut self,
        epoch: i64,
        time: i64,
        serial: u64,
        r: GeometrySourceRequest,
    ) {
        if self.epoch() != epoch || self.frame_sample.is_none_or(|s| s.time_ns != time) {
            return;
        }
        if let Some(g) = &mut self.geometry {
            if r.fact.eligible() {
                g.observe_culled(r.id, time, serial, r.fact.frame);
            }
        }
    }
    pub fn geometry_completion_serial(&self) -> u64 {
        self.geometry_completion_serial
    }
    pub fn finish_geometry_frame(
        &mut self,
        epoch: i64,
        time: i64,
        serial: u64,
        requests: &[GeometrySourceRequest],
    ) -> bool {
        if self.epoch() != epoch || self.frame_sample.is_none_or(|s| s.time_ns != time) {
            return false;
        }
        let Some(g) = &mut self.geometry else {
            return false;
        };
        for r in requests {
            if r.fact.eligible() {
                g.observe_culled(r.id, time, serial, r.fact.frame);
            }
        }
        let observed = g.pass_observed(time, serial);
        let complete = g.completed() && observed;
        if observed {
            self.client_serial = serial;
            if let Some(mut basis) = self.partial.clone() {
                if !complete {
                    basis.max_offset = basis.max_offset.max(g.camera_bound());
                }
                self.paint_basis = Some(basis);
            }
            self.mark_painted(epoch, time);
        }
        // Even an entirely clipped pass can commit the shared camera only after
        // every row has a real target ACK and an independently proven cull.
        if complete {
            self.completed = true;
            self.geometry_completion_serial = serial;
        }
        complete
    }
}
