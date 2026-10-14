# CC-Niri：16GB 设备全项目低内存架构与验收规范

> **文档性质**：项目级长期约束 + Codex 审计 / 优化任务规范，**不是已经实施或通过验收的结果**。\
> 日期：2026-10-12\
> 适用仓库：[Cc-aw/cc-niri](https://github.com/Cc-aw/cc-niri)\
> 首次核查基线：`main` / `b77a40eb1e0a0fd66d053c5996a13bc88e75518b`；执行前以最新 `HEAD` 重新核查。\
> 适用范围：**整个 cc-niri**，包括现有与未来功能，而非仅 `AlwaysCenterSingleColumn`。\
> 用户硬件约束：**整机 16GB RAM**；桌面为 Fedora 44、KWin Wayland、主屏 4K@150% / 60Hz、副屏 2K@100%（按实际测试环境复核）。\
> **核心原则：整套 cc-niri 的增量常驻内存必须尽量低；正常空闲不持续占用不必要的 CPU/GPU 资源；内存不能随交互次数、工作区切换次数或窗口开关次数持续增长。**

## 0. 目标、范围与排除项

这是一份**系统级内存预算**，不是对某一个单列居中、Focus Ring 或动画功能设置的局部预算。

- 用户日常使用时关注的是**整套 cc-niri 叠加在原生 KDE/Plasma 桌面上的额外内存**，不是 Rust 二进制大小、单个 Bridge RSS 或 KWin 进程全部 RSS。
- cc-niri 的 JavaScript、Rust/C++ Native Effect 主要驻留在 `kwin_wayland` 进程内；独立 `cc-niri-bridge` 需要计入；默认关闭的 Dock 不计入默认配置，但**开启时应单独测量其对 `plasmashell` 的增量**。
- 需要同时审计 CPU 内存（PSS、Private_Dirty、Swap）、GPU/合成资源（纹理、render target、cache）和对象生命周期（window、workspace、animation、signal/slot、timer、IPC）。
- **不要求整个 KWin 或 KDE 系统只有几十 MiB**：KWin、Plasma、驱动、浏览器占有大量其自身资源。项目预算统计的是开启 cc-niri 带来的**差值**。对没有可靠隔离能力的图形显存，必须如实报告“不可准确归因”，不能假装显存开销为 0。
- **不通过牺牲稳定性换内存**：不能为了少几 MiB 取消必要的窗口恢复、异常防护、Rust ownership 或现有正确的 Clip、Ring 逻辑。
- **不通过降低动画流畅度换内存**：4K 60Hz 上避免 GPU 合成过载及抖动，但优先做数据结构和不必要重绘的减法，不把必要的 60Hz 帧变成低帧率动画。

## 1. 哪些进程与模块需要纳入统计

| 组件 | 运行位置 | 需要纳入的资源 | 代码入口与关注点 |
|---|---|---|---|
| KWin Script / JS Control Plane | `kwin_wayland` | JS 堆、布局派生对象、引用和信号连接 | `src/kwin/`、`package/contents/code/main.js`；只改 `src/` 并重新生成 bundle |
| Rust Native Core | 由 C++ Native 插件链接，驻留在 KWin | state、临时容器、FFI handle、protocol registry | `native/rust/cc-niri-native-core/src/`，不引入 async runtime |
| Viewport Clip / Workspace Slide | KWin Native Effect | Paint pass 状态、Scroll buffer、诊断样本、场景对象 | `native/viewport-clip/`，重点 `ViewportClipEffect.h/.cpp` |
| Focus Ring | KWin Native Effect | per-owner Scene Item、小纹理、过渡期间保留的 visual | `native/focus-ring/FocusRingEffect.cpp`、`FocusRingItem.cpp`、`FocusRingStrokeItem.cpp` |
| Bridge | 独立 `cc-niri-bridge.service` | Qt 运行时、state JSON、QQueue/QSet、D-Bus 状态 | `bridge/src/CCNiriBridge.cpp`；不引入第二个服务 |
| 可选 Dock / Plasmoid | `plasmashell` | QML/UI/模型与缓存的**增量** | `plasmoid/`；仅启用 `--with-dock` 才计入 |
| 测试/诊断工具 | 非日常运行 | 构建内存、采样缓存 | 单独记录，**不得混入日常 idle 预算** |

**资源归因原则**：统一用相同窗口、输出、特效配置和启动状态做 A/B。对 KWin 测 `PSS(cc-niri enabled) - PSS(cc-niri disabled)`；对 Bridge 测**其运行时 PSS**；对开启 Dock 的 `plasmashell` 再做增量。必要时分别测 Native Effect、Bridge、JS 子组合，以定位来源，不能将这些阶段差值机械相加（共享库/系统缓存不完全可加）。

## 2. 全项目目标预算（实施前目标，不是测量结果）

### 2.1 默认 Dockless 配置

| 指标 | 项目级目标 | 判定性质 |
|---|---:|---|
| **整套 cc-niri 空闲稳态 PSS 净增量**（KWin 差值 + Bridge） | **≤ 32 MiB**，争取 **≤ 16 MiB** | 16GB 设备的**总预算目标**；不得把每个模块都单独分配 32 MiB |
| 常规滚动/工作区动画时的**整套 PSS 观测峰值净增量** | **≤ 64 MiB** | 初始工程目标；按同负载 A/B 采样，非亚秒级真正峰值保证 |
| 已有功能上新增**轻量布局特性**的空闲 PSS 增量 | **≤ 2 MiB** | 例如单列居中；包含在上述全项目 32 MiB 中，不单独叠加预算 |
| 新增轻量布局特性的动画期间 PSS 增量 | **≤ 8 MiB** | 原有 `always-center-single-column` 文档的增量目标 |
| 同样窗口/工作区数量，持续 30–60 分钟交互后回到空闲的 PSS 净增长 | **≤ 4 MiB**（需结合基线波动） | 调查阈值；若有持续正斜率、存活对象增长则判不通过；单次超限也须调查 |
| 新增独立运行服务 / 线程池 / 额外动画时钟 | **0** | 默认新增功能的硬约束；例外须单独批准并测成本 |
| 新增窗口尺寸/全屏的 CPU 图像、GPU 离屏缓冲 | **0** | 常规特性硬约束；例外必须先进行架构评审 |
| 正常 idle 的循环重绘 / 每帧日志 / 持续采样 | **0** | idle 后必须停止插件自己发起的持续 repaint 与 capture |
| 单个动画 frame **新增**的堆分配 | **0 为设计目标** | 审计热路径；不要误报“整个 KWin 每帧零堆分配” |

**注意**：上述 32 / 64 MiB 是待测的项目级目标，**没有目前 cc-niri 的完整 A/B 基线测量**，不能宣称已经达到。实际测得超限时：先找分配归因、生命周期和渲染浪费，再讨论预算是否需要调整；不得为了数字好看破坏稳定性。如果 KWin 重启/模块卸载不可控、测量噪声太大，结果标记 `INCONCLUSIVE`，而不是虚构结论。

### 2.2 额外情形

- **Dock 启用**：单列 `Dockless` 与 `Dock Enabled`，额外报告 `plasmashell` 的 PSS / GPU 增量；Dock 不得改变其他模块的基本开销结构。不要把 Plasma Shell 的总内存算成 Dock 的内存。
- **GPU 显存**：不使用未经确认的“显存 < X MiB”的承诺；首先要求**不新增全屏纹理或冗余拷贝**。仅一个 3840×2160 RGBA8 缓冲约 **31.64 MiB**，两个就是 **63.28 MiB**，对 16GB 设备与合成器都没有必要的新增缓存应被拒绝。
- **窗口数量相关的内存**：已存在的 window model、membership、必要缓存可按受管列数 `O(N)` 增长，但须确认在关闭窗口后回收；严禁依历史操作次数 `O(total actions)` 增长。
- **项目业务扩展**：未来 Multi-window Column、Overview、Quickshell、额外动画及新的视觉特效不能绕开本规范。新增功能的资源预算需从**同一份 32 MiB 总预算**中分配，不能变为独立的“每功能 +32 MiB”。

## 3. 基于当前源码的初步资源审计（不是泄漏判定）

### 3.1 已有的正面约束，必须保留

1. `Bridge` 已有 `MaxPendingCommands = 64`、`MaxRecentCommandIds = 128`、`MaxStateBytes = 1 MiB`。保持有界队列和协议校验，禁止重构时改成无限命令历史。
2. `Focus Ring` 的 `FocusRingStrokeItem.cpp` 采用小 patch QImage / Gaussian profile，而不是每窗一张完整 4K 的软光图；`FocusRingItem::clear()` 存在明确的 visual item 清理路径。保留纹理复用、绘制范围与 owner-output 限制。
3. `Viewport Clip` 的 `ScrollFrameCapture` 为固定容量（frame/presentation 各 2048、lifecycle 128），采样默认关闭；`m_loggedDeviceClips` 限制为不超过 256 个记录。保留有界容量与停止采样逻辑。
4. JS `WorkspaceSnapshotStore` 使用 `snapshots` 与 `uuidOwner`，快照保存 UUID/宽度等纯数据，不应留存 KWin Window 对象；`FocusRingController` 按窗口关闭断开信号并清除 watched 状态。
5. 原生 Scroll motion 已有所有权、epoch、cancel、disarm 与 frame 生命周期；不要为了内存重构引入第二套动画 authority。

以上属于**源码设计上已有的保护机制**，不能仅凭它们就宣布“无内存泄漏”。

### 3.2 优先验证的成本点（按收益与风险排序）

| 优先级 | 审计点 | 需要验证的现象 | 优化门槛与原则 |
|---|---|---|---|
| P0 | `ScrollFrameCapture.h` 嵌入 `ViewportClipEffect.h` 的固定数组 | **即使诊断关闭，内嵌数组仍占对象空间**；确认 `sizeof`、实际驻留和分配次数 | 如果占用确实值得优化，可考虑只在用户主动 capture 时创建有界缓冲；**不能将分配移入每帧**，也不能为几十 KiB 引入复杂风险 |
| P0 | Focus Ring `m_visuals` 与 gain/steady glow Scene Item | 多次换焦点、关闭窗口、切工作区后，Visual/纹理数量是否回到稳态 | 只保留 active + 必要的短暂 fade-out 对象；现有小纹理可缓存，必须在 close/unload/output 移除时释放 |
| P0 | `FocusRingController.watched` 与 `closed`、Qt signal | 大量打开/关闭窗口后是否仍持有已销毁 Window wrapper | `closed` 无界增长或重复信号连接属于硬缺陷；不删除必要的运行时 eligibility 策略 |
| P0 | `WorkspaceSnapshotStore`、`WorkspacePersistence` 和 Bridge `m_lastState` | 随动态工作区创建/回收，是否存留无主窗口/过期 UUID | 确保删除、recycle、stop 后收敛到真实窗口与桌面集合；状态数据应小而有界 |
| P0 | `ScrollPlanCommitGate`、`DeferredScrollParking`、Workspace departures | 超时、拒绝、取消、重启后仍存活的 timer/closure/handle | 必须以 epoch/session 断开旧 callback；确保窗口和桌面所有权完全释放 |
| P1 | KWin `QHash/QSet` / `std::vector` 的容量 | 清空后内存未回落是容量保留、分配器行为还是泄漏 | 先剖析对象数量与容量，再决定是否释放大容器；不要每次 focus 触发 shrink/reallocate |
| P1 | JS 发布/日志、`JSON.stringify()` / `sort()` | 高速焦点和窗口事件中是否存在可避免的重复对象与字符串 | 优化事件去重和冷路径，**不改变 Bridge authority 和协议内容**；不可缓存不安全的 KWin 对象 |
| P1 | `ViewportClip` frame samples 与 per-output maps | 输出热插拔、capture 启停后旧输出是否清除 | `screenRemoved` 和 stop 必须解绑/清理，不能按历史输出数量增长 |
| P2 | QML Dock（仅启用时） | 隐藏 Dock、禁用集成后额外组件是否继续占用资源 | 默认 Dockless 必须不装、不启用额外 UI；Dock 单独测量和逐组件分析 |

审计输出应为“**发现/证据/分配归因/预计节省/变更风险/测试结果**”。仅靠代码搜索发现 `Map`、`QImage` 或固定数组，不能认定为问题。**先测量再改代码**。

## 4. 全生命周期的内存释放协议

| 生命周期边界 | 必须归零或回收到有界稳态的状态 |
|---|---|
| Window close/destroy | JS column/state、Focus Ring watched/visual、Native registry tokens、Clip ownership、deferred parking、悬挂回调 |
| 从 Column 转 Floating / Dialog / Secondary | 主屏 Column 对该窗口的控制引用、Native Scroll ownership、Bridge 的旧列状态；不影响副屏原生窗口 |
| Workspace switch / unmount / recycle | 单个工作区的动画 epoch、窗口 park/restore、已删除桌面 snapshot/owner、workspace-specific FrameContext |
| Native effect unload / reload | Scene Item、glow textures、QPointer/Qt connections、pending Rust FFI handles、FrameCapture 状态 |
| Bridge stop / restart / reconnect | pending command queue、recent ID ring、session/generation、旧 IPC callback；不删除用户应保存的 workspace 数据 |
| Output disable/hot-unplug / scale change | output-scoped capture / render / damage / workspace departures；仅在真实变更时重建需要的缓存 |
| Emergency restore / cc-niri stop | 任意受管窗口均可见或恢复到可访问位置；没有永久 opaque/hidden/parked；动画、timer、capture 停止 |

**绝对禁止**通过简单 `clear()` 忽略协议 ACK 和停止清理顺序，导致窗口卡在屏幕外。内存优化先保证恢复行为与现有 Golden differential 不变。

## 5. 内存测量方法：基线、增量、峰值、泄漏

### 5.1 基线矩阵

使用**相同物理机、相同显示拓扑和应用窗口集、相同 KWin/Plasma 版本、Release 构建、无正在进行的编译、无持续 capture**，分别采集：

- **B0 原生桌面**：关闭 cc-niri Script、原生两个 Effect、Bridge 和可选 Dock；严格按照现有安全停用/恢复流程，**不擅自强杀 KWin**。如禁用 Native Effect 必须重启 compositor 才能释放映射页，记录这个限制，使用另一个受控登录会话测量；不能把“只停脚本”当作 B0。
- **B1 默认 Dockless CC-Niri**：Bridge、JS、Clip 与 Ring 按日常默认配置加载，保持稳定 3–5 分钟。
- **B2 Dock Enabled**：在 B1 基础上启用 Dock，额外测 `plasmashell` 的 PSS 差值。
- **B3 单功能 A/B**：同一 commit 和相同窗口集，分别开关 single-column center、Focus Ring、smooth60 等；这是局部归因，不代替 B0/B1 全项目预算。

最低窗口场景：0、1 half、1 full、2 half、5 half、8–10 half；工作区场景：1、4–8、空末尾 W8/W9；双屏 4K150% + 2K100%。

**全项目空闲 PSS 净增量**（示意）：

```text
cc_niri_idle_delta_PSS = (PSS_KWin[B1] - PSS_KWin[B0])
                       + PSS_Bridge[B1]
# 若 B0 也有其他相关驻留服务，须先识别并扣除真实差值。
# Dock 另报:  ΔPSS_plasmashell[B2-B1] (+ other true incremental services)
```

这个数值不能直接拿 `RSS(KWin) + RSS(Bridge)` 代替；PSS 是按共享页分摊的，且不同会话中 KWin 的映射/缓存仍有自然波动。B0/B1 最好各做 3 轮并取中位数，同时报告范围。

### 5.2 无需安装依赖的只读采样

```bash
# 日常只读检查：不更改 KWin/Bridge 的状态，也不会重启桌面。
free -h
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {print}' /proc/meminfo

KWIN_PID=$(pgrep -u "$(id -u)" -x kwin_wayland | head -n1 || true)
BRIDGE_PID=$(systemctl --user show cc-niri-bridge.service -p MainPID --value 2>/dev/null || true)
PLASMA_PID=$(pgrep -u "$(id -u)" -x plasmashell | head -n1 || true)

for pair in "KWin:$KWIN_PID" "Bridge:$BRIDGE_PID" "Plasma:$PLASMA_PID"; do
    name=${pair%%:*}; pid=${pair#*:}
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [[ -r "/proc/$pid/smaps_rollup" ]]; then
        echo "=== $name pid=$pid ==="
        awk '$1=="Pss:" || $1=="Rss:" || $1=="Private_Clean:" ||
             $1=="Private_Dirty:" || $1=="Swap:" {print}' "/proc/$pid/smaps_rollup"
    else
        echo "=== $name: PSS unavailable (record PID and reason) ==="
    fi
done
```

`smaps_rollup` 可能受权限限制。允许从 `/proc/PID/status` 记录 `VmRSS` 做**辅助**，但不能将 RSS 当作 PSS 通过全项目预算。记录 PID、采样时间、commit、KWin/Plasma/Qt/GCC/Rust 版本、GPU driver、两屏分辨率与缩放、当前列数/桌面数、Dock 状态、当前 `MemAvailable`/Swap。**禁止每帧扫描 `/proc`**：只在测量阶段后台低频采样。

### 5.3 采样与判定

1. **空闲**：每 10 秒一次，至少 5 分钟，B0/B1 各 3 组；观察 PSS/Private_Dirty 中位数、范围、KWin/Bridge PID 是否变化。
2. **交互**：测 H/L 普通/反向、J/K、Focus Ring、窗口增删、Full/Wide、Workspace move、Bridge reconnect。低频内存采样只能得到**采样峰值**，不能冒充亚秒级真实峰值。
3. **压力**：模型级 1000–5000 次轻量状态交互；真实桌面使用轻量窗口 30–50 次开关（用户许可后），H/L+J/K 至少 30 分钟，恢复同一窗口数后静止 60 秒，再测 PSS/Private_Dirty；不让重复启动大型浏览器导致错误归因。
4. **闲置**：至少 30–60 分钟，确认内部持续 repaint / frame capture / 日志积累已经停止；报告内存趋势，不能以 RSS 的一次性高水位自动判泄漏。
5. **性能**：同时记录原有 animation capture 的帧呈现间隔、KWin CPU 使用与异常恢复情况，避免“内存更低但滚动卡顿”。
6. **GPU**：若驱动工具支持可信的进程级统计则附采样；不支持时以资源审计、纹理计数/尺寸、KWin 诊断资料说明。`nvidia-smi` 进程显存不是所有环境的完整显存归因，更不能以缺失/零进程数值判无显存使用。

**泄漏与缓存区分**：在相同剩余窗口数下，持续增长的仍存活 window/visual/timer/FFI handle 是问题；可能被 allocator 保留的已释放页需要结合 profiling 与多轮重复辨别。禁止要求每次关闭窗口马上归零 RSS，也不能以“Linux 会缓存”搪塞有界对象持续增长。

## 6. 必须覆盖的全项目低内存回归矩阵

| ID | 操作/场景 | 内存验证 | 正确性门禁 |
|---|---|---|---|
| G01 | 空桌面/1/2/5/10 窗口，Dockless | B0/B1 PSS；每列合理 O(N) | 首次映射、Focus Ring、窗口无丢失 |
| G02 | 30–60 分钟无输入 idle | PSS 无持续增长；无插件发起连续 repaint | 静态窗口、60Hz 与其他输出不受扰 |
| G03 | 重复 H/L / 反向 / 短连击 | Scroll state、capture、pending ACK 不累加 | 连续 Spring，无 snap、clip ghost |
| G04 | 重复 J/K、动态 W8/W9 创建回收 | workspace 相关 Map/快照收敛 | 归属、focus、parking 正确 |
| G05 | 30–50 次轻量窗口开关 | close 后 objects/timers/Visual 收敛 | Dialog/floating 不误入 Column |
| G06 | Focus Ring 快速换焦点、打开关闭窗口 | 纹理对象数量不随历史次数增长 | Glow/两侧外沿/HiDPI 一致 |
| G07 | Half/Full、Wide、Fullscreen 循环 | animation/Scene Items 无积累 | 视觉连续、无强制重启 KWin |
| G08 | Bridge 停止/恢复、D-Bus 断连与超时 | bounded queue/callback 清理；Bridge PSS | 现有 fail-safe 与控制可用 |
| G09 | Primary/Secondary 不同工作区 | output-specific maps/viewport 不串屏 | 副屏 Safe Area 保持 |
| G10 | 效果关闭/启用、安全 stop/restart | Native handle、Item/Qt connection 释放 | 不得黑屏或留 parked 隐藏窗 |
| G11 | Dock 开 / 关（可选） | PlasmaShell/Bridge 增量单独计算 | 默认无 Dock 仍正常 |
| G12 | 适度低可用内存情况下运行（用户允许） | 无额外大缓存/OOM；压力测试可中止 | Emergency restore 安全可用 |

测试受设备限制、权限不足或有较高桌面风险时，明确记 `BLOCKED` 或 `INCONCLUSIVE`，不能跳过后宣称达标。**不为了跑测试主动耗尽 16GB RAM**。

## 7. 实施阶段和提交边界（交给 Codex）

### M0 — 建立真实全项目基线，修复已知测试问题

- 只读核对最新 `HEAD`、`AGENTS.md`、`native/AGENTS.md`、现有脚本、KWin/Bridge/Plasmoid 状态。
- 先处理基线既有 CI 问题（`workspace-runtime-guards.test.js` 的测试上下文缺少 `layoutEligibility`；若 `HEAD` 已修复则无需重复更改）。该缺陷不是本内存优化本身造成的。
- 输出不依赖第三方商业 profiler 的基础报告；如果 B0 需要重登录或停掉 compositor，**先列出安全操作并征得用户同意**，否则使用分组件 A/B 和 `INCONCLUSIVE` 占位，不擅自重启。
- 新建 `test/CC_NIRI_GLOBAL_MEMORY_BASELINE.md`，含原始数字与测量局限。没有 baseline 就不能声称优化了多少 MiB。

### M1 — 源码资源账本（先不修改行为）

- 给 `Bridge`、JS Control Plane、Native Clip、Ring、Dock（可选）列出 `O(1)` / `O(N)` 状态清单、每项生命周期释放路径、可见的有界容量以及潜在热点。
- 验证 `ScrollFrameCapture` 的 `sizeof` 与驻留大小、`FocusRing` 两份小型纹理和动画 visual 的存活量、Bridge 的队列上限、WorkspaceSnapshot 的 UUID 规模。
- 可以引入**测试专用**统计辅助，但 production 默认关闭，禁用逐帧日志与全局对象扫描。必要时用现有 Rust `allocation_checks.rs` 的测试计数；禁止污染发布产物与 Rust ABI。
- 产出 `test/CC_NIRI_GLOBAL_MEMORY_AUDIT.md`；按证据排序，不按语言偏好（Rust/C++/JS）下结论。

### M2 — 低风险优化（最小独立变更）

- 优先修复经过实测证明的生命周期残留、重复信号连接、多余常驻缓存、无界状态或不必要事件分配；每个子改动单独提交、单独回归。
- 保持现有 JS layout/workspace authority、Bridge 协议、Rust FrameClock/Spring、C++ renderer boundary；禁止把原生存储改成 JS 长期对象映射。
- 如果固定 capture 缓冲可被安全 lazy 化，应只在**主动开始诊断时**分配有界块，停止后释放或按有限复用策略释放；不要在 frame hot path 做 `new` 或频繁申请/释放。
- Focus Ring 只允许共享、复用现有小 patch 纹理；不得为了优化 PSS 引入全屏 blur/render target。
- 每处修改给出“修改前/后 PSS、Private_Dirty、对象数/纹理数、运行时 frame capture”的具体证据；收益低于噪声且风险大的改动直接放弃。

### M3 — 整体压力测试、内存门禁与恢复

- 全量跑 `G01–G12` 中安全且允许的项目。特别关注 16GB 下 UI/浏览器同时运行的可用内存、swap、较高负载场景的稳定性。
- 核对新/旧代码 A/B，并解释所有无法归因的资源；以默认 Dockless 项目总 PSS 目标验收，绝不通过只报告单个 Rust Core 的“零分配”代替系统级结果。
- 任何 KWin 崩溃、窗口丢失、粘滞不可见、显著新掉帧、对象数无限增长直接阻塞验收。出现不确定情况优先保留原稳定生产代码。
- `README.md` 和 `doc/README.md` 仅在验收成功后更新真实状态，所有待验证项保持 Pending。

## 8. 构建与验证硬约束

依据根 `AGENTS.md`：

```bash
cargo fmt --manifest-path native/rust/Cargo.toml --all --check
cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings
cargo test --manifest-path native/rust/Cargo.toml --locked --workspace
node tools/check.js --native
```

- Rust 必须使用仓库锁定的 `1.99.0`，Cargo 使用 `--locked`；C++ 使用 `/usr/bin/g++`（GNU GCC 16.x）。CMake/FFI/Core 更改另跑 Debug/Release Core CTest、Native Umbrella、`BUILD_TESTING=OFF` 的 production boundary；不得修改 frozen Golden oracle 迎合结果。
- 只有 JS / 文档更改时按仓库规范完成 JS / bundle 检查；修改核心动画、FFI、Effect 时必须完成 Native 全量门禁与实机相关验收。
- 内存对比必须在**Release 产物且所有大型编译、测试程序结束之后**执行。16GB 设备不并行跑高内存 Debug + Release 全量构建，构建建议 `--parallel 2`（具体按 `MemAvailable` 调整）。
- 所有实机部署必须使用项目现有的 save-state → stop → immutable install / upgrade → start 及已有 rollback 机制；未经同意不执行 KWin 强杀、热插拔、强制重登、内存耗尽或可能造成黑屏的操作。

## 9. 长期 Release Gate（整个 cc-niri 都必须遵守）

- [ ] 当前默认 Dockless 的**整套** PSS 基线已经可重复测量，并区分 KWin 插件增量和 Bridge 常驻消耗。
- [ ] 默认 idle 目标 **≤ 32 MiB** 已验证，或明确记录不可归因/超标原因与后续治理；不虚构 PASS。
- [ ] 动画期间项目 PSS 观测净增量和帧率/掉帧指标均满足要求；不能以低内存换卡顿。
- [ ] 没有新增全屏/窗口尺寸的 GPU/CPU 图像缓存、无新增日常进程与重复时钟（例外均经过单独审查）。
- [ ] 无因事件次数、关闭过的窗口数、已回收的工作区数持续增长的状态数组/缓存/Scene Items/IPC。
- [ ] 30–60 分钟的 idle、窗口开关、H/L、J/K、Focus Ring、Bridge 恢复测试无稳定增长的 PSS/Private_Dirty 和异常存活对象。
- [ ] 可选 Dock 的附加开销独立报告；默认 Dockless 路径不负担隐藏 UI 的常驻成本。
- [ ] Safe restore、KWin 崩溃防护、Golden differential、4K60 动画和双屏行为不回归。
- [ ] 提交 `test/CC_NIRI_GLOBAL_MEMORY_RESULTS.md`，每项明确 `PASS/FAIL/BLOCKED/INCONCLUSIVE`，附原始数据、commit 和回滚方法。

## 10. 将全项目低内存原则固化到仓库（建议由 Codex 提交）

要让**以后每个新功能**都自动受到约束，不应只有一份 `doc/todo/` 文档。全项目资源要求应由根目录 `AGENTS.md` 直接约束，并在 `README.md` 说明 16GB 设计目标；这个变更只涉及工程规范，不意味着已经达标。

建议为仓库根 `AGENTS.md` 添加如下短节；具体语句须与现有内容合并，**不要覆盖已有的 Rust/C++ 工具链、JS/Rust/C++ 权限边界及全量门禁**：

```md
## 全项目低内存设计约束（16GB 桌面）

- cc-niri 的内存预算覆盖 KWin JavaScript、Rust Native Core、原生
  Viewport Clip / Focus Ring、独立 Bridge，以及开启时的可选 Dock。
  不得仅凭单个进程 RSS 或单个功能零分配就宣称整体低内存。
- 默认 Dockless 整套项目相对原生 KDE 的稳态 PSS 增量初始目标
  ≤32 MiB（争取 ≤16 MiB）；正常动画期间采样峰值目标 ≤64 MiB。
  目标并非现有实测结果；必须先建立 B0/B1 基线，无法测量时
  标记 INCONCLUSIVE，不虚报达标。
- 禁止新增不必要的常驻 daemon、全屏/窗口尺寸纹理、额外动画
  时钟、每帧 JSON/堆分配和无界缓存；现有对象必须在关闭窗口、
  workspace 退出、output 移除、effect stop 后清理。
- 每项新特性申报自身的资源增量，且必须计入同一份项目总预算；
  不得以降低 4K60 动画流畅度或破坏安全恢复换取少量内存。
- 对内存/生命周期热路径的变更先测量再优化，提交 A/B 的 PSS、
  Private_Dirty、对象数量、GPU 归因限制和回归结果；严格遵循
  doc/todo/cc-niri_16GB_Whole_Project_Memory_Budget_Codex_Spec.md。
```

**落地顺序**：将本文归档到 `doc/todo/` → 根 `AGENTS.md` 加短约束 → Codex 先做全项目 PSS 基线 → 再依证据优化。实施前只需修改规范，不允许在未获同意时自行重启或卸载正在使用的 KWin 组件。

## 11. 可以直接交给 Codex 的执行指令

> 请阅读 `AGENTS.md`、`native/AGENTS.md` 和 `doc/todo/cc-niri_16GB_Whole_Project_Memory_Budget_Codex_Spec.md`。目标不是优化某个 `always-center-single-column` 选项，而是使**整个 cc-niri** 在 16GB RAM 的 Fedora / KWin 桌面上维持非常低、稳定、可测的额外内存占用。先建立 B0（原生 KDE）与 B1（完整 Dockless cc-niri）基线，再根据证据审计并优化 KWin JS、Rust Core、Native Clip、Focus Ring、Bridge、Workspace 状态和可选 Dock。初始总预算为空闲增量 PSS ≤32 MiB、争取 ≤16 MiB；动画采样净增量 ≤64 MiB；对象数量及 PSS 不随交互历史无限增长。这些是目标，不是假定已经达标。
>
> 先做 M0–M1 的**只读审计和结果文档**，对所有可能影响运行桌面的改动先说明并等待明确允许。若用户要求进一步实施，再按 M2–M3 小步修改与验证。绝对不新增独立动画时钟、额外 daemon、全屏纹理或长期无界缓存；优先修复经测量确定的引用泄漏与多余驻留资源。不得降低动画质量、破坏 KWin 安全恢复或跳过 Native/JS 门禁。交付每个组件的内存账本、A/B PSS 和 Private_Dirty 原始数据、GPU 观测限制、优化前后差值、CI/实机结果与可回滚方案。没有实测就标记 `NOT MEASURED` / `INCONCLUSIVE`。

## 12. 参考与关联文档

- [cc-niri 源码](https://github.com/Cc-aw/cc-niri)
- [根开发约束 `AGENTS.md`](https://github.com/Cc-aw/cc-niri/blob/main/AGENTS.md)
- [Native 开发约束](https://github.com/Cc-aw/cc-niri/blob/main/native/AGENTS.md)
- [Clip：ScrollFrameCapture](https://github.com/Cc-aw/cc-niri/blob/main/native/viewport-clip/ScrollFrameCapture.h)
- [Focus Ring：Visual 管理](https://github.com/Cc-aw/cc-niri/blob/main/native/focus-ring/FocusRingEffect.cpp)
- [Focus Ring：小纹理渲染](https://github.com/Cc-aw/cc-niri/blob/main/native/focus-ring/FocusRingStrokeItem.cpp)
- [Bridge：状态与有界队列](https://github.com/Cc-aw/cc-niri/blob/main/bridge/src/CCNiriBridge.cpp)
- [WorkspaceSnapshotStore](https://github.com/Cc-aw/cc-niri/blob/main/src/kwin/workspace/WorkspaceSnapshotStore.js)
- 同目录配套：[`cc-niri_always-center-single-column_Codex_Spec.md`](./cc-niri_always-center-single-column_Codex_Spec.md)；单列居中的 **≤2 MiB PSS 功能级增量**必须计入本文全项目总预算。

---

**请始终区分三件事**：**总量预算**（整套 cc-niri 的开销）、**特性预算**（某个新功能额外增加多少）、**泄漏/增长**（相同状态下内存是否随时间或历史操作次数不断扩大）。只验证其中一个，不能代表整个 cc-niri 已经满足低内存目标。
