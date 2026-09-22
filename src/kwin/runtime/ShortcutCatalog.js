"use strict";

function createShortcutCatalog(actions) {
    return [
        {
            name: "CCScrollFocusPreviousColumn",
            description: "CC Scroll: Focus Previous Column",
            defaultSequence: "Meta+H",
            handler: actions.focusPrevious,
        },
        {
            name: "CCScrollFocusNextColumn",
            description: "CC Scroll: Focus Next Column",
            defaultSequence: "Meta+L",
            handler: actions.focusNext,
        },
        {
            name: "CCScrollToggleFocusWide",
            description: "CC Scroll: Toggle Focus Wide",
            defaultSequence: "Meta+Z",
            handler: actions.toggleWide,
        },
        {
            name: "CCScrollMoveColumnLeft",
            description: "CC Scroll: Move Column Left",
            defaultSequence: "Meta+Shift+H",
            handler: actions.moveLeft,
        },
        {
            name: "CCScrollMoveColumnRight",
            description: "CC Scroll: Move Column Right",
            defaultSequence: "Meta+Shift+L",
            handler: actions.moveRight,
        },
        {
            name: "CCScrollToggleFloating",
            description: "CC Scroll: Toggle Floating",
            defaultSequence: "Meta+Shift+Return",
            handler: actions.toggleFloating,
        },
        {
            name: "CCScrollToggleFloatingKeypad",
            description: "CC Scroll: Toggle Floating Keypad Enter",
            defaultSequence: "Meta+Shift+Enter",
            handler: actions.toggleFloating,
        },
        {
            name: "CCScrollPublishDockState",
            description: "CC Scroll: Publish Dock State",
            defaultSequence: "",
            handler: actions.publishDockState,
        },
        {
            name: "CCScrollApplyDockCommand",
            description: "CC Scroll: Apply Dock Command",
            defaultSequence: "Meta+Ctrl+Alt+Shift+F11",
            handler: actions.applyDockCommand,
        },
        {
            name: "CCScrollEmergencyRestore",
            description: "CC Scroll: Emergency Restore Parked Windows",
            defaultSequence: "Meta+Ctrl+Alt+Shift+F12",
            handler: actions.emergencyRestore,
        },
    ];
}

/* cjs:start */
module.exports = { createShortcutCatalog };
/* cjs:end */
