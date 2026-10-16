// SPDX-License-Identifier: GPL-2.0-or-later
//! Per-client facts from the real scene draw. Shared camera paint alone cannot
//! prove that a resized or occluded client has painted. Storage is allocated at
//! arm, bounded by current clients, and updated without allocating in paint.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClientPaint {
    pub column_id: f64,
    pub frame: Rect,
    pub visual: Rect,
    pub velocity_x: f64,
    pub velocity_y: f64,
    pub logical_x: f64,
    pub epoch: i64,
    pub time_ns: i64,
    pub serial: u64,
}

impl ScrollViewportRuntime {
    /// Called only after the adapter actually delegates a nonempty clipped
    /// client draw on the bound output, using that pass's timestamp and serial.
    /// Exact frame equality is deliberate: legacy near() tolerance is not a
    /// configure/resize proof for the future typed geometry transaction.
    pub fn record_client_painted(
        &mut self,
        id: WindowId,
        epoch: i64,
        time_ns: i64,
        serial: u64,
        frame: Rect,
    ) -> bool {
        let Some(config) = self.partial_config().cloned() else {
            return false;
        };
        let Some(sample) = self.frame_sample else {
            return false;
        };
        let Some((column_id, previous)) = self.client_paints.get(&id) else {
            return false;
        };
        if epoch != self.epoch()
            || sample.motion.epoch != epoch
            || sample.time_ns != time_ns
            || serial == 0
            || serial > MAX_SAFE_INTEGER as u64
            || serial < self.client_serial
            || previous.is_some_and(|p| {
                time_ns < p.time_ns
                    || serial < p.serial
                    || (serial == p.serial && time_ns != p.time_ns)
            })
            || !(self.columns.get(&id) == Some(&frame)
                || self.source_frames.get(&id) == Some(&frame))
        {
            return false;
        }
        let Some(projection) = self.projection(id, frame) else {
            return false;
        };
        let (visual, velocity_x, velocity_y) = if let Some(g) = &mut self.geometry {
            if !g.mark_painted(id, epoch, time_ns, serial, frame) {
                return false;
            }
            let p = g.painted(id).expect("recorded paint");
            (p.rect, p.velocity_x, p.velocity_y)
        } else {
            (
                Rect {
                    x: frame.x + projection.translation_x,
                    ..frame
                },
                -sample.motion.velocity,
                0.0,
            )
        };
        let pose = ClientPaint {
            column_id: *column_id,
            frame,
            visual,
            velocity_x,
            velocity_y,
            logical_x: visual.x + sample.motion.current - config.layout.x,
            epoch,
            time_ns,
            serial,
        };
        self.client_paints.get_mut(&id).expect("existing client").1 = Some(pose);
        self.client_serial = serial;
        let mut basis = config.clone();
        if !self.completed {
            if let Some(g) = &self.geometry {
                basis.max_offset = basis.max_offset.max(g.camera_bound());
            }
        }
        self.paint_basis = Some(basis);
        true
    }
    pub fn client_paint(&self, id: WindowId) -> Option<ClientPaint> {
        self.client_paints.get(&id)?.1
    }
    pub fn client_paint_serial(&self) -> u64 {
        self.client_serial
    }
    /// A conservative source capability. Every owned client must have actually
    /// painted in the same camera pass. Occluded/missing clients return false;
    /// callers must not turn this into an Arm ACK or invent a painted pose.
    pub fn client_source_complete(&self) -> bool {
        let Some(sample) = self.painted_sample else {
            return false;
        };
        if let Some(g) = &self.geometry {
            return g.pass_observed(sample.time_ns, self.client_serial);
        }
        self.partial_config().is_some()
            && self.client_serial != 0
            && self.client_paints.len() == self.columns.len()
            && !self.client_paints.is_empty()
            && self.client_paints.values().all(|(_, pose)| {
                pose.is_some_and(|p| {
                    p.epoch == sample.motion.epoch
                        && p.time_ns == sample.time_ns
                        && p.serial == self.client_serial
                })
            })
    }
    /// Fresh platform output/workspace facts are independent of the cached
    /// plan. A resized output or desktop switch invalidates this source even
    /// before a new Bridge context arrives. Borrowed identity checks allocate 0.
    pub fn client_source_matches(&self, output: Rect, workspace: &[u16], name: &[u16]) -> bool {
        self.viewport == output
            && self
                .context()
                .is_some_and(|c| c.workspace.0 .0 == workspace && c.output.0 .0 == name)
            && self.client_source_complete()
    }
}
