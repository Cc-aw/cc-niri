const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname,
    "../package/contents/code/main.js"), "utf8");
const timerSource = source.slice(source.indexOf("function setRuntimeTimer("),
    source.indexOf("const recovery =", source.indexOf("function setRuntimeTimer(")));
class KWinTimerMock {
    constructor() {
        this.timeout = {
            connect: callback => { this.connected = callback; },
            disconnect: callback => {
                assert.equal(callback, this.connected,
                    "KWin signal disconnect requires the original callback");
                this.connected = null;
            },
        };
    }
    start(delay) { this.delay = delay; }
    stop() { this.stopped = true; }
}
const context = vm.createContext({ QTimer: KWinTimerMock });
vm.runInContext(timerSource, context);
let fired = 0;
const handle = context.setRuntimeTimer(() => { fired++; }, 150);
assert.equal(handle.timer.singleShot, true);
assert.equal(handle.timer.delay, 150);
handle.timer.connected();
assert.equal(fired, 1);
context.clearRuntimeTimer(handle);
assert.equal(handle.timer.stopped, true);
assert.equal(handle.timer.connected, null);
console.log("PASS KWin runtime timer disconnects its exact callback");
