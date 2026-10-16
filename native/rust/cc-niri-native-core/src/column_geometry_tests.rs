// SPDX-License-Identifier: GPL-2.0-or-later
use crate::column_geometry::*;
use crate::native_protocol::*;
use crate::scroll_retarget::MotionBounds;
use crate::scroll_visual::{parameters, OutputFacts};
use crate::viewport_motion::{MotionKind, MotionSample, ViewportMotion};
use std::collections::HashMap;

fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}
fn fixture() -> (ColumnGeometryPlan, WindowRegistry, GeometrySource) {
    let mut windows = WindowRegistry::default();
    let a = windows.intern(Text::from_utf8("a"));
    let b = windows.intern(Text::from_utf8("b"));
    let layout = rect(0.0, 66.0, 2560.0, 1358.0);
    let header = ScrollPlan {
        shape_valid: true,
        protocol: 4.0,
        kind: Text::from_utf8("COLUMN_GEOMETRY"),
        session: Text::from_utf8("session"),
        workspace: Text::from_utf8("workspace"),
        output: Text::from_utf8("DP-1"),
        epoch: 2.0,
        issued_at: 10.0,
        old_offset: 0.0,
        new_offset: 1000.0,
        retarget_only: 0,
        clip_partial: 2,
        viewport: rect(0.0, 0.0, 2560.0, 1440.0),
        partial: None,
        entries: vec![],
        fingerprint: vec![2],
    };
    let entries = vec![
        ColumnGeometryEntry {
            window_id: a,
            column_id: 1.0,
            source_culled: false,
            old_logical_x: Some(652.0),
            new_logical_x: 652.0,
            old_width: 1256.0,
            new_width: 2528.0,
            old_frame: rect(652.0, 66.0, 1256.0, 1358.0),
            old_visual: Some(rect(652.0, 66.0, 1256.0, 1358.0)),
            target_frame: rect(0.0, 66.0, 2528.0, 1358.0),
            old_placement: Placement::Visible,
            new_placement: Placement::Visible,
        },
        ColumnGeometryEntry {
            window_id: b,
            column_id: 2.0,
            source_culled: false,
            old_logical_x: Some(1924.0),
            new_logical_x: 3196.0,
            old_width: 1256.0,
            new_width: 1256.0,
            old_frame: rect(1304.0, 66.0, 1256.0, 1358.0),
            old_visual: Some(rect(1924.0, 66.0, 1256.0, 1358.0)),
            target_frame: rect(1304.0, 66.0, 1256.0, 1358.0),
            old_placement: Placement::Visible,
            new_placement: Placement::Visible,
        },
    ];
    let context = Context::scroll(RuntimeContext {
        protocol: 2.0,
        generation: 1.0,
        session: header.session.clone(),
        workspace: header.workspace.clone(),
        output: header.output.clone(),
    })
    .unwrap();
    let source = GeometrySource {
        context,
        viewport: header.viewport,
        layout,
        max_camera: 1272.0,
        scope_revision: 1.0,
        epoch: 1,
        serial: 10,
        camera_x: 0.0,
        time_ns: 1_000_000_000,
        rows: entries
            .iter()
            .map(|e| {
                (
                    e.window_id,
                    ColumnSource {
                        column_id: e.column_id,
                        frame: e.old_frame,
                        visual: e.old_visual,
                        velocity_x: 0.0,
                        velocity_y: 0.0,
                        acknowledged: true,
                        hidden: false,
                        culled: false,
                    },
                )
            })
            .collect(),
    };
    (
        ColumnGeometryPlan {
            header,
            old_layout: layout,
            layout,
            old_max_camera: 1272.0,
            max_camera: 2544.0,
            scope_revision: 1.0,
            source_epoch: 1.0,
            source_serial: 10.0,
            entries,
        },
        windows,
        source,
    )
}
fn camera(plan: &ColumnGeometryPlan) -> ViewportMotion {
    let mut camera = ViewportMotion::new(parameters(true));
    assert!(camera
        .start_bounded(
            plan.header.old_offset,
            plan.header.new_offset,
            0.0,
            MotionBounds {
                lower: 0.0,
                upper: plan.old_max_camera.max(plan.max_camera),
                reverse_limit: 51.2
            },
            plan.header.epoch as i64,
            1_000_000_000
        )
        .is_some());
    camera
}
fn transition(
    plan: ColumnGeometryPlan,
    windows: &WindowRegistry,
    source: &GeometrySource,
    camera: &ViewportMotion,
) -> ColumnGeometryTransition {
    ColumnGeometryTransition::new(
        ValidatedColumnGeometryPlan::new(plan, windows).unwrap(),
        source,
        camera.sample(1_000_000_000),
        1_000_000_000,
        true,
    )
    .unwrap()
}
fn facts() -> OutputFacts {
    OutputFacts {
        valid: true,
        scale: 1.5,
        refresh_hz: 60.0,
    }
}

#[test]
fn strict_geometry_schema_and_shared_sequence_do_not_relax_legacy() {
    let (plan, windows, source) = fixture();
    assert!(!valid_scroll_plan(&plan.header, &windows));
    let mut sequence = ScrollSequence::default();
    assert!(sequence
        .update(RuntimeContext {
            protocol: 2.0,
            generation: 1.0,
            session: source.context.session.0.clone(),
            workspace: source.context.workspace.0.clone(),
            output: source.context.output.0.clone()
        })
        .is_ok());
    for expected in [PlanDisposition::Accepted, PlanDisposition::Duplicate] {
        let mut validated = ValidatedColumnGeometryPlan::new(plan.clone(), &windows).unwrap();
        assert_eq!(
            sequence.observe_validated(validated.sequence()),
            Ok(expected)
        );
    }
    let mut conflict = plan.clone();
    conflict.header.fingerprint = vec![99];
    let mut validated = ValidatedColumnGeometryPlan::new(conflict, &windows).unwrap();
    assert_eq!(
        sequence.observe_validated(validated.sequence()),
        Err(NativeError::SequenceRejected)
    );
    let mut older = plan.clone();
    older.header.epoch = 1.0;
    older.source_epoch = 0.0;
    assert!(ValidatedColumnGeometryPlan::new(older, &windows).is_err());
    // Schema validity is insufficient to invent the platform source. A failed
    // numerical arm cannot unconsume the accepted shared sequence epoch.
    let mut missing = source;
    missing.rows.clear();
    assert!(ColumnGeometryTransition::new(
        ValidatedColumnGeometryPlan::new(plan.clone(), &windows).unwrap(),
        &missing,
        camera(&plan).sample(1_000_000_000),
        1_000_000_000,
        true
    )
    .is_err());
    let mut legacy = plan.header.clone();
    legacy.protocol = 2.0;
    legacy.kind = Text::from_utf8("SCROLL");
    legacy.epoch = 1.0;
    legacy.fingerprint = vec![1];
    legacy.clip_partial = 0;
    legacy.entries = vec![ScrollEntry {
        window_id: plan.entries[0].window_id,
        column_id: 1.0,
        logical_x: 0.0,
        pixel_width: 100.0,
        old_placement: Placement::Visible,
        new_placement: Placement::Parked,
    }];
    let mut validated = ValidatedScrollPlan::new(legacy, &windows).unwrap();
    assert_eq!(
        sequence.observe_validated(&mut validated),
        Err(NativeError::SequenceRejected)
    );
}

#[test]
fn malformed_geometry_and_client_ack_data_are_rejected() {
    let (plan, windows, _) = fixture();
    let mutations: &[fn(&mut ColumnGeometryPlan)] = &[
        |p| p.header.protocol = 3.0,
        |p| p.header.shape_valid = false,
        |p| p.scope_revision = 0.0,
        |p| p.source_epoch = p.header.epoch,
        |p| p.source_serial = f64::NAN,
        |p| p.max_camera = f64::INFINITY,
        |p| p.header.old_offset = -1.0,
        |p| p.old_layout.x = -1.0,
        |p| p.entries[0].old_width += 0.001,
        |p| p.entries[0].target_frame.width += 0.001,
        |p| p.entries[0].old_visual.as_mut().unwrap().x += 1.0,
        |p| p.entries[0].old_logical_x = None,
        |p| p.entries[0].new_width = 3000.0,
        |p| p.entries[0].target_frame.x = -0.001,
        |p| p.entries[1].column_id = 1.0,
        |p| p.entries[1].window_id = p.entries[0].window_id,
        |p| p.entries[0].window_id = WindowId(999),
        |p| p.entries[1].new_logical_x = p.entries[0].new_logical_x,
        |p| p.entries[0].old_placement = Placement::Parked,
        |p| p.entries = vec![p.entries[0].clone(); 257],
    ];
    for (i, mutate) in mutations.iter().enumerate() {
        let mut bad = plan.clone();
        mutate(&mut bad);
        assert!(
            ValidatedColumnGeometryPlan::new(bad, &windows).is_err(),
            "case {i}"
        );
    }
}

#[test]
fn half_two_thirds_full_half_preserves_camera_bounds_and_natural_client_size() {
    let (mut plan, windows, mut source) = fixture();
    plan.entries.truncate(1);
    let id = plan.entries[0].window_id;
    source.rows.retain(|key, _| *key == id);
    let mut previous_width = 1256.0;
    let mut previous_camera = 0.0;
    let mut previous_max = 0.0;
    let mut previous_frame = plan.entries[0].old_frame;
    for (step, (width, target)) in [(1680.0, 212.0), (2528.0, 636.0), (1256.0, 0.0)]
        .into_iter()
        .enumerate()
    {
        let epoch = step as i64 + 2;
        let start = 1_000_000_000 + step as i64 * 4_000_000_000;
        plan.header.epoch = epoch as f64;
        plan.header.old_offset = previous_camera;
        plan.header.new_offset = target;
        plan.old_max_camera = previous_max;
        plan.max_camera = (652.0 + width + 652.0 - 2560.0_f64).max(0.0);
        plan.source_epoch = (epoch - 1) as f64;
        plan.source_serial = 10.0 + 2.0 * step as f64;
        let e = &mut plan.entries[0];
        e.old_width = previous_width;
        e.new_width = width;
        e.old_frame = previous_frame;
        e.old_visual = Some(rect(652.0 - previous_camera, 66.0, previous_width, 1358.0));
        e.target_frame = rect(652.0 - target, 66.0, width, 1358.0);
        source.epoch = epoch - 1;
        source.serial = 10 + 2 * step as u64;
        source.camera_x = previous_camera;
        source.max_camera = previous_max;
        source.time_ns = if step == 0 {
            start
        } else {
            start - 1_000_000_000
        };
        source.rows.insert(
            id,
            ColumnSource {
                column_id: 1.0,
                frame: e.old_frame,
                visual: e.old_visual,
                velocity_x: 0.0,
                velocity_y: 0.0,
                acknowledged: true,
                hidden: false,
                culled: false,
            },
        );
        let target_frame = e.target_frame;
        let mut camera = ViewportMotion::new(parameters(true));
        assert!(camera
            .start_bounded(
                previous_camera,
                target,
                0.0,
                MotionBounds {
                    lower: 0.0,
                    upper: previous_max.max(plan.max_camera),
                    reverse_limit: 51.2
                },
                epoch,
                start
            )
            .is_some());
        let mut motion = ColumnGeometryTransition::new(
            ValidatedColumnGeometryPlan::new(plan.clone(), &windows).unwrap(),
            &source,
            camera.sample(start),
            start,
            true,
        )
        .unwrap();
        assert!(motion.prepare_frame(camera.sample(start), start, facts()));
        assert!(motion.mark_painted(id, epoch, start, 11 + 2 * step as u64, previous_frame));
        assert_eq!(motion.painted(id).unwrap().rect.width, previous_width);
        let finish = start + 3_000_000_000;
        assert!(motion.prepare_frame(camera.sample(finish), finish, facts()));
        assert!(motion.observe_frame(id, target_frame));
        assert!(motion.mark_painted(id, epoch, finish, 12 + 2 * step as u64, target_frame));
        assert!(motion.completed());
        assert_eq!(motion.painted(id).unwrap().rect.width, width);
        previous_width = width;
        previous_camera = target;
        previous_max = plan.max_camera;
        previous_frame = target_frame;
    }
}

#[test]
fn actual_old_and_new_surface_sizes_are_never_scaled_or_accepted_by_near() {
    let (plan, windows, source) = fixture();
    let camera = camera(&plan);
    let a = plan.entries[0].window_id;
    let old = plan.entries[0].old_frame;
    let new = plan.entries[0].target_frame;
    let mut motion = transition(plan, &windows, &source, &camera);
    let time = 1_080_000_000;
    assert!(motion.prepare_frame(camera.sample(time), time, facts()));
    let old_projection = motion.projection(a, old).unwrap();
    assert!(motion.mark_painted(a, 2, time, 11, old));
    assert_eq!(motion.painted(a).unwrap().rect.width, 1256.0);
    assert!(!motion.painted(a).unwrap().target_frame);
    let almost = Rect {
        width: new.width - 0.01,
        ..new
    };
    assert!(motion.projection(a, almost).is_none());
    assert!(motion.observe_frame(a, new));
    let new_projection = motion.projection(a, new).unwrap();
    assert_eq!(
        old.x + old_projection.translation_x,
        new.x + new_projection.translation_x
    );
    assert!(motion.mark_painted(a, 2, time, 12, new));
    assert_eq!(motion.painted(a).unwrap().rect.width, 2528.0);
    assert!(motion.painted(a).unwrap().target_frame);
    assert!(
        !motion.observe_frame(a, old),
        "a late old frame cannot revoke the target ACK"
    );
    assert!(motion.projection(a, old).is_none());
    assert!(motion.observe_frame(a, new));
    assert!(motion.projection(a, new).is_some());
}

#[test]
fn unpainted_prediction_cannot_be_a_retarget_source_and_velocity_is_continuous() {
    let (plan, windows, source) = fixture();
    let camera = camera(&plan);
    let entries = plan.entries.clone();
    let mut motion = transition(plan.clone(), &windows, &source, &camera);
    let time = 1_080_000_000;
    let painted_camera = camera.sample(time);
    assert!(motion.prepare_frame(painted_camera, time, facts()));
    for e in &entries {
        assert!(motion.mark_painted(e.window_id, 2, time, 11, e.old_frame));
    }
    let poses: HashMap<_, _> = entries
        .iter()
        .map(|e| (e.window_id, motion.painted(e.window_id).unwrap()))
        .collect();
    assert!(motion.prepare_frame(camera.sample(time + 80_000_000), time + 80_000_000, facts()));
    for e in &entries {
        assert_eq!(motion.painted(e.window_id), Some(poses[&e.window_id]));
    }
    let frozen = motion.clone_for_paint();
    for e in &entries {
        let projection = frozen.projection(e.window_id, e.old_frame).unwrap();
        assert!(
            (e.old_frame.x + projection.translation_x - poses[&e.window_id].rect.x).abs() < 1e-9
        );
    }
    let mut next = plan;
    next.header.epoch = 3.0;
    next.header.old_offset = painted_camera.current;
    next.header.new_offset = 0.0;
    next.source_epoch = 2.0;
    next.source_serial = 11.0;
    next.old_max_camera = next.max_camera;
    let mut proof = GeometrySource {
        context: source.context,
        viewport: next.header.viewport,
        layout: next.old_layout,
        max_camera: next.old_max_camera,
        scope_revision: 1.0,
        epoch: 2,
        serial: 11,
        camera_x: painted_camera.current,
        time_ns: time,
        rows: HashMap::new(),
    };
    for e in &mut next.entries {
        let p = poses[&e.window_id];
        e.old_visual = Some(p.rect);
        e.old_logical_x = Some(p.rect.x + painted_camera.current);
        e.old_frame = entries
            .iter()
            .find(|old| old.window_id == e.window_id)
            .unwrap()
            .old_frame;
        e.old_width = e.old_frame.width;
        // Keep target widths/order while reversing the common camera.
        let x = e.new_logical_x;
        e.target_frame.x = x.clamp(0.0, 2560.0 - e.new_width);
        e.new_placement = if x < 2560.0 {
            Placement::Visible
        } else {
            Placement::Parked
        };
        proof.rows.insert(
            e.window_id,
            ColumnSource {
                column_id: e.column_id,
                frame: e.old_frame,
                visual: Some(p.rect),
                velocity_x: p.velocity_x,
                velocity_y: p.velocity_y,
                acknowledged: true,
                hidden: false,
                culled: false,
            },
        );
    }
    let mut reversed = ViewportMotion::new(parameters(true));
    assert!(reversed
        .start_bounded(
            painted_camera.current,
            0.0,
            painted_camera.velocity,
            MotionBounds {
                lower: 0.0,
                upper: 2544.0,
                reverse_limit: 51.2
            },
            3,
            time + 80_000_000
        )
        .is_some());
    let mut next = ColumnGeometryTransition::new(
        ValidatedColumnGeometryPlan::new(next, &windows).unwrap(),
        &proof,
        reversed.sample(time + 80_000_000),
        time + 80_000_000,
        true,
    )
    .unwrap();
    assert!(next.prepare_frame(
        reversed.sample(time + 80_000_000),
        time + 80_000_000,
        facts()
    ));
    for e in &entries {
        assert!(next.mark_painted(e.window_id, 3, time + 80_000_000, 12, e.old_frame));
        let after = next.painted(e.window_id).unwrap();
        let before = poses[&e.window_id];
        assert!((after.rect.x - before.rect.x).abs() < 1e-9);
        assert!((after.velocity_x - before.velocity_x).abs() < 1e-8);
    }
}

#[test]
fn completion_requires_all_real_target_ack_paints_and_monotonic_frame_identity() {
    let (plan, windows, source) = fixture();
    let camera = camera(&plan);
    let entries = plan.entries.clone();
    let mut motion = transition(plan, &windows, &source, &camera);
    assert!(!motion.prepare_frame(camera.sample(1_000_000_000), 999_999_999, facts()));
    let time = 4_000_000_000;
    assert!(motion.prepare_frame(camera.sample(time), time, facts()));
    assert!(!motion.completed());
    assert!(!motion.mark_painted(entries[0].window_id, 1, time, 11, entries[0].target_frame));
    assert!(!motion.mark_painted(entries[0].window_id, 2, time, 10, entries[0].target_frame));
    assert!(motion.mark_painted(entries[0].window_id, 2, time, 11, entries[0].target_frame));
    assert!(!motion.completed());
    assert!(motion.mark_painted(entries[1].window_id, 2, time, 12, entries[1].target_frame));
    assert!(
        !motion.completed(),
        "different output-pass serials cannot form one complete frame"
    );
    assert!(motion.mark_painted(entries[0].window_id, 2, time, 12, entries[0].target_frame));
    assert!(motion.completed());
    assert!(!motion.prepare_frame(camera.sample(time - 1), time - 1, facts()));
    let mut stale = camera.sample(time);
    stale.epoch = 1;
    assert!(!motion.prepare_frame(stale, time, facts()));
    motion.remove(entries[1].window_id);
    assert_eq!(motion.len(), 1);
    motion.clear();
    assert!(motion.is_empty());
    assert!(!motion.completed());
}

#[test]
fn incoming_requires_hidden_real_source_and_closed_unknown_rows_never_project() {
    let (mut plan, windows, mut source) = fixture();
    let a = plan.entries[0].window_id;
    plan.entries[0].old_visual = None;
    plan.entries[0].old_logical_x = None;
    plan.entries[0].old_placement = Placement::Parked;
    plan.entries[0].old_frame.x = -4000.0;
    let fact = source.rows.get_mut(&a).unwrap();
    fact.frame = plan.entries[0].old_frame;
    fact.visual = None;
    let validated = ValidatedColumnGeometryPlan::new(plan.clone(), &windows).unwrap();
    assert!(ColumnGeometryTransition::new(
        validated,
        &source,
        camera(&plan).sample(1_000_000_000),
        1_000_000_000,
        true
    )
    .is_err());
    source.rows.get_mut(&a).unwrap().hidden = true;
    source.rows.get_mut(&a).unwrap().velocity_y = 5000.0;
    let camera = camera(&plan);
    let frame = plan.entries[0].old_frame;
    let mut motion = transition(plan, &windows, &source, &camera);
    assert!(motion.prepare_frame(camera.sample(1_000_000_000), 1_000_000_000, facts()));
    assert!(motion.projection(a, frame).is_some());
    assert!(motion.prepare_frame(camera.sample(1_060_000_000), 1_060_000_000, facts()));
    assert_eq!(
        frame.y + motion.projection(a, frame).unwrap().translation_y,
        66.0,
        "an unpainted incoming client cannot inherit an invented vertical velocity"
    );
    motion.remove(a);
    assert!(motion.projection(a, frame).is_none());
    assert!(!motion.observe_frame(a, frame));
}

#[test]
fn reorder_and_close_keep_stable_ids_and_cull_late_client_callbacks() {
    let (mut plan, windows, source) = fixture();
    plan.entries[0].new_logical_x = 1924.0;
    plan.entries[0].target_frame.x = 32.0;
    plan.entries[1].new_logical_x = 652.0;
    plan.entries[1].target_frame.x = 0.0;
    let camera = camera(&plan);
    let entries = plan.entries.clone();
    let mut motion = transition(plan, &windows, &source, &camera);
    let start = 1_000_000_000;
    assert!(motion.prepare_frame(camera.sample(start), start, facts()));
    for row in &entries {
        let projection = motion.projection(row.window_id, row.old_frame).unwrap();
        assert!(
            (row.old_frame.x + projection.translation_x - row.old_visual.unwrap().x).abs() < 1e-9
        );
        assert_eq!(motion.column_id(row.window_id), Some(row.column_id));
    }
    let closed = &entries[1];
    motion.remove(closed.window_id);
    assert!(!motion.observe_frame(closed.window_id, closed.target_frame));
    assert!(!motion.mark_painted(closed.window_id, 2, start, 11, closed.target_frame));
    let finish = 4_000_000_000;
    assert!(motion.prepare_frame(camera.sample(finish), finish, facts()));
    assert!(motion.observe_frame(entries[0].window_id, entries[0].target_frame));
    assert!(motion.mark_painted(entries[0].window_id, 2, finish, 12, entries[0].target_frame));
    assert!(motion.completed());
    assert_eq!(motion.len(), 1);
}

#[test]
fn projection_and_ack_queries_allocate_nothing_over_many_shared_frames() {
    let (plan, windows, source) = fixture();
    let camera = camera(&plan);
    let rows = plan.entries.clone();
    let mut motion = transition(plan, &windows, &source, &camera);
    let count = crate::allocation_checks::count(|| {
        for i in 0..10000 {
            let time = 1_000_000_000 + i * 100_000;
            let sample = camera.sample(time);
            assert!(motion.prepare_frame(sample, time, facts()));
            for row in &rows {
                assert!(motion.observe_frame(row.window_id, row.target_frame));
                assert!(motion.projection(row.window_id, row.target_frame).is_some());
                assert!(motion.mark_painted(
                    row.window_id,
                    2,
                    time,
                    11 + i as u64,
                    row.target_frame
                ));
                assert_eq!(motion.column_id(row.window_id), Some(row.column_id));
            }
            let _ = motion.completed();
        }
    });
    assert_eq!(count, 0);
}

#[test]
fn caller_cannot_supply_another_camera_scope_or_fabricate_frame_proof() {
    let (plan, windows, source) = fixture();
    let camera = camera(&plan);
    let mut wrong = camera.sample(1_000_000_000);
    wrong.epoch = 1;
    assert!(ColumnGeometryTransition::new(
        ValidatedColumnGeometryPlan::new(plan.clone(), &windows).unwrap(),
        &source,
        wrong,
        1_000_000_000,
        true
    )
    .is_err());
    let mut wrong = camera.sample(1_000_000_000);
    wrong.current += 0.01;
    assert!(ColumnGeometryTransition::new(
        ValidatedColumnGeometryPlan::new(plan.clone(), &windows).unwrap(),
        &source,
        wrong,
        1_000_000_000,
        true
    )
    .is_err());
    let mut missing = source;
    missing
        .rows
        .get_mut(&plan.entries[0].window_id)
        .unwrap()
        .acknowledged = false;
    assert!(ColumnGeometryTransition::new(
        ValidatedColumnGeometryPlan::new(plan.clone(), &windows).unwrap(),
        &missing,
        camera.sample(1_000_000_000),
        1_000_000_000,
        true
    )
    .is_err());
    assert_eq!(camera.sample(4_000_000_000).kind, MotionKind::Static);
    let _: MotionSample = camera.sample(1_000_000_000);
}

#[test]
fn wire_cannot_substitute_another_actual_output_layout_or_old_bound() {
    let (mut plan, windows, mut source) = fixture();
    plan.entries.truncate(1);
    let id = plan.entries[0].window_id;
    source.rows.retain(|key, _| *key == id);
    let camera = camera(&plan);
    for mutate in [
        (|p: &mut ColumnGeometryPlan| p.header.viewport.width = 5120.0)
            as fn(&mut ColumnGeometryPlan),
        |p: &mut ColumnGeometryPlan| p.old_layout.width = 2550.0,
        |p: &mut ColumnGeometryPlan| p.old_max_camera = 5000.0,
    ] {
        let mut spoofed = plan.clone();
        mutate(&mut spoofed);
        let validated = ValidatedColumnGeometryPlan::new(spoofed, &windows).unwrap();
        assert!(
            ColumnGeometryTransition::new(
                validated,
                &source,
                camera.sample(1_000_000_000),
                1_000_000_000,
                true
            )
            .is_err(),
            "a schema-valid wire must still match independent platform/basis facts"
        );
    }
}

fn composed_fixture() -> (
    crate::scroll_runtime::ScrollViewportRuntime,
    ColumnGeometryPlan,
    Vec<crate::scroll_runtime::GeometrySourceRequest>,
) {
    use crate::scroll_runtime::*;
    let (plan, _, source) = fixture();
    let mut r = ScrollViewportRuntime::new(true);
    for name in ["a", "b"] {
        r.intern(Text::from_utf8(name));
    }
    assert!(r.update_context(RuntimeContext {
        protocol: 2.0,
        generation: 1.0,
        session: plan.header.session.clone(),
        workspace: plan.header.workspace.clone(),
        output: plan.header.output.clone()
    }));
    let mut initial = plan.header.clone();
    initial.protocol = 3.0;
    initial.kind = Text::from_utf8("PARTIAL_SCROLL");
    initial.epoch = 1.0;
    initial.new_offset = initial.old_offset;
    initial.retarget_only = 2;
    initial.fingerprint = vec![1];
    initial.partial = Some(PartialScrollConfig {
        layout: plan.old_layout,
        max_offset: plan.old_max_camera,
        scope_revision: plan.scope_revision,
    });
    initial.entries = plan
        .entries
        .iter()
        .map(|e| ScrollEntry {
            window_id: e.window_id,
            column_id: e.column_id,
            logical_x: e.old_logical_x.unwrap(),
            pixel_width: e.old_width,
            old_placement: e.old_placement,
            new_placement: e.old_placement,
        })
        .collect();
    let frames = plan
        .entries
        .iter()
        .map(|e| (e.window_id, e.old_frame))
        .collect();
    assert!(r.arm_partial(initial, 0, &frames, true, plan.header.viewport));
    assert!(r.prepare_frame(source.time_ns));
    let requests: Vec<_> = plan
        .entries
        .iter()
        .map(|e| GeometrySourceRequest {
            id: e.window_id,
            column_id: e.column_id,
            fact: GeometryClientFact {
                frame: e.old_frame,
                opacity: 1.0,
                flags: 99,
            },
        })
        .collect();
    for q in &requests {
        assert!(r.record_client_painted(q.id, 1, source.time_ns, 10, q.fact.frame));
        assert!(r.mark_painted(1, source.time_ns));
    }
    assert!(r.client_source_complete());
    (r, plan, requests)
}
#[test]
fn real_scroll_owner_composes_geometry_camera_ack_and_all_client_completion() {
    let (mut r, plan, mut requests) = composed_fixture();
    let start = 1_000_000_000;
    assert!(r.arm_geometry(plan.clone(), start, &requests, true, plan.header.viewport));
    assert!(r.column_geometry_active());
    assert!(!r.completed());
    for (e, q) in plan.entries.iter().zip(&requests) {
        let p = r.geometry_projection(q.id, q.fact.frame).unwrap();
        assert!((q.fact.frame.x + p.translation_x - e.old_visual.unwrap().x).abs() < 1e-9);
    }
    // Exact old/target frames preserve position without resizing any surface.
    let id = requests[0].id;
    let old = requests[0].fact.frame;
    let target = plan.entries[0].target_frame;
    let old_pose = r.geometry_projection(id, old).unwrap();
    assert!(r.observe_client_frame(id, target));
    let new_pose = r.geometry_projection(id, target).unwrap();
    assert_eq!(
        old.x + old_pose.translation_x,
        target.x + new_pose.translation_x
    );
    assert!(!r.observe_client_frame(id, old));
    assert!(r.projection(id, old).is_none());
    assert!(r.observe_client_frame(id, target));
    let time = start + 3_000_000_000;
    assert!(r.prepare_frame_with_output(time, facts()));
    assert!(!r.completed());
    for (e, q) in plan.entries.iter().zip(&mut requests) {
        q.fact.frame = e.target_frame;
        assert!(r.observe_client_frame(q.id, q.fact.frame));
    }
    assert!(r.record_client_painted(id, 2, time, 11, target));
    assert!(r.mark_painted(2, time));
    assert!(!r.completed());
    assert!(!r.finish_geometry_frame(2, time, 11, &requests));
    let q = requests[1];
    assert!(r.record_client_painted(q.id, 2, time, 11, q.fact.frame));
    assert!(r.finish_geometry_frame(2, time, 11, &requests));
    assert!(r.completed());
    assert_eq!(r.geometry_completion_serial(), 11);
    assert!(!r.record_client_painted(id, 1, time, 12, target));
    assert!(r.targets().contains_key(&id)); // completion does not park/disown
    r.cancel(&plan.header.session, 2);
    assert!(!r.column_geometry_active());
    assert!(r.client_paint(id).is_none());
}
#[test]
fn geometry_source_is_platform_checked_and_failed_arms_consume_the_shared_epoch() {
    let (mut r, mut plan, mut requests) = composed_fixture();
    let output = plan.header.viewport;
    let source = r.geometry_source(&requests, output).unwrap();
    assert_eq!(source.serial, 10);
    requests[0].fact.frame.width -= 0.01;
    assert!(r.geometry_source(&requests, output).is_none());
    assert!(!r.arm_geometry(plan.clone(), 1_000_000_000, &requests, true, output));
    requests[0].fact.frame = plan.entries[0].old_frame;
    assert!(!r.arm_geometry(plan.clone(), 1_000_000_000, &requests, true, output));
    plan.header.epoch = 3.0;
    plan.header.fingerprint = vec![3];
    assert!(r.arm_geometry(plan.clone(), 1_000_000_000, &requests, true, output));
    assert!(!r.arm_geometry(
        plan,
        1_000_000_000,
        &requests,
        true,
        rect(0.0, 0.0, 2559.0, 1440.0)
    ));
    for flags in [0, 97, 99 | 8, 99 | 16, 99 & !32, 99 & !64] {
        requests[0].fact.flags = flags;
        assert!(r.geometry_source(&requests, output).is_none());
    }
}
#[test]
fn geometry_retarget_and_departure_use_client_paint_even_before_first_new_draw() {
    let (mut r, plan, requests) = composed_fixture();
    let start = 1_000_000_000;
    let time = start + 80_000_000;
    assert!(r.arm_geometry(plan.clone(), start, &requests, true, plan.header.viewport));
    assert!(r.prepare_frame_with_output(time, facts()));
    for q in &requests {
        assert!(r.record_client_painted(q.id, 2, time, 11, q.fact.frame));
        assert!(r.mark_painted(2, time));
    }
    let source = r.geometry_source(&requests, plan.header.viewport).unwrap();
    let poses: Vec<_> = requests
        .iter()
        .map(|q| r.client_paint(q.id).unwrap())
        .collect();
    assert!(r.prepare_frame_with_output(time + 80_000_000, facts()));
    let mut next = plan.clone();
    next.header.epoch = 3.0;
    next.header.fingerprint = vec![3];
    next.header.old_offset = source.camera_x;
    next.header.new_offset = 0.0;
    next.old_max_camera = source.max_camera;
    next.source_epoch = 2.0;
    next.source_serial = 11.0;
    for (e, pose) in next.entries.iter_mut().zip(&poses) {
        e.old_visual = Some(pose.visual);
        e.old_logical_x = Some(pose.logical_x);
        e.old_width = pose.frame.width;
        e.old_frame = pose.frame;
        e.old_placement = if pose.visual.intersects(next.header.viewport) {
            Placement::Visible
        } else {
            Placement::Parked
        };
        let visual = rect(
            next.layout.x + e.new_logical_x,
            next.layout.y,
            e.new_width,
            next.layout.height,
        );
        e.target_frame = Rect {
            x: visual.x.clamp(0.0, 2560.0 - e.new_width),
            ..visual
        };
        e.new_placement = if visual.intersects(next.header.viewport) {
            Placement::Visible
        } else {
            Placement::Parked
        };
    }
    assert!(r.arm_geometry(
        next.clone(),
        time + 80_000_000,
        &requests,
        true,
        next.header.viewport
    ));
    for (q, p) in requests.iter().zip(&poses) {
        let projected = r.geometry_projection(q.id, q.fact.frame).unwrap();
        assert!((q.fact.frame.x + projected.translation_x - p.visual.x).abs() < 1e-7);
    }
    let frozen = r.clone_for_paint();
    for (q, p) in requests.iter().zip(&poses) {
        let projected = frozen.geometry_projection(q.id, q.fact.frame).unwrap();
        assert!((q.fact.frame.x + projected.translation_x - p.visual.x).abs() < 1e-7);
    }
    // Several commands before another actual paint may reuse exactly that same
    // proven source; an unpainted epoch/target must not invent a new origin.
    next.header.epoch = 4.0;
    next.header.fingerprint = vec![4];
    assert!(r.arm_geometry(
        next,
        time + 80_000_000,
        &requests,
        true,
        plan.header.viewport
    ));
}
#[test]
fn clipped_transit_finishes_on_target_ack_without_fabricating_a_client_paint() {
    let (mut r, mut plan, mut requests) = composed_fixture();
    plan.entries[1].new_logical_x = 5000.0;
    plan.entries[1].new_placement = Placement::Parked;
    assert!(r.arm_geometry(
        plan.clone(),
        1_000_000_000,
        &requests,
        true,
        plan.header.viewport
    ));
    let time = 4_000_000_000;
    assert!(r.prepare_frame_with_output(time, facts()));
    for (e, q) in plan.entries.iter().zip(&mut requests) {
        q.fact.frame = e.target_frame;
        assert!(r.observe_client_frame(q.id, q.fact.frame));
    }
    let a = requests[0];
    assert!(r.record_client_painted(a.id, 2, time, 11, a.fact.frame));
    assert!(r.mark_painted(2, time));
    assert!(r.finish_geometry_frame(2, time, 11, &requests));
    assert!(r.completed());
    assert_eq!(
        r.client_paint(requests[1].id).unwrap().epoch,
        1,
        "no fake offscreen draw"
    );
    let culled = r.geometry_source(&requests, plan.header.viewport).unwrap();
    assert!(culled.rows[&requests[1].id].culled);
    assert!(!culled.rows[&requests[1].id]
        .visual
        .unwrap()
        .intersects(plan.header.viewport));
    requests[1].fact.opacity = 0.0;
    requests[1].fact.flags |= 4;
    let source = r.geometry_source(&requests, plan.header.viewport).unwrap();
    assert!(source.rows[&requests[1].id].hidden);
    assert!(source.rows[&requests[1].id].visual.is_none());
}
#[test]
fn composed_geometry_shared_paint_and_cull_hot_path_remains_allocation_free() {
    let (mut r, plan, mut requests) = composed_fixture();
    assert!(r.arm_geometry(
        plan.clone(),
        1_000_000_000,
        &requests,
        true,
        plan.header.viewport
    ));
    for (e, q) in plan.entries.iter().zip(&mut requests) {
        q.fact.frame = e.target_frame;
        assert!(r.observe_client_frame(q.id, q.fact.frame));
    }
    let count = crate::allocation_checks::count(|| {
        for i in 1..=10_000 {
            let time = 1_000_000_000 + i * 16_666_667;
            let serial = 10 + i as u64;
            assert!(r.prepare_frame_with_output(time, facts()));
            for q in &requests {
                assert!(r.record_client_painted(q.id, 2, time, serial, q.fact.frame));
                assert!(r.mark_painted(2, time));
            }
            r.finish_geometry_frame(2, time, serial, &requests);
        }
    });
    assert_eq!(count, 0);
}

fn retarget_from_source(
    mut plan: ColumnGeometryPlan,
    source: &GeometrySource,
    epoch: f64,
) -> ColumnGeometryPlan {
    plan.header.epoch = epoch;
    plan.header.fingerprint = vec![epoch as u8];
    plan.header.old_offset = source.camera_x;
    plan.source_epoch = source.epoch as f64;
    plan.source_serial = source.serial as f64;
    plan.old_layout = source.layout;
    plan.old_max_camera = source.max_camera;
    for entry in &mut plan.entries {
        let fact = source.rows[&entry.window_id];
        entry.old_frame = fact.frame;
        entry.old_width = fact.frame.width;
        entry.old_visual = fact.visual;
        entry.old_logical_x = fact.visual.map(|p| p.x - source.layout.x + source.camera_x);
        entry.source_culled = fact.culled;
        entry.old_placement = if fact.visual.is_some_and(|p| p.intersects(source.viewport)) {
            Placement::Visible
        } else {
            Placement::Parked
        };
    }
    plan
}

#[test]
fn issued_observation_can_rebase_only_real_numeric_drift_at_arm() {
    let (mut r, plan, requests) = composed_fixture();
    let output = plan.header.viewport;
    assert!(r.arm_geometry(plan.clone(), 1_000_000_000, &requests, true, output));
    let mut issued = None;
    for (time, serial) in [(1_080_000_000, 11), (1_160_000_000, 12)] {
        assert!(r.prepare_frame_with_output(time, facts()));
        for q in &requests {
            assert!(r.record_client_painted(q.id, 2, time, serial, q.fact.frame));
            assert!(r.mark_painted(2, time));
        }
        if serial == 11 {
            issued = r.query_geometry_source(&requests, output);
        }
    }
    let issued = issued.unwrap();
    let latest = r.geometry_source(&requests, output).unwrap();
    assert_ne!(issued.camera_x, latest.camera_x);
    let next = retarget_from_source(plan, &issued, 3.0);
    let mut forged = next.clone();
    forged.entries[0].old_frame.x += 1.0;
    let mut rejected = r.clone();
    assert!(!rejected.arm_geometry(forged, 1_170_000_000, &requests, true, output));
    assert!(r.arm_geometry(next, 1_170_000_000, &requests, true, output));
    assert_eq!(r.origin_sample().unwrap().motion.current, latest.camera_x);
    for q in &requests {
        let pose = r.geometry_projection(q.id, q.fact.frame).unwrap();
        assert!(
            (q.fact.frame.x + pose.translation_x - latest.rows[&q.id].visual.unwrap().x).abs()
                < 1e-7
        );
    }
    r.clear();
    assert!(r.geometry_source(&requests, output).is_none());
}

#[test]
fn culled_reentry_preserves_real_zero_coverage_pose_without_faking_draws() {
    let (mut r, mut plan, mut requests) = composed_fixture();
    plan.entries[1].new_logical_x = 5000.0;
    plan.entries[1].new_placement = Placement::Parked;
    let output = plan.header.viewport;
    assert!(r.arm_geometry(plan.clone(), 1_000_000_000, &requests, true, output));
    for (e, q) in plan.entries.iter().zip(&mut requests) {
        q.fact.frame = e.target_frame;
        assert!(r.observe_client_frame(q.id, q.fact.frame));
    }
    assert!(r.prepare_frame_with_output(4_000_000_000, facts()));
    let q = requests[0];
    assert!(r.record_client_painted(q.id, 2, 4_000_000_000, 11, q.fact.frame));
    assert!(r.mark_painted(2, 4_000_000_000));
    assert!(r.finish_geometry_frame(2, 4_000_000_000, 11, &requests));
    let source = r.geometry_source(&requests, output).unwrap();
    let mut next = retarget_from_source(plan, &source, 3.0);
    next.entries[0].new_width = 1680.0;
    next.entries[0].target_frame.width = 1680.0;
    next.entries[1].new_logical_x = 2348.0;
    next.entries[1].new_placement = Placement::Visible;
    let id = requests[1].id;
    let before = source.rows[&id].visual.unwrap();
    let mut forged = next.clone();
    forged.entries[1].source_culled = false;
    assert!(!r
        .clone()
        .arm_geometry(forged, 4_010_000_000, &requests, true, output));
    assert!(r.arm_geometry(next, 4_010_000_000, &requests, true, output));
    let after = r.geometry_projection(id, requests[1].fact.frame).unwrap();
    assert!((requests[1].fact.frame.x + after.translation_x - before.x).abs() < 1e-7);
    assert_eq!(r.client_paint(id).unwrap().epoch, 1);
}

#[test]
fn close_freezes_departure_until_deleted_and_omitted_live_owner_is_rejected() {
    let (mut r, plan, mut requests) = composed_fixture();
    let output = plan.header.viewport;
    let mut next = plan.clone();
    next.entries.truncate(1);
    assert!(!r
        .clone()
        .arm_geometry(next.clone(), 1_000_000_000, &requests, true, output));
    let closed = requests[1].id;
    let visual = r.client_paint(closed).unwrap().visual;
    requests[1].fact.flags |= 8;
    assert!(r.arm_geometry(next, 1_000_000_000, &requests, true, output));
    assert!(r.prepare_frame_with_output(2_000_000_000, facts()));
    let pose = r
        .geometry_projection(closed, requests[1].fact.frame)
        .unwrap();
    assert_eq!(requests[1].fact.frame.x + pose.translation_x, visual.x);
    assert!(!r.targets().contains_key(&closed));
    r.remove(closed);
    assert!(r
        .geometry_projection(closed, requests[1].fact.frame)
        .is_none());
}

#[test]
fn late_old_ack_revokes_completed_proof_without_idle_repaint_loop() {
    let (mut r, plan, mut requests) = composed_fixture();
    assert!(r.arm_geometry(
        plan.clone(),
        1_000_000_000,
        &requests,
        true,
        plan.header.viewport
    ));
    assert!(r.prepare_frame_with_output(4_000_000_000, facts()));
    assert!(
        !r.needs_repaint(),
        "settled curves do not spin while waiting for client ACKs"
    );
    for (e, q) in plan.entries.iter().zip(&mut requests) {
        q.fact.frame = e.target_frame;
        assert!(r.observe_client_frame(q.id, q.fact.frame));
        assert!(r.record_client_painted(q.id, 2, 4_000_000_000, 11, q.fact.frame));
        assert!(r.mark_painted(2, 4_000_000_000));
    }
    assert!(r.finish_geometry_frame(2, 4_000_000_000, 11, &requests));
    assert!(r.completed());
    assert!(!r.observe_client_frame(WindowId(9999), plan.entries[0].old_frame));
    assert!(
        r.completed(),
        "unowned application geometry cannot revoke this transaction"
    );
    assert!(!r.observe_client_frame(requests[0].id, plan.entries[0].old_frame));
    assert!(!r.completed());
    assert_eq!(r.geometry_completion_serial(), 0);
    assert!(!r.needs_repaint());
}

#[test]
fn confirmed_cancel_hydration_preserves_predicted_clock_barrier() {
    use crate::scroll_runtime::*;
    let (mut r, plan, requests) = composed_fixture();
    assert!(r.arm_geometry(
        plan.clone(),
        1_016_000_000,
        &requests,
        true,
        plan.header.viewport
    ));
    r.cancel(&plan.header.session, 2);
    let mut bootstrap = plan.header.clone();
    bootstrap.protocol = 3.0;
    bootstrap.kind = Text::from_utf8("PARTIAL_SCROLL");
    bootstrap.epoch = 3.0;
    bootstrap.fingerprint = vec![3];
    bootstrap.old_offset = 0.0;
    bootstrap.new_offset = 0.0;
    bootstrap.retarget_only = 2;
    bootstrap.partial = Some(PartialScrollConfig {
        layout: plan.layout,
        max_offset: plan.old_max_camera,
        scope_revision: 1.0,
    });
    bootstrap.entries = plan
        .entries
        .iter()
        .map(|e| ScrollEntry {
            window_id: e.window_id,
            column_id: e.column_id,
            logical_x: e.old_logical_x.unwrap(),
            pixel_width: e.old_width,
            old_placement: Placement::Visible,
            new_placement: Placement::Visible,
        })
        .collect();
    let frames = requests.iter().map(|q| (q.id, q.fact.frame)).collect();
    assert!(r.arm_partial(
        bootstrap,
        1_000_000_000,
        &frames,
        true,
        plan.header.viewport
    ));
    assert!(r.prepare_frame_with_output(1_016_000_000, facts()));
    for q in &requests {
        assert!(r.record_client_painted(q.id, 3, 1_016_000_000, 12, q.fact.frame));
        assert!(r.mark_painted(3, 1_016_000_000));
    }
    assert!(r.client_source_complete());
}

#[test]
fn overlapping_natural_surfaces_consume_ambiguous_pairs_without_selecting_a_client() {
    let (mut r, plan, mut requests) = composed_fixture();
    assert!(r.arm_geometry(
        plan.clone(),
        1_000_000_000,
        &requests,
        true,
        plan.header.viewport
    ));
    assert!(r.prepare_frame_with_output(1_000_000_000, facts()));
    for (e, q) in plan.entries.iter().zip(&mut requests) {
        q.fact.frame = e.target_frame;
        assert!(r.observe_client_frame(q.id, q.fact.frame));
        assert!(r.record_client_painted(q.id, 2, 1_000_000_000, 11, q.fact.frame));
        assert!(r.mark_painted(2, 1_000_000_000));
    }
    assert_eq!(r.partial_hit(2000.0, 100.0), None);
    assert!(r.partial_point_ambiguous(2000.0, 100.0));
    assert!(!r.partial_point_ambiguous(2560.0, 100.0));
    assert!(!r.partial_point_ambiguous(20.0, 100.0));
    for q in &requests {
        assert!(r.partial_input_blocked(q.id, q.fact.frame, 2000.0, 100.0));
    }
    let press = r.partial_input.event(1, 272, true, 0);
    assert!(press.0);
    assert!(r.partial_input.event(2, 272, false, 0).0);
    let count = crate::allocation_checks::count(|| {
        for _ in 0..10000 {
            assert!(r.partial_point_ambiguous(2000.0, 100.0));
        }
    });
    assert_eq!(count, 0);
}

#[test]
fn issued_retarget_survives_real_completion_shrinking_the_old_camera_bound() {
    let (mut r, mut plan, mut requests) = composed_fixture();
    plan.max_camera = 1000.0;
    let output = plan.header.viewport;
    assert!(r.arm_geometry(plan.clone(), 1_000_000_000, &requests, true, output));
    for (e, q) in plan.entries.iter().zip(&mut requests) {
        q.fact.frame = e.target_frame;
        assert!(r.observe_client_frame(q.id, q.fact.frame));
    }
    assert!(r.prepare_frame_with_output(1_080_000_000, facts()));
    for q in &requests {
        assert!(r.record_client_painted(q.id, 2, 1_080_000_000, 11, q.fact.frame));
        assert!(r.mark_painted(2, 1_080_000_000));
    }
    let issued = r.query_geometry_source(&requests, output).unwrap();
    assert!(r.prepare_frame_with_output(4_000_000_000, facts()));
    for q in &requests {
        assert!(r.record_client_painted(q.id, 2, 4_000_000_000, 12, q.fact.frame));
        assert!(r.mark_painted(2, 4_000_000_000));
    }
    assert!(r.finish_geometry_frame(2, 4_000_000_000, 12, &requests));
    let latest = r.geometry_source(&requests, output).unwrap();
    assert!(latest.max_camera < issued.max_camera);
    let next = retarget_from_source(plan, &issued, 3.0);
    assert!(r.arm_geometry(next, 4_010_000_000, &requests, true, output));
    assert_eq!(r.origin_sample().unwrap().motion.current, latest.camera_x);
}
