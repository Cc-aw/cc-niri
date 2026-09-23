const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root,
    "package/contents/code/main.js"), "utf8");
const application = main.slice(main.indexOf("/* END GENERATED KWIN MODULES */"));
const controller = fs.readFileSync(path.join(root,
    "src/kwin/presentation/PresentationController.js"), "utf8");
const fullscreen = fs.readFileSync(path.join(root,
    "src/kwin/lifecycle/FullscreenController.js"), "utf8");
assert.doesNotMatch(application,
    /(?:mainScreenState|appState)\.viewport\.(?:mode|wideColumnId)\s*=(?!=)/);
assert.doesNotMatch(application,
    /(?:mainScreenState|appState)\.viewport\s*=(?!=)/);
assert.doesNotMatch(controller,
    /appState\.viewport(?:\.(?:mode|wideColumnId))?\s*=(?!=)/);
assert.doesNotMatch(fullscreen,
    /appState\.viewport(?:\.(?:mode|wideColumnId))?\s*=(?!=)/);
assert.match(controller, /this\.viewport\.pair\(\)/);
assert.match(controller, /this\.viewport\.wide\(column\)/);
assert.match(controller, /this\.viewport\.restore\(restoreViewport\)/);
console.log("PASS ContextualViewport is the sole viewport writer");
