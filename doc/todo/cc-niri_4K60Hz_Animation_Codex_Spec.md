# CC-Niri：4K 60Hz 动画流畅度优化实施规范

> **交付对象：Codex**\
> **文档版本：1.0**\
> **日期：2026-10-07**\
> **核查基线：`Cc-aw/cc-niri`，`main`，`f3650b286198c0a189f0e32f59f249b2c9b43e88`**\
> **性质：待实施设计，不是已完成优化或实机验收报告。**\
> **建议保存位置：`doc/cc-niri_4K60Hz_Animation_Codex_Spec.md`**

---

## 0. 给 Codex 的执行入口

本任务是在现有 CC-Niri 架构上，优化 **4K 60Hz 主屏的动画节奏、连续输入接管和负载稳定性**。不是再次进行 Rust 重构，也不是重写窗口管理器。

**默认本轮只实现 A0 和 A1。** A0 建立测量基线，A1 修正 H/L 的输出与呈现时钟。完成代码、自动测试和阶段报告后，停止扩大范围，汇报实机验收状态。A2 及以后按阶段继续，不把全部优化合并成一次大改。

执行要求：

1. 先读根 `AGENTS.md`、`native/AGENTS.md` 及本文件，再核查本地源码和工作树；远端基线不代表用户本地没有更新。
2. 在独立功能分支开发，建议 `feat/animation-60hz`。保留用户未提交修改，不执行破坏性 reset、自动 stash、强推或未经要求的 main 合并。
3. 保留 JS / Rust / C++ 现有职责分工，只对本阶段需要的模块做增量修改。
4. 默认仅构建和测试；**未得到明确部署授权，不运行会替换当前桌面组件的安装、stop/start 或卸载操作。** 已获得部署授权时，遵循第 13 节安全流程。
5. 每阶段交付：修改清单、行为差异、测试结果、测量证据、尚未验证项、回滚方法。
6. 编译默认最多 2 个并行任务，门禁顺序执行，不同时启动多套构建或 microbenchmark。

**完成标准不是“编译通过”“用了 Rust”或“计数器达到 60fps”，而是：呈现稳定、轨迹可解释、连按不无故刹停、交互延迟不恶化、布局与生命周期不回归。**

---

## 1. 目标、边界与术语

### 1.1 本次目标

- H/L 在目标输出的绘制周期中，按 KWin 提供的预计呈现时间采样。
- 同一输出、同一动画帧内，Incoming / Continuing / Outgoing 使用同一个 motion sample。
- 连续同向 H/L 不再无条件清零速度；反向输入有明确、受限、可测试的制动策略。
- J/K 保留有限时长工作区动画，改善中途 retarget 的速度衔接。
- H/L 收尾考虑物理像素可见精度，避免不必要的微小运动长尾。
- 减少动画主动触发的无关输出重绘，保留正确的损伤区域、遮挡和清理语义。
- 保持窗口、Focus Ring、裁剪与最终绘制变换一致。

### 1.2 明确不做

本任务不更改显示分辨率、刷新率、缩放、驱动或 KDE 全局动画速度；不新增合成器、不改窗口布局 authority、不改变现有快捷键，不引入另一套工作区实现。

不在本任务顺便实现 Wide 100%、贴底布局、安全区域外滚动、拖拽排序、多窗口 Column、Overview 或其他桌面功能。即使这些功能在其他分支开发，也应保持独立。

不引入独立 60/120/240Hz 动画定时器、后台动画线程、async runtime、全局锁、插帧或默认运动模糊。不要通过每帧修改真实窗口 geometry 来代替 compositor paint transform。

不把“减少 Blur / 关闭透明”设为默认方案；仅在实际测量证实渲染瓶颈时做独立 A/B。

### 1.3 几个必须区分的概念

| 概念 | 本文定义 |
| --- | --- |
| `event_time` | 控制事件被本组件接收并处理的单调时钟时间；未必是硬件按键时间 |
| `predicted_present_time` | KWin 为当前目标输出绘制提供的预计呈现时间 |
| `last_painted_sample` | 最近一次真正用于目标输出绘制的数值状态；**不等同于已确认显示到面板上** |
| `actual_present_time` | 由现有 `framePresented` 机制观测到的实际呈现时间戳 |
| C0 连续 | 接管时的位置状态不跳变 |
| C1 连续 | 接管时的位置、速度状态连续 |
| C2 连续 | 在 C1 基础上，加速度也连续 |
| 数值完成 | 运动达到终点或符合其收尾条件 |
| 生命周期完成 | JS park / disarm、ownership、可见性引用等按既有协议释放 |

60Hz 的名义刷新周期为 `1000 / 60 ≈ 16.67ms`；提高计算频率不会使该屏幕呈现真正的 120 个独立刷新画面。本任务改善的是现有刷新机会中的运动质量。

---

## 2. 已核查的当前实现

以下结论针对文档顶部的固定提交。Codex 必须先检查本地是否发生变化，不能为了套用文档而回退用户的新实现。

### 2.1 源码事实

| 路径 / 符号 | 基线行为 | 本次意义 |
| --- | --- | --- |
| `native/viewport-clip/ViewportClipEffect.cpp`，`prePaintScreen()` | H/L 活跃时调用 `m_scrollRuntime.advance(motionNow())`；该段未按 target output 过滤 | 需要核查并修正采样时钟与输出边界 |
| 同文件，`postPaintScreen()` | H/L 活跃且未完成时调用 `effects->addRepaintFull()` | 不只是切换瞬间，持续 H/L 也主动申请全局重绘 |
| `native/viewport-clip/WorkspaceSlideAdapter.cpp` | J/K 已使用 `data.view->nextPresentationTimestamp()`；按输出持有 motion、请求后续 repaint | 复用设计思路，不重写 KWin 时钟 |
| `native/rust/cc-niri-native-core/src/scroll_runtime.rs`，`arm()` | 连续滚动从最近的 `frame_offset` 开始，但实际调用 `motion.start()` | **只改 `ViewportMotion::retarget()` 不会修复这条生产路径** |
| `.../viewport_motion.rs`，`start()` | 使用 `Spring::new(from, target, 0.0, params)` | 接管初速度被清零 |
| 同文件，`retarget()` | 从采样位置重启，旧策略也清零速度 | 旧测试明确覆盖这种行为 |
| `.../spring.rs` | Spring 已支持非零初速度；默认 `mass=1`、`damping_ratio=1`、`stiffness=800`、`epsilon=0.0001` | 保留解析求解器，优先修复调用与策略 |
| `.../workspace_motion.rs` | 从最近绘制位置接管；每段重启零端点速度的 quintic smoothstep | 单段平滑不等于中途 C1 连续 |
| `native/focus-ring/FocusRingEffect.cpp` | 在窗口绘制链中捕获并沿用变换 / 裁剪上下文绘制 Ring | 保留现有绘制附着，不新增 Ring 动画时钟 |

源码与文档来源见第 16 节的 S1–S10。

### 2.2 现有工作区优化不要重复实现

仓库已经存在：

```ini
[Effect-cc-niri-viewport-clip]
OptimizedWorkspaceAnimation=false
WorkspaceDuration=420
```

这是源码默认值，不代表用户当前有效配置。`WorkspaceDuration` 现有允许范围为 240–800ms。既有 CLI 负责优化动画启用期间暂停原生 Slide、关闭时恢复偏好；本任务不得绕过这一互斥与恢复机制。[S4]、[S8]

`test/WORKSPACE_ANIMATION_RESULTS.md` 记录过 4K60 主屏、150% 缩放及双屏环境下的 J/K 采样：独立优化组约 60fps、没有超过 25ms 的长间隔；另一次初始采样出现过 33.326ms 间隔。记录同时说明新旧画面不是严格相同的 A/B，人工视觉验收与部分负载场景仍有限制。[S8]

**这些是仓库历史记录，不是本轮新测量，也不能外推为 H/L 已经稳定。** 本轮应重新记录当前输出、GPU、有效配置、提交与插件版本。

---

## 3. 不得破坏的架构契约

### 3.1 职责分工

```text
JS Control Plane
  布局 / 焦点 / 工作区选择 / 协议发布 / 全局恢复
             │ 事件、计划、epoch
             ▼
C++ Adapter
  KWin output 与 window 生命周期 / paint hooks / 配置读取 / 呈现观测
             │ 窄 DTO；不传 QObject 或 EffectWindow 指针
             ▼
Rust Core
  运动采样 / 接管策略 / 有限轨迹 / 数值验证 / 投影
             │ 一帧一份数值结果
             ▼
C++ paint path
  窗口变换 / clip / Ring 共用最终绘制上下文
```

Rust 不读取平台时钟，不获得 KWin 指针，不成为第二套布局或焦点 authority。C++ 不承载弹簧、Hermite 曲线或制动策略。生产核心仍固定 Rust，不恢复 R1–R6 迁移开关。[S1]、[S2]

### 3.2 生命周期和协议

- Scroll v2 与独立 Ring v1 的 JS schema、发布 authority 保持不变；新增运行时诊断字段不等于修改协议。
- session / workspace / output / generation / epoch 屏障继续生效。
- 重复消息、旧消息、取消、几何不匹配等规则继续保持；特别保留“合法计划已接受后，几何或时钟 arm 失败仍消费该 epoch”的当前约定。
- 接管起点使用最近实际绘制状态，不使用 KDE 已经提交的目标 geometry，也不先按当前墙钟外推后直接跳过去。
- **motion completed 后仍保留 Outgoing，直到既有 JS park / disarm。** 数值终止不能直接触发 hide、删除引用或抢先归还 ownership。
- Pair/Wide 离开工作区时的冻结、workspace barrier、fullscreen effect owner、可见性引用、窗口关闭处理不得被绕过。
- Focus Ring 不出现第二个 owner、第二套 eligibility 或独立计时器。

以上约束来自当前仓库规范，应与功能测试一起保留。[S1]、[S2]

### 3.3 与旧 Golden differential 的关系

这是**明确改变动画行为的新功能**，不是要求逐值等价的语言迁移。

不得修改 `native/rust/tests/reference/` 来“让新结果等于旧结果”，也不得删除整个 differential 门禁。应保留原有默认入口或 stable 策略，与冻结 C++ reference 继续差分；新策略另建契约测试。

若需要调整仓库约束中关于旧 retarget 的描述，只做与新功能模式直接相关的最小更新，清楚标注 stable 旧语义与新语义。R0–R7 历史验收报告保持原样，本任务新增独立报告。

---

## 4. 分阶段交付与模式设计

### 4.1 阶段表

| 阶段 | 范围 | 本阶段不做 |
| --- | --- | --- |
| **A0** | 只读核查、低扰动采样、建立 A/B 基线 | 不改动画手感 |
| **A1** | H/L 目标输出过滤、呈现时钟、一帧共享采样 | 不改速度接管、刚度与收尾 |
| **A2** | H/L 最近绘制速度保存、同向接管、受限反向 | 不改 J/K、不同时调刚度 |
| **A3** | J/K 有限轨迹的速度接管 | 不改工作区 authority、默认时长 |
| **A4** | H/L 刚度 A/B、物理像素收尾 | 不泛化到 Wide / Ring / 全局 Spring |
| **A5** | 持续 repaint 限定输出、HiDPI 一致性检查 | 不立即做细粒度 damage 或关闭全部特效 |
| **A6** | 集成验收、获授权后部署、文档与回滚 | 不宣称未测试场景已经通过 |

A1 的采样输出过滤与 A5 的 repaint 范围缩减应分开提交：先修正采样，保留旧 damage 作为保守基线，再单独评估渲染变化。

### 4.2 一个明确的模式开关，不引入迁移矩阵

建议新增 KConfig 键：

```ini
[Effect-cc-niri-viewport-clip]
AnimationProfile=stable
```

**这是拟新增选项，基线尚不存在。**

- `stable`：默认模式；保留基线动画策略，作为对照与故障回退。仍使用 Rust，不是 C++ 后端。
- `smooth60`：启用当前阶段已经完成的新策略。A1 阶段只改变采样；A2 才增加速度接管；后续依次推进。
- 不因检测到 60Hz 而自动启用；不修改全局动画速度。
- 不创建十几种永久 feature flag 的组合。阶段 A/B 用提交边界和这两个模式完成。
- 初次读取或重配置时解析一次配置，生成类型化策略；热路径不读 kwinrc、不解析字符串。
- 无效 profile 回退 stable，并在状态中给出原因。

`AnimationProfile` 与现有 `OptimizedWorkspaceAnimation` 独立：smooth60 不得自动打开工作区优化，不得擅自禁用原生 Slide。工作区优化未启用时，A3 不生效；启用且 profile=stable 时继续现有有限曲线。

A4 试验参数通过纯数值测试和受控开发版本比较，不要求立即新增一套用户调参 UI。最终入选参数集中在 Rust 的策略配置中，状态接口可查询其有效值。

---

## 5. A0：基线与低扰动测量

### 5.1 开工核查

记录以下内容，写入新增的 `test/ANIMATION_60HZ_RESULTS.md`：

```sh
git status --short
git branch --show-current
git rev-parse HEAD
```

确认本地 `AGENTS.md` 及模块实现与本规范的差异。不要拉取或重置本地工作树以强行匹配固定提交。

在具备桌面访问权限的实际机器记录：KWin / Qt / GPU / 驱动、输出名称、物理分辨率、实际刷新率、scale、当前加载的插件路径 / hash、有效 profile、工作区优化开关 / 时长、原生 Slide 状态。没有桌面访问权限则标记“未执行”，不能据 README 猜当前状态。

### 5.2 复用现有呈现观测

基线已有 `StartWorkspaceFrameCapture()` / `GetWorkspaceFrameCapture()` 和 `KWin::RenderLoop::framePresented` 接入。扩展时保持现有接口可用；为 H/L 新增带版本的采样接口或向新报告格式增加记录，不默默改变旧字段含义。[S3]

建议每帧记录固定尺寸 DTO：

| 字段 | 用途 |
| --- | --- |
| capture / transition / frame 标识 | 区分采样、操作与绘制 |
| 输出 token、动画 epoch / revision | 识别副屏污染、重复 pass 和中途接管 |
| event receive / predicted / sample 时间 | 分析控制事件到绘制以及采样时钟 |
| `x`、`v`，工作区必要时 `a` | 分析轨迹与接管；明确单位 |
| target、scale、刷新周期 | 归一化位移并计算物理像素指标 |
| retarget 类型、是否制动、是否降级 | 不隐藏异常策略分支 |
| numerical completed / ownership active | 区分收尾与生命周期 |

实际呈现事件单独记录。能通过可靠 frame 标识关联时再建立一对一关系；做不到时，报告“输出呈现统计”和“绘制轨迹统计”两组数据，**不要把预计时间冒充实际时间，也不要把每个 paint pass 当成一次新呈现。**

### 5.3 采样开销约束

采样默认关闭；开始采样时一次性准备固定容量缓冲，例如 2048 条 frame DTO，容量只是建议。每帧只写固定字段，不进行文件 I/O、D-Bus 调用、JSON 编码、UUID 格式化、动态扩容或同步 GPU 等待。

缓冲满后标记 `truncated` 并停止写入；不得静默覆盖数据却仍宣称完整。导出 JSON / CSV 只发生在显式查询时，最好在动画结束后。

诊断关闭时不额外触发 repaint；诊断开启也不能改变动画时钟和布局。增加开关前后数值轨迹一致性测试。

### 5.4 需要输出的指标

- 实际呈现间隔的 P50 / P95 / P99、最大值、样本数、截断状态。
- `long_interval = dt > 1.5 × 当前输出刷新周期`。60Hz 时约为 25ms；超过阈值不自动等于已证明的“漏掉几个帧”。
- 每帧逻辑 / 物理位移、解析速度、接管状态误差。
- 从 **组件收到事件** 到第一个可见位移采样的时间；没有硬件输入时间，不叫完整端到端输入延迟。
- `T95`、进入视觉终点阈值的时间、数值完成时间、JS park / disarm 时间。
- 每个输出由本插件主动发起的 repaint 请求计数 / 区域；不将其等同于实际 GPU 工作量。

**A0 通过条件：**没有改变生产动画；能收集同一画面、同一输入脚本的基线；无效、截断、无法关联的数据都能被明确识别。

---

## 6. A1：H/L 呈现时钟与输出归属

### 6.1 修改位置

主要修改 `ViewportClipEffect.cpp/.h`；必要时新增小型 `AnimationFrameContext` helper 和对应测试。不要为此重写整个 effect，也不要把数值策略搬进 C++。

可参照 `WorkspaceSlideAdapter::prePaintScreen()` 的已有用法，但必须用本地 KWin headers 核验 `ScreenPrePaintData`、`RenderView` 与 `nextPresentationTimestamp()` 的契约。

### 6.2 每个目标输出帧只采样一次

smooth60 下的语义流程：

```text
进入 prePaintScreen(data)
  → 继续既有 workspace adapter / effect chain 调用
  → H/L runtime 不活跃：不推进
  → 当前真实输出不是 runtime target output：不推进
  → 取得本输出的预计呈现时间
  → 检查时间域、单调性和 sample revision
  → 当前帧已采样且 revision 未变化：复用
  → 否则推进一次，生成不可变的 frame sample
  → 本输出的所有受管窗口投影复用这个 sample
```

具体调用顺序以现有效果链正确性为前提，不能因提前 return 而漏掉 `effects->prePaintScreen()`。

**重要细节：**

- 在 arm / context 更新时解析并缓存 target output 绑定，不要每帧调用生成 JSON 的 `status()` 来找输出。
- 副屏 paint pass 不得更新主屏 `last_painted_sample`、完成状态或采样时间。
- 重复 paint、递归窗口绘制、离屏捕获与实际输出绘制要区分。窗口 `paintWindow()` 重入只消费当前 frame sample，不再推进动画。
- 帧缓存至少考虑 output、presentation timestamp 和 motion revision；不能只按 timestamp 去重，漏掉同一时刻接受的新 epoch。
- 必须区分“已算出的 pending sample”和“已用于真实目标输出绘制的 sample”。仅运行 prePaint 而没有用于目标绘制的样本，不能错误覆盖接管锚点。
- 输出移除、上下文改变、stop / reconfigure 时清除该绑定与缓存，使用现有安全取消路径。

### 6.3 时间域与回退

Core 继续接受有符号纳秒和单调时间。事件接收时间、预计呈现时间必须先确认同一时间基准，不能将 `QDateTime` 的 Unix 毫秒与 steady-clock 纳秒混用。

正常路径使用目标输出预计呈现时间；不能简单将所有 `motionNow()` 文本替换掉。协议 `issuedAt` / 工作区 barrier 的既有时间域不在此阶段改动范围。

对于预测时间缺失、为无效值或倒退：

- 采用明确的降级规则，不能输入负 elapsed 或让画面倒退。
- 最低要求是保持最近有效采样，并使用同域单调时间作为有记录的后备；后备时间不能小于最近有效采样时间。
- 时间突然前跳时按真实 elapsed 采样，不能把任意长间隔强行当成 16ms，导致动画无限拖长。
- fallback 原因进入诊断计数，不每帧输出 warning。

预计呈现时间可能晚于事件实际处理时间；这不是错误。后续接管应遵循第 7.2 节的锚点与单调屏障，而不是伪造 `+1ns` 修补顺序。

### 6.4 A1 验收

以可注入时钟的测试覆盖：60 / 120 / 144Hz、59.94Hz、不等间隔、相同时间戳、倒退、预测缺失、多输出交错与新 epoch。

在保持预计呈现时间序列不变时，随机扰动执行时刻，smooth60 的采样位置应不变。增加副屏 pass 不应改变主屏采样序列。

A1 不调整 `stiffness=800`、`epsilon`、初速度或 J/K 时长。对比 stable，差异应限定在采样时刻与输出归属。

---

## 7. A2：H/L 速度连续接管

### 7.1 实际生产路径必须修改到位

重点是：

```text
ScrollViewportRuntime::arm()
        → ViewportMotion 的新策略入口
        → Spring::new(..., initial_velocity, ...)
```

不能只改 `ViewportMotion::retarget()`，再用它的单元测试宣称普通 H/L 已修复。必须使用生产 `arm()` 路径的集成测试验证。

### 7.2 保存完整绘制状态

将“仅缓存 frame offset”的思路扩展为完整 motion sample。名称可按现有风格调整：

```rust
// 概念 DTO，不要求照抄名称或公开到 JS 协议。
struct PaintedMotionSample {
    position: f64,              // logical px
    velocity: f64,              // logical px / second
    sample_time_ns: i64,
    epoch: i64,
    revision: u64,
}
```

Core 的查询和 projection 不得隐式采样当前时间。`advance()` 尽量一次获得完整 sample，复用 position、velocity 和完成状态，不为每个查询重复求值。

接管采用：

```text
x0 = 最近真正用于目标输出绘制的 position
v0 = 同一个 sample 的 velocity
start_time = max(本次事件的同域单调时间, sample_time)
```

这保持既有“从最近绘制位置接管”的用户契约。若没有有效绘制样本、工作区或输出不同、已经静止，则采用静止起点或既有清理路径，不能继承无关速度。

**连续性的口径：**这里匹配的是被保存的绘制状态，不是按任意墙钟重新求值的旧轨迹。事件与绘制之间可能存在时间重基准；报告应同时检查实际相邻帧位移，不能仅凭 `new.v0 == saved.v` 就宣称屏幕上的所有间隔都严格 C1。

不要在新目标到来时额外先显示一帧旧目标，再显示新目标。不要重置整个输出时钟。没有新绘制帧时连续接受多个目标，仍从同一个有效绘制锚点重规划，不能不断制造未显示的中间运动状态。

### 7.3 同方向接管

对 same session / workspace / output、几何可连续的普通滚动：

- 保留有效 `v0`，更新目标。
- 同目标且运动策略未改变时不重启曲线；协议 epoch / entries 的接受与更新照常执行。
- 不简单按每次 key repeat 累加一个额外速度；速度来自已有运动状态，不能凭输入次数无限放大。
- 目标接近、初速度过大时仍要检查过冲和可用绘制区域，不能把“同方向”当作绝对安全条件。

H/L 的必要目标是 C1；不要求第一版将 Spring 升级为全程 C2 或 jerk-limited solver。

### 7.4 反方向接管与不可同时满足的条件

当 `v0` 非零时，以下三个条件不能无条件同时满足：完全保留速度、立即反向、绝不沿旧方向继续移动。

采用明确策略：**优先保持位置，正常范围内保留速度并短暂制动；制动位移必须在当前已持有窗口和 clip 可安全覆盖的区域内。**

建议实现顺序：

1. 首先检查当前解析 Spring 以 `v0` 启动后的转向时刻、过冲和区域边界；满足约束时直接使用，不增加额外阶段。
2. 超过可接受反向位移时，进入 Rust 内部的短制动段，再接目标 Spring。H/L 允许制动边界加速度不连续，但位置、速度应连续。
3. 可先试验制动时长上限 50ms、额外旧方向位移上限为安全视口对应方向长度的 2%；这些是待 A/B 的工程起点，不是通用最佳值。
4. 实际位移上限还应取可用绘制覆盖范围与硬边界的更小值，不得为满足运动曲线越过 workspace / output 生命周期约束。
5. 若边界处没有制动空间、数值异常或约束不可满足，允许显式降级到保持当前位置、重置速度的安全策略；计数并记录原因，不声称这一退化分支仍是 C1。

不能在每帧简单执行 `x = clamp(x, min, max)` 来掩盖轨迹越界；那会制造停止 / 速度跳变。应在规划阶段生成受限轨迹，clamp 只能是最后的异常保护。

若先采用常减速度制动，可利用 `制动位移 = v0 × Tb / 2` 限定 `Tb`。不要为了一个固定 50ms 时长越过可绘制区域，也不要承诺极端情况下仍能获得完全柔和的速度转向。

### 7.5 建议的模块拆分

- `viewport_motion.rs`：保留旧入口；增加携带初速度 / 策略的内部入口。
- `scroll_runtime.rs`：完整绘制样本、生产 arm 接管、revision 与 completion 协调。
- 可新增 `motion_policy.rs` 或 `scroll_retarget.rs`：仅在反向策略使原模块职责明显膨胀时拆出，不创建空泛的通用动画框架。
- `spring.rs`：默认保持解析求解器和参数不变；必要的纯数学辅助函数可新增，不改共享默认行为。

仅在 Adapter 确实需要新字段时扩展窄 FFI，不修改 JS schema。不将复杂容器跨 C ABI 暴露。

### 7.6 A2 验收

至少覆盖单次 H/L、同向 30 / 60 / 120ms 间隔连按、20 / 50 / 130 / 250ms 后反向、边界无效导航、目标不变、同帧多目标及关闭窗口。

正常接管应验证：新起点等于最近绘制位置、新初速度等于对应速度、未丢失仍需绘制的 Outgoing；异常降级应有独立测试。

C0 / C1 数值误差采用有单位的绝对加相对容差，例如 `1e-8 + 1e-10 × max(1, |reference|)`；不要将这类数值容差与第 9 节的视觉阈值混用。

---

## 8. A3：J/K 有限轨迹的连续接管

### 8.1 保留的行为

维持 `WorkspaceMotion` 的工作区坐标体系、grid 边界、wrap 最短路径、gesture release / cancel 以及每输出状态。工作区选择仍由原控制层决定。

维持现有 `WorkspaceDuration`，默认 420ms，不在本阶段改成动态时长。单次从静止开始的曲线应继续与当前 quintic smoothstep 一致。

只有工作区优化已启用且 profile=smooth60 时，启用新接管策略；其他组合保持原行为。

### 8.2 带初始速度 / 加速度的五次轨迹

建议新增纯 Rust `workspace_curve.rs`，或在当前模块保持合理规模时直接扩展。状态至少保存当前位置和解析速度；若实现 C2，还要保存对应解析加速度。

对每个轴，以 `u = elapsed / T` 计算：

```text
q(u) = c0 + c1*u + c2*u² + c3*u³ + c4*u⁴ + c5*u⁵
v(t) = q'(u) / T
a(t) = q''(u) / T²
```

边界条件：

```text
q(0) = x0     v(0) = v0     a(0) = a0
q(1) = x1     v(T) = 0      a(T) = 0
```

可使用以下归一化系数。`T` 以秒计，速度与加速度单位必须一致：

```text
c0 = x0
c1 = v0*T
c2 = 0.5*a0*T²

A = x1 - c0 - c1 - c2
B = -c1 - 2*c2
C = -2*c2

c3 =  10*A - 4*B + 0.5*C
c4 = -15*A + 7*B - C
c5 =   6*A - 3*B + 0.5*C
```

当 `v0=a0=0` 时，这些系数退化为当前的 `6u⁵−15u⁴+10u³`。终点时显式写入目标与零速度 / 加速度，避免浮点残差造成无限活动。

本文已用独立代数边界检查验证上述系数，但**没有因此验证完整受限轨迹、KWin 接入或实机手感**。

### 8.3 不能直接套 Hermite 就结束

非零初速度 / 加速度的五次轨迹可能过冲、越界或出现不必要的二次摆动。必须在起段 / retarget 时检查整段范围，而不只是检查端点。

可采用导数极值检查，或利用等价 Bézier 控制点和有界细分证明包络；纯采样少量帧只能做测试，不能当作完整范围证明。不要为此在每帧求根或引入大依赖，规划可在事件路径完成，采样保持常数复杂度。

- 正常可行段：保持 x / v，条件允许时同时保持 a。
- 不可行段：使用受限制动 / 分段轨迹；H/L 的策略不能直接照搬而忽略工作区坐标单位。
- 硬边界不可行：明确安全降级，保留位置、终点与生命周期正确性。区分 C1 与 C2 降级，不能笼统宣称“全程 C2”。
- 普通完整切换仍按 `WorkspaceDuration` 完成；若异常分段需要改变完成时间，必须在状态与测试报告中记录，不能静默增加长尾。

工作区速度单位是 workspace cell / second；投影后才乘输出宽高加 gap。窗口逻辑像素速度不能未经转换直接写入工作区 motion。

### 8.4 gesture 的边界

现有 gesture 输入未必包含可信速度。第一轮保留原 gesture 语义；无法可靠取得 release 速度时允许零速度释放，不宣称已实现惯性手势。

任何新增速度估计都必须仅基于明确时间戳的 gesture 样本，并作为独立范围验证；不得借本阶段擅自更改输入手势系统。

### 8.5 A3 验收

保持现有 workspace-motion-rust-contract，新增：同向 J/J、J/K 快速反向、多次 retarget、单格 / 多格 / wrap、grid 边界、无移动目标、gesture cancel、不同输出尺寸 / scale、事件时钟落后于预测采样时间。

必须复验 Pair→Wide 在 20 / 80 / 180ms 中途离开工作区的现有 fixture、返回后状态、fullscreen owner 与可见性引用释放；不能只检查多项式端点。

---

## 9. A4：60Hz 参数与视觉收尾

### 9.1 先测刚度，其他变量固定

保持 H/L `mass=1`、`damping_ratio=1`，依次比较 stiffness=800 / 600 / 500。先在纯数值与相同输入序列中比较，再按用户授权进行实机 A/B。

下表是本文件制作时根据当前临界阻尼公式进行的**理想数值计算**：位移 1260 logical px、scale=1.5、初速度 0、从 t=0 开始以 60Hz 采样。不是实机结果，不代表任意相位或连续输入下的最大值。

| stiffness | T95 | 最大相邻采样位移，physical px |
| --- | ---: | ---: |
| 800 | 167.721ms | 321.018 |
| 600 | 193.667ms | 281.889 |
| 500 | 212.152ms | 256.764 |

公式：

```text
omega = sqrt(stiffness / mass)
x(t) = D * [1 - (1 + omega*t) * exp(-omega*t)]   // x0=0，v0=0
```

600 仅是候选，不是直接修改生产默认值的依据。降低 stiffness 会减少峰值速度，但也延长到达与收尾；需要同时报告 T95、视觉到位时间、反向响应、首个可见位移和用户感受。

J/K 420ms 先不动，不用“减少总时长”代替接管优化。不要让全局 `SpringParams::default()` 的修改意外影响其他 motion 或测试。

### 9.2 物理像素视觉收尾

当前 epsilon 是逻辑坐标下的数值精度。smooth60 的 H/L 可独立增加视觉终止策略；stable 与其他动画继续保留原条件。

建议同时检查：

```text
position_error_physical = abs(target - x) * output_scale
velocity_step_physical  = abs(v) * refresh_period_seconds * output_scale

两者都 <= 0.25 physical px
```

0.25 是初始试验阈值，可比较 0.125 / 0.25 / 0.5；不要无依据扩大。

单靠“当前位置接近目标”不足以判定完成：携带速度时仍可能穿过终点。除双阈值外，应限制为已进入最终稳定趋近段，或验证后续轨迹包络仍在阈值内；制动段 / 高速穿越阶段禁止提前收尾。

刷新周期来自当前目标输出的有效刷新率，不从某一个偶然 33ms 长帧推导放宽阈值。输出无效、scale 非正或刷新率未知时使用保守旧数值完成条件，并记录后备原因。

符合条件后精确 snap 到目标并置 numerical completed，继续保留 Outgoing / ownership，等待原 JS park / disarm。不得提前删除窗口、改变焦点或发送新的工作区操作。

### 9.3 数值例子与限制

在 1260 logical px、150%、stiffness=800 的静止起步模型中：

- T95 约 167.721ms。
- 仅位置误差进入 0.25 physical px 约 404.909ms。
- 满足当前双重数值 epsilon 条件约 684.583ms。

这里第二项只是**位置阈值**，不是自动认为已满足新收尾策略。实际收尾还受速度、轨迹包络、采样相位与生命周期影响。

A4 测试要覆盖 100 / 125 / 150 / 175 / 200% scale、59.94 / 60 / 120 / 144Hz、短位移、长位移、同向 / 反向速度、长帧、结束前新目标到来，以及输出缩放改变。

---

## 10. A5：重绘范围与 HiDPI 一致性

### 10.1 优先只缩小持续 repaint

将 H/L 活跃未完成时的持续 `addRepaintFull()`，在 smooth60 下改为覆盖目标输出的安全 repaint 请求；数据来自已有绑定，不每帧解析协议。

先不追求逐窗口的极小 damage。主屏大面积滚动可能本来就影响大部分主屏，先避免插件无条件带动副屏更稳妥。

arm / cancel / workspace barrier / marker 改变等一次性全局 repaint 暂时保留；只有测试证明损伤区域完整，才另行缩小。切换输出、全屏接管或清理失败时可保留保守全局 damage。

`postPaintScreen()` 中必须知道当前正在完成哪个真实输出 pass，不能因副屏 postPaint 再为主屏重复发起推进 / 完成逻辑。注意 effect chain、嵌套绘制和 output 移除的有效性。

**验收口径：**插件不再主动为每个 H/L 动画帧申请无关输出的全局 repaint；副屏仍可能因为光标、视频或其他效果重绘，不应要求其全局帧计数恒为零。

### 10.2 数值位置不取整，最终绘制策略一致

内部 motion position、velocity、frame offset 保持浮点精度，不把物理像素取整结果写回 Core。

在最终绘制处检查窗口、clip、Ring 是否使用一致的变换与坐标映射。不能分别对窗口与 Ring 采用不同舍入规则，制造 1px 错位。

niri 的 fractional layout 文档区分未取整的 motion offset 与最终渲染位置的物理像素对齐；借鉴这一原则，但**不要把 niri 的整数物理像素要求机械套到 KWin 的所有纹理变换上**。先验证当前 KWin / Ring 的既有 HiDPI 路径，能够复用则不新增取整层。[S11]

测试 150% 缩放下的浅蓝边框、窗口边缘、阴影、圆角、负坐标、不同输出原点；禁止重复乘 scale。原有 Focus Ring 宽度、颜色、owner 与 fullscreen 隐藏策略保持不变。

### 10.3 性能优化的后续条件

只有发现实际呈现长间隔或合成瓶颈时，再测 Blur、背景对比、透明内容与圆角。采用一项开 / 关的同场景 A/B，不同时更改多个效果。

不要在动画中逐帧切换 blur 角色、冻结整个桌面截图、同步读取 GPU timer 或使用 `glFinish()` 来“稳定帧率”。这些改变可能引入额外延迟或视觉回归，属于另一个需要证据支持的任务。

---

## 11. 配置、状态与错误处理

### 11.1 有效状态必须可查询

在现有 `GetScrollMotionStatus()` 中添加向后兼容字段，具体命名可遵循项目风格：

```text
animationProfile
scrollClockSource
scrollTargetOutput
scrollRetargetPolicy
scrollSpringStiffness
scrollVisualSettlePhysicalPx
workspaceRetargetPolicy
clockFallbackCount
retargetDegradedCount
```

这些是**新增字段建议**，不是当前已存在的接口。状态应反映真正生效的后端与参数，不只是读到的配置文字。未实施阶段不要声称已经启用对应能力。

热路径不得依赖生成整个 status JSON。状态导出、日志和文件序列化留在显式查询或阶段边界。

### 11.2 切换 profile

通过现有 reconfigure / CLI 生命周期应用配置，确保动画与引用按已有安全清理路径结束。不得单独改一个 Rust 参数而留下上一种 profile 的半段状态。

测试 stable↔smooth60 切换、优化工作区 true / false 组合、无效字符串、插件版本不支持配置的情况。profile 不修改 KDE 原生 Slide 偏好的保存 / 恢复协议。

### 11.3 错误策略

无效数值、旧 epoch、无效输出 / 窗口、时间倒退遵循已有可恢复错误约定。**不得因为用户快速输入、热插拔或可预期的配置错误，新增 `abort()`、panic 或崩溃 KWin 的路径。**

保留项目既有的 `panic=abort` 工具链约束与 FFI 不跨语言 unwind 的边界；这不意味着普通无效输入应主动 panic。不要趁本任务对所有已有 FFI 错误处理做大规模重写。

---

## 12. 测试与量化验收

### 12.1 自动测试矩阵

| 测试组 | 必测内容 |
| --- | --- |
| 稳定模式回归 | stable 与冻结 reference / 基线契约继续一致 |
| 时钟 | 预测时间相同而执行时刻扰动；倒退 / 重复 / 缺失 / 大跳变 |
| 多输出 | 主副屏交错 paint、不同刷新率、不同 scale、目标切换 |
| 帧复用 | 同输出同帧多窗口、递归绘制、新 epoch 同时间戳 |
| H/L 生产 arm | 位置与速度锚点、同向 / 反向 / 同目标、同帧多次输入 |
| 轨迹范围 | 高初速度、近目标、硬边界、制动段、降级分支 |
| 工作区 | quintic 端点、速度 / 加速度、wrap、grid、gesture 原语义 |
| 生命周期 | 关闭 / 删除窗口、取消、session 切换、output 移除、stop |
| ownership | 数值完成仍持有 Outgoing，直到 JS park / disarm |
| Pair / Wide | 离开画面冻结、中途 J/K、返回、fullscreen owner |
| Ring / HiDPI | paint transform、clip、边框粗细与原有独立权限协议 |
| 分配 / FFI | 开关关闭零新增采样开销、frame 热路径不分配、ownership / null / 无效值 |

不要只用同一段生产公式对照自身。Spring 继续使用已有独立 ODE / reference；新有限曲线用边界条件、独立高精度计算与范围检查交叉验证。

### 12.2 实机 A/B 方法

固定应用、窗口数量与尺寸、工作区、焦点、背景 / 特效、输出配置和输入脚本。每个关键场景建议至少 20 次，分别报告冷启动与稳定运行；初次绘制不应直接删除。

需要的场景包括：普通 H/L、同向连按、反向、普通 J/K、中途反向、Pair→Wide 中途离开、双屏正常使用，以及一组受控编译负载。编译压力测试独立进行，不能与普通组混在一起，再把偶发长帧归咎于某个模块。

实际刷新周期用测量配置计算，不能强行写死 16.6667ms。不同组若窗口 / 内容不一致，标记不是严格 A/B。

### 12.3 阶段通过标准

**正确性硬门槛：**

- 无崩溃、黑屏循环、Rust panic、悬空引用、窗口遗失或 ownership 泄漏。
- 无新 session / epoch / workspace 隔离错误，无 barrier 绕过。
- 正常接管满足其声明的位置 / 速度容差；受限降级有显式记录。
- J/K 有限轨迹终点与范围符合策略，不能无限拖尾。
- 退出 / 回滚后窗口、焦点、工作区与原生 Slide 偏好可恢复。

**性能与体验验收：**

- A1 在理想注入时钟测试中消除执行时刻扰动造成的采样差异。
- 普通轻载场景目标是不新增 >1.5 周期长间隔；若实际有异常，报告完整样本而不是只给平均 FPS。
- 新版相对 stable 的事件接收到首个可见响应，不能无解释地回退超过一个刷新周期；轨迹慢启动导致的变化应单独披露。
- A2/A3 同向连按不再出现无理由的初速度归零；反向额外移动符合明确上限与边界。
- A4 降低峰值步进的同时不能仅靠长时间拖动换取“平滑”；报告响应和收尾的取舍。
- A5 降低本插件主动请求的无关输出 repaint，不能造成残影、裁剪错误或少绘制。

P99 在样本很少时意义有限，必须一起报告样本数与最大间隔。未获得 GPU 时长时不要声称“GPU 帧时间优化了多少”；未获得真实输入 / 呈现关联时不要声称完整输入延迟降低。

人工手感只能记录用户实际反馈。没有反馈写“待人工验收”，不能用自动测试代替。

---

## 13. 构建、部署与回滚

### 13.1 工具链与并发

遵循仓库当前工具链：读取 `rust-toolchain.toml`，基线固定 Rust / Cargo 1.99.0；C++ 使用 `/usr/bin/g++`、GNU GCC 16.x。禁止换用 stable 别名或绕过 CMake policy。[S1]、[S2]

建议在仓库根目录的 Bash 会话中执行：

```bash
set -euo pipefail
export CMAKE_BUILD_PARALLEL_LEVEL=2
export CARGO_BUILD_JOBS=2
export CTEST_PARALLEL_LEVEL=2

cargo fmt --manifest-path native/rust/Cargo.toml --all --check
cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
node tools/check.js --native
```

上述命令需要本地对应工具链和 KDE 依赖；不因环境不具备而标记通过。迭代中先跑定向测试，阶段交付前跑完整门禁，避免每次小改都并行重建所有树。

修改 Core / FFI / Qt 转换时，按 `native/AGENTS.md` 验证 Debug / Release Core CTest：

```bash
for config in Debug Release; do
    cmake -S native -B "build/rust-$config" \
        -DCMAKE_CXX_COMPILER=/usr/bin/g++ \
        -DCC_NIRI_BUILD_KWIN_ADAPTERS=OFF \
        -DCMAKE_BUILD_TYPE="$config"
    cmake --build "build/rust-$config" --parallel 2
    ctest --test-dir "build/rust-$config" --output-on-failure --parallel 2
done
```

同时运行仓库要求的 umbrella Native 构建 / CTest。修改 CMake 链接或生产边界时，继续验证 `BUILD_TESTING=OFF` 的生产目标和 `tools/check-native-boundary.py`；不恢复退休迁移矩阵。

若需要修改 `src/`，必须执行 `node tools/build.js` 生成包，不直接编辑生成的 `main.js`。非必要时保持 JS bundle 不变。

### 13.2 部署前快照

仅在已获得部署授权后进行。使用既有 save-state / stop / immutable install / start 流程，不能另写简化脚本绕过恢复保护。

备份应放在持久用户状态目录，例如 `${XDG_STATE_HOME:-$HOME/.local/state}/cc-niri/backups/<标识>`，不要只依赖会被清理的 `/tmp`。

记录并备份：本地提交与 dirty diff、有效配置键的原值及“原本不存在”的状态、实际插件 / CLI 版本及 immutable 路径、工作区状态文件、恢复步骤。

**不要盲目覆盖整个 kwinrc 或 workspaces.json 以回滚一个动画选项。** 正常回滚仅恢复本任务修改的键和组件；完整状态快照仅用于必要的故障恢复，避免抹掉用户之后的窗口操作与其他配置。

### 13.3 三层回滚

1. **行为回滚：**将新增 `AnimationProfile` 恢复 stable，经现有安全 reconfigure / 生命周期应用。其余设置不变。
2. **组件回滚：**恢复部署前 immutable 插件 / CLI 绑定，按既有 start 流程恢复。不能因为新插件清理失败就强制卸载仍持有窗口的对象。
3. **仓库回滚：**在功能分支保留独立阶段提交；需要撤回时采用可审计的 revert，不执行会丢失用户修改的 reset。

profile 只能回退行为，不能保证救回已经崩溃的 compositor。部署记录必须包含现有项目支持的外部恢复入口；不要在本任务发明未经验证的 KWin 重启命令。

### 13.4 立即停止后续部署的信号

出现黑屏 / KWin 循环重启、错误输出窗口移动、Outgoing 遗失、JS barrier 失效、持续 native 错误、退化计数异常增长或不明时间域差异时，停止推进阶段，保存证据并按已有安全路径回滚。

---

## 14. 代码与文档交付清单

建议新增或更新以下文件，具体拆分以不重复现有模块为准：

```text
native/viewport-clip/ViewportClipEffect.cpp/.h
native/viewport-clip/WorkspaceSlideAdapter.cpp/.h        # A3 起按需
native/viewport-clip/AnimationFrameContext.*            # 可选，小型平台 helper
native/rust/cc-niri-native-core/src/viewport_motion.rs
native/rust/cc-niri-native-core/src/scroll_runtime.rs
native/rust/cc-niri-native-core/src/workspace_motion.rs
native/rust/cc-niri-native-core/src/workspace_curve.rs  # 可选，有限曲线模块
native/rust/cc-niri-native-core/src/scroll_retarget.rs  # 可选，受限制动策略
native/rust/tests/                                     # 新策略契约与集成测试
native/viewport-clip/tests/                            # 帧上下文 / 平台适配测试
tools/analyze-animation-capture.py                     # 可选，离线分析，不常驻
test/ANIMATION_60HZ_RESULTS.md                        # 新增独立阶段报告
doc/cc-niri_4K60Hz_Animation_Codex_Spec.md             # 本文
```

上表中的可选新文件不是已经存在的接口，也不是要求创建空壳。不要把所有新逻辑堆进 `ViewportClipEffect.cpp`，也不要为几十行策略建一整套插件框架。

每个阶段报告至少包含：

```text
阶段 / commit / 工作树状态
实施范围与未实施范围
实际生效的 profile / 参数 / 组件版本
源码行为变更与旧模式兼容性
自动测试：逐项结果；未执行项和原因
实机环境、输入序列、样本数与完整数据位置
呈现统计与轨迹统计；明确哪些无法关联
正常接管与降级次数 / 原因
Pair/Wide、Ring、workspace、停放与恢复结果
用户视觉反馈，或“待人工验收”
回滚状态及下一阶段准入结论
```

不要将历史测试记录、纯 Rust microbenchmark 或本文的公式计算填入“本轮实机结果”。

---

## 15. 首轮完成检查表：A0 + A1

- [ ] 已读本地 AGENTS，记录与固定基线的差异，保留用户修改。
- [ ] 在独立功能分支工作，未擅自合并或部署。
- [ ] stable 默认行为保留，smooth60 只启用本轮时钟修正。
- [ ] H/L 按目标真实输出的预计呈现时间采样。
- [ ] 副屏 pass、递归绘制、重复时间戳不会错误推进主屏状态。
- [ ] 同帧全部窗口投影共用一个 sample；新 epoch 不被错误去重。
- [ ] 事件 / 呈现 / 协议时间域明确，缺失和倒退有可测试的回退。
- [ ] last-painted 与仅计算过的 sample、actual-presented 区分清楚。
- [ ] 采样默认关闭，逐帧路径没有新增 JSON / I/O / 动态扩容。
- [ ] 未修改 H/L 刚度、初速度策略、收尾或 J/K 时长。
- [ ] 未在 A1 同时收缩 damage 范围，以保留单变量对照。
- [ ] 定向测试与仓库要求的完整门禁完成，或明确报告未执行原因。
- [ ] 新建阶段报告，未把待验收项目标为通过。
- [ ] 提供现有路径兼容的回滚方案，然后停止扩大到 A2。

---

## 16. 核查来源与参考资料

### 项目固定提交来源

以下 S1–S9 使用本文核查提交固定链接，避免后续 main 变化造成证据漂移。执行时仍以用户本地实际版本为准。

- **S1**：[根 AGENTS.md](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/AGENTS.md)：工具链、职责边界、必须验证项。
- **S2**：[native/AGENTS.md](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/AGENTS.md)：最后绘制位置接管、Outgoing 生命周期、Core / Adapter 约束。
- **S3**：[ViewportClipEffect.cpp](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/viewport-clip/ViewportClipEffect.cpp)：H/L paint hooks、持续全局 repaint、现有帧时间采集与状态接口。
- **S4**：[WorkspaceSlideAdapter.cpp](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/viewport-clip/WorkspaceSlideAdapter.cpp)：每输出工作区动画、预计呈现时间、配置与可见性引用。
- **S5**：[scroll_runtime.rs](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/rust/cc-niri-native-core/src/scroll_runtime.rs)；[viewport_motion.rs](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/rust/cc-niri-native-core/src/viewport_motion.rs)：生产 arm 路径、零速度重启、最近绘制偏移与旧测试。
- **S6**：[spring.rs](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/rust/cc-niri-native-core/src/spring.rs)：解析弹簧、初速度、参数和完成条件。
- **S7**：[workspace_motion.rs](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/rust/cc-niri-native-core/src/workspace_motion.rs)：当前有限曲线、grid / wrap / gesture 契约。
- **S8**：[WORKSPACE_ANIMATION_RESULTS.md](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/test/WORKSPACE_ANIMATION_RESULTS.md)；[README.md](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/README.md)：既有配置、历史实机结果与限制。
- **S9**：[FocusRingEffect.cpp](https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/focus-ring/FocusRingEffect.cpp)：窗口绘制上下文、Ring owner 与绘制链。

### 官方设计参考

- **S10**：[niri：Animation Timing](https://github.com/niri-wm/niri/wiki/Animation-Timing)：区分动作发生时间与预计显示时间，使用可控时钟对齐动画采样。本文借鉴原则，不要求复制整个 LazyClock 实现。
- **S11**：[niri：Fractional Layout](https://github.com/niri-wm/niri/wiki/Fractional-Layout)：逻辑浮点布局、最终物理像素对齐与 motion offset 的分离。
- **S12**：[Qt：QScreen::refreshRate](https://doc.qt.io/qt-6/qscreen.html#refreshRate-prop)：官方提醒避免用刷新率驱动普通 timer 动画；本项目应继续依附 KWin 已有 paint / repaint 调度，而不是照搬普通 QWindow 的应用接口。

> 本文的阶段安排、候选参数、制动上限与验收阈值属于针对 CC-Niri 的设计建议。除明确引用的源码事实、仓库历史记录和已标注的数值计算外，不代表已有实机验证。

[S1]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/AGENTS.md
[S2]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/AGENTS.md
[S3]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/viewport-clip/ViewportClipEffect.cpp
[S4]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/viewport-clip/WorkspaceSlideAdapter.cpp
[S5]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/rust/cc-niri-native-core/src/scroll_runtime.rs
[S6]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/rust/cc-niri-native-core/src/spring.rs
[S7]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/rust/cc-niri-native-core/src/workspace_motion.rs
[S8]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/test/WORKSPACE_ANIMATION_RESULTS.md
[S9]: https://github.com/Cc-aw/cc-niri/blob/f3650b286198c0a189f0e32f59f249b2c9b43e88/native/focus-ring/FocusRingEffect.cpp
[S10]: https://github.com/niri-wm/niri/wiki/Animation-Timing
[S11]: https://github.com/niri-wm/niri/wiki/Fractional-Layout
[S12]: https://doc.qt.io/qt-6/qscreen.html#refreshRate-prop
