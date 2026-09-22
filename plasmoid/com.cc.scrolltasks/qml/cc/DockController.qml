/*
    SPDX-License-Identifier: GPL-2.0-or-later
*/
import QtQuick

Item {
    id: root
    visible: false

    required property var tasksModel
    property bool userReorderEnabled: true
    readonly property alias applyingRemoteOrder: order.applyingRemoteOrder
    readonly property alias managedUuids: state.managedUuids

    function normalizeUuid(value): string { return state.normalizeUuid(value); }
    function hasManagedUuid(uuid): bool { return state.hasManagedUuid(uuid); }
    function applyState(json): void { order.applyState(json); }
    function retryPendingState(): void { order.retryPendingState(); }
    function requestState(): void { order.requestState(); }
    function requestReorder(): void { order.requestReorder(); }
    function presentationModeFor(uuid): string { return presentation.modeFor(uuid); }
    function requestPresentationMode(uuid, mode): void {
        presentation.requestMode(uuid, mode);
    }
    function requestFocusRight(uuid, fallbackModelIndex): bool {
        return presentation.requestFocusRight(uuid, fallbackModelIndex);
    }

    DockState { id: state }

    DockBridge {
        id: bridge
        onStateReceived: json => order.applyState(json)
        onBecameAvailable: order.requestState()
    }

    DockOrder {
        id: order
        tasksModel: root.tasksModel
        state: state
        bridge: bridge
    }

    DockPresentation {
        id: presentation
        tasksModel: root.tasksModel
        state: state
        bridge: bridge
        order: order
    }
}
