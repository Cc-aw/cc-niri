# cc-niri 日常稳定版收尾设计

> **归档状态（2026-10-01）：** 部分完成；native CI 与自动安全恢复已实现（b97594a），已有受控实机检查（8b6c887），但 test/V3_DAILY_ACCEPTANCE.md 的完整交互矩阵与 release gate 仍有 Pending / Partial 项。
> 文档状态与阅读顺序见 [文档索引](../README.md)。原设计正文保留作为历史依据。

> 目标：停止继续扩大功能面，把当前 `cc-niri` 从“功能基本完成的 V3 Alpha”收敛为一个可以长期日常使用、可回归、可安全退化的稳定版本。
>
> 当前基线：`main` 已具备 Column / Pair / Wide / Floating / Dock / WindowPolicy / Bridge / Native Viewport Clip / Recovery 等核心能力，JS 回归测试已达到 48/48。接下来只完成三项稳定性工作：
>
> 1. Native CI Gate
> 2. V3 Daily-use 实机回归矩阵
> 3. Invariant Failure 自动安全恢复

---

# 0. 总体原则

这三个阶段不再引入新的窗口管理能力，也不进行大规模架构重构。

目标不是继续增加：

- Multi-window Column
- Overview integration
- 跨桌面会话 persistence
- Secondary screen 双向 Column ordering
- 新动画样式

而是保证现有功能具备：

```text
源码修改
   ↓
自动回归
   ↓
Native 编译验证
   ↓
真实桌面验收
   ↓
运行时异常检测
   ↓
安全退化 / Emergency Restore
```

完成后建议从：

```text
3.0.0-alpha.*
```

进入：

```text
3.0.0-beta.1
```

并建立一个用于长期日常使用的稳定 tag / branch。

---

# 1. Phase A — Native CI Gate

**优先级：P0**

## 1.1 当前问题

当前 `.github/workflows/regression.yml` 只执行：

```bash
node tools/check.js
```

它可以验证：

- generated bundle 是否和 `src/` 一致
- Node 回归测试
- source-level native contract
- `git diff --check`

但不能证明以下原生组件真的能够编译：

```text
bridge/
native/viewport-clip/
plasmoid/com.cc.scrolltasks/
```

虽然 `tools/check.js` 已经支持：

```bash
node tools/check.js --native
```

但 `--native` 当前只执行已有 build tree 的：

```bash
cmake --build build/bridge
cmake --build build/native-viewport-clip
cmake --build build/plasmoid
```

Fresh CI runner 上不存在这些 build tree，因此 CI 必须先执行 configure。

---

## 1.2 目标

每次：

```text
push
pull_request
```

都必须验证：

### JS / Runtime

```text
generated bundles
48+ regression tests
git diff --check
```

### Native

```text
Bridge configure + build
Viewport Clip configure + build
Plasmoid configure + build
```

任何一个失败都不允许 main 被视为回归通过。

---

## 1.3 推荐 CI 结构

建议不要把所有内容塞进一个 job。

拆成：

```text
Regression
├── js-regression
└── native-build
```

这样 GitHub Actions 页面能明确告诉你：

```text
JS logic failed
```

还是：

```text
KWin / Qt native build failed
```

---

## 1.4 `.github/workflows/regression.yml`

建议改为类似：

```yaml
name: Regression

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  js-regression:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run JavaScript regression gate
        run: node tools/check.js

  native-build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Install build dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            cmake \
            ninja-build \
            extra-cmake-modules \
            qt6-base-dev \
            qt6-declarative-dev

      - name: Install KDE / KWin development dependencies
        run: |
          # 根据 GitHub runner 当前 Ubuntu / KDE 包名调整。
          # 如果 Ubuntu 仓库中的 KWin dev 版本无法满足当前源码，
          # 推荐切换 Fedora container/job。
          sudo apt-get install -y \
            libkf6coreaddons-dev \
            libkf6config-dev \
            libkf6i18n-dev \
            libkf6windowsystem-dev \
            kwin-dev

      - name: Configure Bridge
        run: |
          cmake \
            -S bridge \
            -B build/bridge \
            -G Ninja \
            -DCMAKE_BUILD_TYPE=RelWithDebInfo

      - name: Configure native viewport clip
        run: |
          cmake \
            -S native/viewport-clip \
            -B build/native-viewport-clip \
            -G Ninja \
            -DCMAKE_BUILD_TYPE=RelWithDebInfo

      - name: Configure Plasmoid
        run: |
          cmake \
            -S plasmoid/com.cc.scrolltasks \
            -B build/plasmoid \
            -G Ninja \
            -DCMAKE_BUILD_TYPE=RelWithDebInfo

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Build all native components
        run: node tools/check.js --native
```

---

## 1.5 Ubuntu runner 可能遇到的问题

项目的真实运行环境是：

```text
Fedora 44
Plasma / KWin 6.7.5
Wayland
```

而 GitHub 默认 runner 是 Ubuntu。

因此 Native CI 最大风险不是项目本身，而是：

```text
Ubuntu 软件源中的 KWin / KF6 版本
```

和真实 Fedora 环境不同。

### 推荐优先级

#### 方案 A：Ubuntu runner

优点：

- 简单
- GitHub 官方 runner
- 启动快

适合：

```text
Bridge
Plasmoid
```

但 Native KWin Effect 可能因为 KWin development API 版本不同而失败。

#### 方案 B：Fedora container

如果 Ubuntu 上无法获得匹配的 KWin 6.x development API，推荐：

```yaml
container:
  image: fedora:44
```

然后：

```bash
dnf install -y \
    gcc-c++ \
    cmake \
    ninja-build \
    extra-cmake-modules \
    qt6-qtbase-devel \
    qt6-qtdeclarative-devel \
    kf6-kcoreaddons-devel \
    kf6-kconfig-devel \
    kf6-ki18n-devel \
    kwin-devel
```

**最终建议：Native build 尽量使用 Fedora 44。**

因为：

```text
CI build ABI/API environment
≈
真实桌面环境
```

比“Ubuntu 上勉强编译通过”更有价值。

---

## 1.6 改进 `tools/check.js`

当前：

```bash
node tools/check.js --native
```

默认假设三个 build tree 已经存在。

建议继续保留这种设计，不把 configure 塞进去。

理由：

```text
tools/check.js
    ↓
验证

CI / install.sh
    ↓
负责环境配置
```

职责更清晰。

不过建议增加 build dir 检查：

```js
function requireBuildDir(name, dir) {
    if (!fs.existsSync(dir)) {
        console.error(
            `${name} build directory is missing. ` +
            `Run CMake configure before --native.`
        );
        process.exit(1);
    }
}
```

这样开发者直接运行：

```bash
node tools/check.js --native
```

不会看到难理解的 CMake error。

---

## 1.7 Native CI 完成判据

必须满足：

```text
[PASS] generated runtime bundles
[PASS] all Node regression tests
[PASS] git diff --check

[PASS] Bridge configure
[PASS] Bridge build

[PASS] Viewport Clip configure
[PASS] Viewport Clip build

[PASS] Plasmoid configure
[PASS] Plasmoid build
```

GitHub Actions 中：

```text
js-regression  ✅
native-build   ✅
```

才视为一次完整 Regression PASS。

---

# 2. Phase B — V3 Daily-use 实机回归矩阵

**优先级：P0**

## 2.1 当前问题

当前：

```text
test/TEST_PLAN.md
```

仍然主要是 V2 Safe Area / Quick Tile 测试。

但现在真正复杂的部分已经变成：

```text
Column
Pair
Wide
Floating
Dock
Bridge
Native Effect
WindowPolicy
Output migration
Reload recovery
```

因此现有 manual test plan 已经不能覆盖当前 V3 的核心风险。

---

# 2.2 新测试文件

建议新建：

```text
test/V3_DAILY_ACCEPTANCE.md
```

不要继续在旧 V2 `TEST_PLAN.md` 上不断叠内容。

V2 几何测试仍然保留作为历史和 safe-area regression。

---

# 2.3 固定测试环境

至少记录：

```text
OS:
Fedora 44

Desktop:
KDE Plasma

KWin:
6.7.5

Session:
Wayland

Primary:
DP-1
2560×1440 logical
150%

Secondary:
HDMI-A-1
2560×1440 logical
100%
```

如果后续 Plasma/KWin 更新：

```text
6.7.5 → 6.8.x
```

必须重新跑关键 smoke test。

---

# 2.4 固定测试应用

不要只用一个 Konsole。

建议固定以下程序：

| 应用 | 用途 |
|---|---|
| Konsole | 标准 KDE 窗口 |
| Dolphin | KDE 主窗口 + dialogs |
| Firefox | Wayland 浏览器 / popup / dialog |
| Typora 或 VS Code | Electron |
| System Settings | KDE 多种特殊窗口 |
| 文件选择器 | modal/transient |
| 可选 Qt demo | resize / maximize stress |

这样能覆盖：

```text
Qt
KDE
Firefox/GTK-like behavior
Electron
Transient/Dialog
```

---

# 2.5 Test Group A — 启动和窗口 Adoption

### A1 空桌面启动

步骤：

```text
登录 Plasma
→ cc-niri 自动启动
```

检查：

- Bridge service 正常
- KWin script 正常
- native viewport clip 正常
- effect 正常
- Dock 正常
- 无异常隐藏窗口
- journal 无循环错误

---

### A2 第一个窗口

```text
打开 Konsole
```

预期：

```text
Column 1
```

- 自动进入 Column
- 几何正确
- active state 正确
- Dock UUID 正确

---

### A3 连续打开窗口

依次：

```text
Konsole
Firefox
Dolphin
Typora
```

检查：

```text
1 | 2
2 | 3
3 | 4
```

滚动和 logical order 正确。

---

### A4 Slow mapping 应用

重点测试：

```text
Firefox
Electron
```

因为 AdoptionController 有：

```text
activation
ready-for-painting
geometry-change retry
```

要求：

- 不重复插入
- 不出现幽灵 Column
- 不错误 parked
- geometry settlement 后进入正确位置

---

# 2.6 Test Group B — Pair / H-L

准备：

```text
1 2 3 4 5
```

测试：

```text
1|2
Meta+L
2|3
Meta+L
3|4
Meta+L
4|5
```

反向：

```text
4|5
Meta+H
3|4
Meta+H
2|3
Meta+H
1|2
```

必须满足：

- 无 wrap
- 每次只移动一个逻辑 step
- focus 正确
- scrollOffset 正确
- 无 partial column 泄露到 secondary
- 无窗口闪到另一个 monitor

---

# 2.7 Test Group C — 快速 Motion Retarget

连续快速：

```text
L L L
```

然后：

```text
L L H
```

以及：

```text
H L H L
```

检查：

- 动画从当前 painted position retarget
- 无 snap
- 无突然回原点
- 无 opacity 残留
- 无 scale 残留
- motion completion 后所有 transient effect state 被清理

---

# 2.8 Test Group D — Wide

## D1 Pair → Wide

```text
1|2
focus 1
Meta+Z
```

预期：

```text
        [ 1 — 72% ]
```

两侧为空。

---

## D2 Wide → Pair

再次：

```text
Meta+Z
```

恢复：

```text
1|2
```

检查：

- geometry 精确
- neighbor 正确恢复
- 无 parking 状态残留

---

## D3 Wide directional semantics

场景：

```text
1(Wide preference) | 2
focus=2
Meta+H
```

预期：

```text
1 Wide
```

---

## D4 Off-screen Wide

```text
2|3
```

其中 1 有 Wide preference。

第一次：

```text
Meta+H
```

必须：

```text
1|2
```

第二次：

```text
Meta+H
```

才：

```text
1 Wide
```

---

## D5 Wide → visible neighbor

测试当前最新修复：

```text
Wide focused column
→ toward visible neighbor
```

检查 direction 不错误。

---

# 2.9 Test Group E — Dialog / WindowPolicy

测试：

```text
Firefox 文件选择器
Dolphin Properties
System Settings dialog
About dialog
modal confirmation
```

所有这些窗口：

```text
不得进入 Column
不得改变 columns[]
不得影响 Dock Column order
```

关闭 dialog 后：

```text
原 Column focus / viewport 不变
```

同时测试：

```text
skipTaskbar
utility
toolbar
transient
popup
menu
splash
```

至少人工验证典型实例。

---

# 2.10 Test Group F — Floating

## F1 Shortcut detach

```text
Meta+Shift+Enter
```

检查：

- 当前 managed window 被移出 Column
- geometry 不发生错误 jump
- 仍保持 active
- remembered floating target 正确

---

## F2 Shortcut reattach

再按：

```text
Meta+Shift+Enter
```

检查：

- 插入当前 focused Column 右侧
- logical order 正确
- Dock order 同步

---

## F3 鼠标拖动 detach

对 managed window：

```text
开始 interactive move
```

检查：

- 自动 detach
- 不强制改回 Column geometry
- 用户可以自由拖动
- 仍可 shortcut reattach

---

## F4 Dialog + remembered floating

当存在 remembered floating window 时打开 dialog。

在 dialog 上按：

```text
Meta+Shift+Enter
```

必须：

```text
无动作
```

不能误 attach remembered window。

---

# 2.11 Test Group G — Dock

## G1 点击可见 Column

```text
1|2
点击 Dock 中 1
```

只 focus，不滚动。

---

## G2 点击隐藏 Column

```text
1|2
点击 Dock 中 5
```

预期逐步：

```text
1|2
→ 2|3
→ 3|4
→ 4|5
```

最终激活 5。

---

## G3 Dock reorder

拖动：

```text
5 → 2
```

检查：

- UUID set 完整
- generation 正确
- columns[] 顺序修改
- focus 保留
- viewport 最小调整
- Dock 得到 authoritative state

---

## G4 stale reorder

可通过 debug / test helper 模拟 stale generation。

预期：

```text
REJECT stale-generation
→ authoritative resync
```

而不是错误 reorder。

---

# 2.12 Test Group H — Window Close

场景：

```text
1|2
```

关闭：

### focused 1

预期：

```text
原右 neighbor 接管 focus
```

### focused 2

优先：

```text
右 neighbor
```

不存在右 neighbor 时：

```text
左 neighbor
```

### 非 focused window

focus 不得被抢走。

---

# 2.13 Test Group I — Fullscreen / Maximize

测试：

```text
Pair
→ Fullscreen
→ Exit Fullscreen
```

恢复原 layout。

以及：

```text
Wide
→ Fullscreen
→ Exit
```

恢复 Wide/Pair 语义必须正确。

测试 KDE native maximize button：

```text
Normal
→ Safe-area maximize
→ Restore
```

恢复正确。

---

# 2.14 Test Group J — 双屏

## J1 Primary → Secondary

把 managed Column 拖到 secondary。

预期：

```text
立即从 primary columns[] 移除
```

secondary 使用 native behavior。

---

## J2 Secondary → Primary

inactive 返回 primary：

```text
暂不 adopt
```

第一次 activation 后：

```text
再加入 Column
```

---

## J3 动画不能污染 secondary

在 150% primary + 100% secondary 上连续 H/L。

检查：

- moving window 不在 secondary 出现
- clip region 正确
- 不出现跨 monitor ghost

---

# 2.15 Test Group K — Reload / Crash / Recovery

这是进入 daily stable 前最重要的一组。

---

## K1 KWin Script reload

准备：

```text
Columns = [1,2,3,4,5]
Viewport = 3|4
```

reload script。

检查：

- order 仍为 1,2,3,4,5
- viewport anchor 恢复
- focus 尽量保持
- parked windows 正确重新接管

---

## K2 Bridge restart

```bash
systemctl --user restart cc-scroll-dock-bridge
```

检查：

- KWin layout 继续工作
- H/L 不锁死
- timeout fallback 生效
- Bridge 恢复后 Dock IPC 重新工作

---

## K3 Bridge kill

```bash
systemctl --user stop cc-scroll-dock-bridge
```

然后：

```text
H/L
Wide
Pair
```

确认：

> Bridge 消失不能让桌面失去基本操作能力。

---

## K4 Native clip unavailable

临时 unload native effect。

预期：

```text
full-delta disabled
→ safe 20 px fallback
```

不能出现跨屏污染。

---

## K5 Script disable / uninstall

执行：

```bash
./uninstall.sh
```

检查：

- 所有 parked windows 恢复
- opacity 恢复
- script-owned minimize 恢复
- user-owned minimize 保留
- 无窗口留在 virtual desktop 左侧

---

## K6 Emergency Restore

主动调用 Emergency Restore。

检查：

```text
mainScreenState.enabled = false
```

并恢复：

- geometry
- opacity
- minimize ownership
- visibility

执行后桌面必须立即回到可操作状态。

---

# 2.16 Daily Smoke Test

完整 acceptance 很长，不需要每次提交都人工执行。

日常开发建议固定一个 3~5 分钟 smoke test：

```text
1. 打开 5 个普通窗口
2. H/L 来回 5 次
3. 快速 L-L-H
4. 一个窗口进入 Wide，再退出
5. 打开一个 Dialog
6. detach / reattach Floating
7. Fullscreen → return
8. Dock 点击隐藏窗口
9. 关闭 focused window
10. 重启 Bridge
```

全部正常即可继续日常使用。

---

# 2.17 Phase B 完成判据

创建：

```text
test/V3_DAILY_ACCEPTANCE.md
```

并记录一次真实环境 PASS：

```text
Fedora 44
KWin 6.7.5
Wayland
Mixed DPI
```

核心测试必须无：

```text
hidden/stuck window
wrong-output window
permanent opacity=0
stale minimize
focus loss loop
Bridge-induced freeze
cross-monitor animation leak
```

---

# 3. Phase C — Invariant Failure 自动安全恢复

**优先级：P1，但进入 Stable 前建议完成**

---

# 3.1 当前行为

现在：

```text
LayoutTransaction.end()
        ↓
InvariantChecker.check()
        ↓
PASS / WARN
```

例如可以检测：

```text
duplicate-window
duplicate-uuid
logical-x
invalid-width
state-ownership
wrong-output
focus-index
scroll-offset
pair-with-wide-target
missing-wide-viewport-target
presentation-focus
```

但当前出现 invariant failure 后主要只是：

```text
warn()
```

窗口布局仍可能继续运行。

---

# 3.2 风险

如果某个极端 race condition 导致：

```text
Column model
≠
WindowState
≠
真实 KWin geometry
```

随后继续响应：

```text
windowActivated
frameGeometryChanged
Dock command
H/L
```

就可能进一步扩大错误。

最坏情况：

```text
window parked outside virtual desktop
+
opacity=0
+
script lost ownership
```

这是 daily driver 最不希望发生的情况。

---

# 3.3 设计原则

不能：

```text
第一次 invariant FAIL
→ 立刻 Emergency Restore
```

因为 layout transaction 刚结束时可能存在非常短的：

```text
KWin async geometry acknowledgement
```

所以应该实现：

```text
Invariant FAIL
     ↓
短延迟确认
     ↓
再次检查
     ↓
仍然 FAIL
     ↓
Recovery
```

---

# 3.4 推荐架构

新增：

```text
src/kwin/stability/StabilitySupervisor.js
```

职责：

```text
InvariantChecker
      │
      ↓
StabilitySupervisor
      │
      ├── transient failure debounce
      ├── repeated signature counting
      ├── delayed recheck
      ├── fail-safe latch
      └── emergency recovery trigger
```

不要把这个逻辑塞回：

```text
InvariantChecker.js
```

InvariantChecker 应继续保持：

```text
纯检测
```

Supervisor 负责：

```text
策略
```

---

# 3.5 状态

建议：

```js
class StabilitySupervisor {
    constructor(options) {
        this.checker = options.checker;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
        this.relayout = options.relayout;
        this.recovery = options.recovery;
        this.disableLayout = options.disableLayout;
        this.warn = options.warn;
        this.debug = options.debug;

        this.pending = null;
        this.failed = false;
        this.failureEpoch = 0;
    }
}
```

---

# 3.6 推荐流程

```text
Transaction END
      ↓
checker.errors()
      ↓
empty?
 ├── yes → clear pending failure
 │
 └── no
       ↓
  schedule verification
       ↓ 200~300 ms
  checker.errors()
       ↓
      empty?
       ├── yes → transient, continue
       │
       └── no
             ↓
        attempt safe relayout
             ↓
        wait geometry settle
             ↓
        checker.errors()
             ↓
            still fail?
             ├── no → RECOVERED
             │
             └── yes
                   ↓
              disable layout
                   ↓
              Recovery.restoreAll()
```

---

# 3.7 为什么先 relayout 一次

很多错误可能只是：

```text
model 正确
geometry 暂时没 ACK
```

这种情况：

```text
relayout()
```

可以恢复，而不需要把整个 cc-niri 关闭。

因此 fail-safe 分两级：

## Level 1 — Self-heal

```text
audit failure
→ canonical relayout
```

## Level 2 — Emergency fail-open

```text
relayout 后仍失败
→ disable cc-niri layout
→ restore all windows
```

---

# 3.8 必须 Fail-open

最终原则：

```text
CC Niri 状态不可信
```

时：

**宁可回到普通 KDE 窗口，也不能继续管理窗口。**

因此最终 recovery 必须先：

```js
mainScreenState.enabled = false;
```

再：

```js
recovery.restoreAll(reason);
```

避免 restore 的同时 signal 又触发新 parking。

---

# 3.9 哪些 invariant 应直接提高严重度

所有错误并非同等严重。

建议分：

## Warning

```text
presentation-focus
wide-viewport-focus
```

可以先 self-heal。

## Critical

```text
duplicate-window
duplicate-uuid
state-ownership
wrong-output
invalid-width
invalid viewport mode
```

这类错误意味着 model ownership 已经不可信。

Critical 可以：

```text
一次 delayed confirmation
→ 仍失败
→ 直接 Emergency Restore
```

不必重复多次 relayout。

---

# 3.10 建议错误结构化

当前 `errors()` 返回字符串。

以后可以改为：

```js
{
    code: "state-ownership",
    severity: "critical",
    detail: "column-3"
}
```

例如：

```js
errors.push({
    code: "wrong-output",
    severity: "critical",
    detail: column.id,
});
```

这样 StabilitySupervisor 不需要：

```js
string.startsWith(...)
```

判断严重度。

如果暂时不想改 API，也可以先通过 code prefix 分类。

---

# 3.11 防止 Recovery Storm

必须增加 latch：

```text
NORMAL
  ↓
FAIL_SAFE_PENDING
  ↓
RECOVERING
  ↓
DISABLED
```

一旦进入：

```text
RECOVERING
```

禁止再次触发 recovery。

例如：

```js
if (this.failed) return false;
this.failed = true;
```

避免：

```text
restore
→ geometryChanged
→ audit
→ restore
→ geometryChanged
→ ...
```

---

# 3.12 日志

必须有非常明确的日志：

```text
[cc-stability] INVARIANT_FAIL
[cc-stability] VERIFY_PENDING
[cc-stability] SELF_HEAL
[cc-stability] SELF_HEAL_RECOVERED
[cc-stability] FAIL_SAFE
[cc-stability] EMERGENCY_RESTORE
```

例如：

```text
[cc-stability] INVARIANT_FAIL epoch=103
errors=state-ownership:column-4

[cc-stability] SELF_HEAL epoch=103

[cc-stability] FAIL_SAFE epoch=103
errors=state-ownership:column-4

[cc-stability] EMERGENCY_RESTORE
reason=invariant-failure
```

这样现场出问题时可以直接：

```bash
journalctl --user -b | grep cc-stability
```

定位。

---

# 3.13 新测试

建议新建：

```text
test/stability-supervisor.test.js
```

至少覆盖：

### Case 1

```text
首次 fail
→ delayed recheck PASS
```

不得 recovery。

### Case 2

```text
fail
→ recheck fail
→ relayout
→ PASS
```

只 self-heal。

### Case 3

```text
fail
→ relayout
→ fail
```

触发 Emergency Restore。

### Case 4

Critical：

```text
duplicate-window
```

确认后直接 fail-safe。

### Case 5

连续多个 callback：

```text
recovery 只能触发一次
```

### Case 6

Recovery 后：

```text
layout disabled
```

不能再次 parking。

### Case 7

stale timer：

```text
旧 epoch 的 timer
```

不能误恢复已经正常的新 epoch。

---

# 3.14 与 LayoutTransaction 的集成

当前：

```js
const layoutTransaction = new LayoutTransaction({
    audit: (reason, epoch) => invariantChecker.check(reason, epoch),
    debug,
});
```

建议变成：

```js
const stabilitySupervisor = new StabilitySupervisor({
    checker: invariantChecker,
    ...
});

const layoutTransaction = new LayoutTransaction({
    audit: (reason, epoch) =>
        stabilitySupervisor.audit(reason, epoch),
    debug,
});
```

于是：

```text
LayoutTransaction
      ↓
StabilitySupervisor
      ↓
InvariantChecker
```

职责清晰。

---

# 3.15 Phase C 完成判据

人工制造 invariant error 后：

```text
cc-niri 不得继续在错误状态运行
```

最终必须满足：

```text
窗口全部重新可见
窗口回到有效 screen geometry
用户自己 minimize 的窗口保持 minimize
cc-niri 自己 park/minimize 的窗口被恢复
layout stopped
不会出现 recovery loop
```

---

# 4. 三阶段执行顺序

推荐严格按：

```text
Phase A
Native CI
   ↓
Phase B
V3 Daily Acceptance
   ↓
Phase C
Invariant Fail-safe
   ↓
重新跑 Phase B
   ↓
Freeze
```

不要同时改三个模块。

---

# 5. 建议提交拆分

建议提交历史：

```text
ci: add native component build gate

test: add V3 daily acceptance matrix

feat: add stability supervisor for invariant recovery

test: cover invariant self-heal and emergency fail-safe

docs: mark V3 daily-stable acceptance complete
```

---

# 6. Stable 版本 Gate

只有下面全部满足后再打 Beta / Stable：

## Automated

```text
[ ] generated bundles PASS
[ ] JS regression PASS
[ ] Bridge native build PASS
[ ] Viewport Clip native build PASS
[ ] Plasmoid native build PASS
```

## Manual

```text
[ ] basic Column PASS
[ ] Pair PASS
[ ] Wide PASS
[ ] fast retarget PASS
[ ] Dialog PASS
[ ] Floating PASS
[ ] Dock PASS
[ ] Fullscreen PASS
[ ] Primary/Secondary PASS
[ ] Script reload PASS
[ ] Bridge restart PASS
[ ] Native effect fallback PASS
[ ] Emergency Restore PASS
```

## Fail-safe

```text
[ ] transient invariant failure does not overreact
[ ] recoverable invariant failure self-heals
[ ] persistent invariant failure disables layout
[ ] all parked windows become visible
[ ] no recovery loop
```

---

# 7. 完成后的项目状态

完成这三项以后，项目可以定义为：

```text
CC Niri V3
│
├── Feature complete for current personal workflow
├── Regression protected
├── Native build protected
├── Real-desktop acceptance tested
├── Runtime invariant monitored
└── Fail-open recovery available
```

这时候开发策略应该从：

```text
不断增加功能
```

切换为：

```text
稳定版本日常使用
+
发现真实问题再修
```

即：

```text
main
  └── future development

stable / v3.0.0-beta.1
  └── daily driver
```

---

# 8. 最终优先级

| 项目 | 优先级 | 是否阻挡 Daily Stable |
|---|---:|---:|
| Native CI Gate | P0 | 是 |
| V3 Daily Acceptance | P0 | 是 |
| Invariant Fail-safe | P1 | 建议是 |
| Multi-window Column | P3 | 否 |
| Overview | P3 | 否 |
| Session persistence | P3 | 否 |
| Secondary 双向 Column | P3 | 否 |
| 新动画 | P3 | 否 |

**这三项完成后，建议停止 V3 功能扩张，冻结一个可长期日常使用的版本。**
