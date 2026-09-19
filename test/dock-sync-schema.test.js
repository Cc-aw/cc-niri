const assert = require("node:assert/strict");

function normalizeWindowUuid(value) {
    return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
}

function snapshot(columns, focusedIndex, generation) {
    const focused = columns[focusedIndex] || null;
    return {
        protocol: 1,
        sessionId: "test-session",
        generation,
        targetOutput: "DP-1",
        focusedUuid: focused ? normalizeWindowUuid(focused.uuid) : "",
        columns: columns.map(column => ({
            uuid: normalizeWindowUuid(column.uuid),
            widthMode: column.widthMode,
        })),
    };
}

function validateReorder(command, sessionId, generation, currentOrder) {
    if (command.protocol !== 1 || command.type !== "set-column-order" ||
            !command.commandId || !Array.isArray(command.order)) return false;
    if (command.sessionId !== sessionId || command.baseGeneration !== generation) return false;
    const requested = command.order.map(normalizeWindowUuid);
    const current = new Set(currentOrder.map(normalizeWindowUuid));
    return requested.length === currentOrder.length &&
        new Set(requested).size === requested.length &&
        requested.every(uuid => uuid && current.has(uuid));
}

assert.equal(
    normalizeWindowUuid("{F67AFACF-5BA4-4742-A65E-BA4820A73280}"),
    "f67afacf-5ba4-4742-a65e-ba4820a73280"
);

const state = snapshot([
    { uuid: "{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}", widthMode: "half" },
    { uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", widthMode: "half" },
], 1, 7);

assert.equal(state.protocol, 1);
assert.equal(state.generation, 7);
assert.deepEqual(state.columns.map(column => column.uuid), [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
]);
assert.equal(state.focusedUuid, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

const validCommand = {
    protocol: 1,
    commandId: "command-1",
    sessionId: "test-session",
    baseGeneration: 7,
    type: "set-column-order",
    order: [state.columns[1].uuid, state.columns[0].uuid],
};
assert.equal(validateReorder(validCommand, "test-session", 7,
    state.columns.map(column => column.uuid)), true);
assert.equal(validateReorder({...validCommand, baseGeneration: 6},
    "test-session", 7, state.columns.map(column => column.uuid)), false);
assert.equal(validateReorder({...validCommand, order: [validCommand.order[0], validCommand.order[0]]},
    "test-session", 7, state.columns.map(column => column.uuid)), false);
assert.equal(validateReorder({...validCommand, order: [validCommand.order[0]]},
    "test-session", 7, state.columns.map(column => column.uuid)), false);

console.log("PASS Phase 8.5 dock state schema and UUID normalization");
