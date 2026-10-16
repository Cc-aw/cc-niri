// SPDX-License-Identifier: GPL-2.0-or-later
//! Typed geometry validation and relative column motion. The existing Scroll
//! sequence/camera/presentation owner supplies authority and time. No layout,
//! focus, platform objects, surface scaling, timer or independent camera here.
use crate::native_protocol::{
    integer, Context, NativeError, Placement, Rect, ScrollPlan, Text, ValidatedScrollPlan,
    WindowId, WindowRegistry, MAX_SAFE_INTEGER,
};
use crate::scroll_retarget::{MotionBounds, RetargetDecision};
use crate::scroll_visual::OutputFacts;
use crate::viewport_motion::{MotionKind, MotionSample, ViewportMotion};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub struct ColumnGeometryEntry {
    pub window_id: WindowId,
    pub column_id: f64,
    // None is an unowned, hidden client; it must not claim a painted pose.
    pub old_logical_x: Option<f64>,
    pub source_culled: bool,
    pub new_logical_x: f64,
    pub old_width: f64,
    pub new_width: f64,
    pub old_frame: Rect,
    pub old_visual: Option<Rect>,
    pub target_frame: Rect,
    pub old_placement: Placement,
    pub new_placement: Placement,
}

#[derive(Clone, Debug)]
pub struct ColumnGeometryPlan {
    // Common identity, epoch and fingerprint; legacy entries must be empty.
    pub header: ScrollPlan,
    pub old_layout: Rect,
    pub layout: Rect,
    pub old_max_camera: f64,
    pub max_camera: f64,
    pub scope_revision: f64,
    pub source_epoch: f64,
    pub source_serial: f64,
    pub entries: Vec<ColumnGeometryEntry>,
}

fn scalar(v: f64) -> bool {
    v.is_finite() && (0.0..=MAX_SAFE_INTEGER).contains(&v)
}
fn safe_rect(r: Rect) -> bool {
    r.valid_viewport()
        && r.width >= 1.0
        && r.height >= 1.0
        && [r.x, r.y, r.width, r.height, r.x + r.width, r.y + r.height]
            .into_iter()
            .all(|v| v.abs() <= MAX_SAFE_INTEGER)
}
fn inside(r: Rect, output: Rect) -> bool {
    safe_rect(r)
        && r.x >= output.x
        && r.y >= output.y
        && r.x + r.width <= output.x + output.width
        && r.y + r.height <= output.y + output.height
}
fn placement(visual: Rect, output: Rect) -> Placement {
    if visual.intersects(output) {
        Placement::Visible
    } else {
        Placement::Parked
    }
}
fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 0.000001
}

impl ColumnGeometryPlan {
    pub(crate) fn matches_source(&self, source: &GeometrySource) -> bool {
        let h = &self.header;
        source.context.matches(h)
            && source.viewport == h.viewport
            && source.layout == self.old_layout
            && source.max_camera == self.old_max_camera
            && source.scope_revision == self.scope_revision
            && source.epoch as f64 == self.source_epoch
            && source.serial as f64 == self.source_serial
            && source.serial <= MAX_SAFE_INTEGER as u64
            && source.time_ns >= 0
            && source.camera_x == h.old_offset
            && source.rows.len() == self.entries.len()
            && self.entries.iter().all(|entry| {
                source.rows.get(&entry.window_id).is_some_and(|fact| {
                    fact.culled == entry.source_culled
                        && fact.column_id == entry.column_id
                        && fact.frame == entry.old_frame
                        && fact.acknowledged
                        && fact.visual == entry.old_visual
                        && fact.velocity_x.is_finite()
                        && fact.velocity_y.is_finite()
                        && (entry.old_visual.is_some() || fact.hidden)
                })
            })
    }
    pub(crate) fn valid(&self, windows: &WindowRegistry) -> bool {
        let h = &self.header;
        if !h.shape_valid
            || h.protocol != 4.0
            || h.kind != Text::from_utf8("COLUMN_GEOMETRY")
            || !h.session.valid()
            || !h.workspace.valid()
            || !h.output.valid()
            || integer(h.epoch).is_none()
            || integer(h.issued_at).is_none()
            || h.partial.is_some()
            || !h.entries.is_empty()
            || h.clip_partial != 2
            || h.retarget_only != 0
            || !safe_rect(h.viewport)
            || !inside(self.old_layout, h.viewport)
            || !inside(self.layout, h.viewport)
            || !scalar(self.old_max_camera)
            || !scalar(self.max_camera)
            || !scalar(h.old_offset)
            || h.old_offset > self.old_max_camera
            || !scalar(h.new_offset)
            || h.new_offset > self.max_camera
            || !integer(self.scope_revision).is_some_and(|v| v > 0)
            || !integer(self.source_epoch).is_some_and(|v| v > 0)
            || self.source_epoch >= h.epoch
            || integer(self.source_serial).is_none()
            || self.entries.is_empty()
            || self.entries.len() > 256
        {
            return false;
        }
        let mut owners = HashSet::new();
        let mut columns = HashSet::new();
        for (index, row) in self.entries.iter().enumerate() {
            if !windows
                .label(row.window_id)
                .is_some_and(Text::canonical_window)
                || !owners.insert(row.window_id)
                || !integer(row.column_id).is_some_and(|id| columns.insert(id))
                || !scalar(row.new_logical_x)
                || !scalar(row.old_width)
                || !scalar(row.new_width)
                || row.old_width < 1.0
                || row.new_width < 1.0
                || row.new_width > self.layout.width
                || row.new_logical_x + row.new_width > MAX_SAFE_INTEGER
                || !safe_rect(row.old_frame)
                || row.old_frame.width != row.old_width
                || row.old_frame.width > h.viewport.width
                || row.old_frame.height > h.viewport.height
                || !inside(row.target_frame, h.viewport)
                || self.entries[..index].iter().any(|old| {
                    row.new_logical_x < old.new_logical_x + old.new_width
                        && row.new_logical_x + row.new_width > old.new_logical_x
                })
            {
                return false;
            }
            let visual = Rect {
                x: self.layout.x + row.new_logical_x - h.new_offset,
                y: self.layout.y,
                width: row.new_width,
                height: self.layout.height,
            };
            let target = Rect {
                x: visual.x.clamp(
                    h.viewport.x,
                    h.viewport.x + h.viewport.width - row.new_width,
                ),
                ..visual
            };
            if !safe_rect(visual)
                || row.target_frame != target
                || row.new_placement != placement(visual, h.viewport)
            {
                return false;
            }
            match (row.old_logical_x, row.old_visual) {
                (Some(x), Some(pose)) => {
                    if !x.is_finite()
                        || x.abs() > MAX_SAFE_INTEGER
                        || x + row.old_width > MAX_SAFE_INTEGER
                        || !inside(row.old_frame, h.viewport)
                        || row.old_width > self.old_layout.width
                        || !safe_rect(pose)
                        || !close(pose.x, self.old_layout.x + x - h.old_offset)
                        || pose.y != self.old_layout.y
                        || pose.width != row.old_width
                        || pose.height != self.old_layout.height
                        || row.old_frame.y != pose.y
                        || row.old_frame.height != pose.height
                        || row.old_placement != placement(pose, h.viewport)
                        || (row.source_culled && pose.intersects(h.viewport))
                    {
                        return false;
                    }
                }
                (None, None) if row.old_placement == Placement::Parked && !row.source_culled => {}
                _ => return false,
            }
        }
        true
    }
}

pub struct ValidatedColumnGeometryPlan {
    sequence: ValidatedScrollPlan,
    wire: ColumnGeometryPlan,
}
impl ValidatedColumnGeometryPlan {
    pub fn new(
        mut wire: ColumnGeometryPlan,
        windows: &WindowRegistry,
    ) -> Result<Self, NativeError> {
        let sequence = ValidatedScrollPlan::new_column_geometry(&wire, windows)?;
        // The validated common header owns the sequence fingerprint. Do not
        // retain a second envelope allocation inside the numerical transition.
        wire.header.fingerprint = Vec::new();
        Ok(Self { sequence, wire })
    }
    pub fn wire(&self) -> &ColumnGeometryPlan {
        &self.wire
    }
    pub fn sequence(&mut self) -> &mut ValidatedScrollPlan {
        &mut self.sequence
    }
    pub fn into_wire(self) -> ColumnGeometryPlan {
        self.wire
    }
}

/// Facts from the platform/last actual paint, never an unpainted model target.
#[derive(Clone, Copy, Debug)]
pub struct ColumnSource {
    pub column_id: f64,
    pub frame: Rect,
    pub visual: Option<Rect>,
    pub velocity_x: f64,
    pub velocity_y: f64,
    pub acknowledged: bool,
    pub hidden: bool,
    pub culled: bool,
}
#[derive(Clone, Debug)]
pub struct GeometrySource {
    pub context: Context,
    pub viewport: Rect,
    pub layout: Rect,
    pub max_camera: f64,
    pub scope_revision: f64,
    pub epoch: i64,
    pub serial: u64,
    pub camera_x: f64,
    pub time_ns: i64,
    pub rows: HashMap<WindowId, ColumnSource>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ColumnPose {
    pub rect: Rect,
    pub velocity_x: f64,
    pub velocity_y: f64,
    pub time_ns: i64,
    pub serial: u64,
    pub target_frame: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct ColumnProjection {
    pub translation_x: f64,
    pub translation_y: f64,
    pub viewport: Rect,
}
#[derive(Clone, Debug)]
struct ColumnState {
    source: Rect,
    target: Rect,
    logical_x: f64,
    column_id: f64,
    dx: ViewportMotion,
    dy: ViewportMotion,
    decisions: (RetargetDecision, RetargetDecision),
    pending: Option<ColumnPose>,
    painted: Option<ColumnPose>,
    acknowledged: bool,
    frame_valid: bool,
    offsets_settled: bool,
    culled: Option<ColumnPose>,
}

/// Small numerical companion to the existing Scroll runtime. It receives the
/// SAME camera sample and timestamp. Only offsets animate; real client content
/// uses its actual old/new frame dimensions, without any surface scale.
#[derive(Clone, Debug)]
pub struct ColumnGeometryTransition {
    epoch: i64,
    viewport: Rect,
    layout: Rect,
    camera_target: f64,
    camera_upper: f64,
    smooth: bool,
    started_at: i64,
    source_serial: u64,
    frame: Option<(MotionSample, i64)>,
    rows: HashMap<WindowId, ColumnState>,
}
impl ColumnGeometryTransition {
    pub fn new(
        validated: ValidatedColumnGeometryPlan,
        source: &GeometrySource,
        camera_origin: MotionSample,
        now: i64,
        smooth: bool,
    ) -> Result<Self, NativeError> {
        let plan = validated.into_wire();
        let h = &plan.header;
        if !plan.matches_source(source)
            || now < source.time_ns
            || camera_origin.epoch as f64 != h.epoch
            || !close(camera_origin.current, source.camera_x)
            || camera_origin.target != h.new_offset
            || !camera_origin.velocity.is_finite()
            || (camera_origin.kind == MotionKind::Static
                && camera_origin.current != camera_origin.target)
        {
            return Err(NativeError::ContextMismatch);
        }
        let mut rows = HashMap::with_capacity(plan.entries.len());
        for entry in plan.entries {
            let fact = source
                .rows
                .get(&entry.window_id)
                .ok_or(NativeError::UnknownWindow)?;
            let base_x = plan.layout.x + entry.new_logical_x - camera_origin.current;
            let delta = entry.old_visual.map_or(0.0, |p| p.x - base_x);
            let delta_y = entry.old_visual.map_or(0.0, |p| p.y - plan.layout.y);
            let make_motion = |from: f64, velocity: f64, extent: f64| {
                let mut motion = ViewportMotion::new(crate::scroll_visual::parameters(smooth));
                let decision = if smooth {
                    motion.start_bounded(
                        from,
                        0.0,
                        velocity,
                        MotionBounds {
                            lower: from.min(0.0) - extent * 0.02,
                            upper: from.max(0.0) + extent * 0.02,
                            reverse_limit: extent * 0.02,
                        },
                        camera_origin.epoch,
                        now,
                    )
                } else {
                    motion
                        .start(from, 0.0, camera_origin.epoch, now)
                        .then_some(RetargetDecision::default())
                };
                decision
                    .map(|decision| (motion, decision))
                    .ok_or(NativeError::InvalidGeometry)
            };
            let (dx, decision_x) = make_motion(
                delta,
                entry
                    .old_visual
                    .map_or(0.0, |_| fact.velocity_x + camera_origin.velocity),
                h.viewport.width,
            )?;
            let (dy, decision_y) = make_motion(
                delta_y,
                entry.old_visual.map_or(0.0, |_| fact.velocity_y),
                h.viewport.height,
            )?;
            rows.insert(
                entry.window_id,
                ColumnState {
                    source: entry.old_frame,
                    target: entry.target_frame,
                    logical_x: entry.new_logical_x,
                    column_id: entry.column_id,
                    dx,
                    dy,
                    decisions: (decision_x, decision_y),
                    pending: None,
                    painted: entry
                        .old_visual
                        .filter(|_| !fact.culled)
                        .map(|rect| ColumnPose {
                            rect,
                            velocity_x: fact.velocity_x,
                            velocity_y: fact.velocity_y,
                            time_ns: source.time_ns,
                            serial: source.serial,
                            target_frame: entry.old_frame == entry.target_frame,
                        }),
                    acknowledged: entry.old_frame == entry.target_frame,
                    frame_valid: true,
                    offsets_settled: false,
                    culled: None,
                },
            );
        }
        Ok(Self {
            epoch: camera_origin.epoch,
            viewport: h.viewport,
            layout: plan.layout,
            camera_target: h.new_offset,
            camera_upper: plan.old_max_camera.max(plan.max_camera),
            smooth,
            started_at: now,
            source_serial: source.serial,
            frame: None,
            rows,
        })
    }
    pub fn len(&self) -> usize {
        self.rows.len()
    }
    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
    pub fn clone_for_paint(&self) -> Self {
        let mut copy = self.clone();
        // A departure after prePaint must freeze actual per-client paints.
        for row in copy.rows.values_mut() {
            row.pending = row.painted;
        }
        copy.frame = None;
        copy
    }
    pub fn remove(&mut self, id: WindowId) {
        self.rows.remove(&id);
    }
    pub fn clear(&mut self) {
        self.rows.clear();
        self.frame = None;
    }
    /// The adapter observes real configure facts. Once a target is observed,
    /// a delayed source frame is invalid; it cannot revoke the target ACK.
    pub fn observe_frame(&mut self, id: WindowId, frame: Rect) -> bool {
        let Some(row) = self.rows.get_mut(&id) else {
            return false;
        };
        row.frame_valid = frame == row.target || (!row.acknowledged && frame == row.source);
        if frame == row.target {
            row.acknowledged = true;
        }
        row.frame_valid
    }
    pub fn prepare_frame(
        &mut self,
        camera: MotionSample,
        time_ns: i64,
        facts: OutputFacts,
    ) -> bool {
        if camera.epoch != self.epoch
            || camera.target != self.camera_target
            || !camera.current.is_finite()
            || !(0.0..=self.camera_upper).contains(&camera.current)
            || (camera.kind == MotionKind::Static && camera.current != camera.target)
            || !camera.velocity.is_finite()
            || time_ns < self.started_at
            || self.frame.is_some_and(|(_, previous)| time_ns < previous)
        {
            return false;
        }
        for row in self.rows.values_mut() {
            let sample = |m: &ViewportMotion| {
                if self.smooth {
                    m.sample_visual(time_ns, facts)
                } else {
                    m.sample(time_ns)
                }
            };
            let dx = sample(&row.dx);
            let dy = sample(&row.dy);
            row.offsets_settled = dx.kind == MotionKind::Static && dy.kind == MotionKind::Static;
            row.pending = Some(ColumnPose {
                rect: Rect {
                    x: self.layout.x + row.logical_x - camera.current + dx.current,
                    y: self.layout.y + dy.current,
                    width: row.target.width,
                    height: row.target.height,
                },
                velocity_x: dx.velocity - camera.velocity,
                velocity_y: dy.velocity,
                time_ns,
                serial: 0,
                target_frame: false,
            });
        }
        self.frame = Some((camera, time_ns));
        true
    }
    pub fn projection(&self, id: WindowId, frame: Rect) -> Option<ColumnProjection> {
        let row = self.rows.get(&id)?;
        if !row.frame_valid || !(frame == row.target || (!row.acknowledged && frame == row.source))
        {
            return None;
        }
        let pending = row.pending?;
        Some(ColumnProjection {
            translation_x: pending.rect.x - frame.x,
            translation_y: pending.rect.y - frame.y,
            viewport: self.viewport,
        })
    }
    /// Only the actual client paint can promote a pending offset. Dimensions
    /// come from the observed surface; never advertise the requested width as
    /// already painted. Unpainted prePaint predictions are not retarget sources.
    pub fn mark_painted(
        &mut self,
        id: WindowId,
        epoch: i64,
        time_ns: i64,
        serial: u64,
        frame: Rect,
    ) -> bool {
        if epoch != self.epoch
            || self.frame.is_none_or(|(_, t)| t != time_ns)
            || serial > MAX_SAFE_INTEGER as u64
            || serial <= self.source_serial
        {
            return false;
        }
        let Some(row) = self.rows.get(&id) else {
            return false;
        };
        if row.painted.is_some_and(|p| {
            time_ns < p.time_ns || serial < p.serial || (serial == p.serial && time_ns != p.time_ns)
        }) || self.projection(id, frame).is_none()
        {
            return false;
        }
        if !self.observe_frame(id, frame) {
            return false;
        }
        let row = self.rows.get_mut(&id).expect("observed row");
        let Some(mut pose) = row.pending else {
            return false;
        };
        pose.rect.width = frame.width;
        pose.rect.height = frame.height;
        pose.serial = serial;
        pose.target_frame = frame == row.target;
        row.painted = Some(pose);
        if row.offsets_settled {
            row.dx.snap(0.0);
            row.dy.snap(0.0);
        }
        true
    }
    pub fn painted(&self, id: WindowId) -> Option<ColumnPose> {
        self.rows.get(&id)?.painted
    }
    pub fn column_id(&self, id: WindowId) -> Option<f64> {
        Some(self.rows.get(&id)?.column_id)
    }
    pub fn retarget_decisions(&self, id: WindowId) -> Option<(RetargetDecision, RetargetDecision)> {
        Some(self.rows.get(&id)?.decisions)
    }
    pub fn observe_culled(&mut self, id: WindowId, time: i64, serial: u64, frame: Rect) -> bool {
        if self.frame.is_none_or(|(_, t)| t != time)
            || serial <= self.source_serial
            || serial > MAX_SAFE_INTEGER as u64
        {
            return false;
        }
        if !self.observe_frame(id, frame) {
            return false;
        }
        let row = self.rows.get_mut(&id).expect("observed row");
        if row.pending.is_none_or(|p| {
            Rect {
                width: frame.width,
                height: frame.height,
                ..p.rect
            }
            .intersects(self.viewport)
        }) {
            return false;
        }
        let p = row.pending.expect("validated pending pose");
        row.culled = Some(ColumnPose {
            rect: Rect {
                width: frame.width,
                height: frame.height,
                ..p.rect
            },
            time_ns: time,
            serial,
            target_frame: frame == row.target,
            velocity_x: p.velocity_x,
            velocity_y: p.velocity_y,
        });
        if row.offsets_settled {
            row.dx.snap(0.0);
            row.dy.snap(0.0);
        }
        true
    }
    pub fn culled_source(
        &self,
        id: WindowId,
        time: i64,
        serial: u64,
        frame: Rect,
    ) -> Option<ColumnPose> {
        let row = self.rows.get(&id)?;
        row.culled.filter(|p| {
            row.frame_valid
                && p.time_ns == time
                && p.serial == serial
                && p.rect.width == frame.width
                && p.rect.height == frame.height
                && (frame == row.target || (!row.acknowledged && frame == row.source))
        })
    }
    pub fn pass_observed(&self, time: i64, serial: u64) -> bool {
        serial > self.source_serial
            && !self.rows.is_empty()
            && self.rows.values().all(|row| {
                row.frame_valid
                    && (row
                        .painted
                        .is_some_and(|p| p.time_ns == time && p.serial == serial)
                        || row
                            .culled
                            .is_some_and(|p| p.time_ns == time && p.serial == serial))
            })
    }
    pub fn animating(&self) -> bool {
        self.frame
            .is_none_or(|(c, _)| c.kind == MotionKind::Animation)
            || self.rows.values().any(|r| !r.offsets_settled)
    }
    pub fn camera_bound(&self) -> f64 {
        self.camera_upper
    }
    pub fn completed(&self) -> bool {
        let Some((camera, time)) = self.frame else {
            return false;
        };
        let Some(serial) = self.rows.values().next().and_then(|row| {
            row.culled
                .filter(|p| p.time_ns == time)
                .map(|p| p.serial)
                .or_else(|| row.painted.map(|p| p.serial))
        }) else {
            return false;
        };
        serial > self.source_serial
            && !self.rows.is_empty()
            && camera.kind == MotionKind::Static
            && self.rows.values().all(|row| {
                let sample = |m: &ViewportMotion| m.sample(time);
                row.frame_valid
                    && row.acknowledged
                    && sample(&row.dx).kind == MotionKind::Static
                    && sample(&row.dy).kind == MotionKind::Static
                    && (row
                        .painted
                        .is_some_and(|p| p.target_frame && p.time_ns == time && p.serial == serial)
                        || (row.culled.is_some_and(|p| {
                            p.time_ns == time && p.serial == serial && p.target_frame
                        }) && row
                            .pending
                            .is_some_and(|p| !p.rect.intersects(self.viewport))))
            })
    }
}
