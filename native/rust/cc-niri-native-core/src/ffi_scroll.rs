// SPDX-License-Identifier: GPL-2.0-or-later
use super::protocol_views::{slice, text, ByteView, FfiIdResult, FfiRect, FfiTextResult, U16View};
use super::{FfiSpringBoolResult, INVALID_HANDLE, OK};
use crate::native_protocol::{
    PartialScrollConfig, Placement, Rect, RuntimeContext, ScrollEntry, ScrollPlan, WindowId,
    WindowRole,
};
use crate::scroll_runtime::ScrollViewportRuntime;
use std::collections::HashMap;
const INVALID_DTO: u32 = 2;
#[repr(C)]
pub struct FfiGeometryEntry {
    window_id: u64,
    column_id: f64,
    old_logical_x: f64,
    new_logical_x: f64,
    old_width: f64,
    new_width: f64,
    old_frame: FfiRect,
    old_visual: FfiRect,
    target_frame: FfiRect,
    source_kind: u32,
    old_placement: u32,
    new_placement: u32,
    reserved: u32,
}
#[repr(C)]
pub struct FfiGeometryPlan {
    plan: FfiPlan,
    old_layout: FfiRect,
    layout: FfiRect,
    old_max_camera: f64,
    max_camera: f64,
    scope_revision: f64,
    source_epoch: f64,
    source_serial: f64,
    entries: *const FfiGeometryEntry,
    entries_len: u64,
}
pub(super) unsafe fn decode_geometry(
    p: &FfiGeometryPlan,
) -> Result<crate::column_geometry::ColumnGeometryPlan, u32> {
    use crate::column_geometry::{ColumnGeometryEntry, ColumnGeometryPlan};
    if p.entries_len > 256
        || p.plan.entries_len != 0
        || p.plan.fingerprint.len > 256 * 1024
        || p.plan.shape_valid > 1
    {
        return Err(INVALID_DTO);
    }
    let mut entries = Vec::with_capacity(p.entries_len as usize);
    for e in unsafe { slice(p.entries, p.entries_len)? } {
        if e.reserved != 0 || !(1..=3).contains(&e.source_kind) {
            return Err(INVALID_DTO);
        }
        let painted = e.source_kind != 2;
        if !painted && (e.old_logical_x != 0.0 || Rect::from(e.old_visual) != Rect::default()) {
            return Err(INVALID_DTO);
        }
        entries.push(ColumnGeometryEntry {
            window_id: WindowId(e.window_id),
            column_id: e.column_id,
            old_logical_x: painted.then_some(e.old_logical_x),
            source_culled: e.source_kind == 3,
            new_logical_x: e.new_logical_x,
            old_width: e.old_width,
            new_width: e.new_width,
            old_frame: e.old_frame.into(),
            old_visual: painted.then_some(e.old_visual.into()),
            target_frame: e.target_frame.into(),
            old_placement: placement(e.old_placement),
            new_placement: placement(e.new_placement),
        });
    }
    Ok(ColumnGeometryPlan {
        header: unsafe { decode_plan(&p.plan)? },
        old_layout: p.old_layout.into(),
        layout: p.layout.into(),
        old_max_camera: p.old_max_camera,
        max_camera: p.max_camera,
        scope_revision: p.scope_revision,
        source_epoch: p.source_epoch,
        source_serial: p.source_serial,
        entries,
    })
}
// Source rows contain actual KWin observations, not echoed wire geometry.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiGeometrySourceRow {
    window_id: u64,
    column_id: f64,
    frame: FfiRect,
    opacity: f64,
    flags: u32,
    reserved: u32,
}
unsafe fn geometry_requests(
    rows: *const FfiGeometrySourceRow,
    len: u64,
) -> Result<Vec<crate::scroll_runtime::GeometrySourceRequest>, u32> {
    if len > 512 {
        return Err(INVALID_DTO);
    }
    let mut seen = std::collections::HashSet::new();
    unsafe { slice(rows, len)? }
        .iter()
        .map(|r| {
            if r.reserved != 0 || r.flags & !127 != 0 || !seen.insert(r.window_id) {
                return Err(INVALID_DTO);
            }
            Ok(crate::scroll_runtime::GeometrySourceRequest {
                id: WindowId(r.window_id),
                column_id: r.column_id,
                fact: crate::scroll_runtime::GeometryClientFact {
                    frame: r.frame.into(),
                    opacity: r.opacity,
                    flags: r.flags,
                },
            })
        })
        .collect()
}
/// # Safety
/// Live exclusive handle; all borrowed plan/observation buffers remain live for
/// this synchronous call. Fresh platform observations must not be wire echoes.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_arm_geometry(
    handle: *mut ScrollHandle,
    plan: *const FfiGeometryPlan,
    now: i64,
    rows: *const FfiGeometrySourceRow,
    len: u64,
    smooth: u32,
    actual_output: FfiRect,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let p = unsafe { plan.as_ref() }.ok_or(INVALID_DTO)?;
        if smooth > 1 {
            return Err(INVALID_DTO);
        }
        Ok(h.0.arm_geometry(
            unsafe { decode_geometry(p)? },
            now,
            &unsafe { geometry_requests(rows, len)? },
            smooth != 0,
            actual_output.into(),
        ))
    })())
}
#[repr(C)]
pub struct FfiGeometrySourceStatus {
    viewport: FfiRect,
    layout: FfiRect,
    max_camera: f64,
    scope_revision: f64,
    camera_x: f64,
    epoch: i64,
    time_ns: i64,
    serial: u64,
    count: u32,
    valid: u32,
    status: u32,
    reserved: u32,
}
/// # Safety
/// Exclusively borrowed live handle, initialized input rows and exclusive writable
/// output for capacity elements. Inputs/outputs do not overlap. No pointers retained;
/// a single owned observation is retained until replacement or clear.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_geometry_source(
    handle: *mut ScrollHandle,
    rows: *const FfiGeometrySourceRow,
    len: u64,
    actual_output: FfiRect,
    actual_workspace: U16View,
    actual_name: U16View,
    out: *mut FfiClientPaint,
    capacity: u64,
) -> FfiGeometrySourceStatus {
    let mut result = FfiGeometrySourceStatus {
        viewport: Rect::default().into(),
        layout: Rect::default().into(),
        max_camera: 0.0,
        scope_revision: 0.0,
        camera_x: 0.0,
        epoch: -1,
        time_ns: -1,
        serial: 0,
        count: 0,
        valid: 0,
        status: INVALID_HANDLE,
        reserved: 0,
    };
    let Some(h) = (unsafe { handle.as_mut() }) else {
        return result;
    };
    result.status = INVALID_DTO;
    if capacity < len || capacity > 256 || out.is_null() || len > 256 {
        return result;
    }
    let requests = match unsafe { geometry_requests(rows, len) } {
        Ok(r) => r,
        Err(_) => return result,
    };
    result.status = OK;
    if actual_workspace.len > 256 || actual_name.len > 256 {
        result.status = INVALID_DTO;
        return result;
    }
    let (Ok(workspace), Ok(name)) = (
        unsafe { slice(actual_workspace.data, actual_workspace.len) },
        unsafe { slice(actual_name.data, actual_name.len) },
    ) else {
        result.status = INVALID_DTO;
        return result;
    };
    if h.0
        .context()
        .is_none_or(|c| c.workspace.0 .0 != workspace || c.output.0 .0 != name)
    {
        return result;
    }
    let Some(source) = h.0.query_geometry_source(&requests, actual_output.into()) else {
        return result;
    };
    result.viewport = source.viewport.into();
    result.layout = source.layout.into();
    result.max_camera = source.max_camera;
    result.scope_revision = source.scope_revision;
    result.camera_x = source.camera_x;
    result.epoch = source.epoch;
    result.time_ns = source.time_ns;
    result.serial = source.serial;
    for (index, r) in requests.iter().enumerate() {
        let f = source.rows[&r.id];
        let value = FfiClientPaint {
            frame: f.frame.into(),
            visual: f.visual.unwrap_or_default().into(),
            viewport: result.viewport,
            layout: result.layout,
            max_camera: source.max_camera,
            scope_revision: source.scope_revision,
            column_id: f.column_id,
            logical_x: f
                .visual
                .map_or(0.0, |v| v.x + source.camera_x - source.layout.x),
            velocity_x: f.velocity_x,
            velocity_y: f.velocity_y,
            epoch: source.epoch,
            time_ns: source.time_ns,
            serial: source.serial,
            active: if f.hidden {
                2
            } else if f.culled {
                3
            } else {
                1
            },
            status: OK,
        };
        unsafe {
            out.add(index).write(value);
        }
    }
    result.count = len as u32;
    result.valid = 1;
    result
}
#[repr(C)]
pub struct FfiGeometryProjection {
    viewport: FfiRect,
    translation_x: f64,
    translation_y: f64,
    active: u32,
    status: u32,
}
/// # Safety
/// Live shared handle, scalar observed geometry. Read-only allocation-free query.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_geometry_projection(
    handle: *const ScrollHandle,
    id: u64,
    frame: FfiRect,
) -> FfiGeometryProjection {
    let mut r = FfiGeometryProjection {
        viewport: Rect::default().into(),
        translation_x: 0.0,
        translation_y: 0.0,
        active: 0,
        status: INVALID_HANDLE,
    };
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return r;
    };
    r.status = OK;
    if let Some(p) = h.0.geometry_projection(WindowId(id), frame.into()) {
        r.viewport = p.viewport.into();
        r.translation_x = p.translation_x;
        r.translation_y = p.translation_y;
        r.active = 1;
    }
    r
}
/// # Safety
/// Live exclusive handle; called from actual configure geometry observations.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_observe_client_frame(
    handle: *mut ScrollHandle,
    id: u64,
    frame: FfiRect,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_mut() }
            .ok_or(INVALID_HANDLE)
            .map(|h| h.0.observe_client_frame(WindowId(id), frame.into())),
    )
}
/// # Safety
/// Live exclusive handle; rows are valid initialized platform observations of
/// this bound real output pass, borrowed for this call only.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_finish_geometry_frame(
    handle: *mut ScrollHandle,
    epoch: i64,
    time: i64,
    serial: u64,
    rows: *const FfiGeometrySourceRow,
    len: u64,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        if len > 256 {
            return Err(INVALID_DTO);
        }
        for r in unsafe { slice(rows, len)? } {
            if r.reserved != 0 || r.flags & !127 != 0 {
                return Err(INVALID_DTO);
            }
            let request = crate::scroll_runtime::GeometrySourceRequest {
                id: WindowId(r.window_id),
                column_id: r.column_id,
                fact: crate::scroll_runtime::GeometryClientFact {
                    frame: r.frame.into(),
                    opacity: r.opacity,
                    flags: r.flags,
                },
            };
            h.0.observe_geometry_cull(epoch, time, serial, request);
        }
        Ok(h.0.finish_geometry_frame(epoch, time, serial, &[]))
    })())
}
#[repr(C)]
pub struct FfiGeometryCompletion {
    epoch: i64,
    time_ns: i64,
    serial: u64,
    scope_revision: f64,
    active: u32,
    completed: u32,
    status: u32,
    reserved: u32,
}
/// # Safety
/// Live shared handle; read-only allocation-free typed completion proof.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_geometry_completion(
    handle: *const ScrollHandle,
) -> FfiGeometryCompletion {
    let mut r = FfiGeometryCompletion {
        epoch: -1,
        time_ns: -1,
        serial: 0,
        scope_revision: 0.0,
        active: 0,
        completed: 0,
        status: INVALID_HANDLE,
        reserved: 0,
    };
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return r;
    };
    r.status = OK;
    if h.0.column_geometry_active() {
        r.active = 1;
        r.epoch = h.0.epoch();
        r.time_ns = h.0.frame_sample(true).map_or(-1, |s| s.time_ns);
        r.scope_revision = h.0.partial_config().map_or(0.0, |p| p.scope_revision);
        r.serial = h.0.geometry_completion_serial();
        r.completed = u32::from(h.0.completed() && r.serial > 0);
    }
    r
}
/// # Safety
/// Live shared handle; allocation-free last-pass proof, no platform objects.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_frame_ready(
    handle: *const ScrollHandle,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_ref() }
            .ok_or(INVALID_HANDLE)
            .map(|h| h.0.client_source_complete()),
    )
}
/// # Safety
/// Live shared runtime; numerical continuation demand, no independent clock.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_needs_repaint(
    handle: *const ScrollHandle,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_ref() }
            .ok_or(INVALID_HANDLE)
            .map(|h| h.0.needs_repaint()),
    )
}
#[repr(C)]
pub struct FfiContext {
    pub(super) protocol: f64,
    pub(super) generation: f64,
    pub(super) session: U16View,
    pub(super) workspace: U16View,
    pub(super) output: U16View,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiEntry {
    window_id: u64,
    column_id: f64,
    logical_x: f64,
    pixel_width: f64,
    old_placement: u32,
    new_placement: u32,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiWindowFrame {
    window_id: u64,
    rect: FfiRect,
}
#[repr(C)]
pub struct FfiPlan {
    protocol: f64,
    epoch: f64,
    issued_at: f64,
    old_offset: f64,
    new_offset: f64,
    kind: U16View,
    session: U16View,
    workspace: U16View,
    output: U16View,
    viewport: FfiRect,
    entries: *const FfiEntry,
    entries_len: u64,
    fingerprint: ByteView,
    shape_valid: u32,
    retarget_only: u32,
    clip_partial: u32,
}
#[repr(C)]
pub struct FfiReindexPlan {
    pub(super) plan: FfiPlan,
    pub(super) source_id: u64,
    pub(super) source_logical_x: f64,
}
#[repr(C)]
pub struct FfiPartialPlan {
    pub(super) plan: FfiPlan,
    layout: FfiRect,
    max_offset: f64,
    scope_revision: f64,
}
pub(super) unsafe fn decode_partial(p: &FfiPartialPlan) -> Result<ScrollPlan, u32> {
    let mut plan = unsafe { decode_plan(&p.plan)? };
    plan.partial = Some(PartialScrollConfig {
        layout: p.layout.into(),
        max_offset: p.max_offset,
        scope_revision: p.scope_revision,
    });
    Ok(plan)
}
/// # Safety
/// Live exclusive runtime, typed plan and all borrowed nested buffers.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_arm_partial(
    handle: *mut ScrollHandle,
    plan: *const FfiPartialPlan,
    now: i64,
    frames: *const FfiWindowFrame,
    frames_len: u64,
    smooth: u32,
    actual_output: FfiRect,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let p = unsafe { plan.as_ref() }.ok_or(INVALID_DTO)?;
        if smooth > 1 {
            return Err(INVALID_DTO);
        }
        let physical: HashMap<_, _> = unsafe { slice(frames, frames_len)? }
            .iter()
            .map(|f| (WindowId(f.window_id), f.rect.into()))
            .collect();
        if physical.len() as u64 != frames_len {
            return Err(INVALID_DTO);
        }
        Ok(h.0.arm_partial(
            unsafe { decode_partial(p)? },
            now,
            &physical,
            smooth != 0,
            actual_output.into(),
        ))
    })())
}
/// # Safety
/// Live shared runtime; platform frame and pointer coordinates are copied values.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_partial_blocked(
    handle: *const ScrollHandle,
    id: u64,
    frame: FfiRect,
    x: f64,
    y: f64,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_ref() }
            .ok_or(INVALID_HANDLE)
            .map(|h| h.0.partial_input_blocked(WindowId(id), frame.into(), x, y)),
    )
}
/// # Safety
/// Shared live handle, synchronous allocation-free input query.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_partial_ambiguous(
    handle: *const ScrollHandle,
    x: f64,
    y: f64,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_ref() }.ok_or(INVALID_HANDLE)?;
        if !x.is_finite() || !y.is_finite() {
            return Err(INVALID_DTO);
        }
        Ok(h.0.partial_point_ambiguous(x, y))
    })())
}
/// # Safety
/// Live shared runtime. Returns a stable window token, never a platform pointer.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_partial_hit(
    handle: *const ScrollHandle,
    x: f64,
    y: f64,
) -> FfiIdResult {
    super::protocol_views::id_result(
        unsafe { handle.as_ref() }
            .ok_or(INVALID_HANDLE)
            .map(|h| h.0.partial_hit(x, y).map_or(0, |id| id.0)),
    )
}
#[repr(C)]
pub struct FfiPartialInputResult {
    consume: u32,
    focus: u32,
    status: u32,
    reserved: u32,
}
/// # Safety
/// Live exclusive runtime. kind/id/flags are platform facts, not injected events.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_partial_input(
    handle: *mut ScrollHandle,
    kind: u32,
    id: u64,
    blocked: u32,
    flags: u32,
) -> FfiPartialInputResult {
    let Some(h) = (unsafe { handle.as_mut() }) else {
        return FfiPartialInputResult {
            consume: 0,
            focus: 0,
            status: INVALID_HANDLE,
            reserved: 0,
        };
    };
    if kind > 12 || blocked > 1 || flags > 7 {
        return FfiPartialInputResult {
            consume: 0,
            focus: 0,
            status: INVALID_DTO,
            reserved: 0,
        };
    }
    let (consume, focus) = h.0.partial_input.event(kind, id, blocked != 0, flags);
    FfiPartialInputResult {
        consume: u32::from(consume),
        focus: u32::from(focus),
        status: OK,
        reserved: 0,
    }
}
#[repr(C)]
pub struct FfiPartialStatus {
    scope_revision: f64,
    buttons: u32,
    touches: u32,
    enabled: u32,
    status: u32,
    native_grab: u32,
    reserved: u32,
}
/// # Safety
/// Live shared runtime. Pair ownership survives clear, cancel, retarget and remove.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_partial_status(
    handle: *const ScrollHandle,
) -> FfiPartialStatus {
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiPartialStatus {
            scope_revision: 0.0,
            buttons: 0,
            touches: 0,
            enabled: 0,
            status: INVALID_HANDLE,
            native_grab: 0,
            reserved: 0,
        };
    };
    let (buttons, touches) = h.0.partial_input.pending();
    let partial = h.0.partial_config();
    FfiPartialStatus {
        scope_revision: partial.map_or(0.0, |p| p.scope_revision),
        buttons,
        touches,
        enabled: u32::from(partial.is_some()),
        status: OK,
        native_grab: u32::from(h.0.partial_input.preserves_native_grab()),
        reserved: 0,
    }
}
#[repr(C)]
pub struct FfiScrollStatus {
    epoch: i64,
    active: u32,
    completed: u32,
    status: u32,
    reserved: u32,
}

#[repr(C)]
pub struct FfiProjection {
    viewport: FfiRect,
    translation_x: f64,
    active: u32,
    status: u32,
}

#[repr(C)]
pub struct FfiScrollSample {
    position: f64,
    velocity: f64,
    target: f64,
    time_ns: i64,
    epoch: i64,
    valid: u32,
    completed: u32,
    status: u32,
    reserved: u32,
}

#[repr(C)]
pub struct FfiClientPaint {
    frame: FfiRect,
    visual: FfiRect,
    viewport: FfiRect,
    layout: FfiRect,
    max_camera: f64,
    scope_revision: f64,
    column_id: f64,
    logical_x: f64,
    velocity_x: f64,
    velocity_y: f64,
    epoch: i64,
    time_ns: i64,
    serial: u64,
    active: u32,
    status: u32,
}
/// # Safety
/// Live exclusive runtime; facts are from a real client paint on the bound
/// output/pass. No borrowed buffers survive this synchronous call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_record_client_painted(
    handle: *mut ScrollHandle,
    id: u64,
    epoch: i64,
    time_ns: i64,
    serial: u64,
    frame: FfiRect,
) -> FfiSpringBoolResult {
    bool_result(unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE).map(|h| {
        h.0.record_client_painted(WindowId(id), epoch, time_ns, serial, frame.into())
    }))
}
/// # Safety
/// Live shared runtime. Read-only, allocation-free actual per-client fact query.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_client_paint(
    handle: *const ScrollHandle,
    id: u64,
) -> FfiClientPaint {
    let mut result = FfiClientPaint {
        frame: Rect::default().into(),
        visual: Rect::default().into(),
        viewport: Rect::default().into(),
        layout: Rect::default().into(),
        max_camera: 0.0,
        scope_revision: 0.0,
        column_id: 0.0,
        logical_x: 0.0,
        velocity_x: 0.0,
        velocity_y: 0.0,
        epoch: -1,
        time_ns: -1,
        serial: 0,
        active: 0,
        status: INVALID_HANDLE,
    };
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return result;
    };
    result.status = OK;
    if let Some(p) = h.0.client_paint(WindowId(id)) {
        let (Some(config), Some(projection)) =
            (h.0.partial_config(), h.0.projection(WindowId(id), p.frame))
        else {
            return result;
        };
        result.viewport = projection.viewport.into();
        result.layout = config.layout.into();
        result.max_camera = config.max_offset;
        result.scope_revision = config.scope_revision;
        result.frame = p.frame.into();
        result.visual = p.visual.into();
        result.column_id = p.column_id;
        result.logical_x = p.logical_x;
        result.velocity_x = p.velocity_x;
        result.velocity_y = p.velocity_y;
        result.epoch = p.epoch;
        result.time_ns = p.time_ns;
        result.serial = p.serial;
        result.active = 1;
    }
    result
}
/// # Safety
/// Live shared runtime and initialized borrowed UTF-16 buffers for this call.
/// Does not imply COLUMN_GEOMETRY arm support; no borrowed data is retained.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_client_source_complete(
    handle: *const ScrollHandle,
    actual_output: FfiRect,
    actual_workspace: U16View,
    actual_output_name: U16View,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_ref() }.ok_or(INVALID_HANDLE)?;
        if actual_workspace.len > 256 || actual_output_name.len > 256 {
            return Err(INVALID_DTO);
        }
        let workspace = unsafe { slice(actual_workspace.data, actual_workspace.len)? };
        let output_name = unsafe { slice(actual_output_name.data, actual_output_name.len)? };
        Ok(h.0.client_source_matches(actual_output.into(), workspace, output_name))
    })())
}

/// Unique owned state; no concurrent mutation or aliasing with borrowed output.
pub struct ScrollHandle(ScrollViewportRuntime);
// SAFETY contract for all exported entries: slices are aligned live buffers of
// the stated size for the call; non-null handles are live library allocations.
fn bool_result(value: Result<bool, u32>) -> FfiSpringBoolResult {
    match value {
        Ok(value) => FfiSpringBoolResult {
            value: u32::from(value),
            status: OK,
        },
        Err(status) => FfiSpringBoolResult { value: 0, status },
    }
}
fn placement(value: u32) -> Placement {
    match value {
        1 => Placement::Visible,
        2 => Placement::Parked,
        _ => Placement::Invalid,
    }
}
#[no_mangle]
pub extern "C" fn cc_niri_scroll_create(fuzzy_zero: u32) -> *mut ScrollHandle {
    Box::into_raw(Box::new(ScrollHandle(ScrollViewportRuntime::new(
        fuzzy_zero != 0,
    ))))
}
/// # Safety
/// Handle must be live and shared-borrowed for this call; null is supported.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_clone(handle: *const ScrollHandle) -> *mut ScrollHandle {
    match unsafe { handle.as_ref() } {
        Some(h) => Box::into_raw(Box::new(ScrollHandle(h.0.clone_for_paint()))),
        None => std::ptr::null_mut(),
    }
}
/// # Safety
/// Transfer each uniquely-owned handle once, after all borrows end.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_destroy(handle: *mut ScrollHandle) {
    if !handle.is_null() {
        unsafe {
            drop(Box::from_raw(handle));
        }
    }
}
/// # Safety
/// Live handles, exclusive destination borrow; self-copy supported.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_copy(
    destination: *mut ScrollHandle,
    source: *const ScrollHandle,
) -> u32 {
    if destination.is_null() || source.is_null() {
        return INVALID_HANDLE;
    }
    if !std::ptr::eq(destination, source) {
        unsafe {
            (*destination).0 = (*source).0.clone_for_paint();
        }
    }
    OK
}
/// # Safety
/// Live exclusively-borrowed handle and valid borrowed UTF-16 input.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_intern(
    handle: *mut ScrollHandle,
    name: U16View,
) -> FfiIdResult {
    let result = (|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let name = unsafe { text(name)? };
        Ok::<_, u32>(h.0.intern(name).0)
    })();
    match result {
        Ok(value) => FfiIdResult {
            value,
            status: OK,
            reserved: 0,
        },
        Err(status) => FfiIdResult {
            value: 0,
            status,
            reserved: 0,
        },
    }
}
/// # Safety
/// Live exclusively-borrowed handle, context and all nested buffers for the call.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_update_context(
    handle: *mut ScrollHandle,
    context: *const FfiContext,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        let c = unsafe { context.as_ref() }.ok_or(INVALID_DTO)?;
        let c = RuntimeContext {
            protocol: c.protocol,
            generation: c.generation,
            session: unsafe { text(c.session)? },
            workspace: unsafe { text(c.workspace)? },
            output: unsafe { text(c.output)? },
        };
        Ok(h.0.update_context(c))
    })())
}
pub(super) unsafe fn decode_plan(p: &FfiPlan) -> Result<ScrollPlan, u32> {
    let entries = unsafe { slice(p.entries, p.entries_len)? }
        .iter()
        .map(|e| ScrollEntry {
            window_id: WindowId(e.window_id),
            column_id: e.column_id,
            logical_x: e.logical_x,
            pixel_width: e.pixel_width,
            old_placement: placement(e.old_placement),
            new_placement: placement(e.new_placement),
        })
        .collect();
    let plan = ScrollPlan {
        shape_valid: p.shape_valid != 0,
        protocol: p.protocol,
        kind: unsafe { text(p.kind)? },
        session: unsafe { text(p.session)? },
        workspace: unsafe { text(p.workspace)? },
        output: unsafe { text(p.output)? },
        epoch: p.epoch,
        issued_at: p.issued_at,
        old_offset: p.old_offset,
        new_offset: p.new_offset,
        retarget_only: p.retarget_only,
        clip_partial: p.clip_partial,
        viewport: p.viewport.into(),
        partial: None,
        entries,
        fingerprint: unsafe { slice(p.fingerprint.data, p.fingerprint.len)? }.to_vec(),
    };
    Ok(plan)
}
/// # Safety
/// Live exclusively-borrowed handle, plan, entries, frames and nested buffers.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_arm(
    handle: *mut ScrollHandle,
    plan: *const FfiPlan,
    now: i64,
    frames: *const FfiWindowFrame,
    frames_len: u64,
) -> FfiSpringBoolResult {
    unsafe { cc_niri_scroll_arm_with_policy(handle, plan, now, frames, frames_len, 0) }
}
/// # Safety
/// Same live exclusive handle and borrowed DTO buffers as cc_niri_scroll_arm.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_arm_with_policy(
    handle: *mut ScrollHandle,
    plan: *const FfiPlan,
    now: i64,
    frames: *const FfiWindowFrame,
    frames_len: u64,
    smooth: u32,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        if smooth > 1 {
            return Err(INVALID_DTO);
        }
        let p = unsafe { plan.as_ref() }.ok_or(INVALID_DTO)?;
        let p = unsafe { decode_plan(p)? };
        let frames: HashMap<_, _> = unsafe { slice(frames, frames_len)? }
            .iter()
            .map(|f| (WindowId(f.window_id), f.rect.into()))
            .collect();
        Ok(h.0.arm_with_policy(p, now, &frames, smooth != 0))
    })())
}
/// # Safety
/// Live exclusive handle and synchronous borrowed reindex DTO/frames buffers.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_arm_reindex(
    handle: *mut ScrollHandle,
    plan: *const FfiReindexPlan,
    now: i64,
    frames: *const FfiWindowFrame,
    frames_len: u64,
    smooth: u32,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        if smooth > 1 {
            return Err(INVALID_DTO);
        }
        let p = unsafe { plan.as_ref() }.ok_or(INVALID_DTO)?;
        let wire = unsafe { decode_plan(&p.plan)? };
        let frames = unsafe { slice(frames, frames_len)? }
            .iter()
            .map(|f| (WindowId(f.window_id), f.rect.into()))
            .collect();
        Ok(h.0.arm_reindex(
            wire,
            WindowId(p.source_id),
            p.source_logical_x,
            now,
            &frames,
            smooth != 0,
        ))
    })())
}
#[repr(C)]
#[derive(Default)]
pub struct FfiRetargetStatus {
    degraded: u64,
    carried: u64,
    braked: u64,
    kept: u64,
    no_space: u64,
    invalid_math: u64,
    coverage: u64,
    initial_velocity: f64,
    saved_velocity: f64,
    brake_ms: f64,
    brake_distance: f64,
    lower: f64,
    upper: f64,
    strategy: u32,
    reason: u32,
    status: u32,
    reserved: u32,
}
/// # Safety
/// Live shared handle; returns a value DTO without sampling time or allocation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_retarget_status(
    handle: *const ScrollHandle,
) -> FfiRetargetStatus {
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiRetargetStatus {
            status: INVALID_HANDLE,
            ..Default::default()
        };
    };
    let r = h.0.retarget_stats();
    let d = r.last;
    FfiRetargetStatus {
        degraded: r.degraded,
        carried: r.carried,
        braked: r.braked,
        kept: r.kept,
        no_space: r.reasons[1],
        invalid_math: r.reasons[2],
        coverage: r.reasons[3],
        initial_velocity: d.initial_velocity,
        saved_velocity: d.saved_velocity,
        brake_ms: d.brake_ns as f64 / 1e6,
        brake_distance: d.brake_distance,
        lower: d.lower,
        upper: d.upper,
        strategy: d.strategy as u32,
        reason: d.reason as u32,
        status: OK,
        reserved: 0,
    }
}
/// # Safety
/// Live exclusively-borrowed handle and borrowed UTF-16 input.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_cancel(
    handle: *mut ScrollHandle,
    session: U16View,
    epoch: i64,
) -> u32 {
    let result = (|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        h.0.cancel(&unsafe { text(session)? }, epoch);
        Ok::<_, u32>(())
    })();
    result.err().unwrap_or(OK)
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_clear(handle: *mut ScrollHandle) -> u32 {
    match unsafe { handle.as_mut() } {
        Some(h) => {
            h.0.clear();
            OK
        }
        None => INVALID_HANDLE,
    }
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_remove(handle: *mut ScrollHandle, id: u64) -> u32 {
    match unsafe { handle.as_mut() } {
        Some(h) => {
            h.0.remove(WindowId(id));
            OK
        }
        None => INVALID_HANDLE,
    }
}
/// # Safety
/// Live shared-borrowed handle, no concurrent mutation or destruction.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_input_blocked(
    handle: *const ScrollHandle,
    id: u64,
    x: f64,
    y: f64,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_ref() }.ok_or(INVALID_HANDLE)?;
        if !x.is_finite() || !y.is_finite() {
            return Err(INVALID_DTO);
        }
        Ok(h.0.input_blocked(WindowId(id), x, y))
    })())
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_advance(
    handle: *mut ScrollHandle,
    now: i64,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_mut() }
            .map(|h| h.0.advance(now))
            .ok_or(INVALID_HANDLE),
    )
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_prepare_frame(
    handle: *mut ScrollHandle,
    now: i64,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_mut() }
            .map(|h| h.0.prepare_frame(now))
            .ok_or(INVALID_HANDLE),
    )
}
/// # Safety
/// Live exclusively-borrowed handle. Facts belong to the actual target output;
/// invalid scale/rate fall back numerically, rather than failing the animation.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_prepare_frame_with_output(
    handle: *mut ScrollHandle,
    now: i64,
    output_valid: u32,
    scale: f64,
    refresh_hz: f64,
) -> FfiSpringBoolResult {
    bool_result((|| {
        let h = unsafe { handle.as_mut() }.ok_or(INVALID_HANDLE)?;
        if output_valid > 1 {
            return Err(INVALID_DTO);
        }
        Ok(h.0.prepare_frame_with_output(
            now,
            crate::scroll_visual::OutputFacts {
                valid: output_valid != 0,
                scale,
                refresh_hz,
            },
        ))
    })())
}

#[repr(C)]
pub struct FfiScrollTuningStatus {
    stiffness: f64,
    threshold_px: f64,
    output_scale: f64,
    refresh_hz: f64,
    visual_completed: u64,
    missing_output: u64,
    invalid_scale: u64,
    unknown_refresh: u64,
    smooth: u32,
    fallback: u32,
    status: u32,
    reserved: u32,
}
/// # Safety
/// Shared live handle; no clock reads or allocations. While active, queries
/// report the armed policy (partial plans stay legacy); otherwise configured.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_tuning_status(
    handle: *const ScrollHandle,
    configured_smooth: u32,
) -> FfiScrollTuningStatus {
    let mut result = FfiScrollTuningStatus {
        stiffness: 0.0,
        threshold_px: 0.0,
        output_scale: 0.0,
        refresh_hz: 0.0,
        visual_completed: 0,
        missing_output: 0,
        invalid_scale: 0,
        unknown_refresh: 0,
        smooth: 0,
        fallback: 0,
        status: OK,
        reserved: 0,
    };
    let Some(h) = (unsafe { handle.as_ref() }) else {
        result.status = INVALID_HANDLE;
        return result;
    };
    if configured_smooth > 1 {
        result.status = INVALID_DTO;
        return result;
    }
    let smooth = h.0.effective_smooth(configured_smooth != 0);
    result.stiffness = h.0.effective_stiffness(configured_smooth != 0);
    result.threshold_px = if smooth {
        crate::scroll_visual::VISUAL_THRESHOLD_PX
    } else {
        0.0
    };
    result.smooth = u32::from(smooth);
    result.fallback = if h.0.active() {
        h.0.visual_fallback as u32
    } else if smooth {
        crate::scroll_visual::VisualFallback::AwaitingFrame as u32
    } else {
        0
    };
    // Never export NaN/Inf into the platform's JSON status.
    let facts = h.0.output_facts;
    result.output_scale = if facts.scale.is_finite() {
        facts.scale
    } else {
        0.0
    };
    result.refresh_hz = if facts.refresh_hz.is_finite() {
        facts.refresh_hz
    } else {
        0.0
    };
    result.visual_completed = h.0.visual_completed;
    result.missing_output = h.0.visual_fallback_counts[0];
    result.invalid_scale = h.0.visual_fallback_counts[1];
    result.unknown_refresh = h.0.visual_fallback_counts[2];
    result
}
/// # Safety
/// Live exclusively-borrowed handle; null returns INVALID_HANDLE.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_mark_painted(
    handle: *mut ScrollHandle,
    epoch: i64,
    time_ns: i64,
) -> FfiSpringBoolResult {
    bool_result(
        unsafe { handle.as_mut() }
            .map(|h| h.0.mark_painted(epoch, time_ns))
            .ok_or(INVALID_HANDLE),
    )
}
/// # Safety
/// Live shared-borrowed handle. Queries never sample a clock or allocate.
/// painted=0 queries pending state, 1 the last paint anchor, 2 the arm origin.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_frame_sample(
    handle: *const ScrollHandle,
    painted: u32,
) -> FfiScrollSample {
    let mut result = FfiScrollSample {
        position: 0.0,
        velocity: 0.0,
        target: 0.0,
        time_ns: 0,
        epoch: -1,
        valid: 0,
        completed: 0,
        status: OK,
        reserved: 0,
    };
    let Some(h) = (unsafe { handle.as_ref() }) else {
        result.status = INVALID_HANDLE;
        return result;
    };
    if painted > 2 {
        result.status = INVALID_DTO;
    } else if let Some(sample) = if painted == 2 {
        h.0.origin_sample()
    } else {
        h.0.frame_sample(painted != 0)
    } {
        result.position = sample.motion.current;
        result.velocity = sample.motion.velocity;
        result.target = sample.motion.target;
        result.time_ns = sample.time_ns;
        result.epoch = sample.motion.epoch;
        result.valid = 1;
        result.completed =
            u32::from(sample.motion.kind == crate::viewport_motion::MotionKind::Static);
    }
    result
}
/// # Safety
/// Live shared-borrowed handle, no concurrent mutation or destruction.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_status(handle: *const ScrollHandle) -> FfiScrollStatus {
    match unsafe { handle.as_ref() } {
        Some(h) => FfiScrollStatus {
            epoch: h.0.epoch(),
            active: u32::from(h.0.active()),
            completed: u32::from(h.0.completed()),
            status: OK,
            reserved: u32::from(h.0.clips_partial())
                | (u32::from(h.0.column_geometry_active()) << 1),
        },
        None => FfiScrollStatus {
            epoch: -1,
            active: 0,
            completed: 0,
            status: INVALID_HANDLE,
            reserved: 0,
        },
    }
}
/// # Safety
/// Live shared-borrowed handle; return view valid until the next mutation/destroy.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_context_text(
    handle: *const ScrollHandle,
    field: u32,
) -> FfiTextResult {
    let empty = U16View {
        data: std::ptr::null(),
        len: 0,
    };
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiTextResult {
            value: empty,
            status: INVALID_HANDLE,
            reserved: 0,
        };
    };
    if field > 2 {
        return FfiTextResult {
            value: empty,
            status: INVALID_DTO,
            reserved: 0,
        };
    }
    let value = h.0.context().and_then(|c| c.text(field));
    FfiTextResult {
        value: value
            .map(|t| U16View {
                data: t.0.as_ptr(),
                len: t.0.len() as u64,
            })
            .unwrap_or(empty),
        status: OK,
        reserved: 0,
    }
}
/// # Safety
/// Live shared-borrowed handle, no concurrent mutation or destruction.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_projection(
    handle: *const ScrollHandle,
    id: u64,
    geometry: FfiRect,
) -> FfiProjection {
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiProjection {
            viewport: Rect::default().into(),
            translation_x: 0.0,
            active: 0,
            status: INVALID_HANDLE,
        };
    };
    match h.0.projection(WindowId(id), geometry.into()) {
        Some(p) => FfiProjection {
            viewport: p.viewport.into(),
            translation_x: p.translation_x,
            active: 1 | if h.0.partial_config().is_some() { 2 } else { 0 },
            status: OK,
        },
        None => FfiProjection {
            viewport: Rect::default().into(),
            translation_x: 0.0,
            active: 0,
            status: OK,
        },
    }
}
/// # Safety
/// Live shared-borrowed handle, no concurrent mutation or destruction.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_role(
    handle: *const ScrollHandle,
    id: u64,
) -> FfiSpringBoolResult {
    match unsafe { handle.as_ref() } {
        Some(h) => FfiSpringBoolResult {
            value: match h.0.role(WindowId(id)) {
                None => 0,
                Some(WindowRole::Continuing) => 1,
                Some(WindowRole::Incoming) => 2,
                Some(WindowRole::Outgoing) => 3,
            },
            status: OK,
        },
        None => FfiSpringBoolResult {
            value: 0,
            status: INVALID_HANDLE,
        },
    }
}
/// # Safety
/// Live shared-borrowed handle; out points to capacity writable initialized DTOs.
/// No mutation between the count query and fill call. Null/zero queries the count.
#[no_mangle]
pub unsafe extern "C" fn cc_niri_scroll_frames(
    handle: *const ScrollHandle,
    kind: u32,
    out: *mut FfiWindowFrame,
    capacity: u64,
) -> FfiIdResult {
    let Some(h) = (unsafe { handle.as_ref() }) else {
        return FfiIdResult {
            value: 0,
            status: INVALID_HANDLE,
            reserved: 0,
        };
    };
    let map = match kind {
        0 => h.0.targets(),
        1 => h.0.source_frames(),
        2 => h.0.visual_targets(),
        _ => {
            return FfiIdResult {
                value: 0,
                status: INVALID_DTO,
                reserved: 0,
            }
        }
    };
    let count = if kind == 2 {
        map.keys()
            .filter(|id| h.0.painted_target(**id).is_some())
            .count() as u64
    } else {
        map.len() as u64
    };
    if capacity == 0 {
        return FfiIdResult {
            value: count,
            status: OK,
            reserved: 0,
        };
    }
    if out.is_null() || capacity < count {
        return FfiIdResult {
            value: count,
            status: INVALID_DTO,
            reserved: 0,
        };
    }
    let mut index = 0;
    for (id, rect) in map {
        let rect = if kind == 2 {
            let Some(r) = h.0.painted_target(*id) else {
                continue;
            };
            r
        } else {
            *rect
        };
        unsafe {
            out.add(index).write(FfiWindowFrame {
                window_id: id.0,
                rect: rect.into(),
            });
        }
        index += 1;
    }
    FfiIdResult {
        value: count,
        status: OK,
        reserved: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_protocol::Text;
    #[test]
    fn partial_ffi_status_errors_and_pair_lifetime() {
        // SAFETY: Owned handles, explicit supported nulls and copied numeric DTOs.
        unsafe {
            let null = std::ptr::null_mut();
            assert_eq!(cc_niri_scroll_partial_status(null).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_partial_hit(null, 0.0, 0.0).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_scroll_partial_blocked(null, 0, Rect::default().into(), 0.0, 0.0).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_scroll_partial_input(null, 1, 272, 1, 0).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_scroll_arm_partial(
                    null,
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    0,
                    1,
                    Rect::default().into()
                )
                .status,
                INVALID_HANDLE
            );
            assert_eq!(std::mem::size_of::<FfiPartialPlan>(), 232);
            assert_eq!(std::mem::size_of::<FfiPartialInputResult>(), 16);
            assert_eq!(std::mem::size_of::<FfiPartialStatus>(), 32);
            let h = cc_niri_scroll_create(1);
            assert_eq!(
                cc_niri_scroll_arm_partial(
                    h,
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    0,
                    1,
                    Rect::default().into()
                )
                .status,
                INVALID_DTO
            );
            for (kind, blocked, flags) in [(13, 1, 0), (1, 2, 0), (1, 1, 8)] {
                assert_eq!(
                    cc_niri_scroll_partial_input(h, kind, 272, blocked, flags).status,
                    INVALID_DTO
                );
            }
            assert_eq!(cc_niri_scroll_partial_status(h).buttons, 0);
            let first = cc_niri_scroll_partial_input(h, 1, 272, 1, 0);
            assert_eq!((first.consume, first.focus, first.status), (1, 1, OK));
            cc_niri_scroll_clear(h);
            assert_eq!(cc_niri_scroll_partial_status(h).enabled, 0);
            assert_eq!(cc_niri_scroll_partial_status(h).buttons, 1);
            assert_eq!(cc_niri_scroll_partial_input(h, 2, 272, 0, 1).consume, 1);
            assert_eq!(cc_niri_scroll_partial_status(h).buttons, 0);
            assert_eq!(
                cc_niri_scroll_frames(h, 2, std::ptr::null_mut(), 0).value,
                0
            );
            cc_niri_scroll_destroy(h);
        }
    }

    #[test]
    fn ffi_null_buffers_ownership_and_counts() {
        // SAFETY: Explicitly supported nulls and owned handles; valid DTO buffers.
        unsafe {
            let null = std::ptr::null_mut();
            let empty = U16View {
                data: std::ptr::null(),
                len: 0,
            };
            assert!(cc_niri_scroll_clone(null).is_null());
            cc_niri_scroll_destroy(null);
            assert_eq!(cc_niri_scroll_copy(null, null), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_intern(null, empty).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_update_context(null, std::ptr::null()).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_scroll_arm(null, std::ptr::null(), 0, std::ptr::null(), 0).status,
                INVALID_HANDLE
            );
            assert_eq!(
                cc_niri_scroll_arm_reindex(null, std::ptr::null(), 0, std::ptr::null(), 0, 0)
                    .status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_scroll_cancel(null, empty, 0), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_clear(null), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_remove(null, 0), INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_advance(null, 0).status, INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_prepare_frame(null, 0).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_mark_painted(null, 0, 0).status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_scroll_frame_sample(null, 0).status, INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_retarget_status(null).status, INVALID_HANDLE);
            assert_eq!(cc_niri_scroll_tuning_status(null, 1).status, INVALID_HANDLE);
            assert_eq!(std::mem::size_of::<FfiScrollTuningStatus>(), 80);
            assert_eq!(std::mem::size_of::<FfiRetargetStatus>(), 120);
            assert_eq!(cc_niri_scroll_status(null).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_input_blocked(null, 1, 0.0, 0.0).status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_scroll_context_text(null, 0).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_projection(null, 0, Rect::default().into()).status,
                INVALID_HANDLE
            );
            assert_eq!(cc_niri_scroll_role(null, 0).status, INVALID_HANDLE);
            assert_eq!(
                cc_niri_scroll_frames(null, 0, std::ptr::null_mut(), 0).status,
                INVALID_HANDLE
            );
            let h = cc_niri_scroll_create(1);
            assert_eq!(
                cc_niri_scroll_arm_reindex(h, std::ptr::null(), 0, std::ptr::null(), 0, 0).status,
                INVALID_DTO
            );
            assert_eq!(std::mem::size_of::<FfiReindexPlan>(), 200);
            assert_eq!(cc_niri_scroll_tuning_status(h, 2).status, INVALID_DTO);
            assert_eq!(
                cc_niri_scroll_prepare_frame_with_output(h, 0, 2, 1.5, 60.0).status,
                INVALID_DTO
            );
            assert_eq!(cc_niri_scroll_frame_sample(h, 3).status, INVALID_DTO);
            assert_eq!(
                cc_niri_scroll_arm_with_policy(h, std::ptr::null(), 0, std::ptr::null(), 0, 2)
                    .status,
                INVALID_DTO
            );
            assert_eq!(cc_niri_scroll_prepare_frame(h, -1).value, 0);
            assert_eq!(cc_niri_scroll_mark_painted(h, 0, 0).value, 0);
            assert_eq!(
                cc_niri_scroll_input_blocked(h, 1, f64::NAN, 0.0).status,
                INVALID_DTO
            );
            assert_eq!(
                cc_niri_scroll_input_blocked(h, 1, 0.0, f64::INFINITY).status,
                INVALID_DTO
            );
            assert_eq!(
                cc_niri_scroll_intern(
                    h,
                    U16View {
                        data: std::ptr::null(),
                        len: 1
                    }
                )
                .status,
                INVALID_DTO
            );
            assert_eq!(
                cc_niri_scroll_update_context(h, std::ptr::null()).status,
                INVALID_DTO
            );
            assert_eq!(
                cc_niri_scroll_arm(h, std::ptr::null(), 0, std::ptr::null(), 0).status,
                INVALID_DTO
            );
            assert_eq!(cc_niri_scroll_context_text(h, 3).status, INVALID_DTO);
            assert_eq!(
                cc_niri_scroll_frames(h, 3, std::ptr::null_mut(), 0).status,
                INVALID_DTO
            );
            let label = Text::from_utf8("window");
            let name = U16View {
                data: label.0.as_ptr(),
                len: label.0.len() as u64,
            };
            let token = cc_niri_scroll_intern(h, name).value;
            let t = Text::from_utf8("s");
            (*h).0.update_context(RuntimeContext {
                protocol: 2.0,
                generation: 1.0,
                session: t.clone(),
                workspace: t.clone(),
                output: t.clone(),
            });
            (*h).0.arm(
                ScrollPlan {
                    shape_valid: true,
                    protocol: 2.0,
                    kind: Text::from_utf8("SCROLL"),
                    session: t.clone(),
                    workspace: t.clone(),
                    output: t,
                    epoch: 0.0,
                    issued_at: 0.0,
                    old_offset: 0.0,
                    new_offset: 100.0,
                    retarget_only: 0,
                    clip_partial: 0,
                    partial: None,
                    viewport: Rect {
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 100.0,
                    },
                    fingerprint: vec![1],
                    entries: vec![ScrollEntry {
                        window_id: WindowId(token),
                        column_id: 0.0,
                        logical_x: 0.0,
                        pixel_width: 100.0,
                        old_placement: Placement::Visible,
                        new_placement: Placement::Parked,
                    }],
                },
                0,
                &HashMap::new(),
            );
            assert_eq!(
                cc_niri_scroll_frames(h, 0, std::ptr::null_mut(), 0).value,
                1
            );
            assert_eq!(
                cc_niri_scroll_frames(h, 0, std::ptr::null_mut(), 1).status,
                INVALID_DTO
            );
            let mut output = FfiWindowFrame {
                window_id: 0,
                rect: Rect::default().into(),
            };
            assert_eq!(cc_niri_scroll_frames(h, 0, &mut output, 1).status, OK);
            assert_eq!(output.window_id, token);
            let allocations = crate::allocation_checks::count(|| {
                for frame in 0..1000 {
                    std::hint::black_box(cc_niri_scroll_advance(h, frame * 1_000_000));
                    std::hint::black_box(cc_niri_scroll_projection(h, token, output.rect));
                    std::hint::black_box(cc_niri_scroll_status(h));
                    std::hint::black_box(cc_niri_scroll_role(h, token));
                    std::hint::black_box(cc_niri_scroll_context_text(h, 0));
                    std::hint::black_box(cc_niri_scroll_frames(h, 0, &mut output, 1));
                }
            });
            assert_eq!(allocations, 0);
            let allocations = crate::allocation_checks::count(|| {
                for frame in 1000..2000 {
                    assert_eq!(cc_niri_scroll_prepare_frame(h, frame * 1_000_000).value, 1);
                    let sample = cc_niri_scroll_frame_sample(h, 0);
                    assert_eq!(sample.valid, 1);
                    assert_eq!(
                        cc_niri_scroll_mark_painted(h, sample.epoch, sample.time_ns).value,
                        1
                    );
                    std::hint::black_box(cc_niri_scroll_frame_sample(h, 1));
                    std::hint::black_box(cc_niri_scroll_retarget_status(h));
                    std::hint::black_box(cc_niri_scroll_tuning_status(h, 1));
                }
            });
            assert_eq!(allocations, 0);
            let clone = cc_niri_scroll_clone(h);
            assert_ne!(h, clone);
            cc_niri_scroll_remove(clone, token);
            assert!((*h).0.label(WindowId(token)).is_some());
            assert_eq!(cc_niri_scroll_copy(h, clone), OK);
            assert_eq!(cc_niri_scroll_copy(h, h), OK);
            cc_niri_scroll_destroy(clone);
            assert!((*h).0.label(WindowId(token)).is_none());
            assert_eq!(
                cc_niri_scroll_frames(h, 0, std::ptr::null_mut(), 0).value,
                0
            );
            cc_niri_scroll_destroy(h);
        }
    }
}
