/*
    SPDX-License-Identifier: GPL-2.0-or-later
*/
import QtQml

QtObject {
    required property bool inPopup
    required property bool isWindow
    required property bool isActive

    readonly property bool activeWindowFeedback: !inPopup && isWindow && isActive
    readonly property real iconOpacity: isWindow && !isActive ? 0.9 : 1
    readonly property string activeBackgroundColor: "#66DCEBDD"
    readonly property string activeIndicatorColor: "#4F7657"
    readonly property int activeBackgroundMargin: 3
    readonly property int activeBackgroundRadius: 6
    readonly property int activeIndicatorHeight: 3
    readonly property real activeIndicatorWidthRatio: 0.48

    function indicatorWidth(width, height): int {
        return Math.round(Math.min(width, height) * activeIndicatorWidthRatio);
    }
}
