# `cc-niri-maximize` V2：Safe Area + Quick Tile + Inner Gap 实现规格

> 交给 Codex 直接实现。  
> 本文是在原 `cc-niri-maximize` 方案上的 **V2 修订规格**。重点修复两个行为缺口，并新增 `innerGap`：
>
> 1. 副屏已最大化窗口通过 `Meta+Alt+Left/Right` 移入主屏后，仍然保持整屏最大化；
> 2. 主屏使用 `Meta+Left/Right` Quick Tile 时仍然占满整个屏幕高度，没有遵循 Niri-style 上下留白；
> 3. 新增 **inner gap**，左右平铺窗口之间保留中间间距。
>
> 最终目标不是“只给 maximize 加 gap”，而是给**主屏建立一个统一的 Niri-style Safe Area**，所有布局型状态都基于这个 Safe Area 计算。

---

# 1. 最终语义

主屏存在一个固定的布局安全区域：

```text
Physical output
┌──────────────────────────────────────┐
│              gapTop                  │
│                                      │
│   gapLeft   ┌──────────────────┐     │
│             │                  │     │
│             │     Safe Area    │     │
│             │                  │     │
│             └──────────────────┘     │
│                         gapRight     │
│              gapBottom               │
└──────────────────────────────────────┘
```

定义：

```text
safeRect.x      = output.x + gapLeft
safeRect.y      = output.y + gapTop
safeRect.width  = output.width  - gapLeft - gapRight
safeRect.height = output.height - gapTop  - gapBottom
```

默认参数：

```text
gapTop    = 42
gapBottom = 64
gapLeft   = 10
gapRight  = 10
innerGap  = 8
```

单位全部为：

```text
logical px
```

---

# 2. 所有主屏布局状态都从 `safeRect` 派生

不要再让 maximize、Quick Tile、跨屏行为各自独立计算 geometry。

必须统一：

```text
Output Geometry
      ↓
safeRect
      ↓
┌────────────────────────────────────────────┐
│ Pseudo Maximize                            │
│ Left Tile                                  │
│ Right Tile                                 │
│ Top Left                                   │
│ Top Right                                  │
│ Bottom Left                                │
│ Bottom Right                               │
└────────────────────────────────────────────┘
```

真正 fullscreen 是唯一例外：

```text
Fullscreen
→ 直接使用整个 output / FullScreenArea
→ 不应用 safeRect
```

---

# 3. `innerGap` 的定义

`innerGap` 是不同 tile 区域之间的间距。

例如左右两半：

```text
                    safeRect

     ┌────────────────┐  8px  ┌────────────────┐
     │                │       │                │
     │   Left Tile    │       │   Right Tile   │
     │                │       │                │
     └────────────────┘       └────────────────┘
```

其中：

```text
innerGap = 8
```

注意：

> `innerGap` 不是给每个窗口四周都额外加一圈，而是用于相邻 tile 之间的内部间隔。

---

# 4. 左右平铺 geometry

假设：

```text
R = safeRect
G = innerGap
```

定义：

```text
leftWidth  = floor((R.width - G) / 2)
rightWidth = R.width - G - leftWidth
```

Left Tile：

```text
x      = R.x
y      = R.y
width  = leftWidth
height = R.height
```

Right Tile：

```text
x      = R.x + leftWidth + G
y      = R.y
width  = rightWidth
height = R.height
```

必须避免直接用 `width / 2` 导致 1 px overlap 或空洞。推荐始终：

```text
Math.floor(...)
剩余像素给右侧 / 下侧
```

---

# 5. 上下平铺 geometry

定义：

```text
topHeight    = floor((R.height - G) / 2)
bottomHeight = R.height - G - topHeight
```

Top：

```text
x      = R.x
y      = R.y
width  = R.width
height = topHeight
```

Bottom：

```text
x      = R.x
y      = R.y + topHeight + G
width  = R.width
height = bottomHeight
```

---

# 6. 四角 Tile geometry

```text
┌──────────────┐  G  ┌──────────────┐
│  Top Left    │     │  Top Right   │
└──────────────┘     └──────────────┘
         G
┌──────────────┐  G  ┌──────────────┐
│ Bottom Left  │     │ Bottom Right │
└──────────────┘     └──────────────┘
```

计算：

```text
leftWidth    = floor((R.width  - G) / 2)
rightWidth   = R.width  - G - leftWidth
topHeight    = floor((R.height - G) / 2)
bottomHeight = R.height - G - topHeight
```

Top Left：

```text
x = R.x
y = R.y
w = leftWidth
h = topHeight
```

Top Right：

```text
x = R.x + leftWidth + G
y = R.y
w = rightWidth
h = topHeight
```

Bottom Left：

```text
x = R.x
y = R.y + topHeight + G
w = leftWidth
h = bottomHeight
```

Bottom Right：

```text
x = R.x + leftWidth + G
y = R.y + topHeight + G
w = rightWidth
h = bottomHeight
```

---

# 7. 新的状态模型

原实现只区分：

```text
normal
pseudoMaximized
```

V2 应升级为：

```text
LayoutState
├── Normal
├── PseudoMaximized
├── QuickTileLeft
├── QuickTileRight
├── QuickTileTop
├── QuickTileBottom
├── QuickTileTopLeft
├── QuickTileTopRight
├── QuickTileBottomLeft
├── QuickTileBottomRight
└── Fullscreen
```

每个 WindowState 至少保存：

```text
pseudoMaximized: bool

restoreGeometry:
    原普通窗口 geometry

layoutMode:
    "normal"
    "maximize"
    "left"
    "right"
    "top"
    "bottom"
    "topLeft"
    "topRight"
    "bottomLeft"
    "bottomRight"

layoutModeBeforeFullscreen:
    fullscreen 进入前状态

pendingAction:
    null
    "enterMaximize"
    "leaveMaximize"
    "applyQuickTile"
    "adoptTransferredMaximize"

internalChange:
    bool
```

不要只通过 `frameGeometry == 某矩形` 反推状态。优先读取：

```text
maximizeMode
tile / quickTile mode
output
fullScreen
```

---

# 8. 必须监听的 KWin signals

V2 至少处理：

```text
maximizedAboutToChange
maximizedChanged

quickTileModeChanged
tileChanged

outputChanged

fullScreenChanged

interactiveMoveResizeStarted
interactiveMoveResizeFinished

closed
```

以及 workspace：

```text
screensChanged
virtualScreenGeometryChanged
```

不要通过持续监听 `frameGeometryChanged` 再强制写 geometry 来实现，这容易造成 KWin 与脚本互相抢 geometry。

---

# 9. 修复场景 A：副屏最大化窗口移入主屏

当前 bug：

```text
副屏窗口 native maximized
       ↓
Meta+Alt+Left
       ↓
窗口移动到主屏
       ↓
仍然 native maximized
       ↓
铺满整个主屏
```

原因：

```text
跨屏并不会必然重新触发一个新的 maximize request
```

因此只监听：

```text
maximizedAboutToChange
maximizedChanged
```

不够。

## 正确行为

监听：

```text
outputChanged
```

当：

```text
newOutput == target/main output
AND
window.fullScreen == false
AND
window.maximizeMode == full maximize
```

则：

```text
adoptTransferredMaximize()
```

执行：

```text
1. 获取一个合理的 restoreGeometry
2. 取消 native maximize
3. 应用 safeRect
4. layoutMode = "maximize"
5. pseudoMaximized = true
```

---

# 10. 跨屏最大化的 restoreGeometry

这里要特别小心。

副屏 native-maximized 窗口被移入主屏后：

```text
window.frameGeometry
```

此时已经是最大化 geometry，不能把它作为普通 restoreGeometry。

优先调查 KWin 当前版本是否通过 scripting API 暴露：

```text
geometryRestore
```

或其它 restore geometry property。

如果能读：

```text
window.geometryRestore
```

则使用它。

如果不能，设计 fallback，不要保存整屏 geometry。

可接受 fallback：

```text
如果无法获得原 restoreGeometry：
    首次 adoptTransferredMaximize 时记录 null
    后续 leave pseudo-maximize 时让 KWin 执行 native restore
```

或者在窗口进入 native maximized 前提前缓存普通 geometry。

Codex 必须先检查当前 KWin scripting API，而不是假定。

---

# 11. 修复场景 B：`Meta+Left / Meta+Right`

当前 bug：

```text
Meta+Left
→ KWin Quick Tile Left
→ 左半屏仍从物理顶部铺到物理底部
```

原因：

> Quick Tile 是独立于 maximize 的 KWin 状态。

因此必须监听：

```text
quickTileModeChanged
或
tileChanged
```

---

# 12. Quick Tile 检测

Codex 应先确认当前 KWin scripting API 中是否能使用：

```text
window.tile
window.tile.quickTileMode()
```

或者是否直接暴露：

```text
window.quickTileMode
window.requestedQuickTileMode
```

不同版本可能不同。

不要写死未经本机验证的 API。

---

# 13. Quick Tile 映射

将 KWin QuickTileMode 转换成内部 layoutMode：

```text
QuickTileFlag.Left
→ "left"

QuickTileFlag.Right
→ "right"

QuickTileFlag.Top
→ "top"

QuickTileFlag.Bottom
→ "bottom"

Top | Left
→ "topLeft"

Top | Right
→ "topRight"

Bottom | Left
→ "bottomLeft"

Bottom | Right
→ "bottomRight"
```

如果返回：

```text
None
```

说明退出 Quick Tile。

---

# 14. 主屏 Quick Tile 应用流程

当：

```text
quickTileModeChanged
```

且：

```text
window.output == targetOutput
AND
!window.fullScreen
```

则：

```text
mode = detectQuickTileMode(window)
rect = layoutRectFor(mode, safeRect, innerGap)
window.frameGeometry = rect
layoutMode = mode
```

如果从 normal 进入 Quick Tile：

```text
记录 restoreGeometry
```

如果从 pseudo-maximize 进入 Quick Tile：

```text
不要覆盖 restoreGeometry
```

否则：

```text
Normal
→ Maximize
→ Left Tile
→ Restore
```

最后会丢失最初 normal geometry。

`restoreGeometry` 应始终代表：

> 进入任意 layout state 之前的原始自由窗口 geometry。

---

# 15. Layout state 之间切换

必须支持：

```text
Normal
→ Maximize
→ Left
→ Right
→ TopLeft
→ Maximize
→ Normal
```

切换过程中：

```text
restoreGeometry
```

保持不变。

只有退出所有 layout states 回 Normal 后：

```text
restoreGeometry = null
```

---

# 16. Quick Tile → Normal

如果用户再次触发同样 Quick Tile 快捷键，或者 KWin 的 Quick Tile mode 变为 `None`：

期望恢复：

```text
restoreGeometry
```

而不是留在当前 tile 大小。

如果 KWin 自己已经完成 native restore，需要避免脚本重复覆盖。

这里必须通过：

```text
internalChange
pendingAction
layoutMode
```

处理 signal reentrancy。

---

# 17. Maximize → Quick Tile

例如：

```text
先点击最大化
→ safeRect 全屏

再 Meta+Left
```

期望：

```text
safeRect 左半 + innerGap
```

不能：

```text
退出 pseudo maximize
→ 恢复普通窗口
→ KWin native 左半屏
```

最终 geometry 必须是：

```text
safeRect-based left tile
```

---

# 18. Quick Tile → Maximize

例如：

```text
Meta+Left
→ 左半屏

点击 maximize
```

期望：

```text
safeRect 全部
```

`restoreGeometry` 仍然保留最初普通窗口的 geometry。

---

# 19. 从副屏 Quick Tile 移入主屏

同样要处理：

```text
副屏 Left Tile
→ Meta+Alt+Left
→ 主屏
```

如果窗口到达主屏时仍然带有 Quick Tile mode：

```text
重新计算为主屏 safeRect 的对应 tile
```

例如：

```text
副屏 Left
→ 主屏 Left
```

目标：

```text
主屏 safeRect 左半
```

而不是：

```text
主屏物理屏幕左半
```

---

# 20. 从主屏移到副屏

当：

```text
outputChanged
```

且新 output 不是 targetOutput：

```text
停止应用 safe area
```

目标：

> 副屏继续由 KDE 原生管理。

如果窗口在主屏处于 pseudo-maximize，移动到副屏后允许 KDE native maximize。

如果处于 QuickTileLeft，移动到副屏后允许 KDE native Left Tile。

不要把主屏的：

```text
gapTop
gapBottom
innerGap
```

带到副屏。

---

# 21. 不要把 outputChanged 当成普通“手动移动退出状态”

注意区分：

```text
用户拖动自由窗口跨屏
```

与：

```text
Meta+Alt+Left/Right
保持 maximize/tile 状态跨屏
```

如果一收到 `outputChanged` 就：

```text
clear all layout state
```

会再次复现当前问题。

因此 `outputChanged` 必须检查：

```text
maximizeMode
tile / quickTile mode
fullScreen
```

来决定新屏上的布局状态。

---

# 22. Fullscreen 永远最高优先级

如果：

```text
window.fullScreen == true
```

则完全绕过：

```text
safeRect
innerGap
pseudo maximize
quick tile custom geometry
```

目标：

```text
F11
→ 真正占满 output
```

退出 Fullscreen 后：

如果 fullscreen 前：

```text
layoutMode = "maximize"
```

则恢复 `safeRect`。

如果 fullscreen 前：

```text
layoutMode = "left"
```

则恢复 safeRect Left Tile。

建议保存：

```text
layoutModeBeforeFullscreen
```

---

# 23. Safe Area helper

建议抽象：

```js
function safeRectFor(output) { ... }
```

不要在 maximize、tile、outputChanged 中重复计算。

---

# 24. Layout geometry helper

建议统一：

```js
function rectForLayout(mode, safeRect, innerGap) {
    switch (mode) {
    case "maximize":
        return safeRect;
    case "left":
        ...
    case "right":
        ...
    case "top":
        ...
    case "bottom":
        ...
    case "topLeft":
        ...
    case "topRight":
        ...
    case "bottomLeft":
        ...
    case "bottomRight":
        ...
    }
}
```

该函数应是纯函数，不读写 Window 状态，便于测试。

---

# 25. `innerGap` 配置

在 `contents/config/main.xml` 新增：

```xml
<entry name="innerGap" type="int">
    <label>Gap between adjacent tiled windows</label>
    <default>8</default>
</entry>
```

配置 UI 增加：

```text
Inner gap: [ 8 px ]
```

推荐放在 Outer gaps 下方。

---

# 26. 配置界面最终建议

```text
CC Niri Maximize

Target monitor
Output name: [              ]
Empty = leftmost monitor

Outer gaps

              Top
            [ 42 px ]

   Left                 Right
 [ 10 px ]             [ 10 px ]

             Bottom
            [ 64 px ]

Tiling
Inner gap: [ 8 px ]

☐ Include dialog windows
☐ Debug logging
```

---

# 27. Dock 与 Safe Area

底部 Dock 仍然可以：

```text
Dodge Windows
Auto Hide
```

窗口 layout geometry 必须只基于：

```text
output.geometry
+
cc-niri-maximize 配置
```

而不是动态 `MaximizeArea`。

硬性验收：

```text
Dock show
Dock hide
Dock show
```

过程中：

```text
pseudo maximize geometry 不变
Quick Tile geometry 不变
```

---

# 28. 典型目标效果

## Maximize

```text
                    gapTop

      ┌────────────────────────────┐
      │                            │
      │        Maximized           │
      │                            │
      └────────────────────────────┘

                   gapBottom
```

## Left + Right

```text
                    gapTop

      ┌─────────────┐  G  ┌─────────────┐
      │             │     │             │
      │    Left     │     │    Right    │
      │             │     │             │
      └─────────────┘     └─────────────┘

                   gapBottom
```

---

# 29. 默认参数建议

先使用：

```text
gapTop    = 42
gapBottom = 64
gapLeft   = 10
gapRight  = 10
innerGap  = 8
```

如果实际截图觉得窗口之间太宽：

```text
innerGap = 6
```

如果想更明显的 niri 风格：

```text
innerGap = 10~12
```

默认推荐：

```text
8 px
```

---

# 30. 不要做的实现

禁止：

```text
setInterval
Timer 每 50ms / 100ms
frameGeometryChanged 无限重写
```

禁止：

```text
wmctrl
xdotool
xprop
```

禁止修改：

```text
/usr/share
Plasma Panel 配置
KWin 源码
```

必须保持：

```text
KWin Script
+
signal-driven
```

---

# 31. Debug logging 建议

开启 debug 后打印：

```text
[cc-niri-maximize]

OUTPUT_CHANGE
caption=...
old=HDMI-A-1
new=DP-1
maximizeMode=...
tileMode=...
fullscreen=false

LAYOUT_APPLY
mode=left
safeRect=10,42 2540x1334
innerGap=8
targetRect=10,42 1266x1334
```

这样能直接诊断 `Meta+Alt+Left` 与 `Meta+Left` 到底进入了哪个 signal path。

---

# 32. 必须补充的测试矩阵

## A. Native maximize 跨屏

```text
副屏 maximize
→ Meta+Alt+Left
```

期望：

```text
进入主屏 safeRect maximize
```

## B. 主屏 Quick Tile Left

```text
主屏 normal
→ Meta+Left
```

期望：

```text
safeRect 左半
```

顶部和底部 gap 保留。

## C. 主屏 Quick Tile Right

```text
Meta+Right
```

期望：

```text
safeRect 右半
```

## D. 左右双窗口

Window A：

```text
Meta+Left
```

Window B：

```text
Meta+Right
```

期望：

```text
A 和 B 中间存在 innerGap
```

约：

```text
8 px
```

## E. 四角

至少测试：

```text
TopLeft
TopRight
BottomLeft
BottomRight
```

确保横向和纵向均有 inner gap。

## F. Maximize → Tile

```text
normal
→ maximize
→ Meta+Left
```

期望：

```text
safeRect left
```

## G. Tile → Maximize

```text
normal
→ Meta+Left
→ maximize
```

期望：

```text
safeRect full
```

## H. Restore

经过：

```text
normal
→ maximize
→ left
→ right
→ maximize
→ restore
```

最终必须回到最初 normal geometry。

## I. 副屏 Quick Tile

副屏：

```text
Meta+Left
Meta+Right
```

期望：

```text
KDE 原生行为
```

不加 cc safe area。

## J. Quick Tile 跨屏

```text
副屏 Left Tile
→ Meta+Alt+Left
```

期望：

```text
主屏 safeRect Left Tile
```

## K. 主屏 Tile 移出

```text
主屏 safeRect Left
→ Meta+Alt+Right
```

期望：

```text
副屏 native Left Tile
```

## L. Fullscreen

从 left tile 进入 F11 必须真全屏。

退出 F11：

```text
恢复 left tile
```

## M. Dock hide/show

分别在：

```text
maximize
left
right
topLeft
```

状态下测试 Dock `show / hide`，geometry 不能变化。

---

# 33. Codex 推荐实现顺序

```text
1. 抽出 safeRectFor(output)
2. 抽出 rectForLayout(mode)
3. 新增 innerGap
4. 支持 Left / Right Quick Tile
5. 支持四角 / Top / Bottom
6. 修复 outputChanged + native maximize adopt
7. 修复 outputChanged + Quick Tile adopt
8. 修复 layout state 切换和 restoreGeometry
9. 验证 fullscreen
10. 验证 Dock
11. 最后补 Config UI
```

---

# 34. 最关键的设计原则

V2 的核心不再是：

```text
“最大化时缩小一点”
```

而是：

```text
主屏存在一个统一 Safe Area。
```

所有普通布局状态：

```text
maximize
left/right
top/bottom
四角
```

都必须在 Safe Area 内计算。

真正 Fullscreen 才跳出 Safe Area。

---

# 35. 最终用户体验

主屏：

```text
╭ Launcher ╮       ╭ Clock ╮       ╭ Status ╮


       ┌─────────────────────────┐
       │                         │
       │       Work Area         │
       │                         │
       └─────────────────────────┘


            ╭──── Dock ────╮
```

如果两窗口平铺：

```text
╭ Launcher ╮       ╭ Clock ╮       ╭ Status ╮


    ┌─────────────┐  8px  ┌─────────────┐
    │             │       │             │
    │   Window A  │       │   Window B  │
    │             │       │             │
    └─────────────┘       └─────────────┘


            ╭──── Dock ────╮
```

副屏：

```text
┌───────────────────────────┐
│                           │
│      SSH / Terminal       │
│      KDE native layout    │
│                           │
└───────────────────────────┘
```

---

# 36. Definition of Done

- [ ] 主屏 maximize 使用 safeRect。
- [ ] 副屏 maximize 移入主屏后自动转换为 safeRect maximize。
- [ ] 主屏 `Meta+Left` 使用 safeRect 左半。
- [ ] 主屏 `Meta+Right` 使用 safeRect 右半。
- [ ] Top/Bottom/四角 Quick Tile 使用 safeRect。
- [ ] 相邻 tile 之间有可配置 `innerGap`。
- [ ] 默认 `innerGap = 8 logical px`。
- [ ] Maximize ↔ Quick Tile 状态切换正确。
- [ ] Restore 回到最初 normal geometry。
- [ ] Quick Tile 跨屏后按新 output 正确重算。
- [ ] 主屏移到副屏后恢复 KDE 原生布局行为。
- [ ] Fullscreen 完全绕过 Safe Area。
- [ ] 退出 Fullscreen 恢复进入前 layout state。
- [ ] Dock hide/show 不改变任何 layout geometry。
- [ ] 不使用 polling。
- [ ] 不持续强制重写 `frameGeometryChanged`。
- [ ] journal 无持续 KWin scripting error。

---

# 37. 给 Codex 的直接任务

请基于当前 `cc-niri-maximize` 实现完成 V2。

先读取现有源码和当前机器 KWin API，不要覆盖已有可工作逻辑。

重点修复：

```text
1. outputChanged 时 native-maximized 窗口进入主屏的 adopt；
2. Quick Tile 的 safe-area geometry；
3. innerGap；
4. layout state 之间的 restoreGeometry 一致性。
```

不要把本项目扩大成完整 tiling window manager。

目标仍然是：

> **保留 KDE 原生工作流，只给主屏增加类似 niri 的统一 Safe Area 和 tile gaps。**
