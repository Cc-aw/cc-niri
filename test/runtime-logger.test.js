const assert = require("node:assert/strict");
const { RuntimeLogger } = require("../src/kwin/runtime/RuntimeLogger");

const info = [];
const warnings = [];
let factoryCalls = 0;
const logger = new RuntimeLogger({
    tag: "[cc-test]",
    enabled: false,
    infoSink: message => info.push(message),
    warnSink: message => warnings.push(message),
});

assert.equal(logger.debug(() => {
    factoryCalls += 1;
    return "expensive";
}), false);
assert.equal(factoryCalls, 0, "disabled debug does not construct lazy messages");
logger.setEnabled(true);
logger.debug("[cc-scroll] LAYOUT reason=test");
logger.debug("[cc-adoption] PHASE waiting->managed");
logger.debug("frame", "motion");
assert.deepEqual(info, [
    "[cc-test] [layout] LAYOUT reason=test",
    "[cc-test] [adoption] PHASE waiting->managed",
    "[cc-test] [motion] frame",
]);
logger.setEnabled(false);
logger.warn("[cc-stability] INVARIANT errors=duplicate");
logger.warn("TIMEOUT token=1", "presentation");
assert.deepEqual(warnings, [
    "[cc-test] [stability] INVARIANT errors=duplicate",
    "[cc-test] [presentation] TIMEOUT token=1",
]);

console.log("PASS runtime logger classifies categories and avoids disabled lazy work");
