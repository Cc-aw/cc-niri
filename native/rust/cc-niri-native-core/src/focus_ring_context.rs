// SPDX-License-Identifier: GPL-2.0-or-later
//! Eligibility publication authority; KWin still supplies actual focus/visibility.
use crate::native_protocol::{
    Context, Generation, NativeError, OutputId, SessionId, Text, WindowName, WorkspaceId,
};
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub struct EligibilitySnapshot {
    pub shape_valid: bool,
    pub message_bytes: u64,
    pub protocol: f64,
    pub kind: Text,
    pub session: Text,
    pub workspace: Text,
    pub output: Text,
    pub generation: f64,
    pub enabled: bool,
    // Adapter decodes QUuid into canonical UTF-16. Core checks membership,
    // duplicates, non-null canonical UUIDs and authority/sequence policy.
    pub windows: Vec<Text>,
}
pub struct Candidate<'a> {
    pub window: &'a [u16],
    pub workspace: &'a [u16],
    pub output: &'a [u16],
    // Bits 0..6: active, managed, normal, visible, current activity/desktop,
    // inside output. Bits 7..9: minimized, deleted, fullscreen.
    pub flags: u32,
    pub opacity: f64,
}
#[derive(Clone, Debug, Default)]
pub struct FocusRingContext {
    pub context: Option<Context>,
    pub enabled: bool,
    pub windows: HashSet<WindowName>,
    pub retired_sessions: HashSet<SessionId>,
}
impl FocusRingContext {
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    fn reject(&mut self, error: NativeError) -> Result<bool, NativeError> {
        self.enabled = false;
        self.windows.clear();
        Err(error)
    }
    pub fn update(&mut self, raw: EligibilitySnapshot) -> Result<bool, NativeError> {
        if !raw.shape_valid
            || raw.message_bytes > 256 * 1024
            || raw.protocol != 1.0
            || raw.kind != Text::from_utf8("focus-ring-eligibility")
            || raw.session.0.is_empty()
            || raw.session.0.len() > 128
            || raw.workspace.0.len() > 128
            || raw.output.0.len() > 128
            || (raw.enabled && (raw.workspace.0.is_empty() || raw.output.0.is_empty()))
            || raw.windows.len() > 256
            || (!raw.enabled && !raw.windows.is_empty())
        {
            return self.reject(NativeError::InvalidProtocol);
        }
        let generation = match Generation::from_json(raw.generation) {
            Ok(value) => value,
            Err(error) => return self.reject(error),
        };
        let mut windows = HashSet::new();
        for name in raw.windows {
            if !canonical_uuid(&name.0) || !windows.insert(WindowName(name)) {
                return self.reject(NativeError::UnknownWindow);
            }
        }
        let context = Context {
            session: SessionId(raw.session),
            workspace: WorkspaceId(raw.workspace),
            output: OutputId(raw.output),
            generation,
        };
        if self.retired_sessions.contains(&context.session) {
            return Err(NativeError::SequenceRejected);
        }
        if let Some(old) = &self.context {
            if context.session == old.session && context.generation <= old.generation {
                return if &context == old && raw.enabled == self.enabled && windows == self.windows
                {
                    Ok(true)
                } else {
                    Err(NativeError::SequenceRejected)
                };
            }
            if context.session != old.session {
                if self.retired_sessions.len() >= 256 {
                    return self.reject(NativeError::SequenceRejected);
                }
                self.retired_sessions.insert(old.session.clone());
            }
        }
        self.context = Some(context);
        self.enabled = raw.enabled;
        self.windows = windows;
        Ok(true)
    }
    pub fn permits(&self, candidate: Candidate<'_>) -> bool {
        self.enabled
            && candidate.flags & 0x3ff == 0x7f
            && candidate.opacity.is_finite()
            && candidate.opacity > 0.0
            && self.context.as_ref().is_some_and(|context| {
                context.output.0 .0 == candidate.output
                    && context.workspace.0 .0 == candidate.workspace
            })
            && self.windows.contains(candidate.window)
    }
}
fn canonical_uuid(name: &[u16]) -> bool {
    name.len() == 36
        && name.iter().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                *c == u16::from(b'-')
            } else {
                (u16::from(b'0')..=u16::from(b'9')).contains(c)
                    || (u16::from(b'a')..=u16::from(b'f')).contains(c)
            }
        })
        && name.iter().any(|c| {
            (u16::from(b'1')..=u16::from(b'9')).contains(c)
                || (u16::from(b'a')..=u16::from(b'f')).contains(c)
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot(session: &str, generation: f64) -> EligibilitySnapshot {
        EligibilitySnapshot {
            shape_valid: true,
            message_bytes: 100,
            protocol: 1.0,
            kind: Text::from_utf8("focus-ring-eligibility"),
            session: Text::from_utf8(session),
            workspace: Text::from_utf8("w"),
            output: Text::from_utf8("eDP-1"),
            generation,
            enabled: true,
            windows: vec![Text::from_utf8("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")],
        }
    }
    #[test]
    fn fail_closed_preserves_sequence_and_tombstones() {
        let mut c = FocusRingContext::default();
        assert_eq!(c.update(snapshot("s", 1.0)), Ok(true));
        assert_eq!(c.update(snapshot("reload", 0.0)), Ok(true));
        assert!(c.update(snapshot("s", 99.0)).is_err());
        assert!(c.enabled);
        assert!(c.update(snapshot("reload", 0.5)).is_err());
        assert!(!c.enabled);
        assert!(c.windows.is_empty());
        assert!(c.update(snapshot("reload", 0.0)).is_err());
        assert_eq!(c.update(snapshot("reload", 1.0)), Ok(true));
        for i in 0..255 {
            assert_eq!(c.update(snapshot(&format!("s{i}"), 0.0)), Ok(true));
        }
        assert_eq!(c.retired_sessions.len(), 256);
        assert!(c.update(snapshot("overflow", 0.0)).is_err());
        assert!(!c.enabled);
        assert_eq!(c.context.unwrap().session.0, Text::from_utf8("s254"));
    }
    #[test]
    fn permission_hot_path_does_not_allocate() {
        let mut c = FocusRingContext::default();
        assert_eq!(c.update(snapshot("s", 0.0)), Ok(true));
        let name = Text::from_utf8("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        let workspace = Text::from_utf8("w");
        let output = Text::from_utf8("eDP-1");
        assert_eq!(
            crate::allocation_checks::count(|| {
                for _ in 0..1000 {
                    assert!(c.permits(Candidate {
                        window: &name.0,
                        workspace: &workspace.0,
                        output: &output.0,
                        flags: 0x7f,
                        opacity: 1.0
                    }));
                }
            }),
            0
        );
    }
}
