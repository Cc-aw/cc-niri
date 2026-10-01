"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../plasmoid/com.cc.scrolltasks/qml/cc/DockState.qml"), "utf8");
const parse = source.slice(source.indexOf("    function parse("), source.indexOf("    function commit("))
    .replace(/\): var/g, ")");
const context = vm.createContext({ sessionId: "old", generation: 2, console,
    normalizeUuid: value => String(value || "").toLowerCase().replace(/^\{|\}$/g, "") });
vm.runInContext(parse, context);
for (const protocol of [1, 2]) {
    const result = context.parse(JSON.stringify({ protocol, sessionId: "new", generation: 1,
        columns: [{ uuid: "active" }], workspaces: [{ id: "other", columns: [{ uuid: "sleeping" }] }] }));
    assert.deepEqual(Array.from(result.desired), ["active"], "Dock only consumes active columns");
}
assert.equal(context.parse(JSON.stringify({ protocol: 99, sessionId: "new", columns: [] })), null);
assert.equal(context.parse(JSON.stringify({ protocol: 2, sessionId: "old", generation: 1, columns: [] })).ignored, true);
console.log("PASS Dock consumes active protocol 1/2 columns without flattening sleeping workspaces");
