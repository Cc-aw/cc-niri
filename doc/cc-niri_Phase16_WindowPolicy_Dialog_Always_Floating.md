# CC Niri Phase 16：Window Policy & Dialog Always-Floating 实现设计

> 项目：`Cc-aw/cc-niri`  
> 当前基线：`1e873641d4a59fcd12f9e4230cf4fcba039d46d4` / `3.0.0-alpha.39`  
> 前置阶段：Phase 15.1 Contextual Wide Runtime Hardening 已完成。  
> 本阶段目标：建立统一 `WindowPolicy`，让 Dialog / Transient / Modal / Utility 等辅助窗口明确成为 **Policy Floating**，永远不进入 Column 队列，同时保持 KWin/客户端原生 transient placement。  
> 下一阶段：Phase 17 Multi-window Column。  
>
> 核心原则：
>
> ```text
> Window type decides ownership.
> Policy decides eligibility.
> Layout must not guess window semantics.
> ```
>
> 第一版只解决“谁可以进入 Column”，不重新实现 KWin 的 Dialog 摆放器。

---

# 1. 为什么现在做 Window Policy

当前 `alpha.39` 已经把 Wide 子系统稳定下来：

```text
ContextualViewport
ContextualWideCoordinator
MotionPlanCommitGate
Native Motion/Clip handoff
```

下一阶段准备实现：

```text
一个 Column 内多个 Window
```

在改变：

```text
Column == Window
```

之前，必须先回答一个基础问题：

> **哪些 KWin Window 有资格成为 Column member？**

Dialog 是最明显的例子。

例如：

```text
VS Code
├── Main Window        → Column member
└── Open File Dialog   → 不应该成为新的 Column
```

如果没有统一 Policy，未来 Multi-window Column 很容易把这些判断散落到：

```text
AdoptionController
FloatingController
ColumnStore
Dock
Layout
Fullscreen
```

因此 Phase 16 先建立窗口语义边界。

---

# 2. 当前代码的问题

当前普通 Column eligibility：

```js
function scrollEligible(window) {
    return Boolean(window && window.managed && window.normalWindow &&
        window.moveable && window.resizeable &&
        !window.specialWindow && !window.skipTaskbar && !window.fullScreen &&
        !isPlasmaShellWindow(window));
}
```

而普通 safe-area layout eligibility：

```js
function eligible(window) {
    if (!window || window.fullScreen || !window.resizeable || !window.maximizable ||
            window.skipTaskbar || isPlasmaShellWindow(window)) return false;

    return window.normalWindow || (includeDialogs && window.dialog);
}
```

现在至少存在两套窗口分类逻辑：

```text
scrollEligible()
eligible()
```

并且还有配置：

```text
IncludeDialogs
```

这意味着：

```text
Dialog 是否被 CC Niri 管理
```

仍然由多个地方共同决定。

Phase 16 要把这些入口统一。

---

# 3. KWin 已经提供足够的窗口语义

KWin Window API 已有：

```text
normalWindow
dialog
transient
transientFor
modal
utility
toolbar
splash
popupWindow
dropdownMenu
menu
desktopWindow
dock
specialWindow
managed
```

因此不需要：

```text
匹配 caption
匹配 application name
匹配 resourceClass 白名单
```

第一版应完全基于 KWin Window type。

---

# 4. Phase 16 的核心模型

新增：

```text
src/kwin/policy/WindowPolicy.js
```

WindowPolicy 只做 pure classification：

```text
KWin Window
    ↓
WindowPolicy.classify()
    ↓
┌──────────────────────┐
│ MANAGED_ELIGIBLE     │
│ POLICY_FLOATING      │
│ NATIVE_ONLY          │
└──────────────────────┘
```

---

# 5. 三种 WindowDisposition

建议：

```js
const WindowDisposition = Object.freeze({
    MANAGED_ELIGIBLE: "managed-eligible",
    POLICY_FLOATING: "policy-floating",
    NATIVE_ONLY: "native-only",
});
```

---

# 6. MANAGED_ELIGIBLE

含义：

```text
这个窗口可以成为 Column member
```

典型：

```text
Firefox
VS Code
Kitty
Konsole
Dolphin
Typora
Chrome
普通应用主窗口
```

只有：

```text
MANAGED_ELIGIBLE
```

才允许：

```text
ColumnStore.insertWindow()
Floating → Managed attach
Multi-window Column member insertion
```

---

# 7. POLICY_FLOATING

含义：

```text
窗口属于应用的一部分，
但 CC Niri 明确禁止它进入 Column。
```

第一版建议包含：

```text
dialog
modal
transient
utility
toolbar
```

典型：

```text
Open File
Save As
Preferences
Confirm
Authentication
Tool Palette
Modal Dialog
```

这些窗口：

```text
可以获得 focus
可以被 KWin 管理
可以由应用决定 placement
```

但：

```text
永远不能成为 Column
```

---

# 8. NATIVE_ONLY

含义：

```text
CC Niri 不应该参与它的窗口管理生命周期
```

第一版包含：

```text
desktopWindow
dock
popupWindow
dropdownMenu
menu
splash
Plasma Shell helper
unmanaged window
其它不满足普通 managed window 语义的窗口
```

例如：

```text
Plasma panel
desktop
context menu
combo-box popup
tooltip-like popup
splash screen
```

这些窗口不需要：

```text
Floating toggle
Column eligibility
Policy floating ownership
```

直接保持 KWin/native。

---

# 9. 为什么 POLICY_FLOATING 和 NATIVE_ONLY 要分开

不能简单写：

```text
不是 Column
→ ignored
```

因为 Dialog 仍然是一个真实用户窗口。

Dialog：

```text
可以 focus
可能 modal
可能 transientFor 某个主窗口
生命周期需要正常跟踪
```

而 popup/menu：

```text
通常是瞬时 UI surface
```

所以：

```text
POLICY_FLOATING
!=
NATIVE_ONLY
```

这个区分未来 Multi-window Column 也有价值。

---

# 10. WindowPolicy 必须是 Pure

推荐：

```js
class WindowPolicy {
    classify(window) {
        ...
    }

    canJoinColumn(window) {
        return this.classify(window).kind ===
            WindowDisposition.MANAGED_ELIGIBLE;
    }

    managedLayoutEligible(window) {
        ...
    }
}
```

不得在 WindowPolicy 内：

```text
修改 geometry
修改 focus
修改 minimized
修改 opacity
修改 ColumnStore
schedule timer
调用 DBus
```

它只负责：

```text
分类
```

---

# 11. PolicyDecision

推荐返回：

```js
{
    kind: WindowDisposition.POLICY_FLOATING,
    reason: "dialog",
    parent: window.transientFor || null,
}
```

这样 Debug 和未来 Parent-aware 逻辑都容易扩展。

---

# 12. 推荐 Classification 顺序

顺序很重要。

建议：

```js
classify(window) {
    if (!window || !window.managed) {
        return nativeOnly("unmanaged");
    }

    if (isPlasmaShellWindow(window)) {
        return nativeOnly("plasma-shell");
    }

    if (window.desktopWindow) {
        return nativeOnly("desktop");
    }

    if (window.dock) {
        return nativeOnly("dock");
    }

    if (window.popupWindow ||
            window.dropdownMenu ||
            window.menu) {
        return nativeOnly("popup");
    }

    if (window.splash) {
        return nativeOnly("splash");
    }

    if (window.dialog) {
        return policyFloating("dialog", window.transientFor);
    }

    if (window.modal) {
        return policyFloating("modal", window.transientFor);
    }

    if (window.transient) {
        return policyFloating("transient", window.transientFor);
    }

    if (window.utility) {
        return policyFloating("utility", window.transientFor);
    }

    if (window.toolbar) {
        return policyFloating("toolbar", window.transientFor);
    }

    if (window.specialWindow) {
        return nativeOnly("special-window");
    }

    if (window.skipTaskbar) {
        return nativeOnly("skip-taskbar");
    }

    if (!window.normalWindow) {
        return nativeOnly("not-normal");
    }

    if (!window.moveable) {
        return nativeOnly("not-moveable");
    }

    if (!window.resizeable) {
        return nativeOnly("not-resizeable");
    }

    return managedEligible();
}
```

---

# 13. 为什么 popup 必须比 transient 更早判断

很多 popup 本身也可能具有 parent/transient 关系。

如果先判断：

```text
transient
```

可能把：

```text
menu
popup
dropdown
```

误分类成 `POLICY_FLOATING`。

所以：

```text
popup/menu
```

必须优先成为：

```text
NATIVE_ONLY
```

---

# 14. 为什么 Dialog 要在 specialWindow 前判断

KWin 的 specialized window type 与 `specialWindow` 有重叠可能。

所以不要：

```js
if (window.specialWindow) return nativeOnly();
if (window.dialog) ...
```

否则 Dialog 可能永远到不了 Policy Floating。

明确的窗口语义要优先于 generic：

```text
specialWindow
```

---

# 15. fullscreen / output 不属于 WindowPolicy

不要把下面这些放进：

```text
classify()
```

例如：

```text
window.fullScreen
window.output
current focus
maximize
Quick Tile
```

这些是：

```text
Lifecycle / temporary state
```

不是 Window type。

正确分层：

```text
WindowPolicy
    ↓
“它本质上能不能成为 Column”

AdoptionController
    ↓
“现在这个时刻能不能进入 Column”
```

---

# 16. canJoinColumn()

建议：

```js
canJoinColumn(window) {
    return this.classify(window).kind ===
        WindowDisposition.MANAGED_ELIGIBLE;
}
```

以后 Phase 17：

```text
Column.addMember(window)
```

也必须先调用同一个接口。

---

# 17. managedLayoutEligible()

当前还有：

```text
Safe Maximize
Quick Tile
```

相关 `eligible(window)`。

这个也应该统一进 Policy。

推荐：

```js
managedLayoutEligible(window) {
    if (!this.canJoinColumn(window)) return false;

    return Boolean(
        window.resizeable &&
        window.maximizable
    );
}
```

这样：

```text
Dialog
Transient
Utility
```

不会进入：

```text
CC safe-area maximize/tile ownership
```

第一版让 KWin/应用自己处理这些辅助窗口。

---

# 18. 删除 scrollEligible() 的独立语义

可以保留 wrapper：

```js
function scrollEligible(window) {
    return windowPolicy.canJoinColumn(window);
}
```

用于降低一次重构的改动量。

但最终：

```text
WindowPolicy
```

必须成为唯一分类来源。

---

# 19. 旧 IncludeDialogs 配置应删除

当前：

```text
RuntimeConfig.includeDialogs
package/contents/config/main.xml
package/contents/ui/config.ui
```

仍存在：

```text
Include resizable dialog windows
```

这和新语义直接冲突。

Phase 16 应删除它。

---

# 20. 删除范围

从：

```text
src/kwin/runtime/RuntimeConfig.js
```

删除：

```js
includeDialogs: Boolean(readValue("IncludeDialogs", false))
```

从：

```text
package/contents/config/main.xml
```

删除：

```xml
<entry name="IncludeDialogs" type="Bool">
    <default>false</default>
</entry>
```

从：

```text
package/contents/ui/config.ui
```

删除：

```text
kcfg_IncludeDialogs
```

---

# 21. 不需要 KConfig migration

已有用户配置里可能仍残留：

```text
IncludeDialogs=true
```

可以让它成为 unused stale key。

不需要：

```text
自动修改 kwinrc
```

原则：

```text
不要为了删除一个无效配置键去改用户配置文件。
```

---

# 22. WindowState 的 Floating 语义

这里非常重要。

当前：

```js
windowState.floating
```

已经有明确含义：

> 用户主动把一个原本可管理窗口从 Column detach 出来。

Phase 16 **不要**把 Policy Floating 塞进这个 bool。

即：

```text
windowState.floating
=
USER_FLOATING only
```

---

# 23. 为什么不能：

```js
dialogState.floating = true;
```

因为 `FloatingController` 当前会认为：

```text
floating=true
→ 以后 Meta+Shift+Enter 可以 attach
```

这会让：

```text
Dialog
```

重新进入 Column。

因此：

```text
Policy Floating
```

必须独立于：

```text
User Floating
```

---

# 24. 推荐 Adoption Phase

保留：

```text
ADOPTION_FLOATING
```

表示：

```text
USER_FLOATING
```

新增：

```text
ADOPTION_POLICY_FLOATING
=
"policy-floating"
```

---

# 25. Adoption 状态语义

最终：

```text
ADOPTION_MANAGED
    → Column owner

ADOPTION_FLOATING
    → User Floating

ADOPTION_POLICY_FLOATING
    → WindowPolicy owns “never Column”

ADOPTION_IGNORED
    → Native-only
```

---

# 26. AdoptionController 注入 WindowPolicy

当前：

```js
this.scrollEligible = options.scrollEligible;
```

Phase 16 推荐改为：

```js
this.windowPolicy = options.windowPolicy;
```

如果为了渐进迁移，也可以同时暂留：

```text
scrollEligible wrapper
```

但 `waitPhase()` 必须直接知道 Policy disposition。

---

# 27. AdoptionController.waitPhase()

建议调整顺序：

```js
waitPhase(window, windowState) {
    const policy = this.windowPolicy.classify(window);

    if (policy.kind === WindowDisposition.NATIVE_ONLY) {
        return this.phases.ignored;
    }

    if (policy.kind === WindowDisposition.POLICY_FLOATING) {
        return this.phases.policyFloating;
    }

    if (windowState.floating) {
        return this.phases.floating;
    }

    ...
}
```

然后才判断：

```text
output
fullscreen
maximize
tile
active
```

---

# 28. Policy Floating 必须高于 User Floating

假设：

```text
普通窗口
→ 用户 detach
→ floating=true
```

之后这个 Window 临时变成：

```text
transient/modal
```

Policy 应优先：

```text
POLICY_FLOATING
```

当它以后重新恢复为普通窗口：

```text
windowState.floating=true
```

仍然存在。

于是它自然回到：

```text
USER_FLOATING
```

这个行为是合理的。

---

# 29. Runtime Dialog 不应该等待 activation

现在普通新窗口：

```text
waitingActivation
```

再 adopt。

Dialog 不需要这个过程。

一旦：

```text
WindowPolicy = POLICY_FLOATING
```

立即：

```text
ADOPTION_POLICY_FLOATING
```

不再：

```text
waitingActivation
adopting
settling
```

---

# 30. Startup Dialog

`initializeScrollLayout()` 当前直接用：

```text
scrollEligible(window)
```

过滤 startup snapshot。

改成 WindowPolicy 后：

```text
Dialog
Transient
Utility
```

不会进入：

```text
addInitialColumn()
```

所以启动时已有 Dialog 也安全。

---

# 31. 动态 Policy 变化

KWin 提供：

```text
transientChanged
modalChanged
```

因此 Phase 16 应支持：

```text
Window 语义发生变化
→ Policy re-evaluate
```

---

# 32. 新增 AdoptionController.onPolicyChanged()

推荐：

```js
onPolicyChanged(window, reason) {
    const decision = this.windowPolicy.classify(window);
    const state = this.stateFor(window);

    if (decision.kind !== MANAGED_ELIGIBLE &&
            this.indexOfWindow(window) >= 0) {
        this.removeManagedWindow(
            window,
            `policy-${decision.reason}`,
            false
        );
    }

    if (decision.kind === POLICY_FLOATING) {
        this.transition(
            window,
            state,
            this.phases.policyFloating,
            reason
        );
        return false;
    }

    if (decision.kind === NATIVE_ONLY) {
        this.transition(
            window,
            state,
            this.phases.ignored,
            reason
        );
        return false;
    }

    if (state.floating) {
        this.transition(
            window,
            state,
            this.phases.floating,
            reason
        );
        return false;
    }

    this.transition(
        window,
        state,
        this.phases.waitingEligible,
        reason
    );

    return this.advance(window, reason);
}
```

---

# 33. AdoptionController 需要 remove dependency

新增依赖：

```js
removeManagedWindow
```

用于：

```text
managed normal window
→ transient/dialog
```

时立即从 Column 移除。

---

# 34. Policy 改变时不要重写 geometry

从 Column detach 为 Policy Floating 时：

```text
remove Column ownership
```

但不要主动：

```text
center dialog
resize dialog
move dialog
move to parent output
```

第一版继续依赖：

```text
KWin / Wayland / application transient placement
```

---

# 35. Parent 只作为 Metadata

PolicyDecision 可以返回：

```js
parent: window.transientFor || null
```

第一版只用于：

```text
debug
testing
future extension
```

不要：

```text
window.output = parent.output
window.frameGeometry = parent-relative geometry
```

---

# 36. 为什么第一版不做 Parent Geometry

Wayland transient / XDG positioner / KWin placement 已经有自己的语义。

如果 CC Niri 再强制：

```text
Dialog center on parent
```

可能与客户端 placement 冲突。

因此第一版：

```text
Policy controls ownership,
not placement.
```

---

# 37. Dialog 在 Wide 状态下的行为

例如：

```text
VS Code 1@72
```

弹出：

```text
Open File Dialog
```

Dialog：

```text
不进入 Column
```

同时：

```text
ContextualViewport
仍然保持 WIDE_FOCUS(1)
```

Dialog 获得 focus 时不能：

```text
Wide → Pair
```

---

# 38. 为什么当前架构天然适合

`onWindowActivatedForScrollLayout()`：

```text
columnIndexForWindow(dialog)
→ -1
→ return
```

因此只要 Dialog 永远不进 Column：

```text
Wide parent 不需要被 relayout
```

Dialog 关闭后 focus 回 parent：

```text
原 Wide 状态仍存在
```

这正是目标行为。

---

# 39. Pair 中 Dialog

例如：

```text
1 | 2
focus=2
```

2 弹 Dialog：

```text
1 | 2
        + dialog floating
```

底层 Pair：

```text
完全不改变
```

不应该：

```text
插入 3
滚动 viewport
改变 scrollOffsetX
```

---

# 40. Dialog 关闭

Dialog close：

```text
states.delete(window)
```

即可。

禁止：

```text
removeColumn()
```

因为它从未进入 Column。

---

# 41. FloatingController 必须理解 Policy

当前：

```text
Meta+Shift+Enter
```

可以：

```text
Managed ↔ User Floating
```

Phase 16 后必须明确：

```text
POLICY_FLOATING
```

不能参与这个 toggle。

---

# 42. Dialog 上 Meta+Shift+Enter

如果当前 active Window 是 Dialog：

```text
Meta+Shift+Enter
```

应：

```text
no-op
```

不能：

```text
attach dialog
```

也不能因为 `rememberedWindow` 存在而偷偷操作之前的 User Floating Window。

---

# 43. FloatingController.toggle() 第一条检查

推荐：

```js
toggle(window) {
    if (window &&
            this.windowPolicy.classify(window).kind ===
                WindowDisposition.POLICY_FLOATING) {
        this.debug(
            `[cc-scroll] FLOAT_TOGGLE_BLOCKED reason=policy-floating`
        );
        return false;
    }

    ...
}
```

这条必须发生在：

```text
rememberedFloating target substitution
```

之前。

---

# 44. 为什么要先 block active Policy Floating

当前逻辑：

```text
如果存在 remembered floating
且当前 target 不是 rememberedWindow
→ target = rememberedWindow
```

如果 active window 是 Dialog：

```text
Meta+Shift+Enter
```

可能意外 attach 一个之前的 floating 主窗口。

这不符合用户意图。

因此：

```text
Policy Floating active
→ shortcut no-op
```

优先级最高。

---

# 45. FloatingController.attach()

也必须再次防御：

```js
if (!this.windowPolicy.canJoinColumn(window)) {
    return false;
}
```

这样即使其它代码错误调用：

```text
attach(dialog)
```

仍然无法进入 Column。

---

# 46. hasRememberedFloating()

如果 remembered Window 后来变成：

```text
POLICY_FLOATING
```

应该视为：

```text
不再是有效 reattach target
```

建议：

```js
hasRememberedFloating() {
    if (!...) return false;

    if (!this.windowPolicy.canJoinColumn(this.rememberedWindow)) {
        this.clearRemembered();
        return false;
    }

    return true;
}
```

---

# 47. User Floating 与 Policy Floating 的最终关系

```text
USER_FLOATING
```

是：

```text
用户选择
可逆
```

```text
POLICY_FLOATING
```

是：

```text
Window type 强制
不可通过 Floating shortcut 逆转
```

---

# 48. 不建议新增 `windowState.policyFloating = true`

Policy 应尽量是：

```text
derived state
```

来自：

```text
WindowPolicy.classify(window)
```

不要缓存：

```text
policyFloating=true
```

否则 window type 改变后容易 stale。

---

# 49. WindowState 继续保留 `floating`

Phase 16 可以不改现有：

```js
floating: false
```

但文档和代码注释必须明确：

```text
floating == userFloating
```

未来若要重命名：

```text
userFloating
```

可以另开 refactor，不要求本阶段完成。

---

# 50. setupWindow() 新增 Policy signal

当前已有：

```text
skipTaskbarChanged
activeChanged
readyForPaintingChanged
...
```

推荐新增：

```js
if (window.transientChanged) {
    window.transientChanged.connect(() =>
        adoptionController.onPolicyChanged(
            window,
            "transient-changed"
        )
    );
}

if (window.modalChanged) {
    window.modalChanged.connect(() =>
        adoptionController.onPolicyChanged(
            window,
            "modal-changed"
        )
    );
}
```

---

# 51. skipTaskbarChanged 也统一到 Policy

当前：

```js
if (window.skipTaskbarChanged) {
    window.skipTaskbarChanged.connect(() => {
        if (window.skipTaskbar &&
                columnIndexForWindow(window) >= 0) {
            removeColumn(...);
        }
    });
}
```

建议改成：

```js
window.skipTaskbarChanged.connect(() =>
    adoptionController.onPolicyChanged(
        window,
        "skip-taskbar-changed"
    )
);
```

这样：

```text
窗口 membership 决策
```

不再散在 main.js。

---

# 52. dialog / utility 类型通常在创建时确定

不要依赖不存在或未验证的：

```text
dialogChanged
utilityChanged
```

静态 type 会在：

```text
windowAdded
```

时分类。

动态变化优先处理现有可靠 signal：

```text
transientChanged
modalChanged
skipTaskbarChanged
```

---

# 53. isPlasmaShellWindow 应移动到 Policy

当前：

```text
function isPlasmaShellWindow(window)
```

仍在 main glue。

Phase 16 推荐移动：

```text
src/kwin/policy/WindowPolicy.js
```

并 export 给测试。

这样：

```text
窗口语义分类
```

彻底离开 main.js。

---

# 54. 推荐目录

```text
src/kwin/
├── policy/
│   └── WindowPolicy.js
│
├── lifecycle/
│   ├── AdoptionController.js
│   ├── FloatingController.js
│   ├── OutputController.js
│   └── FullscreenController.js
```

---

# 55. tools/build.js

KWin generated module list加入：

```text
src/kwin/policy/WindowPolicy.js
```

只需保证依赖顺序正确。

---

# 56. Runtime composition

新增：

```js
const windowPolicy = new WindowPolicy();
```

然后注入：

```text
AdoptionController
FloatingController
managed-layout eligibility
```

---

# 57. AdoptionController 构造依赖

建议：

```js
new AdoptionController({
    ...
    windowPolicy,
    removeManagedWindow: removeColumn,
    ...
});
```

---

# 58. FloatingController 构造依赖

建议：

```js
new FloatingController({
    ...
    windowPolicy,
});
```

逐步删除其独立：

```text
scrollEligible
```

依赖。

---

# 59. Policy 不能依赖 FloatingController

依赖方向必须：

```text
WindowPolicy
    ↓
AdoptionController
FloatingController
Runtime
```

不能形成环。

---

# 60. Debug 日志

推荐统一：

```text
[cc-policy]
```

只在：

```text
classification 导致 ownership transition
```

时输出。

不要每次：

```text
canJoinColumn()
```

都打印。

---

# 61. 推荐日志

```text
[cc-policy] POLICY_FLOATING reason=dialog caption=Open File parent=<uuid>
```

```text
[cc-policy] POLICY_FLOATING reason=transient caption=Preferences parent=<uuid>
```

```text
[cc-policy] NATIVE_ONLY reason=popup caption=...
```

---

# 62. Parent UUID

如果：

```text
window.transientFor
```

存在，只用于：

```text
debug
testing
future extension
```

不要改变：

```text
Column order
Dock order
Output ownership
```

---

# 63. Dock 行为

Policy Floating 不进入：

```text
mainScreenState.columns
```

因此不进入：

```text
canonical Column order
```

不要在 Phase 16 主动：

```text
修改 TaskManager skipTaskbar
隐藏 Dialog Dock item
```

Taskbar 是否显示交给应用/KWin。

---

# 64. Reorder 行为

因为 Dialog 不存在于：

```text
columns[]
```

所以：

```text
Meta+Shift+H/L
Dock drag reorder
```

自然不会作用到 Dialog。

无需特殊 case。

---

# 65. Wide 行为

Dialog 打开：

```text
不要 cancel pending Wide
不要 clear ContextualViewport
不要 alter persistentWide
```

Policy classification 只决定：

```text
Dialog 不进入 Column
```

---

# 66. ContextualWideCoordinator

Policy Floating 不应进入：

```text
LayoutPlan
MotionPlan
Wide Neighbor
retainedColumn
wideExitColumn
```

因为这些对象都来自：

```text
columns[]
```

只要 Column membership 正确，就无需修改 Wide runtime。

---

# 67. Output 行为

第一版不主动：

```text
把 Dialog 强制移动到 parent.output
```

如果 Dialog 已由 KWin 放在 parent 对应 output：

```text
保持原生行为
```

如果某个应用 placement 异常：

```text
单独记录 bug
```

不要先用 geometry hack 修。

---

# 68. Fullscreen Parent

如果 fullscreen 应用弹 Dialog：

```text
Dialog = POLICY_FLOATING
```

不要把 Dialog：

```text
加入 Column
退出 Parent fullscreen
```

原生 focus/placement 交给 KWin。

---

# 69. Policy Floating 不参与 Safe Maximize

`eligible(window)` 应迁移为：

```text
windowPolicy.managedLayoutEligible(window)
```

因此 Dialog 的 maximize/tile 不属于 CC safe-area layout。

这可以减少：

```text
Dialog geometry 被 CC Niri 强制重写
```

---

# 70. 测试：WindowPolicy Matrix

新增：

```text
test/window-policy.test.js
```

至少覆盖：

| Window | 结果 |
|---|---|
| normal managed | MANAGED_ELIGIBLE |
| dialog | POLICY_FLOATING |
| modal | POLICY_FLOATING |
| transient | POLICY_FLOATING |
| utility | POLICY_FLOATING |
| toolbar | POLICY_FLOATING |
| popupWindow | NATIVE_ONLY |
| dropdownMenu | NATIVE_ONLY |
| menu | NATIVE_ONLY |
| splash | NATIVE_ONLY |
| dock | NATIVE_ONLY |
| desktopWindow | NATIVE_ONLY |
| Plasma Shell | NATIVE_ONLY |
| unmanaged | NATIVE_ONLY |
| skipTaskbar normal | NATIVE_ONLY |
| non-resizeable normal | NATIVE_ONLY |

---

# 71. 测试：Popup 优先于 Transient

构造：

```js
{
    popupWindow: true,
    transient: true
}
```

必须：

```text
NATIVE_ONLY
```

不能：

```text
POLICY_FLOATING
```

---

# 72. 测试：Dialog 优先于 skipTaskbar

构造：

```js
{
    dialog: true,
    skipTaskbar: true
}
```

必须：

```text
POLICY_FLOATING
```

因为：

```text
skipTaskbar
```

不应该把真实 Dialog 降级成完全 Native-only 的 popup 语义。

---

# 73. 测试：Startup Dialog

startup snapshot：

```text
Main Window
Dialog
Main Window
```

最终：

```text
columns.length == 2
```

Dialog：

```text
不在 ColumnStore
```

---

# 74. 测试：Runtime Dialog

`windowAdded(dialog)`：

```text
ADOPTION_POLICY_FLOATING
```

不得出现：

```text
ADOPTION_ADOPTING
ADOPTION_SETTLING
ADOPTION_MANAGED
```

---

# 75. 测试：Dialog Activation

Dialog activation：

```text
focusedColumnIndex 不变
scrollOffsetX 不变
viewport mode 不变
```

如果 parent 是 Wide：

```text
WIDE_FOCUS 保持
```

---

# 76. 测试：Dialog Close

关闭 Dialog：

```text
columns[] 不变
focusedColumnIndex 不变
```

回到 parent focus 后：

```text
原 viewport state 保留
```

---

# 77. 测试：Meta+Shift+Enter on Dialog

必须：

```text
false / no-op
```

断言：

```text
ColumnStore unchanged
rememberedWindow unchanged
Dialog not attached
```

---

# 78. 测试：Remembered User Floating + Dialog

场景：

```text
A detach → rememberedWindow=A
Dialog B becomes active
Meta+Shift+Enter
```

结果必须：

```text
no-op
```

不能：

```text
偷偷 attach A
```

---

# 79. 测试：attach(dialog)

直接调用：

```text
FloatingController.attach(dialog)
```

必须：

```text
false
```

作为 defensive guard。

---

# 80. 测试：Managed → Transient

初始：

```text
A ∈ ColumnStore
```

触发：

```text
transientChanged
A.transient=true
```

结果：

```text
A 从 ColumnStore 移除
ADOPTION_POLICY_FLOATING
```

---

# 81. 测试：Transient → Normal

如果：

```text
A.transient=false
A.active=true
A userFloating=false
```

触发：

```text
onPolicyChanged()
```

则可以重新进入正常 adoption：

```text
WAITING_ELIGIBLE
→ ADOPTING
→ MANAGED
```

---

# 82. 测试：User Floating → Policy Floating → User Floating

场景：

```text
A normal
→ user detach
floating=true

A.transient=true
→ POLICY_FLOATING

A.transient=false
```

最终应回：

```text
ADOPTION_FLOATING
```

而不是自动 Managed。

这证明：

```text
Policy Floating
```

没有覆盖用户自己的 floating preference。

---

# 83. 测试：IncludeDialogs 完全删除

更新：

```text
runtime-config-output.test.js
generated-package.test.js
```

确保：

```text
RuntimeConfig 不再读取 IncludeDialogs
main.xml 不再声明 IncludeDialogs
config.ui 不再出现 kcfg_IncludeDialogs
```

---

# 84. 测试：Safe Maximize 不管理 Dialog

Dialog：

```text
managedLayoutEligible == false
```

原有 safe-area maximize/tile handler 不应接管它。

---

# 85. Regression 要求

全部通过：

```bash
node tools/build.js
node tools/build.js --check
node --test test/*.test.js
node tools/check.js
node tools/check.js --native
```

---

# 86. Manual Test Apps

建议实际测试：

```text
Firefox
Chrome
VS Code
Dolphin
Kitty/Konsole
Typora
```

重点触发：

```text
Open File
Save As
Preferences
Confirm close
Authentication
About / Utility Window
```

---

# 87. Manual Wide + Dialog

重点场景：

```text
1@72
↓
打开 Dialog
↓
Dialog floating
↓
关闭 Dialog
↓
1 仍然 @72
```

这是 Phase 16 最关键的实际体验测试之一。

---

# 88. Manual Pair + Dialog

```text
1|2
focus=2
↓
2 打开 Dialog
↓
1|2 不动
↓
Dialog floating
```

检查：

```text
scrollOffset 不变化
Dock Column order 不变化
```

---

# 89. Dialog Geometry 验收

第一版不要要求：

```text
CC Niri 把 Dialog 精确居中 Parent
```

只要求：

```text
CC Niri 没有破坏应用/KWin 的 placement
```

---

# 90. 不要做 Application-specific Rules

Phase 16 禁止：

```text
if resourceClass == "code"
if caption contains "Open"
if app == "chrome"
```

WindowPolicy 必须保持：

```text
semantic
generic
```

如果个别应用错误标记 window type：

```text
单独记录兼容问题
```

以后再设计 optional override。

---

# 91. 不要修改 Dialog geometry

禁止：

```js
dialog.frameGeometry = ...
```

禁止：

```text
强制中心
强制 72%
强制 half
```

Policy 只负责 ownership。

---

# 92. 不要给 Dialog persistentWide

因为 Dialog 不进入：

```text
ColumnStore
```

所以不存在：

```text
persistentWide
widthMode
logicalX
pixelWidth
```

---

# 93. 不要给 Dialog Column ID

WindowState：

```text
columnId = null
managedByScrollLayout = false
```

始终保持。

---

# 94. 推荐实现顺序

## Step 1：新增 WindowPolicy

```text
src/kwin/policy/WindowPolicy.js
```

先 pure module + tests。

不改 runtime。

## Step 2：统一 Column eligibility

把：

```text
scrollEligible()
```

变成：

```text
windowPolicy.canJoinColumn()
```

确保现有普通窗口 regression 全过。

## Step 3：加入 POLICY_FLOATING Adoption phase

新增：

```text
ADOPTION_POLICY_FLOATING
```

让 Runtime Dialog 永远停止在 Policy Floating。

## Step 4：Startup adoption

确认 startup Dialog 不进入 Column。

## Step 5：FloatingController guard

处理：

```text
toggle
attach
rememberedWindow
```

## Step 6：动态 Policy re-evaluation

连接：

```text
transientChanged
modalChanged
skipTaskbarChanged
```

统一进入：

```text
AdoptionController.onPolicyChanged()
```

## Step 7：Safe-area layout eligibility

用：

```text
windowPolicy.managedLayoutEligible()
```

替代旧：

```text
eligible()
```

## Step 8：删除 IncludeDialogs

删除：

```text
RuntimeConfig
main.xml
config.ui
README
tests
```

中的旧配置。

## Step 9：Manual soak

实际测试多个 GTK/Qt/Electron/Chromium 应用 Dialog。

---

# 95. 推荐 Commit 顺序

## Commit 1

```text
feat: add semantic window policy classification
```

新增：

```text
WindowPolicy.js
window-policy.test.js
```

## Commit 2

```text
refactor: route column eligibility through window policy
```

## Commit 3

```text
feat: keep dialogs and transients policy-floating
```

加入：

```text
ADOPTION_POLICY_FLOATING
```

## Commit 4

```text
fix: block floating reattach for policy-owned windows
```

## Commit 5

```text
refactor: reconcile dynamic window policy changes
```

处理：

```text
transientChanged
modalChanged
skipTaskbarChanged
```

## Commit 6

```text
refactor: route managed layouts through window policy
```

## Commit 7

```text
chore: remove obsolete include-dialogs option
```

## Commit 8

```text
test: cover dialog policy ownership and floating isolation
```

## Commit 9

```text
docs: document alpha40 window policy
```

---

# 96. 建议版本

Phase 16 完成后：

```text
3.0.0-alpha.40
```

建议定义：

```text
alpha.39
Contextual Wide runtime hardening

alpha.40
Semantic Window Policy + Dialog Always-Floating
```

---

# 97. README 更新

Current phase 增加：

```text
Dialogs, modal windows, transients, utility windows, and detached
tool windows are classified by WindowPolicy and remain policy-floating.
They never become Columns and cannot be attached through the user
Floating shortcut.
```

同时删除：

```text
Dialogs: excluded
```

改成更准确：

```text
Dialogs/transients: policy-floating
```

---

# 98. Development 文档

加入：

```text
src/kwin/policy/WindowPolicy.js
```

说明：

```text
WindowPolicy is the sole semantic membership authority for Column eligibility.
```

---

# 99. Phase 16 完成标准

## Policy

```text
[ ] WindowPolicy 是唯一 Window type 分类来源
[ ] MANAGED_ELIGIBLE 定义明确
[ ] POLICY_FLOATING 定义明确
[ ] NATIVE_ONLY 定义明确
```

## Dialog

```text
[ ] Dialog 永远不进入 ColumnStore
[ ] Modal 永远不进入 ColumnStore
[ ] Transient 永远不进入 ColumnStore
[ ] Utility/Toolbar 永远不进入 ColumnStore
[ ] Popup/Menu/Splash 保持 Native-only
```

## Floating

```text
[ ] windowState.floating 仍只表示 User Floating
[ ] Policy Floating 不写 floating=true
[ ] Dialog 上 Meta+Shift+Enter no-op
[ ] attach(dialog) defensive reject
[ ] remembered User Floating 不被 Dialog shortcut 意外 attach
```

## Lifecycle

```text
[ ] Startup Dialog 不 adopt
[ ] Runtime Dialog 进入 ADOPTION_POLICY_FLOATING
[ ] transientChanged 可移出 Column
[ ] transient 恢复 normal 时可重新评估
[ ] skipTaskbarChanged 统一走 Policy
```

## Layout

```text
[ ] Dialog 不参与 scrollOffset
[ ] Dialog 不参与 Pair/Wide layout
[ ] Dialog 不参与 MotionPlan
[ ] Dialog 不参与 safe-area maximize/tile ownership
```

## Wide

```text
[ ] Wide Parent 弹 Dialog 后保持 Wide
[ ] Dialog close 后 Wide 恢复无跳变
[ ] Pair Parent 弹 Dialog 后 Pair 不移动
```

## Config

```text
[ ] IncludeDialogs RuntimeConfig 删除
[ ] main.xml 删除
[ ] config.ui 删除
[ ] stale user key 安全忽略
```

## Regression

```text
[ ] node tools/check.js PASS
[ ] node tools/check.js --native PASS
```

---

# 100. Phase 16 之后为什么适合进入 Multi-window Column

完成 WindowPolicy 后：

```text
Column member eligibility
```

只有一个答案：

```js
windowPolicy.canJoinColumn(window)
```

因此 Phase 17 可以安全把：

```text
Column {
    window
}
```

改成：

```js
Column {
    windows: [...],
    activeWindowIndex,
}
```

而无需再次讨论：

```text
Dialog 能不能进去？
Popup 能不能进去？
Transient 能不能进去？
```

这些边界已经在 Phase 16 固定。

---

# 101. Phase 17 的接口预留

Phase 16 的 API 最好让未来直接使用：

```js
if (!windowPolicy.canJoinColumn(window)) {
    return false;
}
```

无论以后是：

```text
create new Column
```

还是：

```text
append Window to existing Column
```

都调用同一个 Policy。

---

# 102. 最终架构

完成 Phase 16 后：

```text
                KWin Window
                     │
                     ▼
              ┌──────────────┐
              │ WindowPolicy │
              └──────┬───────┘
                     │
       ┌─────────────┼──────────────┐
       │             │              │
       ▼             ▼              ▼
MANAGED_ELIGIBLE POLICY_FLOATING NATIVE_ONLY
       │             │              │
       ▼             ▼              ▼
 Adoption        Native app      KWin/native
 Column          auxiliary
 Lifecycle       window
```

其中：

```text
FloatingController
```

只负责：

```text
MANAGED_ELIGIBLE
↔
USER_FLOATING
```

而不是：

```text
POLICY_FLOATING
```

---

# 103. 本阶段最终原则

Phase 16 的目标不是：

```text
“让 Dialog 看起来像 Floating”
```

而是建立一条长期稳定的 ownership 规则：

```text
Dialog is not a Column that happens to float.

Dialog is a Policy-Floating Window
that is fundamentally ineligible for Column ownership.
```

这是后续 Multi-window Column 能保持架构干净的关键前置条件。
