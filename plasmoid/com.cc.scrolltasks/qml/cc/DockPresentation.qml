/*
    SPDX-License-Identifier: GPL-2.0-or-later
*/
import QtQml

QtObject {
    id: root

    required property var tasksModel
    required property var state
    required property var bridge
    required property var order

    function modeFor(uuid): string {
        return state.modeFor(uuid);
    }

    function requestMode(uuid, mode): void {
        const normalized = state.normalizeUuid(uuid);
        if (!bridge.registered || !state.sessionId || state.generation < 0 ||
                !state.hasManagedUuid(normalized) ||
                ["normal", "wide", "maximized"].indexOf(String(mode)) < 0) {
            order.requestState();
            return;
        }
        bridge.requestCommand({
            protocol: 1,
            commandId: state.commandId("presentation"),
            sessionId: state.sessionId,
            baseGeneration: state.generation,
            type: "set-presentation-mode",
            windowUuid: normalized,
            mode: String(mode)
        }, "[cc-scroll-tasks] bridge rejected presentation command",
        "[cc-scroll-tasks] RequestCommand failed", () => order.requestState());
    }

    function requestFocusRight(uuid, fallbackModelIndex): bool {
        const normalized = state.normalizeUuid(uuid);
        if (!bridge.registered || !state.sessionId || state.generation < 0 ||
                !state.hasManagedUuid(normalized)) return false;
        bridge.requestCommand({
            protocol: 1,
            commandId: state.commandId("focus-right"),
            sessionId: state.sessionId,
            baseGeneration: state.generation,
            type: "focus-column-right",
            windowUuid: normalized
        }, "[cc-scroll-tasks] bridge rejected Dock focus command",
        "[cc-scroll-tasks] Dock focus command failed", () => {
            tasksModel.requestActivate(fallbackModelIndex);
            order.requestState();
        });
        return true;
    }
}
