/*
    SPDX-License-Identifier: GPL-2.0-or-later
*/
import QtQml
import org.kde.taskmanager as TaskManager

QtObject {
    id: root

    required property var tasksModel
    required property var state
    required property var bridge
    property bool applyingRemoteOrder: false

    function taskUuidAt(row): string {
        if (row < 0 || row >= tasksModel.count) return "";
        const index = tasksModel.index(row, 0);
        if (!tasksModel.data(index, TaskManager.AbstractTasksModel.IsWindow)) return "";
        const ids = tasksModel.data(index, TaskManager.AbstractTasksModel.WinIdList);
        return ids && ids.length === 1 ? state.normalizeUuid(ids[0]) : "";
    }

    function rowForUuid(uuid): int {
        for (let row = 0; row < tasksModel.count; ++row) {
            if (taskUuidAt(row) === uuid) return row;
        }
        return -1;
    }

    function firstWindowRow(): int {
        for (let row = 0; row < tasksModel.count; ++row) {
            if (taskUuidAt(row) !== "") return row;
        }
        return tasksModel.count;
    }

    function applyState(json): void {
        const parsed = state.parse(json);
        if (!parsed || parsed.ignored) return;
        const envelope = parsed.envelope;
        const desired = parsed.desired;
        const missing = desired.filter(uuid => rowForUuid(uuid) < 0);
        if (missing.length > 0) {
            const present = [];
            for (let row = 0; row < tasksModel.count; ++row) {
                const uuid = taskUuidAt(row);
                if (uuid) present.push(uuid);
            }
            state.stateJson = String(json);
            console.warn("[cc-scroll-tasks] waiting for TaskModel UUID mapping" +
                " missing=" + missing.join(",") + " present=" + present.join(","));
            return;
        }

        applyingRemoteOrder = true;
        try {
            const baseRow = firstWindowRow();
            for (let target = 0; target < desired.length; ++target) {
                const currentRow = rowForUuid(desired[target]);
                const targetRow = baseRow + target;
                if (currentRow !== targetRow && !tasksModel.move(currentRow, targetRow)) {
                    console.warn("[cc-scroll-tasks] TasksModel.move failed",
                        currentRow, targetRow);
                    return;
                }
            }
            state.commit(json, envelope, desired);
            console.info("[cc-scroll-tasks] applied generation=" + state.generation +
                " columns=" + desired.length);
        } finally {
            applyingRemoteOrder = false;
        }
    }

    function retryPendingState(): void {
        if (state.stateJson) Qt.callLater(root.applyState, state.stateJson);
    }

    function requestState(): void {
        bridge.requestState();
    }

    function currentManagedOrder(): var {
        const managed = new Set(state.managedUuids);
        const order = [];
        for (let row = 0; row < tasksModel.count; ++row) {
            const uuid = taskUuidAt(row);
            if (managed.has(uuid)) order.push(uuid);
        }
        return order;
    }

    function requestReorder(): void {
        if (applyingRemoteOrder || !bridge.registered ||
                !state.sessionId || state.generation < 0) return;
        const order = currentManagedOrder();
        const unique = new Set(order);
        if (order.length !== state.managedUuids.length || unique.size !== order.length ||
                state.managedUuids.some(uuid => !unique.has(uuid))) {
            console.warn("[cc-scroll-tasks] local reorder has invalid managed UUID set");
            requestState();
            return;
        }
        bridge.requestReorder({
            protocol: 1,
            commandId: state.commandId("reorder"),
            sessionId: state.sessionId,
            baseGeneration: state.generation,
            type: "set-column-order",
            order
        }, () => root.requestState());
    }
}
