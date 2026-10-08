// SPDX-License-Identifier: GPL-2.0-or-later
//! Shared native identities, validated context, wire DTOs and sequence policy.
use std::collections::{HashMap, HashSet};
pub const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
pub const GEOMETRY_EPSILON: f64 = 0.5;
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Text(pub Vec<u16>);
impl Text {
    pub fn from_utf8(value: &str) -> Self {
        Self(value.encode_utf16().collect())
    }
    pub fn valid(&self) -> bool {
        !self.0.is_empty() && self.0.len() <= 256 && self.0.iter().any(|c| !space(*c))
    }
    pub(crate) fn canonical_window(&self) -> bool {
        self.valid()
            && !space(self.0[0])
            && !space(self.0[self.0.len() - 1])
            && !self.0.contains(&u16::from(b'{'))
            && !self.0.contains(&u16::from(b'}'))
            && char::decode_utf16(self.0.iter().copied()).all(|c| match c {
                Ok(c) => c.to_lowercase().eq(std::iter::once(c)),
                Err(_) => true, // Preserve unpaired UTF-16 units, as the platform string does.
            })
    }
}
fn space(c: u16) -> bool {
    char::from_u32(u32::from(c)).is_some_and(char::is_whitespace)
}
pub(crate) fn integer(value: f64) -> Option<i64> {
    (value.is_finite() && (0.0..=MAX_SAFE_INTEGER).contains(&value) && value.floor() == value)
        .then_some(value as i64)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct WindowId(pub u64);
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Rect {
    pub(crate) fn valid_viewport(self) -> bool {
        [
            self.x,
            self.y,
            self.width,
            self.height,
            self.x + self.width,
            self.y + self.height,
        ]
        .into_iter()
        .all(f64::is_finite)
            && self.width > 0.0
            && self.height > 0.0
    }
    pub(crate) fn near(self, other: Self) -> bool {
        (self.x - other.x).abs() <= GEOMETRY_EPSILON
            && (self.y - other.y).abs() <= GEOMETRY_EPSILON
            && (self.width - other.width).abs() <= GEOMETRY_EPSILON
            && (self.height - other.height).abs() <= GEOMETRY_EPSILON
    }
    pub(crate) fn equivalent(self, other: Self, fuzzy_zero: bool) -> bool {
        let equal = |a: f64, b: f64| {
            if fuzzy_zero && (a == 0.0 || b == 0.0) {
                (a - b).abs() <= 1e-12
            } else {
                (a - b).abs() * 1e12 <= a.abs().min(b.abs())
            }
        };
        equal(self.x, other.x)
            && equal(self.y, other.y)
            && equal(self.width, other.width)
            && equal(self.height, other.height)
    }
    pub(crate) fn intersects(self, other: Self) -> bool {
        let edges = |x: f64, w: f64| if w < 0.0 { (x + w, x) } else { (x, x + w) };
        let (l1, r1) = edges(self.x, self.width);
        let (l2, r2) = edges(other.x, other.width);
        if l1 == r1 || l2 == r2 || l1 >= r2 || l2 >= r1 {
            return false;
        }
        let (t1, b1) = edges(self.y, self.height);
        let (t2, b2) = edges(other.y, other.height);
        !(t1 == b1 || t2 == b2 || t1 >= b2 || t2 >= b1)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    Visible,
    Parked,
    Invalid,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowRole {
    Continuing,
    Incoming,
    Outgoing,
}
#[derive(Clone, Debug)]
pub struct RuntimeContext {
    pub protocol: f64,
    pub session: Text,
    pub workspace: Text,
    pub output: Text,
    pub generation: f64,
}
#[derive(Clone, Debug)]
pub struct ScrollEntry {
    pub window_id: WindowId,
    pub column_id: f64,
    pub logical_x: f64,
    pub pixel_width: f64,
    pub old_placement: Placement,
    pub new_placement: Placement,
}
#[derive(Clone, Debug)]
pub struct ScrollPlan {
    pub shape_valid: bool,
    pub protocol: f64,
    pub kind: Text,
    pub session: Text,
    pub workspace: Text,
    pub output: Text,
    pub epoch: f64,
    pub issued_at: f64,
    pub old_offset: f64,
    pub new_offset: f64,
    // 0 absent, 1 false, 2 true, 3 wrong JSON type.
    pub retarget_only: u32,
    pub clip_partial: u32,
    pub viewport: Rect,
    pub entries: Vec<ScrollEntry>,
    // Opaque canonical envelope bytes, including extra fields; never parsed on a frame.
    pub fingerprint: Vec<u8>,
}
#[derive(Clone, Copy, Debug)]
pub struct ScrollProjection {
    pub translation_x: f64,
    pub viewport: Rect,
}
#[derive(Clone, Debug)]
pub struct RuntimeStatus {
    pub context: Option<Context>,
    pub epoch: Epoch,
    pub active: bool,
    pub completed: bool,
}

/// Native numeric epochs keep the full i64 range; JSON epochs separately use
/// the exact JavaScript integer range. NONE is never accepted as a new epoch.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Epoch(pub i64);
impl Epoch {
    pub const NONE: Self = Self(-1);
    pub fn from_json(value: f64) -> Result<Self, NativeError> {
        integer(value).map(Self).ok_or(NativeError::InvalidEpoch)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Generation(pub i64);
impl Generation {
    pub fn from_json(value: f64) -> Result<Self, NativeError> {
        integer(value).map(Self).ok_or(NativeError::InvalidEpoch)
    }
}
macro_rules! text_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
        pub struct $name(pub Text);
    };
}
text_id!(SessionId);
text_id!(WorkspaceId);
text_id!(OutputId);
// Wire names and per-handle numeric WindowId tokens are distinct identities.
// Scroll permits canonical non-UUID names; Ring requires a non-null UUID.
text_id!(WindowName);
impl std::borrow::Borrow<[u16]> for WindowName {
    fn borrow(&self) -> &[u16] {
        &self.0 .0
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Context {
    pub session: SessionId,
    pub workspace: WorkspaceId,
    pub output: OutputId,
    pub generation: Generation,
}
impl Context {
    pub fn scroll(raw: RuntimeContext) -> Result<Self, NativeError> {
        if raw.protocol != 2.0
            || !raw.session.valid()
            || !raw.workspace.valid()
            || !raw.output.valid()
        {
            return Err(NativeError::InvalidProtocol);
        }
        Ok(Self {
            session: SessionId(raw.session),
            workspace: WorkspaceId(raw.workspace),
            output: OutputId(raw.output),
            generation: Generation::from_json(raw.generation)?,
        })
    }
    pub fn matches(&self, plan: &ScrollPlan) -> bool {
        self.session.0 == plan.session
            && self.workspace.0 == plan.workspace
            && self.output.0 == plan.output
    }
    pub fn text(&self, field: u32) -> Option<&Text> {
        match field {
            0 => Some(&self.session.0),
            1 => Some(&self.workspace.0),
            2 => Some(&self.output.0),
            _ => None,
        }
    }
}
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeError {
    InvalidProtocol = 1,
    InvalidEpoch = 2,
    InvalidGeometry = 3,
    ContextMismatch = 4,
    UnknownWindow = 5,
    SequenceRejected = 6,
    InternalInvariant = 7,
}
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanDisposition {
    Rejected = 0,
    Duplicate = 1,
    Accepted = 2,
}
#[derive(Clone, Debug)]
pub struct ScrollSequence {
    pub context: Option<Context>,
    epoch: Epoch,
    fingerprint: Vec<u8>,
}
impl Default for ScrollSequence {
    fn default() -> Self {
        Self {
            context: None,
            epoch: Epoch::NONE,
            fingerprint: Vec::new(),
        }
    }
}
impl ScrollSequence {
    // Observer preserves authority on rejection. Runtime explicitly resets it
    // on invalid context, matching its separate fail-closed contract.
    pub fn update(&mut self, raw: RuntimeContext) -> Result<(), NativeError> {
        if raw.protocol == 1.0 {
            *self = Self::default();
            return Ok(());
        }
        let next = Context::scroll(raw)?;
        if let Some(old) = &self.context {
            if old.session == next.session && next.generation < old.generation {
                return Err(NativeError::SequenceRejected);
            }
            if old.session != next.session {
                self.epoch = Epoch::NONE;
                self.fingerprint.clear();
            }
        }
        self.context = Some(next);
        Ok(())
    }
    pub fn observe_validated(
        &mut self,
        validated: &mut ValidatedScrollPlan,
    ) -> Result<PlanDisposition, NativeError> {
        let plan = &mut validated.wire;
        if self
            .context
            .as_ref()
            .is_none_or(|context| !context.matches(plan))
        {
            return Err(NativeError::ContextMismatch);
        }
        let epoch = validated.epoch;
        if epoch < self.epoch {
            return Err(NativeError::SequenceRejected);
        }
        if epoch == self.epoch {
            return if plan.fingerprint == self.fingerprint {
                Ok(PlanDisposition::Duplicate)
            } else {
                Err(NativeError::SequenceRejected)
            };
        }
        // Consume before runtime geometry/clock checks, including failed arms.
        self.epoch = epoch;
        self.fingerprint = std::mem::take(&mut plan.fingerprint);
        Ok(PlanDisposition::Accepted)
    }
}

/// Owned validated plan. Only this type can cross the sequence barrier;
/// untrusted wire numbers stay in ScrollPlan until all checks have passed.
pub struct ValidatedScrollPlan {
    wire: ScrollPlan,
    epoch: Epoch,
    issued_at: i64,
}
impl ValidatedScrollPlan {
    pub fn new(wire: ScrollPlan, windows: &WindowRegistry) -> Result<Self, NativeError> {
        let epoch = Epoch::from_json(wire.epoch)?;
        let issued_at = integer(wire.issued_at).ok_or(NativeError::InvalidEpoch)?;
        if !valid_scroll_plan(&wire, windows) {
            return Err(NativeError::InvalidProtocol);
        }
        Ok(Self {
            wire,
            epoch,
            issued_at,
        })
    }
    pub fn epoch(&self) -> Epoch {
        self.epoch
    }
    pub fn issued_at(&self) -> i64 {
        self.issued_at
    }
    pub fn into_wire(self) -> ScrollPlan {
        self.wire
    }
}

pub fn valid_scroll_plan(plan: &ScrollPlan, windows_registry: &WindowRegistry) -> bool {
    if !plan.shape_valid
        || plan.protocol != 2.0
        || plan.kind != Text::from_utf8("SCROLL")
        || !plan.session.valid()
        || !plan.workspace.valid()
        || !plan.output.valid()
        || integer(plan.epoch).is_none()
        || integer(plan.issued_at).is_none()
        || !plan.old_offset.is_finite()
        || plan.old_offset < 0.0
        || !plan.new_offset.is_finite()
        || plan.new_offset < 0.0
        || plan.clip_partial > 2
        || plan.retarget_only > 2
        || (plan.old_offset == plan.new_offset) != (plan.retarget_only == 2)
        || !plan.viewport.valid_viewport()
        || plan.entries.is_empty()
        || plan.entries.len() > 256
    {
        return false;
    }
    let mut windows = HashSet::new();
    let mut columns = HashSet::new();
    for entry in &plan.entries {
        let Some(column) = integer(entry.column_id) else {
            return false;
        };
        if !windows_registry
            .label(entry.window_id)
            .is_some_and(Text::canonical_window)
            || !windows.insert(entry.window_id)
            || !columns.insert(column)
            || !entry.logical_x.is_finite()
            || entry.logical_x < 0.0
            || !entry.pixel_width.is_finite()
            || entry.pixel_width <= 0.0
            || !(entry.logical_x + entry.pixel_width).is_finite()
        {
            return false;
        }
        for (offset, placement) in [
            (plan.old_offset, entry.old_placement),
            (plan.new_offset, entry.new_placement),
        ] {
            let left = plan.viewport.x + entry.logical_x - offset;
            let right = left + entry.pixel_width;
            if !left.is_finite() || !right.is_finite() {
                return false;
            }
            let expected = if if plan.clip_partial == 2 {
                left < plan.viewport.x + plan.viewport.width && right > plan.viewport.x
            } else {
                left >= plan.viewport.x && right <= plan.viewport.x + plan.viewport.width
            } {
                Placement::Visible
            } else {
                Placement::Parked
            };
            if placement != expected {
                return false;
            }
        }
        if entry.old_placement == Placement::Parked && entry.new_placement == Placement::Parked {
            return false;
        }
    }
    true
}

/// Per-handle stable window tokens. Shared by runtime and protocol observer;
/// frame queries never convert strings. Removing a name never reuses its token.
#[derive(Clone, Debug, Default)]
pub struct WindowRegistry {
    next: u64,
    names: HashMap<WindowName, WindowId>,
    labels: HashMap<WindowId, WindowName>,
}
impl WindowRegistry {
    pub fn intern(&mut self, text: Text) -> WindowId {
        if let Some(id) = self.names.get(text.0.as_slice()) {
            return *id;
        }
        self.next += 1;
        let id = WindowId(self.next);
        let name = WindowName(text);
        self.names.insert(name.clone(), id);
        self.labels.insert(id, name);
        id
    }
    pub fn label(&self, id: WindowId) -> Option<&Text> {
        self.labels.get(&id).map(|name| &name.0)
    }
    pub fn remove(&mut self, id: WindowId) {
        if let Some(name) = self.labels.remove(&id) {
            self.names.remove(&name);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn json_epochs_and_native_epochs_have_distinct_ranges() {
        for bad in [-1.0, 0.5, f64::NAN, f64::INFINITY, MAX_SAFE_INTEGER + 1.0] {
            assert!(Epoch::from_json(bad).is_err());
        }
        assert_eq!(
            Epoch::from_json(MAX_SAFE_INTEGER),
            Ok(Epoch(9_007_199_254_740_991))
        );
        let mut motion =
            crate::viewport_motion::ViewportMotion::new(crate::spring::SpringParams::default());
        assert!(motion.start(0.0, 1.0, i64::MAX, 0));
        assert_eq!(motion.sample(0).epoch, i64::MAX);
    }
}
