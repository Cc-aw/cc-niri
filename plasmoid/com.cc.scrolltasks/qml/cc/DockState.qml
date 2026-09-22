/*
    SPDX-License-Identifier: GPL-2.0-or-later
*/
import QtQml

QtObject {
    id: root

    property string stateJson: ""
    property string sessionId: ""
    property int generation: -1
    property var managedUuids: []
    property string presentationUuid: ""
    property string presentationMode: "normal"

    function normalizeUuid(value): string {
        return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
    }

    function hasManagedUuid(uuid): bool {
        return managedUuids.indexOf(normalizeUuid(uuid)) >= 0;
    }

    function parse(json): var {
        if (!json) return null;
        let envelope;
        try {
            envelope = JSON.parse(String(json));
        } catch (error) {
            console.warn("[cc-scroll-tasks] invalid state JSON", error);
            return null;
        }
        if (envelope.protocol !== 1 || !envelope.sessionId ||
                !Array.isArray(envelope.columns)) {
            console.warn("[cc-scroll-tasks] invalid state schema");
            return null;
        }
        if (envelope.sessionId === sessionId &&
                Number(envelope.generation) < generation) {
            return { ignored: true };
        }

        const desired = envelope.columns.map(column => normalizeUuid(column.uuid));
        const unique = new Set(desired);
        if (unique.size !== desired.length || desired.some(uuid => !uuid)) {
            console.warn("[cc-scroll-tasks] rejected duplicate or empty UUID state");
            return null;
        }
        return { ignored: false, envelope, desired };
    }

    function commit(json, envelope, desired): void {
        stateJson = String(json);
        sessionId = String(envelope.sessionId);
        generation = Number(envelope.generation);
        managedUuids = desired;
        const presentation = envelope.presentation || {};
        presentationUuid = normalizeUuid(presentation.windowUuid);
        const mode = String(presentation.mode);
        presentationMode = ["normal", "wide", "maximized"].indexOf(mode) >= 0
            ? mode : "normal";
    }

    function modeFor(uuid): string {
        const normalized = normalizeUuid(uuid);
        return normalized && normalized === presentationUuid
            ? presentationMode : "normal";
    }

    function commandId(kind): string {
        return sessionId + "-" + kind + "-" + Date.now() + "-" +
            Math.floor(Math.random() * 0x100000000).toString(16);
    }
}
