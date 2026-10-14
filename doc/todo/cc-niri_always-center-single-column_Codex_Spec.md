# CC-Niri：`always-center-single-column` 实施设计与 Codex 任务规范

> 文档类型：可直接交给 Codex 的工程实施规格；**不是已完成实现或验收记录**\
> 编写日期：2026-10-12\
> 目标仓库：[Cc-aw/cc-niri](https://github.com/Cc-aw/cc-niri)\
> 核查基线：`main` / `b77a40eb1e0a0fd66d053c5996a13bc88e75518b`\
> 参考实现：[niri 的 `scrolling.rs`](https://github.com/niri-wm/niri/blob/main/src/layout/scrolling.rs)、[niri Layout 文档](https://niri-wm.github.io/niri/Configuration%3A-Layout.html)\
> 优先级：单列居中、原有 Pair 无回归、稳定性先于视觉效果。

## 0. 一句话目标

为 cc-niri 增加可选的 `AlwaysCenterSingleColumn`：**当前主屏工作区恰好存在一个受管 Column、且它是普通半宽列时，将该列在 Safe Area 内水平居中；出现第二列时恢复现有 Pair 布局，列间距和半宽不变。** Full 列仍占据 100% Safe Area，Wide、Fullscreen、浮动与副屏保持原有语义。

> 注意：niri 的 `always-center-single-column` **不是“每打开一个新窗口就让新窗口居中”**，也不是 `center-focused-column "always"`。仅对单列工作区进行居中，多个列时继续使用原本的焦点导航 / 滚动策略。不要把本任务扩展成所有焦点列居中。

## 1. 基线和架构边界

当前项目已经具备：

- JS Control Plane：`ColumnStore`、布局、Workspace Mount/Transfer、Pair/Wide、持久化、稳定性恢复与 Bridge 消息发布。
- Rust Native Core R0–R7：Spring、ViewportMotion、Scroll Runtime、Ring、协议 / eligibility。生产算法固定 Rust，旧 C++ Golden 仅在差分测试中使用。
- KWin C++ Adapter：实际输出、窗口对象生命周期、Scene Item、裁剪与绘制。
- 主屏默认 `half ↔ full`（50% / 100%）与 8 logical px 内部间隔；`third`、`twoThirds` 仍延期。
- 当前 `projectColumnRect()`：`screenX = safeRect.x + column.logicalX - scrollOffsetX`。
- 当前 `boundScrollOffset()` 把视口偏移约束到非负区间；Rust `native_protocol.rs::valid_scroll_plan()` 同样要求 `old_offset >= 0`、`new_offset >= 0` 和每个 entry 的 `logical_x >= 0`。

**必须遵循：**

1. **JS** 继续唯一负责判断哪些列属于哪个工作区、列宽、逻辑坐标、居中策略、状态发布和恢复。
2. **Rust** 继续唯一负责动画的数值演化；不添加第二套 JS Spring / timer / requestAnimationFrame。
3. **KWin Adapter** 继续负责绘制、裁剪和输入区域，不增加独立的窗口布局 authority。
4. 不修改现有 Spring 参数、`smooth60` / `stable` 行为、420ms 工作区曲线、Focus Ring 配色、Wide 参数、Bridge canonical 名称、用户快捷键。
5. 不恢复 C++ 生产 Motion 逻辑；不修改冻结的 Golden reference 来“让测试通过”。

### 1.1 当前需要先解决的基线门禁

在上述提交上，GitHub Actions 的 JS 回归 **99/100 通过**，失败项为 `test/workspace-runtime-guards.test.js`：测试通过 `vm` 单独加载 `eligible()`，却没有注入新的 `layoutEligibility`，产生 `ReferenceError`。这是当前基线的**真实 CI 失败**。

开始此功能前，先以最小改动修复测试隔离环境与依赖注入，复跑现有回归；不要将该失败归因于单列居中，也不要通过跳过测试掩盖。将基线修复单独提交或独立记录。

## 2. 用户可观察行为（精确定义）

| 场景 | `AlwaysCenterSingleColumn=false` | 启用后应有行为 |
|---|---|---|
| 0 个主屏受管列 | 现状 | 现状；偏移 0，无额外动画 |
| 1 个 half 列 | 通常靠左 | 在当前主屏 Safe Area **水平居中**；Y/高度不变 |
| 1 个 full 列 | 100% Safe Area | 仍占满 Safe Area，不额外留白 |
| 2 个 half 列 | Pair `1\|2` | 恢复原来的左右半宽 Pair 和原间隔 |
| 3 个及以上列 | H/L 按需滚动 | 可见 Pair、列顺序和现有 H/L 行为不变 |
| 1 个 half + Focus Wide | 现有 72% 居中展示 | 继续使用 Wide；退出 Wide 返回 **半宽居中** |
| Fullscreen | KWin 原生 fullscreen | 完全不受居中规则影响 |
| Dialog / transient / float | 不加入主屏 Column | 不计入“单列”，不受影响 |
| 副屏独立桌面 | 副屏 Safe Area / 原生窗口 | 不创建副屏单列居中；不修改副屏 geometry |
| 1 → 2 | 新列按现有聚焦策略插入 | 正常聚焦新增列时，从单列居中平滑切换到 Pair |
| 2 → 1 | 关闭或移走某个 Column | 剩余 half 列居中；不能遗留 offscreen、opacity=0 或错误焦点 |
| 切换工作区 / 重载 | 保存宽度、焦点与视口 | 不串工作区；单列恢复居中，多列保持可见布局 |

“一个列”只针对**主屏当前已挂载工作区**的 `mainScreenState.columns.length === 1`，不等于 `workspace.windowList().length`，也不统计 Floating、Dialog、副屏或其他工作区窗口。仅“显示列数为 1”但底层仍有隐藏 / parked Column 时**不算单列**。

### 非目标

- 不实现 `center-focused-column "always"` 或 `"on-overflow"`。
- 不实现 `third` / `twoThirds`、Multi-window Column、Overview、全屏外的其它视觉特效。
- 不重新开发动画系统，不引入独立动画定时器。
- 不强制新建窗口获得焦点；保持 `focusNew` 语义。
- 不把居中结果写成新的持久化 `widthMode` 或 `viewport.mode`，避免与 `Contextual Wide` 混淆。

## 3. 参考 niri 的原则

在 niri `scrolling.rs` 中，`is_centering_focused_column()` 判断：

```rust
center_focused_column == CenterFocusedColumn::Always
    || (always_center_single_column && columns.len() <= 1)
```

真正的居中由视口计算和动画完成，并不是直接重排全体窗口到物理屏幕坐标。niri 的视口相对于活动列表示，可自然使用负的相对视口偏移；cc-niri 目前采用**整条 Strip 的非负 `scrollOffsetX`**，因此不能原样复制 niri 的相对偏移公式。

本项目采用**等价可见行为，但不照搬 niri 内部坐标系统**的方案。

## 4. 推荐方案：固定的虚拟前导留白（Virtual Leading Inset）

### 4.1 为什么不用负偏移

单列逻辑位置 `x=0`、Safe Area 宽度 `W`、列宽 `w` 时，直观的居中偏移是：

```text
centeredViewportOffset = -(W - w) / 2
```

然而直接将负数写进 `scrollOffsetX` 会同时违反：

- `ColumnLayout.js::boundScrollOffset()` 的非负区间；
- `InvariantChecker.js` 的合法区间；
- Rust `native_protocol.rs::valid_scroll_plan()` 的非负协议约束；
- 既有 snapshot、native clip 和转场测试所依赖的坐标约定。

为一个 UI 功能扩展全链路带符号协议风险过高，**本阶段不采用此路线**。

### 4.2 核心思路

在启用该选项的主屏 Strip 中，为**整个逻辑列序列**加入固定的左侧虚拟留白 `L`，而不是只在 `columns.length === 1` 时改变第一列 `logicalX`。

```text
halfWidth = computeColumnWidth("half", safeWidth, innerGap)
L = max(0, floor((safeWidth - halfWidth) / 2))

column[0].logicalX = L
column[i+1].logicalX = column[i].logicalX + column[i].pixelWidth + innerGap
```

这里 `L` 对启用该选项的工作区**从一列到多列始终存在**；它是内部坐标基准，不是实际 Safe Area margin，也不是多列模式下持续显示的额外空白。多列时正常通过正数 `scrollOffsetX` 将它滚出视野。

**为什么不能只在单列时加 `L`？** 因为新增第二列时第一列的 `logicalX` 会由 `L` 变回 0，导致 Native SCROLL 以新逻辑坐标重算旧位置，破坏旧 / 新同一坐标基准下的动画连续性。固定 `L` 则能让“追加第二列”的既有列逻辑坐标保持不变。

### 4.3 数值例子

以主屏 Safe Area 宽度 `W=2512`、内部间隔 `gap=8` 为例：

```text
halfWidth = floor((2512 - 8) / 2) = 1252
L = floor((2512 - 1252) / 2) = 630
```

| 状态 | 列逻辑 X | `scrollOffsetX` | 屏幕相对 Safe Area 的 X |
|---|---|---:|---|
| 1 half | `[630]` | 0 | `[630]`（居中） |
| 2 half | `[630, 1890]` | 630 | `[0, 1260]`（正常 Pair） |
| 3 half，展示 2/3 | `[630,1890,3150]` | 1890 | 第 2、3 列 `[0,1260]` |
| 1 full | `[630]` | 630 | `[0]`，宽度 2512 |

如果 `safeRect.x ≠ 0`，最终屏幕 X 应在这些相对值上增加 `safeRect.x`。

对单列 half：

```text
screenX = safeRect.x + L - 0
```

对两列 half：

```text
screenX[0] = safeRect.x + L - L = safeRect.x
screenX[1] = safeRect.x + (L + halfWidth + gap) - L
           = safeRect.x + halfWidth + gap
```

不需要改变 `projectColumnRect()` 的公式；`scrollOffsetX` 继续非负。

### 4.4 必须保持的性质

1. `L` 是确定性纯函数，随 Safe Area 宽度与 `innerGap` 变化，但与 Column 当前焦点、工作区 ID、窗口数量无关。
2. 只有**启用配置**时 `L` 才大于零；关闭后必须恢复 `logicalX[0] = 0` 的原始行为。
3. 所有后继列仍按现有 gap 精确排布：`x[i+1] - x[i] = width[i] + gap`。
4. `computeStripWidth()` 仍取最后一列右边缘；`boundScrollOffset()` 继续使用 `[0, max(0, stripWidth - viewportWidth)]`，不得无条件放大上界。
5. 宽度按现有规则为 half / full；不要把 `L` 加到窗口 width、Safe Area 或 KWin 输出 geometry。
6. 以 logical px 运算；最终渲染沿用现有 KWin / Native 像素对齐策略。奇数宽度的左右边距误差最多 1 logical px（额外验证混合 DPI）。
7. `NaN`、非有限 safeWidth、极小尺寸、超大 gap 必须安全返回 `L=0` 或已有可用布局，不能产生无限数值。

### 4.5 第一列是 Full 的情况

即使只有一列，也继续使用同一个由 half 宽度计算出的 `L`，不改变列的逻辑坐标。此时由 `ensureColumnVisible()` 将 `scrollOffsetX` 调整为 `L`，得到宽度为 100% 的 Full 几何：

```text
logicalX = L
pixelWidth = safeWidth
scrollOffsetX = L
screenX = safeRect.x
```

从 half ↔ full 切换应复用现有 `ColumnWidthController` + Pair/Wide 宽度转场；不能把 Full 误认为半宽居中，也不能强制退出原生 fullscreen 后再居中。

## 5. 代码修改范围（按实际仓库路径）

### 5.1 配置入口

- `package/contents/config/main.xml`：新增 `AlwaysCenterSingleColumn`，`Bool`，默认 `false`。
- `package/contents/ui/config.ui`：在主屏 Column 布局区新增 checkbox `kcfg_AlwaysCenterSingleColumn`，说明“Center the only half-width column on the primary workspace”。
- `src/kwin/runtime/RuntimeConfig.js`：读取为 `alwaysCenterSingleColumn`。

默认 `false` 是为防止给现有工作区立即更换坐标系；在局部 / 实机验收通过后，由用户显式启用。配置变更通过**安全的 `cc-niri restart`** 生效；第一版不要求热切换，也不重置其他布局参数。

示例：

```bash
kwriteconfig6 --file kwinrc --group Script-cc-niri-maximize \
  --key AlwaysCenterSingleColumn --type bool true
cc-niri restart
```

回滚开关使用 `false` 并安全 restart。**禁用选项不得删除或重写已持久化工作区快照。**

### 5.2 纯布局函数

建议在 `src/kwin/layout/ColumnLayout.js` 新增纯函数，不在多个模块复制居中公式：

```javascript
function virtualLeadingInset(safeWidth, innerGap, enabled) {
    if (!enabled || !Number.isFinite(safeWidth) || safeWidth <= 0) return 0;
    const halfWidth = computeColumnWidth("half", safeWidth, innerGap);
    return Math.max(0, Math.floor((safeWidth - halfWidth) / 2));
}

// 保留旧调用的默认输出，不改变既有三参数测试。
function deriveColumnLayout(columns, safeWidth, innerGap, options = {}) {
    let logicalX = virtualLeadingInset(
        safeWidth, innerGap, options.alwaysCenterSingleColumn === true
    );
    return columns.map(column => {
        const pixelWidth = computeColumnWidth(column.widthMode, safeWidth, innerGap);
        const derived = { logicalX, pixelWidth };
        logicalX += pixelWidth + innerGap;
        return derived;
    });
}
```

此为**接口草案**，Codex 需检查现有导出、CJS marker 和调用方后适配，不要直接照抄为最终补丁；同时给 `virtualLeadingInset()` 加尺寸边界测试。

### 5.3 运行时重排

在 `package/contents/code/main.js` 的**人工维护入口部分（`/* END GENERATED KWIN MODULES */` 之后）**，把 `recomputeLogicalLayout()` 的 `deriveColumnLayout(...)` 调用接入 `runtimeConfig.alwaysCenterSingleColumn`。

注意：`tools/build.js` 只更新 main.js 的生成模块区；**不要直接修改生成模块区的代码**。修改 `src/kwin/layout/ColumnLayout.js` 后执行 `node tools/build.js` 重新生成相应区段。由于现有运行时主入口就是 main.js 的手写部分，修改入口逻辑属于允许范围，不能因为文件名叫 `main.js` 就把整份文件视为不可修改。

`projectColumnRect()` 不变。不要另设 `centeredX` 去覆盖渲染坐标，更不要在 KWin 窗口 geometry 上叠加第二份半宽 padding。

### 5.4 InvariantChecker（必须修改）

`src/kwin/stability/InvariantChecker.js` 当前 `expectedLogicalX = 0`；直接改变列起点而不改该校验会触发 `logical-x` invariant，并可能进一步触发 fail-safe。

改为从**同一个纯布局函数 / 单一辅助函数**计算预期起点（或计算完整预期列布局），并保持列间距、成员归属、focus、offset 范围检查。禁用功能时仍期望零起点。不要简单删除 `logical-x` 检查。

### 5.5 Workspace 恢复与状态快照

核对以下路径：

- `src/kwin/workspace/WorkspaceMountController.js`：`hydrate()` 的 `recomputeLayout()` → `boundOffset()` → `ensureVisible()`，以及 `capture()` 的 `viewportAnchor`。
- `src/kwin/runtime/StartupLayout.js`：旧 `viewportAnchor` 与 `restoreOffset()`。
- `src/kwin/workspace/WorkspaceSnapshotStore.js`：已有快照规范化与旧协议兼容。

方案**不新增 snapshot 字段**，不更改已有宽度与 Wide preference；只在重新挂载时派生 `L` 并约束偏移。

注意单列 half 的正确 offset 是 `0`，而它的 `logicalX=L`。因此 `capture()` 可能没有满足 `column.logicalX <= scrollOffsetX` 的 anchor，这时 `viewportAnchor=null` **是合法状态**，不可当作持久化失败。重新挂载单列 half 应得到 offset 0、位置居中。

从旧配置 / 旧快照恢复时：

- 旧单列 half：offset 被合法 bound 到 0，恢复居中。
- 旧单列 full：offset 对齐 `L`，恢复覆盖整个 Safe Area。
- 两列及以上：相对 anchor 的 delta 应继续保留原可见关系；必要时校正到有效焦点列，不能平白左移 / 右移一个 `L`。
- 配置回退 `false`：再次恢复原零起点视觉状态，保留窗口顺序、焦点、宽度和工作区。

### 5.6 动画分发：当前仓库有两个关键陷阱

**陷阱 A：不是有 `scrollTransaction` 就一定使用 Rust Scroll 动画。**

当前 `relayoutImpl()` 只有 `directionalFocus || plan.scrollTransaction.clipPartial` 时才向 `scrollPlanCommitGate` 安排 Scroll v2。普通 `adoptNewWindowAsColumn` / `removeColumn` 在全 half 布局中即使 offset 发生变化，也可能直接提交 KWin 几何、出现瞬移。

因此必须识别**狭义的单列布局转换**，在协议可表达且动画安全时使用同一个 Native Scroll ACK gate；不要放开条件让**所有** layout reason 都进入 Native。

**陷阱 B：新窗口进入 Column 时，Bridge 成员状态发布发生在 `relayout()` 之后。**

`bridge/src/CCNiriBridge.cpp::PublishMotionPlan()` 以**最后一次权威 `PublishState` 的 `columns` UUID 集合**验证 Scroll entries。若先发布包含新窗口的 SCROLL 再提交成员状态，Bridge 会拒绝这个计划。

为单列 `1 → 2` 的 Scroll 准备明确的、单次的**成员状态先发布 → MotionPlan publish → Native arm ACK → 几何 commit → 窗口激活**顺序。可参照现有 `workspace-mount` 的预发布模式；避免双重 generation、发布顺序竞态与状态快照中旧 workspace 的 UUID。

不得在 `ScrollPlanCommitGate` 还未获得 ACK 时提前把待进入的窗口从 parking 直接设置到可见输出；要遵循现有 `DeferredScrollParking`、`deferActivation()`、epoch / ownership 和失败回退流程。不得靠定时 sleep 解决 Bridge 时序。

### 5.7 状态变化矩阵（不能错误地套用一种 Scroll）

| 变化 | 逻辑坐标是否重编号 | 建议处理 |
|---|---|---|
| 空工作区 → 1 half | 不存在旧列 | 直接用静态最终位置居中；不播放从屏幕边缘飞入动画 |
| 1 half → 2 half，**在右侧追加** | 旧第一列 `logicalX` 不变 | 可用 Native Scroll v2，offset `0 → L`；第一列连续滑向左侧，新列从右侧进入 |
| 2 half → 1 half，**移除右侧** | 存活的原第一列 `logicalX` 不变 | 可用 Native Scroll v2，offset `L → 0` |
| 2 half → 1 half，**移除左侧** | 存活列从第二列重编号为第一列 | **不能只按旧 / 新 offset 强行创建 Scroll v2**，因为同一 UUID 的旧逻辑 X 已改变；参见 5.8 |
| 1 → 2，新列插在左侧 / 恢复插入 | 存活列逻辑 X 变化 | 同样属于重编号情形；参见 5.8 |
| 1 half ↔ 1 full | 列逻辑 X 不变、宽度和 offset 变 | 继续使用现有 `ColumnWidthController` 与视觉事务，不额外复制 Spring |
| 工作区卸载 / 重载 | 全部重新 hydrate | 以静态恢复为主；不把旧 output / workspace 的 pending animation 跨域继承 |
| Safe Area 尺寸 / DPI 变化 | `L` 与各列宽度变化 | cancel / rebase 旧事务，重新计算合法 geometry，不跨设备像素重复取整 |

### 5.8 处理“剩余列重新编号”的视觉连续性

这是整个特性最容易漏掉的边界。以 `W=2512, gap=8, L=630` 为例：

```text
旧布局 [A, B]：
  logicalX[A] = 630
  logicalX[B] = 1890
  scrollOffset = 630
  B 实际屏幕相对 X = 1260

关闭 A 后，新布局仅 [B]：
  logicalX[B] = 630
  scrollOffset = 0
  B 目标屏幕相对 X = 630
```

如果直接用**新**的 `logicalX[B]=630` 配上**旧**的 `scrollOffset=630` 计算动画起点，Native 会认为 B 曾经位于 `x=0`，然而它的旧实际位置是 `x=1260`，会造成错误的起始图像 / 跳变；甚至可能引发与真实窗口几何不一致的裁剪。

**必须先判定逻辑坐标基准是否保留**，再选择动画路径：

1. 捕获幸存窗口旧的 `logicalX`、旧几何与旧 viewport 运动状态（有在途 Spring 时以已绘制的 visual pose 为准，不把 target 当作 painted）。
2. 重新计算新逻辑布局，对存活 Window ID 比较 `oldLogicalX` 与 `newLogicalX`。
3. 若所有参与 Native Scroll 的幸存列 X 一致，使用普通 Scroll v2。
4. 若任何幸存列 X 发生变化，**不得发出把“旧 offset + 新 logicalX”当成旧画面的 Scroll v2**。该路径应采用项目已有的安全几何转场机制；如果现有路径不能以“旧实际绘制位置 → 新目标位置”表达连续位移，需要增加一个**最小、独立门禁的 Native 单窗视觉位移适配**，复用 Rust Spring / 共享呈现时钟和现有 Native clip，不能新增 JS 插值器、定时器或第二套 focus authority。
5. 以上转场期间，实际窗口归属、focus、Ring owner、输入 hit-test、park/unpark 仍由现有控制器管理。动画完成或取消后，几何应精确落在 canonical `projectColumnRect()` 目标，不保留临时额外 translation。
6. 失败回退必须**可见、可聚焦、可恢复**。若暂时无法证明重编号转场的渲染连续性，先安全提交正确位置，并把此用例标为“视觉验收未通过”；不得宣称整个功能已经达到平滑验收。

这段约束允许 Codex 检查并复用现有 `MotionPlanCommitGate` / Native Clip 能力，但**不得冒用 `PAIR_TO_WIDE` / `WIDE_TO_PAIR` 的协议类型**来表示本质不同的“列重编号”。任何确有必要的最小 Native 扩展都必须先出一个明确的协议和回滚设计，再实施、通过全量 Native 门禁。

## 6. 开发顺序（每阶段可独立测试和回滚）

### P0 — 基线修复和只读环境核对

- 固定 Rust 1.99.0 与 `/usr/bin/g++` GNU 16.x，不升级工具链。
- 核查运行中的 `main`、构建 / 运行时版本、KWin 主副屏 Safe Area。
- 修复 99/100 回归中的 `layoutEligibility` 测试上下文；取得 baseline 全绿。
- 保存工作区快照与安全回滚点；不要在开发阶段反复覆盖 KWin 已映射的动态库。

### P1 — 纯布局 + 配置（先禁用）

- 完成 `virtualLeadingInset`、`deriveColumnLayout` 可选参数、RuntimeConfig / KConfig / UI。
- 更新 InvariantChecker 起点检查。
- 新增纯 JS 测试：关闭时旧行为字节 / 数值不变，开启时单列和 Pair 坐标正确，边界值正常。
- `node tools/build.js`，生成区段校验通过。

### P2 — 恢复、半宽与 Full / Wide 兼容

- 适配 `recomputeLogicalLayout()`、workspace mount、start/restart、safeRect 更新。
- 单 half、单 full、Pair 与多列几何全部成立。
- 不改 Full/Wide 的原显示大小和偏好；退出 Wide 时应回到单 half 的居中位置。
- 补充工作区 snapshot roundtrip、disabled 回退以及 secondary 不变测试。

### P3 — 1 ↔ 2 动画与 Bridge 时序

- 仅在满足真实旧 / 新窗口基准一致、合法 entries、正常焦点 / 输出身份时安排 Native SCROLL。
- `1 → 2` 插入右侧：State 先于 MotionPlan，Native ACK 先于 geometry，geometry 先于新窗 activation；测试延迟 ACK、拒绝、timeout、快速反向。
- `2 → 1` 移除右侧：复用同一 Spring / ownership，逐帧连续，不闪现、不遗留 parked。
- 排除或单独处理布局重编号情形；完成 P4 前不宣布最终视觉验收。

### P4 — 重编号、异常路径与实机验收

- `2 → 1` 移除左侧、新列插入左侧、已有 Full 与后继列、多工作区 move-and-follow 等基准变化场景。
- 能复用现有 Motion 通路则复用；不能满足连续性时，按 5.8 设计最小转场接口并通过专门门禁。
- 测量 4K60 下真实 H/L / 加窗 / 关窗呈现间隔、drop / Ring 同步与 idle repaint；不能仅凭 Core 单测推断 GPU 延迟。
- 全部验收后才建议用户长期启用。未覆盖的阶段标注 Pending，而不是省略。

## 7. 回归测试要求

### 7.1 单元 / 几何

建议新增 `test/always-center-single-column.test.js`；独立测试纯函数，不依赖实机：

1. `enabled=false`：0/1/2/5 列逻辑布局与原实现一致（第 1 列 `logicalX=0`）。
2. `enabled=true`：`W=2512, gap=8` 的 `[630]`、`[630,1890]`、`[630,1890,3150]`；相应屏幕 X 分别 `[630]`、`[0,1260]`、`[0,1260]`。
3. 单 Full 的投影为 `safeRect.x`、`pixelWidth=W`；`half → full → half` 后中心正确。
4. `W=1/2/3`、gap=0/8/很大、非整数 safeWidth、非有限数输入全部有限且有界。
5. safeRect 具有非零 / 负的全局 X 原点时，只相对 Safe Area 居中。
6. 启用后的 `logicalX[i+1] = logicalX[i] + pixelWidth[i] + gap`，InvariantChecker 不报错；主动破坏列起点仍必须报错。
7. `boundScrollOffset` 对负 offset 仍 clamp 到 0；Rust Scroll v2 对负 offset 仍拒绝（不改变协议）。

### 7.2 集成与状态

在 `test/helpers/workspace-runtime.js` 或等价 mock runtime 中，使用 `AlwaysCenterSingleColumn: true` 创建真实的 1 / 2 列工作区，检查：

- 空 → 第一列；第二列在右插入并获得焦点；关闭右列；关闭左列；撤销浮动 / 重新接管；重复 `1→2→1`。
- `focusNew=false`：不擅自改变真正的焦点；如果第二列没有激活，不强求立刻滚动成左右 Pair，但激活后必须能按原规则显示。
- 有在途 `scrollPlanCommitGate.pending` 时再次开 / 关窗；所有旧 ACK 必须因 epoch 失效而不能覆盖新状态。
- Bridge 的 `PublishState` 必须在含新增 UUID 的 `PublishMotionPlan` 前被接受；验证调用顺序与单次 generation。
- Native `ArmScrollPlan` 失败、Bridge 拒绝、150ms ACK timeout：无不透明度泄漏、错误 minify、卡在停车区或焦点丢失。
- W0–W9 切换后分别保留各工作区 Column 数量、居中几何和宽度偏好；move-and-follow 不串状态。
- 真实 Full、Wide、Fullscreen、Dialog、Floating、Quick Tile 与副屏 Safe Area 均无回归。
- 重启后 `viewportAnchor` 允许空值；单列和多列都能准确恢复，关闭开关后能退回旧布局。

### 7.3 Native / 渲染 / 混合 DPI

- 1→2、2→1（两种关闭方向）截图 / capture 的第一帧与最后一帧必须与源 / 目标窗口几何吻合；重点核对重编号时旧 painted pose，而不是旧 target。
- 单列时 Ring 始终围绕真实窗口内容，边框宽度、圆角和柔光纹理与原有静态 F3 一致；不能偏移 `L` 两次。
- 100%、125%、150%、175%、200% SDK 像素对齐与 clip / 输入一致性；实际双屏基线 4K/150% + 2K/100%。
- 主屏居中不能触发副屏持续 repaint，不能导致窗口窗口边界越过真实 Safe Area 进入副屏；inactive / fullscreen / output change 应清理旧 visual ownership。
- 运行中关闭 / 重开 2 个窗口、短时间快速开关 10 次、H/L 与 J/K 中途操作，不允许残留幽灵列。

## 8. 必须执行的门禁

依照仓库 `AGENTS.md` / `native/AGENTS.md`，至少执行：

```bash
node tools/build.js
node tools/build.js --check
node tools/check.js

cargo fmt --manifest-path native/rust/Cargo.toml --all --check
cargo clippy --manifest-path native/rust/Cargo.toml \
  --locked --workspace --all-targets -- -D warnings
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
node tools/check.js --native
```

若修改 Native Core / FFI / CMake：另做现有 **Debug / Release Core CTest、umbrella Native build + CTest、`BUILD_TESTING=OFF` 生产边界审计**；GCC 路径和版本仍须按仓库规范验证。不要使用 Rust stable 别名或最新 C++ 替换固定工具链。

若仅修改 JS，也不能因此跳过生产 JS 回归及在途动画 / 实机最小 smoke；自动测试不能替代用户视觉验收。对首次 CI 失败要把“基线修复”和“本功能引入”区分记录。

## 9. 实机部署与验收场景

**风险：cc-niri 是安装进 KWin 的窗口布局脚本。绝对禁止未备份就全量替换 / `killall kwin_wayland` / 强制全局重启，或边测试边同时编译多个 Native 大目标导致桌面不稳定。**

按照仓库已有 save-state → stop → install/upgrade → start 入口执行；若只改 JS 尽量仅升级脚本，不重新构建和替换无关的 Native 插件。保存原 `kwinrc` 配置、`~/.local/state/cc-niri/workspaces.json`、旧包及 `rollback-component.sh` 路径。

验收表（需要逐条填写 `PASS / FAIL / BLOCKED` 与证据）：

| ID | 操作 | 预期 |
|---|---|---|
| S01 | 空桌面新建一个 Konsole | 50% 宽度，安全区水平居中，不弹跳 |
| S02 | 再新建 Firefox | 1→2 平滑移动到 Pair，两窗完全可见、gap 不变 |
| S03 | 关闭最右窗口 | 最后单列居中；Ring 位置一致 |
| S04 | 再新建右窗，然后关闭最左窗口 | 存活右窗移至居中，不错误使用重编号后的旧坐标 |
| S05 | 单列 `Meta+F` 两次 | half center ↔ Full 100%，不闪现邻列 |
| S06 | 单列 `Meta+Z` 两次 | Wide 72% ↔ half center，偏好不丢 |
| S07 | 3–5 列 H/L，最后只剩一列 | 多列保持原 Pair 滚动，最后剩余列居中 |
| S08 | J/K 切换空 / 单 / 多列工作区 | 工作区隔离、恢复正确、无 parked 遗留 |
| S09 | 将一个受管 Column 移到相邻 / 数字工作区 | 目标工作区单列时居中，源工作区按剩余数量更新 |
| S10 | 打开文件选择对话框 / 模态窗口 | 不计入单列，不改变父窗口 Center / Focus |
| S11 | 主副屏显示不同工作区并操作窗口 | 副屏位置与四周 Safe Area 不变 |
| S12 | 4K 150% / 2K 100%，连续添加 / 关闭和快速 H/L | 裁剪 / Ring 正常、无跨屏泄漏；记录 frame capture |
| S13 | 中途 stop/restart、Bridge 短暂不可用 | 布局安全恢复、不黑屏 / 隐身 / 停车区卡死 |
| S14 | 把配置改回 false 并 restart | 恢复原先第一列左对齐 / Pair 行为，旧快照不损坏 |

记录至少包括：日期、commit、KWin / Fedora / Plasma 版本、两屏模式与缩放、实际配置、差异截图或短视频、Native 状态与 Bridge 日志、测试结果及回滚步骤。不要将单次呈现间隔统计写成总体 GPU 性能提升。

## 10. 完成定义（DoD）

只有**全部**满足时才能标记为“已完成”：

1. 主屏单 half 居中、单 Full 100%、多列 Pair 与现有 H/L 布局都正确；默认禁用时无行为回归。
2. **1→2 在右侧正常插入**时基于 Rust Native Scroll 同一时钟平滑过渡；Bridge State / UUID / epoch 的发布顺序正确。
3. **2→1 两种移除方向**可用、焦点正确，重编号场景不会发布伪造旧姿态的 Scroll v2。若实际视觉有跳变，必须明确记录未通过，不能宣称动画验收完成。
4. Full/Wide、Dialog/Floating、Fullscreen、workspace move、双屏 Safe Area 与 Focus Ring 均无回归。
5. workspace snapshot roundtrip / 旧版数据兼容 / 配置开关回退通过；InvariantChecker 能正确识别合法的虚拟前导留白和真正的异常。
6. Rust 生产 Core、Bridge/FFI、既有 smooth60 / stable 和 Native clip 没有破坏；全量回归和必需门禁通过。
7. 相关实机项目已经验收；完整进度、限制、性能证据与安全回滚方案提交到 `test/`。README 与 `doc/README.md` 同步真实完成情况。

## 11. Codex 执行指令（可直接复制）

> 请先阅读根目录 `AGENTS.md`、`native/AGENTS.md` 和本文件。当前基线是 `b77a40e`。先做只读核对与基线 CI 修复，然后按 P1→P4 顺序实现 `AlwaysCenterSingleColumn`。目标是主屏仅一个 half 列时在 Safe Area 内居中；多列保留 Pair，Full/Wide 语义不变。首选固定 Virtual Leading Inset，禁止随列数突然重新定义旧 Column 的 logicalX；严禁为此放宽 Rust Scroll v2 的非负 offset 协议或引入 JS 动画时钟。
>
> 特别检查 `relayoutImpl()` 目前仅为 H/L 或 clipPartial 安排 Native SCROLL，以及 `CCNiriBridge::PublishMotionPlan()` 必须先看到包含新 UUID 的权威状态。对列删除 / 插入引起的 surviving-column logicalX reindex，必须用真实旧视觉位置做运动连续性验证，不能用新 logicalX 配旧 offset 伪装起点。
>
> 每阶段先添加测试再实施，运行对应门禁；首次遇到失败只修本阶段根因，不放宽 invariant、不修改 Golden baseline、不跳过 CI。最后报告变更文件、测试结果、实际动画证据、尚未通过的实机场景、回滚方法；未经用户明确同意，不进行影响运行桌面的危险操作。不可将设计文档称为已实现。

## 12. 参考源码与核查索引

**niri**

- [niri `scrolling.rs`](https://github.com/niri-wm/niri/blob/main/src/layout/scrolling.rs)：`is_centering_focused_column()`、`compute_new_view_offset_centered()`、`add_column()`、`animate_view_offset_with_config()`。
- [niri Configuration: Layout](https://niri-wm.github.io/niri/Configuration%3A-Layout.html)：`center-focused-column` 与 `always-center-single-column` 的官方语义。

**cc-niri**

- [ColumnLayout.js](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/layout/ColumnLayout.js)
- [Projection.js](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/layout/Projection.js)
- [LayoutEngine.js](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/layout/LayoutEngine.js)
- [InvariantChecker.js](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/stability/InvariantChecker.js)
- [WorkspaceMountController.js](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/workspace/WorkspaceMountController.js)
- [RuntimeBridge.js](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/integration/RuntimeBridge.js)
- [CCNiriBridge.cpp](https://github.com/Cc-aw/cc-niri/blob/main/bridge/src/CCNiriBridge.cpp)
- [Rust Native Scroll Protocol](https://github.com/Cc-aw/cc-niri/blob/main/native/rust/cc-niri-native-core/src/native_protocol.rs)
- [Native Scroll ACK Gate](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/layout/ScrollPlanCommitGate.js)
- [KWin 运行入口 / 生成包](https://github.com/Cc-aw/cc-niri/blob/main/package/contents/code/main.js)
- [测试约束](https://github.com/Cc-aw/cc-niri/blob/main/AGENTS.md)

---

**实施提醒：** 虚拟前导留白解决的是**不改变 Scroll v2 非负协议的几何表达**；它本身不自动解决所有窗口增删时的连续动画。上线前必须同时完成 Native ACK / Bridge UUID 时序与逻辑列重编号的视觉路径验证。
