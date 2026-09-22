"use strict";

class ControllerComposition {
    constructor(controllers, requiredNames) {
        const missing = requiredNames.filter(name => !controllers[name]);
        if (missing.length) {
            throw new Error(`missing runtime controllers: ${missing.join(",")}`);
        }
        this.controllers = Object.freeze(Object.assign({}, controllers));
    }

    get(name) {
        const controller = this.controllers[name];
        if (!controller) throw new Error(`unknown runtime controller: ${name}`);
        return controller;
    }

    names() {
        return Object.keys(this.controllers);
    }
}

/* cjs:start */
module.exports = { ControllerComposition };
/* cjs:end */
