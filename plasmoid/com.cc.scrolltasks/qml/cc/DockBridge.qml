/*
    SPDX-License-Identifier: GPL-2.0-or-later
*/
import QtQuick
import org.kde.plasma.workspace.dbus as DBus

Item {
    id: root
    visible: false

    readonly property bool registered: serviceWatcher.registered

    signal stateReceived(string json)
    signal becameAvailable

    function requestState(): void {
        if (!registered) return;
        DBus.SessionBus.asyncCall({
            service: "org.cc.ScrollDockBridge",
            path: "/ScrollDock",
            iface: "org.cc.ScrollDockBridge1",
            member: "GetState",
            arguments: [],
            signature: "()"
        }, reply => {
            root.stateReceived(reply.value);
            reply.destroy();
        }, reply => {
            console.warn("[cc-scroll-tasks] GetState failed", reply.error.message);
            reply.destroy();
        });
    }

    function requestReorder(command, rejected): void {
        DBus.SessionBus.asyncCall({
            service: "org.cc.ScrollDockBridge",
            path: "/ScrollDock",
            iface: "org.cc.ScrollDockBridge1",
            member: "RequestReorder",
            arguments: [JSON.stringify(command)],
            signature: "(s)"
        }, reply => {
            if (!reply.value) {
                console.warn("[cc-scroll-tasks] bridge rejected reorder command");
                rejected();
            }
            reply.destroy();
        }, reply => {
            console.warn("[cc-scroll-tasks] RequestReorder failed", reply.error.message);
            reply.destroy();
            rejected();
        });
    }

    function requestCommand(command, rejectionMessage, failureMessage, rejected): void {
        DBus.SessionBus.asyncCall({
            service: "org.cc.ScrollDockBridge",
            path: "/ScrollDock",
            iface: "org.cc.ScrollDockBridge1",
            member: "RequestCommand",
            arguments: [JSON.stringify(command)],
            signature: "(s)"
        }, reply => {
            if (!reply.value) {
                console.warn(rejectionMessage);
                rejected();
            }
            reply.destroy();
        }, reply => {
            console.warn(failureMessage, reply.error.message);
            reply.destroy();
            rejected();
        });
    }

    DBus.DBusServiceWatcher {
        id: serviceWatcher
        busType: DBus.BusType.Session
        watchedService: "org.cc.ScrollDockBridge"
        onRegisteredChanged: {
            if (registered) root.becameAvailable();
        }
    }

    DBus.SignalWatcher {
        busType: DBus.BusType.Session
        service: "org.cc.ScrollDockBridge"
        path: "/ScrollDock"
        iface: "org.cc.ScrollDockBridge1"
        enabled: serviceWatcher.registered

        function dbusStateChanged(json) {
            root.stateReceived(json);
        }
    }
}
