const assert = require("node:assert/strict");
const { ControllerComposition } =
    require("../src/kwin/runtime/ControllerComposition");

const adoption = { name: "adoption" };
const dock = { name: "dock" };
const composition = new ControllerComposition(
    { adoption, dock },
    ["adoption", "dock"]
);
assert.equal(composition.get("adoption"), adoption);
assert.deepEqual(composition.names(), ["adoption", "dock"]);
assert.throws(() => composition.get("missing"), /unknown runtime controller/);
assert.throws(
    () => new ControllerComposition({ adoption }, ["adoption", "dock"]),
    /missing runtime controllers: dock/
);

console.log("PASS controller composition validates and owns runtime controllers");
