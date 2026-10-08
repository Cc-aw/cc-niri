"use strict";

// Persistent action IDs and user bindings stay stable. Canonical IPC actions
// have no default key; the legacy queue action keeps its existing F11 binding.
function createShortcutCatalog(actions) {
    const entry = (group, name, description, defaultSequence, handler) =>
        ({ group, name, description, defaultSequence, handler });
    const workspace = [
        entry("Workspace", "CCScrollWorkspacePrevious", "CC Scroll: Previous Workspace", "Meta+K", actions.workspacePrevious),
        entry("Workspace", "CCScrollWorkspaceNext", "CC Scroll: Next Workspace", "Meta+J", actions.workspaceNext),
        ...Array.from({ length: 9 }, (_, index) => {
            const number = index + 1;
            return entry("Workspace", `CCScrollWorkspace${number}`, `CC Scroll: Workspace ${number}`,
                `Meta+${number}`, () => actions.workspaceFocus(number));
        }),
    ];
    const workspaceMove = [
        entry("Column Move", "CCScrollMoveColumnPreviousWorkspace", "CC Scroll: Move Column to Previous Workspace", "Meta+Shift+K", actions.moveWorkspacePrevious),
        entry("Column Move", "CCScrollMoveColumnNextWorkspace", "CC Scroll: Move Column to Next Workspace", "Meta+Shift+J", actions.moveWorkspaceNext),
        ...Array.from({ length: 9 }, (_, index) => {
            const number = index + 1;
            return entry("Column Move", `CCScrollMoveColumnWorkspace${number}`, `CC Scroll: Move Column to Workspace ${number}`,
                `Meta+Ctrl+${number}`, () => actions.moveWorkspaceNumber(number));
        }),
    ];
    const focus = [
        entry("Column Focus", "CCScrollFocusPreviousColumn", "CC Scroll: Focus Previous Column", "Meta+H", actions.focusPrevious),
        entry("Column Focus", "CCScrollFocusNextColumn", "CC Scroll: Focus Next Column", "Meta+L", actions.focusNext),
    ];
    const width = [
        entry("Column Width", "CCScrollCycleColumnWidth", "CC Scroll: Cycle Column Width", "Meta+R", actions.cycleWidth),
        entry("Column Width", "CCScrollToggleColumnFull", "CC Scroll: Toggle Column Full Width", "Meta+F", actions.toggleFull),
    ];
    const presentation = [
        entry("Presentation", "CCScrollToggleFocusWide", "CC Scroll: Toggle Focus Wide", "Meta+Z", actions.toggleWide),
    ];
    const reorder = [
        entry("Column Move", "CCScrollMoveColumnLeft", "CC Scroll: Move Column Left", "Meta+Shift+H", actions.moveLeft),
        entry("Column Move", "CCScrollMoveColumnRight", "CC Scroll: Move Column Right", "Meta+Shift+L", actions.moveRight),
    ];
    const floating = [
        entry("Floating", "CCScrollToggleFloating", "CC Scroll: Toggle Floating", "Meta+Shift+Return", actions.toggleFloating),
        entry("Floating", "CCScrollToggleFloatingKeypad", "CC Scroll: Toggle Floating Keypad Enter", "Meta+Shift+Enter", actions.toggleFloating),
    ];
    const runtime = [
        entry("Debug", "CCScrollPublishFocusRingState", "CC Scroll: Publish Focus Ring Eligibility", "", actions.publishFocusRingState),
        entry("Debug", "CCScrollPublishRuntimeState", "CC Scroll: Publish Runtime State", "", actions.publishRuntimeState),
        entry("Debug", "CCScrollApplyRuntimeCommand", "CC Scroll: Apply Runtime Command", "", actions.applyRuntimeCommand),
    ];
    const compatibility = [
        entry("Compatibility", "CCScrollPublishDockState", "CC Scroll: Publish Dock State", "", actions.publishRuntimeState),
        entry("Compatibility", "CCScrollApplyDockCommand", "CC Scroll: Apply Dock Command", "Meta+Ctrl+Alt+Shift+F11", actions.applyRuntimeCommand),
    ];
    const recovery = [
        entry("Debug", "CCScrollEmergencyRestore", "CC Scroll: Emergency Restore Parked Windows", "Meta+Ctrl+Alt+Shift+F12", actions.emergencyRestore),
    ];
    return [].concat(workspace, workspaceMove, focus, width, presentation, reorder,
        floating, runtime, compatibility, recovery);
}

/* cjs:start */
module.exports = { createShortcutCatalog };
/* cjs:end */
