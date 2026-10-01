# cc-niri × Quickshell 视觉与动画升级：模块化 Codex 实现设计

> **归档状态（2026-10-01）：** 部分实现；V1 MotionProfiles 已完成（bde8a03），V2–V11 尚未完整实施。
> 文档状态与阅读顺序见 [文档索引](../README.md)。原设计正文保留作为历史依据。

> **目标仓库：** `https://github.com/Cc-aw/cc-niri`  
> **参考项目：** `https://github.com/StatIndet/quickshell`（Clavis Shell）  
> **当前设计基线：** `cc-niri` `main`，V3 `3.0.0-alpha.41`，基线提交 `8b6c8873fb0f7a5d7ae83ea7a566008de3e70e9f`  
> **目标环境：** Fedora 44 / Plasma / KWin 6.7.5 / Wayland / 主屏 150% + 副屏 100% mixed-DPI  
> **文档用途：** 直接交给 Codex 分阶段实施。  
> **首要约束：** 所有新功能从一开始就模块化实现，禁止先把逻辑写进 `main.js`，再进行第二次重构。

---

# 1. 本轮目标

当前 `cc-niri` 的窗口管理核心已经基本稳定：

- 单窗口 Column；
- Pair 50/50；
- Focus Wide 72%；
- `Meta+H/L` 连续滚动；
- retargetable Motion；
- Native Viewport Clip；
- Dock UUID 双向同步；
- Floating；
- WindowPolicy；
- Adoption state machine；
- Bridge session / generation；
- Emergency Restore；
- StabilitySupervisor；
- Native CI gate；
- mixed-DPI 实机测试。

本轮**不再扩展窗口管理模型**。

本轮只做视觉层升级，使：

```text
KDE / KWin 稳定性
        +
niri-like Column workflow
        +
Clavis / Quickshell 风格的统一 Motion Language
```

形成一套适合长期日用的桌面体验。

本轮实现以下功能：

1. 统一 Window Motion Profile；
2. Dock State Layer；
3. Dock 邻居式 Hover Magnification；
4. Dock Launch Bounce；
5. 单一共享 Active Indicator；
6. Window Enter / Close-Refill 视觉统一；
7. Pair ↔ Wide expressive polish；
8. CC Presentation Pill Popup；
9. Dock Quick Actions Morph；
10. Dock / Popup Glass Surface polish。

---

# 2. 最重要的架构原则

## 2.1 不允许新逻辑重新堆入 `main.js`

当前存在：

```text
package/contents/code/main.js
effect/contents/code/main.js
```

其中 generated region 由：

```text
tools/build.js
```

生成。

本轮规则：

### KWin Script 新逻辑

必须放入：

```text
src/kwin/...
```

### KWin Effect 新逻辑

必须放入：

```text
src/effect/...
```

### Dock / Plasma UI 新逻辑

必须放入：

```text
plasmoid/com.cc.scrolltasks/qml/cc/...
```

`main.js` / `main.qml` 只允许：

```text
实例化 controller
绑定 property
转发 signal
调用模块公开 API
```

禁止出现：

```text
几十行 hover 算法
bounce 状态机
presentation morph 算法
动画 profile switch
复杂 if/else policy
```

---

# 3. Generated 文件规则

以下 generated 区域禁止手工修改：

```text
package/contents/code/main.js
effect/contents/code/main.js
```

新增 JS module 后：

```text
修改 src/...
        ↓
加入 tools/build.js modulePaths
        ↓
node tools/build.js
```

然后：

```bash
node tools/check.js
```

必须确保 generated bundle 与 source 同步。

---

# 4. QML 文件规则

新增：

```text
plasmoid/com.cc.scrolltasks/qml/cc/*.qml
```

后必须同步加入：

```text
plasmoid/com.cc.scrolltasks/CMakeLists.txt
```

中的：

```cmake
QML_SOURCES
```

禁止创建文件后仅依赖开发目录动态加载。

Native CI 必须能从 clean checkout 构建。

---

# 5. 不改变的核心状态所有权

本轮任何视觉功能都不能改变下面的 authority。

```text
Column order
    → KWin Column model

Window geometry
    → LayoutEngine / GeometryCommitter / relayout

Viewport Pair/Wide
    → ContextualViewport

Presentation
    → PresentationController

Wide transition lifecycle
    → ContextualWideCoordinator

Dock logical order
    → KWin authoritative columns[]
       + Dock generation/session protocol

Window eligibility
    → WindowPolicy

Recovery
    → StabilitySupervisor + Recovery
```

新视觉模块只能消费这些状态。

**视觉层不得反向成为逻辑状态源。**

---

# 6. 参考 Quickshell 时的许可证要求

参考仓库 `StatIndet/quickshell` 根许可证为 GPL-3.0。

本轮采用：

> **行为与设计思想借鉴，代码自行实现。**

允许借鉴：

- Motion token 分层；
- Spatial / Effects 分离；
- hover magnification 思路；
- launch bounce 交互；
- state layer；
- pill UI；
- progress-driven morph；
- enter / exit 不对称 duration；
- surface / glass 视觉语言。

本轮禁止直接复制：

```text
Animations.qml 大段代码
DockItem.qml 大段代码
SpotlightModeMorphSurface.qml shader / SDF 代码
Shader
完整 QML component
```

如果未来确实直接复用代码，再单独进行 GPL-3.0 license review。

---

# 7. 当前代码基础

当前已经存在：

```text
src/effect/
├── MotionClassifier.js
├── MotionController.js
├── MotionSampler.js
├── MotionTokens.js
├── MotionTransaction.js
├── ParkingAnimationGrabber.js
├── ViewportClipController.js
└── WideMotionGeometry.js
```

以及 Dock：

```text
plasmoid/com.cc.scrolltasks/qml/cc/
├── DockAppearance.qml
├── DockBridge.qml
├── DockController.qml
├── DockOrder.qml
├── DockPresentation.qml
└── DockState.qml
```

这说明：

> 本轮不创建第二套 Motion 系统。

尤其不要再创建与：

```text
MotionTokens.js
MotionController.js
```

职责重复的：

```text
NewMotionEngine.js
AnimationManager.js
MotionTheme2.js
```

---

# 8. 本轮最终模块结构

建议最终形成：

```text
src/effect/
├── MotionTokens.js                # 已有：基础 token
├── MotionProfiles.js              # 新增：语义 Motion profile
├── MotionSampler.js               # 已有
├── MotionController.js            # 已有：纯播放/retarget engine
├── MotionClassifier.js            # 已有
├── MotionTransaction.js           # 已有
├── WindowLifecycleMotion.js       # 新增：window enter / refill / optional exit
├── WideMotionGeometry.js          # 已有
├── WideMotionPolicy.js            # 新增：Wide 视觉策略
├── ParkingAnimationGrabber.js     # 已有
└── ViewportClipController.js      # 已有
```

Dock：

```text
plasmoid/com.cc.scrolltasks/qml/cc/
├── DockAppearance.qml             # 已有：颜色与基础尺寸
├── DockMotionTokens.qml           # 新增：Dock duration / scale token
├── DockMotionController.qml       # 新增：共享 hover / interaction 状态
├── DockMagnification.qml          # 新增：scale/offset 纯计算
├── DockStateLayer.qml             # 新增：hover/pressed/active overlay
├── DockLaunchFeedback.qml         # 新增：单 task launch bounce
├── DockActiveIndicator.qml        # 新增：单一共享 indicator
├── DockPresentationPopup.qml      # 新增：Normal/Wide/Max pill
├── PresentationPillButton.qml     # 新增：pill button visual
├── DockQuickActions.qml           # 新增：动作 bubble/morph
├── DockSurface.qml                # 新增：统一 translucent surface
├── DockBridge.qml                 # 已有
├── DockController.qml             # 已有
├── DockOrder.qml                  # 已有
├── DockPresentation.qml           # 已有
└── DockState.qml                  # 已有
```

测试：

```text
test/
├── motion-profiles.test.js
├── window-lifecycle-motion.test.js
├── wide-motion-policy.test.js
├── dock-motion-modules.test.js
├── dock-magnification.test.js
├── dock-launch-feedback.test.js
├── dock-active-indicator.test.js
├── dock-presentation-popup.test.js
└── dock-visual-contract.test.js
```

---

# 9. Window Motion 与 Dock Motion 必须分开

不要让：

```text
KWin Effect MotionTokens
```

直接被 QML Dock import。

两边技术栈和 runtime 不同。

应该：

```text
Window Motion
    → src/effect/MotionTokens.js

Dock Motion
    → qml/cc/DockMotionTokens.qml
```

但二者遵循相同**语义等级**：

```text
micro interaction
fast effect
spatial
expressive spatial
```

数值允许不同。

---

# 10. Motion Language

## 10.1 高频导航：克制

适用于：

```text
Meta+H/L
Dock far scroll
Reorder
```

要求：

```text
快速响应
平滑减速
无明显 overshoot
支持 retarget
```

现有：

```text
220 ms
OutCubic
```

继续作为基础。

## 10.2 Presentation：更 expressive

适用于：

```text
Pair → Wide
Wide → Pair
Presentation popup
Dock morph
```

要求：

```text
比滚动略慢
允许轻微 scale assist
不能明显弹簧
```

## 10.3 Micro interaction：很快

适用于：

```text
hover
pressed
state layer
indicator
```

目标：

```text
90 ~ 170 ms
```

用户不能感觉到“等待动画”。

---

# 11. Phase V0 — Baseline Freeze

**风险：无**

在 Codex 修改前先完成：

```bash
git status
node tools/build.js --check
node tools/check.js
```

记录：

```text
current main commit
current automated test count
current CI status
```

录制或手工记录：

1. `H/L`；
2. `L-L-H` retarget；
3. Pair → Wide → Pair；
4. Dock 点击 hidden task；
5. Dock active indication；
6. app launch；
7. close-refill。

这一阶段不改代码。

---

# 12. Phase V1 — MotionProfiles：语义层先独立

**优先级：P0**

当前 `MotionTokens.js` 已经有：

```javascript
microPressMs
microHoverMs
fastMs
spatialMs
spatialFastMs
resizeMs
expressiveEnterMs
expressiveExitMs
subtleIncomingScale
subtleIncomingOpacity
```

这些值保留。

问题在于：

> token 是数字，但“哪一种 transition 使用哪些 token”仍然容易散落到 runtime。

因此新建：

```text
src/effect/MotionProfiles.js
```

---

# 13. MotionProfiles.js 职责

只负责：

```text
MotionType
    ↓
duration
curve
allowed channels
default scale/opacity assist
retarget policy
```

它**不执行动画**。

示意：

```javascript
const MotionProfiles = Object.freeze({
    [MotionType.SCROLL]: {
        durationToken: "spatialMs",
        curve: MotionCurves.standardDecel,
        translation: true,
        scale: false,
        opacity: false,
        retarget: true,
    },

    [MotionType.DOCK_SCROLL]: {
        durationToken: "spatialMs",
        curve: MotionCurves.standardDecel,
        translation: true,
        scale: false,
        opacity: false,
        retarget: true,
    },

    [MotionType.CLOSE_REFILL]: {
        durationToken: "spatialFastMs",
        curve: MotionCurves.standardDecel,
        translation: true,
        scale: true,
        opacity: true,
        retarget: true,
    },

    [MotionType.PAIR_TO_WIDE]: {
        durationToken: "expressiveEnterMs",
        curve: MotionCurves.expressiveSpatial,
        translation: true,
        scale: true,
        opacity: false,
        retarget: true,
    },

    [MotionType.WIDE_TO_PAIR]: {
        durationToken: "expressiveExitMs",
        curve: MotionCurves.standardDecel,
        translation: true,
        scale: true,
        opacity: false,
        retarget: true,
    },
});
```

---

# 14. MotionProfiles 的边界

禁止它：

```text
读取 workspace
读取 Column state
写 geometry
访问 Bridge
访问 Dock
调用 animate()
```

它应该可以在 Node test 中纯测试。

---

# 15. MotionController 保持通用

`MotionController.js` 继续只负责：

```text
sample
visualSnapshot
retarget
channel assembly
animate()
animation completion
viewport clip role
```

不要在 `MotionController` 加：

```javascript
if (type === "WIDE") ...
if (type === "CLOSE") ...
```

所有语义选择放入 `MotionProfiles` / feature module。

---

# 16. Expressive Curve 的第一版规则

当前：

```javascript
MotionCurves.expressiveSpatial
```

最终在：

```text
MotionController.curveType()
```

仍映射为 `OutCubic`。

本轮第一版**不要为了复制 Quickshell Bezier 而破坏 sampler parity**。

原因：

```text
KWin animate() 的实际 easing
```

和：

```text
MotionSampler.sampleMotionState()
```

必须一致。

否则 retarget 时：

```text
采样 visual state != compositor 实际 visual state
```

会产生 snap。

因此 V1：

```text
expressiveSpatial
仍可以使用 OutCubic
```

“expressive”主要先来自：

```text
duration
scale assist
neighbor choreography
```

未来只有在：

```text
KWin custom easing
+
MotionSampler exact same easing
```

都能保证时，再引入自定义 Bezier。

---

# 17. Phase V1 文件

新增：

```text
src/effect/MotionProfiles.js
test/motion-profiles.test.js
```

修改：

```text
tools/build.js
src/effect/MotionTokens.js        # 仅必要时补 MotionType
```

`tools/build.js` 的 Effect module order：

```text
MotionTokens.js
MotionProfiles.js
MotionSampler.js
...
```

验收：

```text
H/L 行为完全不变
Dock scroll 行为完全不变
Wide 行为完全不变
```

---

# 18. Phase V2 — Dock Motion 基础模块

**优先级：P0**

新增：

```text
qml/cc/DockMotionTokens.qml
qml/cc/DockMotionController.qml
qml/cc/DockMagnification.qml
```

---

# 19. DockMotionTokens.qml

职责：

```text
仅存 UI animation constants
```

建议第一版：

```text
pressMs               90
hoverMs              110
indicatorMs          170
launchUpMs           220
launchSettleMs       340
stateLayerMs         120
popupEnterMs         210
popupExitMs          175
pillResizeMs         220

hoverScaleSelf      1.15
hoverScaleNear      1.07
hoverScaleFar       1.02
pressScale          0.97

launchTravelPx       10~14
```

Quickshell 的 Dock launch bounce 约 19 px，但 cc-niri 第一版不要直接复制，因为 KDE panel 高度和 icon size 不同。

---

# 20. DockMotionController.qml

**这是 Dock 视觉状态唯一 owner。**

状态：

```qml
property int hoveredTaskIndex: -1
property int pressedTaskIndex: -1
property int activeTaskIndex: -1
property bool pointerInsideDock: false
property bool contextActive: false
property bool dragActive: false
property bool visualEffectsEnabled: true
property bool reducedMotion: false
```

公开 API：

```text
setHovered(index)
clearHovered(index)
setPressed(index)
clearPressed(index)
clearTransientState()

scaleFor(index)
offsetFor(index)
```

它不能参与：

```text
DockOrder
generation
Bridge
presentation command
```

---

# 21. DockMagnification.qml

做成**纯计算模块**。

输入：

```text
index
hoveredIndex
panel edge
```

输出：

```text
scale
translation
transform origin
```

第一版：

```text
distance = abs(index - hoveredIndex)

0 → 1.15
1 → 1.07
2 → 1.02
>2 → 1.00
```

---

# 22. 第一版不做 layout reflow

当前 `CC Scroll Tasks` 还承担：

```text
manual task order
drag reorder
TaskManager delegate geometry
published icon geometry
tooltip anchoring
```

如果让：

```text
delegate width 随 hover 改变
```

会影响太多逻辑。

因此第一版：

> **只放大 icon visual，不改变 Task delegate geometry。**

允许 icon 轻微超出自己的 cell。

---

# 23. Phase V3 — Dock Hover Magnification

**优先级：P0**

修改：

```text
qml/main.qml
qml/Task.qml
CMakeLists.txt
```

main.qml 只实例化：

```qml
TaskManagerApplet.DockMotionTokens {
    id: ccDockMotionTokens
}

TaskManagerApplet.DockMotionController {
    id: ccDockMotion
    tokens: ccDockMotionTokens
}
```

并暴露 alias。

不要在 main.qml 写 scale formula。

---

# 24. Task.qml Hover

新增一个不会抢 `DragHandler/TapHandler` grab 的 hover observer。

行为：

```text
enter
→ dockMotion.setHovered(index)

exit
→ dockMotion.clearHovered(index)
```

不要修改现有：

```text
TapHandler
DragHandler
leftClick()
ContextMenu
```

---

# 25. Magnification 作用于 visual host

当前核心结构：

```text
Loader id: iconBox
  └ Kirigami.Icon id: icon
```

建议内部增加：

```text
IconLayoutBox
└── LaunchMotionHost
    └── HoverMotionHost
        └── PressHost
            └── Icon + Badge/Progress
```

不要修改：

```text
task.width
task.height
TaskList GridLayout geometry
```

---

# 26. Hover 动画

使用：

```text
Behavior on scale
110 ms
OutCubic
```

快速横移：

```text
1 → 2 → 3 → 4
```

要求：

```text
新 hover target 立即成为新 target
旧 target 直接 retarget 回 1.0
```

不要 SpringAnimation。

---

# 27. Panel 四方向

Bottom：

```text
icon 向上生长
```

Top：

```text
icon 向下生长
```

Left：

```text
icon 向右生长
```

Right：

```text
icon 向左生长
```

依据：

```text
Plasmoid.location
```

确定 transform origin。

---

# 28. Hover 与 Drag / Context Menu

当：

```text
DragHandler.active
```

时：

```text
hover magnification disabled
scale → 1
```

当 context menu active：

```text
允许当前 task 保持 1.05~1.07
```

但不要保持 1.15。

---

# 29. Tooltip 与 Published Geometry

Tooltip 继续锚定：

```text
Task delegate
```

不要锚定放大后的 visual icon。

`publishIconGeometries()` 继续发布**逻辑 task geometry**。

不要发布 hover magnified visual geometry。

---

# 30. Phase V4 — Dock State Layer

**优先级：P0**

新增：

```text
qml/cc/DockStateLayer.qml
```

借鉴 Quickshell StateLayer 思想，但自行实现。

输入：

```qml
property bool hovered
property bool pressed
property bool active
property bool dragging
property bool dropTarget
property real radius
```

---

# 31. State 优先级

建议：

```text
dragging/dropTarget
    >
pressed
    >
active + hovered
    >
active
    >
hovered
    >
normal
```

不要在 Task.qml 各处重复颜色判断。

---

# 32. DockAppearance 扩展

当前 `DockAppearance.qml` 已拥有：

```text
activeBackgroundColor
activeIndicatorColor
margin
radius
```

增加：

```text
hoverLayerColor
pressLayerColor
activeHoverLayerColor
dropTargetLayerColor
hoverLayerOpacity
pressLayerOpacity
activeHoverLayerOpacity
dropTargetLayerOpacity
```

`DockStateLayer.qml` 消费这些值。

---

# 33. 删除旧 activeBackground

当前 `Task.qml` 中：

```qml
Rectangle {
    id: activeBackground
    ...
}
```

Phase V4 后由：

```text
DockStateLayer
```

取代。

不要保留两套背景反馈。

StateLayer 只动画：

```text
opacity
color（必要时）
```

建议：

```text
120~150 ms
```

---

# 34. Phase V5 — Dock Launch Bounce

**优先级：P0**

新增：

```text
qml/cc/DockLaunchFeedback.qml
```

每个 task 一个轻量实例。

优先使用 KDE TaskManager 已有：

```text
model.IsStartup
```

不要为了 bounce 新增 Bridge 协议。

---

# 35. Launch 动画语义

收到：

```text
IsStartup false → true
```

或 delegate 创建时：

```text
IsStartup == true
```

触发一次：

```text
0 → launchTravelPx
→ 0
```

建议：

```text
up phase:
220 ms
OutQuad / OutCubic

settle:
340 ms
OutBounce 或克制的分段 easing
```

---

# 36. Bounce 不随 mapping 提前终止

一旦 launch animation 开始，即使：

```text
IsStartup 很快变 false
```

当前 animation 也完整结束。

一个 startup lifecycle 只触发一次。

模块内部维护：

```text
lastStartupState
launchEpoch
running
```

---

# 37. Bounce 方向

依据 panel location：

```text
Bottom → y 向上
Top    → y 向下
Left   → x 向右
Right  → x 向左
```

---

# 38. Transform Channel 分层

不要：

```text
Hover 写 icon.y
Launch 写 icon.y
Press 写 icon.scale
Magnify 写 icon.scale
```

正确：

```text
LaunchMotionHost        # translation
└── HoverMotionHost     # magnification scale
    └── PressHost       # micro press scale
        └── Icon
```

每个模块只拥有自己的 transform channel。

---

# 39. Badge / Progress Overlay

如果 hover 只放大 Icon，而 badge 不动，会显得脱节。

建议：

```text
Icon + Badge + Progress
```

一起放入 HoverMotionHost。

Active Indicator 不放进去。

---

# 40. Phase V6 — 单一 Shared Active Indicator

**优先级：P1**

当前每个 Task 都有：

```qml
Rectangle id: activeIndicator
```

升级为：

> **整个 Dock 只有一个 active indicator。**

新增：

```text
qml/cc/DockActiveIndicator.qml
```

---

# 41. Shared Indicator 所有权

放在：

```text
main.qml / TaskList 上层 visual overlay
```

不要放在每个 Task delegate 内。

`DockMotionController` 维护：

```text
activeTaskIndex
```

或由 root 扫描唯一 active task。

通过：

```text
targetItem.mapToItem(...)
```

得到 indicator target geometry。

---

# 42. Indicator 动画

动画：

```text
x/y/width/height/opacity
170 ms
OutCubic
```

视觉：

```text
[1] [2] [3]
     ━━━

focus 3

[1] [2] [3]
         ━━━
```

V6 完成后删除 `Task.qml` 原 per-task indicator。

---

# 43. Phase V7 — WindowLifecycleMotion

**优先级：P1**

新增：

```text
src/effect/WindowLifecycleMotion.js
```

目标：

> 将现有 close-refill 的 `0.985 / 0.85` 语言扩展成统一的窗口生命周期视觉策略。

第一版处理：

```text
managed window insertion settle
close-refill surviving windows
reattach settle
```

实际 closed surface fade 作为 V7.2。

---

# 44. 不抢 Adoption ownership

`AdoptionController` 仍决定：

```text
什么时候窗口可以进入 Column
```

`WindowLifecycleMotion` 只能在：

```text
Adoption confirmed
+
final managed geometry known
```

后请求 visual settle。

---

# 45. WINDOW_ENTER MotionType

在 `MotionTokens.js` 增加：

```text
WINDOW_ENTER
```

profile：

```text
duration ≈ 220~260 ms
curve = standardDecel
scale 0.985 → 1
opacity 0.85 → 1
optional small translation → 0
```

新窗口不要从 Dock 飞出来。

第一版只允许：

```text
8~12 logical px 以内的小 translation
```

---

# 46. CLOSE_REFILL 统一

现有 `CLOSE_REFILL` 已经使用：

```text
scale 0.985 → 1
opacity 0.85 → 1
```

不要重写。

把 channel selection / duration 改由：

```text
MotionProfiles
+
WindowLifecycleMotion
```

生成。

---

# 47. V7.2 — Closed window fade（可选）

在 Fedora 44 / KWin 6.7.5 做独立 POC。

确认：

```text
effects.windowClosed
```

触发时是否能安全对 closing EffectWindow 做短 opacity/scale animation，并且不与 KWin close effect 冲突。

如果 POC 不稳定：

> **不实现 closed surface fade。**

surviving refill 已经足够优雅。

---

# 48. Phase V8 — WideMotionPolicy

**优先级：P1**

新增：

```text
src/effect/WideMotionPolicy.js
test/wide-motion-policy.test.js
```

保留已有：

```text
WideMotionGeometry.js
ContextualWideCoordinator
```

职责：

```text
WideMotionGeometry
→ 几何推导

WideMotionPolicy
→ 视觉 choreography
```

---

# 49. Pair → Wide

目标窗口：

```text
50%
→
72% centered
```

视觉：

```text
Translation + Scale
duration = expressiveEnterMs ≈ 320 ms
```

邻居：

```text
沿其原本空间方向 slide out
```

不要直接 opacity 1 → 0。

---

# 50. Wide → Pair

目标：

```text
72%
→
50% slot
```

邻居：

```text
从正确边缘 slide back
```

duration：

```text
expressiveExitMs ≈ 240 ms
```

退出比进入快。

---

# 51. Wide 仍然可 retarget

动画中：

```text
Pair → Wide
```

用户立即 `Meta+Z`：

```text
sample current visual
→ retarget Wide → Pair
```

不能 snap。

并继续保持两步导航规则：

```text
2|3
Meta+H
→ 1|2
Meta+H
→ 1 Wide
```

---

# 52. Phase V9 — Presentation Pill Popup

**优先级：P1**

目标：

将当前 ContextMenu 中：

```text
CC Scroll
Normal
Focus Wide
Maximize in Safe Area
```

升级成更精致的 chooser。

但必须保留 KDE Task Manager 原生 context menu 的其他能力。

---

# 53. 不重写完整 ContextMenu

禁止为了 Pill UI 重写：

```text
Places
Recent Files
MPRIS
Activities
Virtual Desktop
Pin
Close
More
```

这些继续使用 KDE 原生菜单。

---

# 54. 推荐交互

把当前三个 checkable item 收敛为：

```text
CC Layout…
```

点击后打开：

```text
DockPresentationPopup.qml
```

锚定当前 Task。

Popup 内容：

```text
╭───────────────────────────────╮
│  Normal    Wide    Maximize   │
╰───────────────────────────────╯
```

---

# 55. Popup 模块边界

输入：

```text
windowUuid
currentMode
anchorItem
```

输出：

```text
modeRequested(uuid, mode)
closed()
```

它**不能自己调用 Bridge**。

由：

```text
DockController / DockPresentation
```

继续处理 request。

---

# 56. PresentationPillButton

新增：

```text
qml/cc/PresentationPillButton.qml
```

状态：

```text
active
hovered
pressed
```

动画：

```text
radius
background
scale
content opacity
```

建议：

```text
pressedScale = 0.97
resize ≈ 220 ms
state color ≈ 150 ms
```

第一版用普通 Rectangle + radius + Behavior，不使用 Material Shape Shader。

---

# 57. Popup enter / exit

Enter：

```text
opacity 0 → 1
scale 0.97 → 1
translation 6 px → 0
≈ 210 ms
```

Exit：

```text
opacity 1 → 0
scale 1 → 0.985
≈ 175 ms
```

---

# 58. Phase V10 — Dock Quick Actions Morph

**优先级：P2**

目标：

让 Presentation Popup 后续扩展成一个有轻量 morph 的快捷动作 surface。

但不改变 task 左键语义。

第一版只通过：

```text
CC Layout…
```

进入 popup。

不要用 active task 左键第二次触发。

---

# 59. Quick Actions 内容

第一排：

```text
Normal
Wide
Maximize
```

第二排可选：

```text
Floating
Close
```

`Floating` 必须走现有 Dock/KWin command path。

Close 继续调用：

```text
tasksModel.requestClose()
```

---

# 60. Morph 视觉

借鉴 Spotlight “主 pill + 后续 button 逐个出现”的思想，但自行实现简单版。

不要 Shader。

使用：

```text
progress 0..1
```

驱动：

```text
button opacity
button scale
button offset
```

例如：

```text
button 0 delay 0 ms
button 1 delay 25 ms
button 2 delay 50 ms
```

只使用 Bezier/OutCubic + stagger，不使用 SpringAnimation 和 damped oscillator。

---

# 61. Phase V11 — DockSurface / Glass Polish

**优先级：P2**

新增：

```text
qml/cc/DockSurface.qml
```

统一：

```text
background color
alpha
radius
border
inner contrast
state layer host
```

不要让每个 popup 自己写颜色。

---

# 62. KDE Blur 策略

不要复制 Quickshell 的 `BlurService.qml`。

你的环境是 KDE/KWin，不是 Niri Layershell。

第一版：

> 使用 Plasma / panel / popup 本身已有 compositor blur 能力，只负责绘制半透明 surface。

即：

```text
CC QML
→ translucent surface

KWin / Plasma theme
→ 是否 blur
```

不要新增第二个 native blur KWin effect。

---

# 63. Glass 参数建议

保持克制：

```text
surface alpha ≈ 0.86~0.94
border alpha  ≈ 0.10~0.18
large radius
```

不要极低 alpha + 重 shadow。

---

# 64. Reduced Motion 接口

从第一版就给 `DockMotionController` 留：

```text
visualEffectsEnabled
reducedMotion
```

reduced motion 时：

```text
hover 小幅保留
launch bounce disable
popup morph 改 fade
```

本轮不必做设置页，但 API 不要堵死。

---

# 65. Drag Snapshot

当前 DragHandler：

```text
icon.grabToImage(...)
```

如果 icon 正处于放大状态，snapshot 可能带 scale。

第一版：

```text
drag active
→ hover target = 1
→ 禁止 magnification
```

然后实机验证 snapshot。

如果仍有问题，再单独修 snapshot source；不要在 Hover Phase 顺手重写 DnD。

---

# 66. Window Motion 不使用 Dock IPC

不要让 Dock visual token 通过 D-Bus 发给 KWin。

两边只是：

```text
设计语义一致
实现独立
```

这样避免高频 pointer motion 进入 Bridge。

---

# 67. Codex 每个 Phase 的执行规则

Codex 每个 Phase 都必须：

1. 先读当前相关模块；
2. 新建目标 module；
3. 写 module test；
4. 再做最少 wiring；
5. 更新 CMake/build.js；
6. `node tools/build.js`；
7. `node tools/check.js`；
8. native build / CI；
9. 不顺手重构无关代码；
10. 一个 Phase 一个独立 commit。

---

# 68. 禁止“大提交”

禁止一个 commit 同时实现：

```text
hover
launch bounce
state layer
wide
popup
glass
```

推荐：

```text
feat: add dock motion tokens and controller
feat: add dock hover magnification
feat: add dock interaction state layer
feat: add dock launch feedback
feat: add shared active indicator
refactor: centralize window motion profiles
feat: add managed window lifecycle settle motion
feat: polish contextual wide motion
feat: add CC presentation pill popup
feat: add dock quick-action morph
style: add CC dock surface polish
```

---

# 69. 每阶段必须可回滚

任何一个 Phase revert 后：

```text
cc-niri 核心窗口管理仍然正常
```

例如 revert Dock Magnification 不能让 DockBridge 或 TaskModel 编译失败。

---

# 70. Test Strategy — Window Effect

纯 JS module：

```text
MotionProfiles
WindowLifecycleMotion
WideMotionPolicy
```

必须直接 Node test。

重点验证：

```text
profile mapping
channel ownership
duration selection
retarget flag
no geometry write
```

---

# 71. Test Strategy — Dock QML

QML 视觉模块主要依靠：

```text
native build
source contract tests
manual acceptance
```

至少检查：

```text
Task.qml 不 hardcode motion token
新 QML file 已进入 CMake
只有一个 shared active indicator
DockMotionController 是唯一 hover state owner
DockPresentationPopup 不直接访问 DBus
```

---

# 72. 自动化 Visual Invariant

新增 visual contract：

```text
1. Dock magnification 不修改 Task delegate width/height
2. Launch feedback 不修改 DockOrder
3. StateLayer 不调用 Bridge
4. PresentationPopup 不直接调用 D-Bus
5. MotionProfiles 不调用 animate
6. WindowLifecycleMotion 不写 frameGeometry
7. WideMotionPolicy 不写 presentation state
8. main.js/main.qml 不出现新 feature algorithm
```

---

# 73. 代码体积约束

不是严格行数限制，但建议：

```text
单 feature module
≈ 50~250 lines
```

如果 QML 超过 300~400 行，优先拆：

```text
visual
controller
policy
```

不要等 800 行以后再拆。

---

# 74. Manual Acceptance — Dock Hover

场景：

```text
5 个 running windows
3 个 pinned launcher
```

测试：

```text
slow hover
fast sweep
left/right reverse
hover active task
hover launcher
hover during startup
hover then right click
hover then drag
```

必须：

- 无 scale stuck；
- 无 delegate resize；
- 无 reorder 抖动；
- indicator 不跟 icon 一起放大；
- tooltip 不跳；
- drag 正常。

---

# 75. Manual Acceptance — Launch

测试：

```text
Konsole
Firefox
Electron/Typora
```

分别：

```text
快速启动
慢启动
重复点击
启动后马上 hover
```

要求：

```text
一次 launch 一次 bounce
bounce 自己完整结束
不会无限 bounce
```

---

# 76. Manual Acceptance — Active Indicator

快速：

```text
Meta+H/L
Dock click
Alt+Tab
```

检查：

```text
indicator 始终只有一个
平滑滑向新 active task
无瞬时双线
```

---

# 77. Manual Acceptance — Window Enter

打开：

```text
Konsole
Firefox
Electron
```

要求：

```text
先 Adoption 正确
再做 visual settle
```

严禁窗口还没完成 geometry settle 就开始错误 scale animation。

---

# 78. Manual Acceptance — Wide

测试：

```text
1|2 → 1 Wide
1 Wide → 1|2

2|3 → H → 1|2 → H → 1 Wide

Wide → L
Wide → H
快速 Z Z
快速 H/L
```

必须：

```text
无 snap
无 ghost
无副屏 leak
无 neighbor fade teleport
```

---

# 79. Manual Acceptance — Presentation Popup

测试：

```text
右键 task
→ CC Layout
→ popup
```

然后：

```text
Normal
Wide
Maximize
Esc
click outside
快速重复打开关闭
```

要求：

- anchor 正确；
- popup 不抢坏 task focus；
- mode 命令只发一次；
- stale popup 不操作已关闭 window；
- Task 关闭时 popup 自动关闭。

---

# 80. Mixed-DPI Acceptance

主屏：150%，副屏：100%。

重点测试：

```text
Window Wide
Window Scroll
Dock popup
Dock hover
```

Dock visual 不得影响 native clip。

---

# 81. Performance Budget

Dock hover 是高频路径。

禁止每次 mouse move：

```text
JSON stringify
D-Bus
遍历完整 TaskModel 多次
创建 Component
读取文件
```

`scaleFor(index)` 必须接近纯数学函数。

---

# 82. Animation Budget

不要同时给一个 icon 上：

```text
blur animation
shadow animation
scale animation
rotation animation
opacity animation
translation animation
```

第一版只：

```text
scale
translation
state overlay
```

KWin Window motion 继续使用：

```text
Translation
Scale
Opacity
```

本轮不加 window blur / 3D / parallax。

---

# 83. Failure Policy

如果视觉模块失败：

```text
视觉退化
```

不能：

```text
窗口不可操作
```

例如 DockMotionController 异常时，Dock 仍应可以点击任务。

WindowLifecycleMotion 异常时，final geometry 仍必须由 LayoutEngine / GeometryCommitter 提交。

---

# 84. Emergency Restore

现有 Emergency Restore 继续拥有最高优先级。

触发时：

```text
cancel all KWin motion
restore parked windows
disable layout as designed
```

Dock QML 动画不能阻止 recovery。

---

# 85. Output topology change

当：

```text
屏幕断开
scale changed
screen order changed
```

Window Motion：

```text
允许 snap to authority
```

Dock：

```text
hover/controller state clear
popup close
```

低频 topology change 不要求做动画。

---

# 86. 推荐配置开关

第一版可以先内部 property：

```text
EnableDockMagnification
EnableLaunchBounce
EnableExpressiveWide
EnablePresentationPopup
```

方便单项回退。

稳定后再决定是否暴露到 Config UI。

---

# 87. 推荐参数总表

## Window

| Motion | Duration | Channels |
|---|---:|---|
| H/L Scroll | 220 ms | Translation |
| Dock Scroll | 220 ms | Translation |
| Reorder | 220 ms | Translation |
| Close Refill | 190~220 ms | Translation + Scale + Opacity |
| Window Enter | 220~260 ms | Scale + Opacity + optional small Translation |
| Pair → Wide | 320 ms | Translation + Scale |
| Wide → Pair | 240 ms | Translation + Scale |

## Dock

| Motion | Duration |
|---|---:|
| Press | 90 ms |
| Hover | 110 ms |
| State Layer | 120~150 ms |
| Active Indicator | 170 ms |
| Launch Up | 220 ms |
| Launch Settle | 340 ms |
| Popup Enter | 210 ms |
| Popup Exit | 175 ms |
| Pill Resize | 220 ms |

---

# 88. Dock magnification 参数

```text
hovered  = 1.15
distance1 = 1.07
distance2 = 1.02
other     = 1.00
```

如果偏活泼：

```text
1.12 / 1.05 / 1.01
```

第一版不要超过 1.18。

---

# 89. Window Enter 参数

```text
scale:
0.985 → 1

opacity:
0.85 → 1

translation:
最多 8~12 logical px
```

不能使用：

```text
scale 0.8
translate 100 px
```

---

# 90. Phase 顺序

严格建议：

```text
V0 Baseline
 ↓
V1 MotionProfiles
 ↓
V2 Dock Motion Foundation
 ↓
V3 Dock Hover Magnification
 ↓
V4 Dock State Layer
 ↓
V5 Launch Bounce
 ↓
V6 Shared Active Indicator
 ↓
V7 Window Lifecycle Motion
 ↓
V8 Wide Motion Polish
 ↓
V9 Presentation Pill Popup
 ↓
V10 Quick Actions Morph
 ↓
V11 Glass Surface Polish
 ↓
Visual Freeze
```

不要并行大改 V7/V8 和 Dock 大量 QML。

---

# 91. 为什么先 Dock 再继续窗口视觉

当前窗口 Motion 已经相对成熟：

```text
retarget
clip
wide coordinator
motion transaction
```

Dock 视觉升级风险更低。

先完成 V2~V6 可以获得明显视觉收益，而不碰窗口状态机。

---

# 92. 每个 Phase 的完成定义

```text
[ ] 模块已独立
[ ] main wiring 很薄
[ ] 自动 test PASS
[ ] generated bundle PASS
[ ] native build PASS
[ ] V3 smoke test PASS
[ ] 无新 warning loop
[ ] 对应 manual acceptance PASS
[ ] 单独 commit
```

---

# 93. V3 Smoke Test 必跑

每个 Phase 后：

```text
1. 打开 5 个普通窗口
2. H/L 来回
3. 快速 L-L-H
4. Pair → Wide → Pair
5. Dialog
6. Floating detach/reattach
7. Dock hidden task jump
8. Dock reorder
9. Close focused window
10. Bridge restart
```

任何视觉改动不能破坏这些。

---

# 94. Codex 不得顺手修改的区域

除非编译必须，不要动：

```text
WindowPolicy
AdoptionController semantic rules
DockGateway protocol
Bridge command schema
Recovery semantics
StabilitySupervisor policy
Native viewport clipping mapping
Output ownership
```

这些不是视觉工程的一部分。

---

# 95. Codex Prompt — Phase V1

```text
按照 cc-niri_Quickshell视觉升级_模块化实现设计.md 的 Phase V1 实现。

只实现 MotionProfiles：
1. 新建 src/effect/MotionProfiles.js；
2. 将各 MotionType 的 duration / curve / channel policy 集中进去；
3. MotionController 保持通用，不加入 feature-specific if/else；
4. 更新 tools/build.js；
5. 新建 test/motion-profiles.test.js；
6. 不改变任何最终视觉和行为；
7. 运行 node tools/build.js 和 node tools/check.js；
8. 不实现后续 Phase。
```

---

# 96. Codex Prompt — Dock Foundation

```text
只实现 Phase V2。

新建：
- DockMotionTokens.qml
- DockMotionController.qml
- DockMagnification.qml

main.qml 只负责实例化并暴露 alias。
不要修改 Task.qml 的视觉。
更新 CMakeLists.txt。
加入模块 contract test。
不要提前实现 hover、bounce、indicator。
```

---

# 97. Codex Prompt — Hover

```text
只实现 Phase V3 Dock Hover Magnification。

必须：
- 使用现有 DockMotionController；
- Task delegate geometry 不改变；
- 不修改 DockOrder / DockBridge；
- hover scale 作用于 icon visual host；
- drag 时 disable；
- panel 四方向 transform origin 正确；
- token 不 hardcode 到 Task.qml。
```

---

# 98. Codex Prompt — Launch

```text
只实现 Phase V5 Dock Launch Feedback。

新增 DockLaunchFeedback.qml。
使用 model.IsStartup 触发。
一个 startup lifecycle 只启动一次。
动画启动后即使 IsStartup 结束也完整 settle。
不要新增 Bridge IPC。
不要修改 Task delegate geometry。
```

---

# 99. Codex Prompt — Window lifecycle

```text
只实现 Phase V7。

新增 WindowLifecycleMotion.js。
不要改变 AdoptionController。
仅在 managed final geometry 已确认后请求视觉 settle。
统一已有 CLOSE_REFILL 视觉 profile。
第一提交不实现 closing window surface fade。
```

---

# 100. Codex Prompt — Wide

```text
只实现 Phase V8。

新增 WideMotionPolicy.js。
WideMotionGeometry 继续只负责 geometry。
ContextualWideCoordinator 继续拥有 Wide lifecycle。
目标窗口 Translation+Scale，邻居方向性 slide。
保持两步 Wide navigation semantics。
所有动作支持当前 visual state retarget。
```

---

# 101. Codex Prompt — Presentation Popup

```text
只实现 Phase V9。

保留 KDE 原生 ContextMenu。
将 CC Scroll 的三个 presentation checkable items 收敛为一个 CC Layout... 入口。
新增独立 DockPresentationPopup.qml 和 PresentationPillButton.qml。
Popup 只 emit modeRequested，不直接访问 DBus。
DockPresentation/DockController 继续发送现有命令。
```

---

# 102. 旧设计文档关系

仓库现有：

```text
doc/todo/CC_Niri_Maximize_Clavis_Motion_实现设计.md
```

主要针对早期 alpha.30：

```text
Scroll FLIP
retarget
Wide Motion
```

其中很多基础设施现在已经实现。

本文件应视为：

> **alpha.41 之后的第二阶段视觉升级设计。**

不要重新实施旧文档已经完成的：

```text
MotionController
Retargetable H/L
Native clipping
MotionTransaction
```

---

# 103. 最终视觉目标

## Window

```text
稳
连续
快速
克制
```

用户高频 H/L 时不应该明显感觉“系统在演动画”。

## Wide

```text
更柔和
更有空间感
略 expressive
```

用户应能理解邻居去了哪、当前窗口如何从 Pair 成为 Wide。

## Dock

Dock 是本轮最允许“有性格”的部分：

```text
hover magnification
launch bounce
state layer
moving indicator
pill morph
glass surface
```

但每一个效果都应独立、可关闭、可回滚。

---

# 104. 最终架构图

```text
                    CC Niri
                       │
          ┌────────────┴────────────┐
          │                         │
   Logical Window Core          Visual System
          │                         │
          │                ┌────────┴────────┐
          │                │                 │
   Layout / Policy       KWin Effect       Dock QML
          │                │                 │
   authoritative       MotionProfiles    DockMotionTokens
   geometry/state      MotionController  DockMotionController
          │            LifecycleMotion   Magnification
          │            WidePolicy        StateLayer
          │                              LaunchFeedback
          │                              ActiveIndicator
          │                              PresentationPopup
          │                              QuickActions
          │
          └────────── no reverse ownership ──────────┘
```

---

# 105. 最终源码职责

```text
MotionTokens
    数值

MotionProfiles
    语义映射

MotionController
    动画执行/retarget

WindowLifecycleMotion
    窗口生命周期视觉请求

WideMotionPolicy
    Wide choreography

DockMotionTokens
    Dock 数值

DockMotionController
    Dock visual state

DockMagnification
    纯 scale/offset 计算

DockStateLayer
    interaction feedback

DockLaunchFeedback
    launch local lifecycle

DockActiveIndicator
    shared focus feedback

DockPresentationPopup
    layout chooser surface

DockQuickActions
    optional morph actions

DockSurface
    consistent visual surface
```

---

# 106. 不允许出现的未来重构债

完成本轮后，不应出现：

```text
“把 Task.qml 里的动画再拆出来”
“把 main.qml 里的 hover state 再拆 controller”
“把 effect main 里的 Wide 条件再抽 policy”
“把每个组件自己的 120ms/170ms 再统一”
```

因为这些边界必须从第一行代码开始就建立。

---

# 107. 最终验收

## Architecture

```text
[ ] 新 feature 全在独立模块
[ ] main.js/main.qml 无大型 feature logic
[ ] token 无散落 hardcode
[ ] Window 与 Dock 状态所有权分开
```

## Window

```text
[ ] H/L 原有稳定性不退化
[ ] retarget 无 snap
[ ] enter settle 自然
[ ] close-refill 统一
[ ] Wide 更柔和且空间方向清晰
[ ] mixed-DPI 无 leak
```

## Dock

```text
[ ] hover magnification
[ ] neighbor attenuation
[ ] launch bounce
[ ] state layer
[ ] single sliding active indicator
[ ] drag/reorder 不受影响
[ ] tooltip 不抖
[ ] published task geometry 稳定
```

## Presentation

```text
[ ] native context menu 保留
[ ] CC Layout popup 可打开
[ ] Normal/Wide/Max pill 正确
[ ] popup enter/exit 自然
[ ] stale task 不执行命令
```

## Stability

```text
[ ] node regression PASS
[ ] native CI PASS
[ ] daily smoke PASS
[ ] Bridge restart PASS
[ ] Emergency Restore PASS
```

---

# 108. 最后的开发原则

本轮最重要的不是：

```text
“把 Quickshell 的效果都搬过来”
```

而是：

```text
只借鉴它成熟的视觉语言
+
保持 cc-niri 已经建立的状态所有权和稳定性
```

最终应该形成：

```text
窗口：
低调、连续、可靠

Dock：
灵动、精致、可交互

Presentation：
柔和、有空间感

底层：
仍然 deterministic
```

这才是适合长期日用的 `cc-niri`。
