# CC-Niri 稳定性专项审计：第一轮

日期：2026-10-24。固定基线 `main` = `95f69b0bcd8326ff319cc5b6df5ee1cb4ea331c3`。

本轮只有审计、隔离测试和探针诊断修正。没有修改 `src/`、生成包、Rust、C++、FFI、CMake、CLI、协议或快捷键；没有安装、重载、停用或操作真实用户桌面。Spring、动画曲线、Focus Ring 视觉和列宽策略没有变化。

结论：尚未确认新的生产缺陷。确认并修正了一项**测试探针路径误报** D-01；两项平台生命周期疑点保持待验证，不能算作已存在缺陷。自动检查通过的范围与未执行的实机验收分别列在下文。

## 基线与参考方法

原工作区有上一轮未提交的 CLI、测试和文档改动，全部保留，不纳入本轮基线。审计在 `/tmp/cc-niri-stability-audit-20261024` 的 detached worktree 进行。通过仅用于本轮验证的符号链接复用原 `build/` 和 `native/rust/target`；四份 CMake cache 指向原仓库，其 Native / Bridge / cmake / plasmoid / toolchain 源码经 `git diff --exit-code 95f69b0 -- ...` 核验相同。符号链接不是交付文件。

Karousel 固定为 [`8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b`](https://github.com/peterfajdiga/karousel/tree/8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b)，只读取参考源码，没有安装或执行其桌面入口，没有复制实现。

| Karousel 参考位置 | 采用的审计视角 | CC-Niri 保留的实现 / 边界 |
| --- | --- | --- |
| [`ClientState/Manager.ts:9`](https://github.com/peterfajdiga/karousel/blob/8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b/src/lib/world/clientState/Manager.ts#L9) | 检查旧状态退出后是否释放其资源 | `WindowStateStore`、Adoption phases、Parking / workspace / Native leases 各自保持原 ownership；不新增第二套 ClientState |
| [`SignalManager.ts:8`](https://github.com/peterfajdiga/karousel/blob/8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b/src/lib/utils/SignalManager.ts#L8) | 每条连接有 owner 和退出清理 | `RuntimeLifecycle.connect/disconnectOwner/stop`、Ring watcher、Recovery disposer；额外验证已销毁 QObject 的 disconnect 异常 |
| [`World.ts:105`](https://github.com/peterfajdiga/karousel/blob/8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b/src/lib/world/World.ts#L105) | 入口动作与后续布局检查保持协调 | 此函数只执行动作后 update；不能当作 CC-Niri 的事务、重入、异步 ACK 或恢复证明的替代品。保留 `LayoutTransaction.run/resume` 和既有 commit gates |
| [`Makefile:5`](https://github.com/peterfajdiga/karousel/blob/8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b/Makefile#L5)、[`TestRunner.ts:8`](https://github.com/peterfajdiga/karousel/blob/8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b/src/tests/utils/TestRunner.ts#L8)、[`flows/destroy.ts:1`](https://github.com/peterfajdiga/karousel/blob/8b9f0b62b2922703d7c25a79d5d49ae93cd3f93b/src/tests/flows/destroy.ts#L1) | lint/test gate、可重复 flow、销毁后的可见性 | 复用 CC-Niri Node / Rust / CTest / 私有 DBus 流程。Karousel 的 `MockQmlTimer.ts:7` 立即触发 timer，本轮另用可显式延迟和重放的假时钟覆盖取消竞态 |

## 已检查的生产路径

以下行号均对应固定基线；没有因为表中存在检查项就认定有缺陷。

| 路径 | 确切位置 | 观察到的安全机制 | 验证 / 限制 |
| --- | --- | --- | --- |
| 连接与启动 / stop | `src/kwin/runtime/RuntimeLifecycle.js:36,42,51,112` | owner 按对象身份区分；断开异常不阻止剩余清理；generation 退休启动回调 | SA-01/02；200 轮取消、重启、旧回调 / deadline 重放 |
| 窗口 close | `src/kwin/runtime/RuntimeEntry.js:2212,2262`；`src/kwin/lifecycle/AdoptionController.js:103` | close 断开 owner、忘记恢复义务、删除 column / floating / state；advance 先查 hasState | SA-09；既有 workspace / adoption 测试；模型不证明 Qt 内部析构时序 |
| 延后窗口动作 | `src/kwin/runtime/RuntimeEntry.js:830`；`src/kwin/runtime/ContinuousLayoutRuntime.js:91,114,135` | action 执行前查真实列表中的同一窗口实例；exclusiveSequence 隔离取消 / pause / stop | 既有 `cross-output-drag.test.js`、`scroll-layout-v2-workspace.test.js`；同 UUID 不代表同 QObject |
| 重入与 ACK | `src/kwin/stability/LayoutTransaction.js:30,41`；`src/kwin/layout/ScrollPlanCommitGate.js:12,105` | finally 退出事务；ACK 只续原 epoch；过期 pending / cancel 请求不重复提交 | SA-07；既有 stale arm / disarm / fallback 测试与 5000 次 ACK 丢失回归 |
| Native 取消证明 | `src/kwin/integration/RuntimeBridge.js:133`；`src/kwin/layout/ColumnGeometryCoordinator.js:327,335,347` | 检查 session / epoch / active / handoff；保留 releaseEpoch，只有确认后才清掉退休义务 | 既有 coordinator 未确认取消与重复 stop 测试；没有简化为一个布尔 flag |
| 会话与异步取消 | `src/kwin/runtime/SessionPauseController.js:39,71,92,118` | token、query live、coalescing、三次 release 上限、实例替换终止、stop 清 timer | SA-08；既有 lock / relock / pending workspace / close while locked 回归 |
| 恢复资源 | `src/kwin/stability/Recovery.js:32,65,90,100`；`src/kwin/stability/RecoveryCompletionGate.js:8,12,36,50` | 先 Native 退休，再写恢复；重试账本只有 UUID + 值 DTO；finish 先退休 pending、清 timer / listeners / rows 再回调 | SA-03 六种次序、SA-04 重入、SA-05 部分连接失败、SA-06 销毁属性毒化；真实 configure 仍需平台测试 |
| InputClip 存活与 ownership | `native/viewport-clip/ViewportClipEffect.cpp:114,204,209` | 额外 hitTest 前排除 deleted / 无 client / internal，再查 Rust role 或 frozen handoff；不另建 owner 集合 | 本轮既有私有 input-lifecycle 场景 100% / 150% 各 45/45；每次 active/handoff 各 8 轮 retained internal window |
| InputClip 遮罩引用 | 同文件 `:95,101,143,286,332,376,426` | `QPointer<Window>` + `EffectWindowVisibleRef`；清自身 hidden bit 后放 visible ref；ShowingDesktop 优先；close/delete/析构及 frame / 零延迟 timer 恢复；`QScopedValueRollback` 防重入 | 静态检查 + 既有私有回归；“自有普通窗口恰在 setHidden 同步回调中销毁”仍是 V-01 待验证 |
| 原生工作区资源 | `native/viewport-clip/WorkspaceSlideAdapter.cpp:29,33,68,102,302,318`；`native/viewport-clip/ScrollClipHandoff.h:31,46` | ScreenBinding RAII 销毁 Rust handle；windowDeleted unbind；finish take 输出 binding；handoff remove / clear | Native CTest PASS；没有新增渲染 / FFI 路径，真实热插拔、effect 卸载未执行 |
| Rust token / handle | `native/viewport-clip/RustScrollViewportRuntime.cpp:26,57,58`；`native/rust/cc-niri-native-core/src/ffi_scroll.rs:1062,1074` | Adapter析构destroy handle；close/remove删除Qt映射与Rust注册名。clear只清运行几何，保留稳定token / 容量，不能把clear误报为整个registry释放 | 复用既有 Rust / CTest remove、clone、cancel 契约；不更改token或Native协议生命周期 |

## 2026-10-16–20 历史故障回归矩阵

“修复前”引用当时保留的记录，本轮没有重新运行会崩溃的旧插件，没有重复实现已有修复。“本轮”一栏仅表示当前基线的实际验证。

| ID / 历史状态 | 触发与最小复现 | 位置与预期安全行为 | 修复前 → 修复后证据 | 本轮 |
| --- | --- | --- | --- | --- |
| H-01 10/16 顶栏与分数缩放，已修 | 150%，51px 可见 dock 不提供 strut，客户端将奇数高度回报为 1/3px 分数 | `OutputTopology.js:100`、`ContinuousColumnLayout.js:27,51,77`：避让可见全边面板，向内对齐公共网格，保留严格 ACK | [panel fix](SCROLL_LAYOUT_V2_PANEL_FIX_RESULTS.md)：先遮挡、再 bootstrap 超时；最终私有 37/37、历史实机 8/8 | `scroll-layout-v2-geometry.test.js:213,243`、`scroll-layout-v2-workspace.test.js:207,224,236`，完整 gate PASS |
| H-02 10/16 mixed-width reorder，`9cf6503` 已修 | 居中 twoThirds，焦点右侧 half，向左换位；W2560/gap16 | `ContinuousViewportController.js:316,326`、`ViewportPolicy.js:16`：换位从 observed camera 执行原 fit，half.x=16，保持身份 / 宽度 / 焦点 | [reorder](SCROLL_LAYOUT_V2_REORDER_RESULTS.md)：修前 652≠16；修后模型 / 入口、私有 41/41 | 既有 runtime / workspace reorder 用例，完整 gate PASS；本轮不改列宽策略 |
| H-03 10/16 恢复历史尺寸，`9cf6503` 已修 | V2 parked 客户端当前已接受尺寸不同于 scrollLastVisibleGeometry；150% 或 Full | `ParkingManager.js:68,99`：以已接受 frame 和 V2 工作区恢复，保留尺寸、仍覆盖旧 configure | [reload](SCROLL_LAYOUT_V2_RELOAD_RESULTS.md)：修前 1357≠1357⅓ / Full 被缩；修后私有 100%=41/41、150%+IME=44/44 | `scroll-layout-v2-recovery-proof.test.js:104,116` PASS |
| H-04 10/16 恢复超时后永久 blocked，`9cf6503` 已修 | hold 真实恢复 frame → deadline → 显式 retry → 迟到 frame / close | `Recovery.js:32,90,100`：未满足目标仍 blocked；显式重试原值账本，不以已清 parking flag 伪造成功 | 同 [reload](SCROLL_LAYOUT_V2_RELOAD_RESULTS.md)：修前义务丢失、不能重试；修后重试 / close 清理，历史重复 restart 成功 | 既有 proof `:84,125`，本轮 SA-03–06 全部 PASS |
| H-05 10/16 crash、10/17 `7bc1932` 已修 | 保留 internal EffectWindowDeletedRef，销毁 QWindow，指针穿过 retained frame；active 与 handoff 均覆盖 | `ViewportClipEffect.cpp:125,134,204`：只对存活且被现有 runtime / handoff 拥有的普通 client 追加 hitTest；释放引用 | [input lifecycle](RUST_NATIVE_R7_INPUT_LIFECYCLE_RESULTS.md)：旧 150% 首次移动 SIGSEGV/-11；修后 100/150 各45/45。历史现场具体 internal window 身份未证明 | 本轮修正探针后 100/150 各45/45；每种缩放 16 次 retained / release 完整结束，KWin 在清理前仍存活 |
| H-06 10/19–20 锁屏 / 取消义务，`adea34c` 已修 | 锁定中 / 解锁 wake 晚到，departure-disarm 未确认；pause 后晚 ACK / relock | `SessionPauseController.js:39,92`、`ColumnGeometryCoordinator.js:327`：事实重读、有限重试、保留退休义务；无证明不写恢复 | [lock resume](RUST_NATIVE_R7_LOCK_RESUME_RESULTS.md)：历史全局停用；修后 JS254、私有100%=49/49 /150%+IME=52/52。具体现场超时根因未唯一归因 | 既有 session / coordinator 回归 + SA-08 PASS；未重做真实锁屏验收 |
| H-07 10/19–20 跨屏拖动，`adea34c` 已修 | 副屏普通窗口真实 move 中拖入主屏；私有 fixture 前两次 arm 各延后12ms放大竞争 | `RuntimeEntry.js:2158,2181`、`AdoptionController.js:120`、`lifecycle/OutputController.js:27`：同步记 move，拖动中不接管；finished 依实际输出和 Floating 协调 | [cross-output drag](RUST_NATIVE_R7_CROSS_OUTPUT_DRAG_RESULTS.md)：修前真实 arm false 两次并恢复停用；修后100/150各17/17。12ms不是生产参数，历史每项底层事实未证明 | 既有 `cross-output-drag.test.js` 7项 PASS；本轮不新增延时修复 |
| H-08 J 后 H 视觉报告，未确认生产缺陷 | incoming 工作区首帧前 / 后执行 H | `test/scroll-layout-v2-workspace.test.js:73`；`8090050` 仅增加测试：half 目标 x16、camera636、真实焦点正确 | [workspace H](RUST_NATIVE_R7_WORKSPACE_H_RESULTS.md)：既有私有场景正常，不能排除其他时序；不是已修复的新缺陷 | 既有前后首帧回归 PASS；真实异常复现 / 主观视觉仍待验证 |

## D-01：已确认的诊断误报（已修）

- **位置**：基线 `tools/scroll-layout-v2-p3-probe.py:253` 直接比较字符串；现在 `:34` 的 `same_artifact_paths` 和 `:265` 的调用。
- **触发**：从独立 worktree 通过符号链接复用已验证构建树。KWin 回报 `/home/cc/cc_niri/build/...so`，探针期望 `/tmp/cc-niri-stability-audit-20261024/build/...so`，二者指向同一文件。
- **最小复现**：SA-11 创建临时文件和 symlink；旧字符串比较为 false，新比较为 true。反例包括内容相同但路径不同的另一个文件、缺失文件、相对路径、空值、错误 key 及断裂链接，全部拒绝。
- **安全预期**：用严格解析的规范绝对路径验证同一个构建产物；保留原始 loaded path 证据，不放宽为只看 basename / 内容相似 / 插件已加载。
- **修前实测**：100/150 两次总结果 FAIL，45项中44项通过，唯一失败键均为 `exact_build_tree_plugins_loaded`；没有 crash 或行为失败。
- **补丁**：仅增加探针身份比较 helper 和调用，生产代码不变；没有放宽私有环境 guard。
- **修后实测**：两次45/45 PASS；SA-10 的4种环境拒绝与 SA-11 正反例通过。见 [机器证据](stability-audit-evidence/20261024/validation.json)，保留修前失败，不能把它计成生产故障。

## 待验证项（不是已确认缺陷）

| ID | 源码观察 / 条件 | 最小验证方案与安全预期 | 当前证据 / 状态 |
| --- | --- | --- | --- |
| V-01 InputClip 同步重入 | `ViewportClipEffect.cpp:95,107,143,332,376`：m_changing 阻止递归 restore，setHidden / 释放 VisibleRef 可能触发平台信号。现有 internal-window fixture 覆盖 retained 非 owner，没有精确钉住“自有普通 client 在 setHidden 同步回调中 close/delete” | 仅在私有 KWin 的 fixture 控制同步关闭时点，记录 mask 数、hidden bit 和可见性 ref 的释放；不得有悬空访问、跨事件遗留或重复释放。需记录真正进入该时点，不能用随机 close 压测代替 | **待验证**。已审核 QPointer / RAII / close 顺序，常规私有45/45通过；未建立该精确复现，未修改生产代码 |
| V-02 输出 barrier 寿命 | `ViewportClipEffect.h:194`；`.cpp:317,455,488,580`：barrier 表以 LogicalOutput* 作 key，所见 screenRemoved 清 frame 表，没有显式清 barrier key。key 本身不持有 output，也未被解引用；不能据此推断崩溃或实测泄漏 | 私有 VirtualBackend 重复创建 / 移除 output，先触发 desktopChanged，比较屏数、barrier key 数和地址复用后的旧时间戳影响；预期过期记录可回收、无历史增长和新输出误用。真实桌面热插拔不在本轮授权内 | **待验证**。源码清理疑点已定位，未完成运行时对象 / 表增长复现，没有宣称内存泄漏或修复它 |

## 验证、资源与实机边界

工具链：Rust / Cargo **1.99.0**，rustfmt / clippy 使用固定 toolchain；`/usr/bin/g++` **16.2.1**。沿用既有 CMake toolchain 检查，未配置新入口。Bridge Release，Clip / Ring / Plasmoid RelWithDebInfo；并行度2，构建串行。

| 检查 | 状态 / 证据 |
| --- | --- |
| 基线 `CMAKE_BUILD_PARALLEL_LEVEL=2 node tools/check.js --native` | PASS；262项 /120文件；Rust109；Bridge18/18、Clip18/18、Ring25/25；7个私有Bridge集成入口；生产boundary检查、四个Native构建通过 |
| 新增 SA-01–09 | PASS，14项；显式假时钟 / 信号顺序，200轮启动退休、100轮生成入口窗口关闭；不是长时间 / PSS 测量 |
| 新增 SA-10–11 | PASS，5项；4种私有环境拒绝，产物身份正反例 |
| 加入新测试后的完整 Native 门禁 | **PASS，281项 /122文件**；包含全部19项新增用例、固定 Rust fmt / clippy /109单测、Bridge18/18、Clip18/18、Ring25/25、7个Bridge私有集成入口、生产boundary和四个Native构建。见 [最终门禁日志](stability-audit-evidence/20261024/final-native.log) 与 [机器证据](stability-audit-evidence/20261024/validation.json) |
| 私有 Virtual/Mesa KWin InputClip | PASS，100%=45/45，150%=45/45；修前误报另存，不混入PASS统计 |
| CMake / FFI 专项 Debug / Release 与编译器拒绝矩阵 | NOT RUN / 本轮未改 CMake、FFI、工具链或Qt转换；完整门禁中的既有 Golden / FFI / runtime / Ring CTest 已执行 |
| 真实用户桌面验收 | **NOT RUN / Pending**：锁屏、跨屏拖动、窗口 close 时序、effect卸载、输出移除、视觉和4K60均未操作；历史部署 / 授权不代表本轮验收 |
| PSS、Private_Dirty、GPU归因、帧时间、30–60分钟资源趋势 | **NOT MEASURED**；模型容器计数归零不能替代全项目预算。沿用 [全项目基线](CC_NIRI_GLOBAL_MEMORY_BASELINE.md) / [账本](CC_NIRI_GLOBAL_MEMORY_AUDIT.md) / [验收](CC_NIRI_GLOBAL_MEMORY_RESULTS.md)，本轮不改写先前未提交记录或虚报低内存达标 |

交付回主工作区后重新验证新增19项与生成包一致性。首次受限沙箱禁止 `spawnSync python3`（EPERM），5项隔离测试未能启动子进程；允许相同隔离子进程后原命令5/5通过，没有跳过用例或放宽断言。完整Native门禁亦在允许私有IPC / 子进程的环境中执行。此环境限制不计为产品故障。

本轮新增常驻服务 / 线程池 / 动画时钟 / 图形缓冲均为0；诊断只在显式执行的隔离进程中运行，无绘制热路径、idle采样或每帧日志改动。私有探针产生的有界截图和临时日志只在 `/tmp`，不新增生产捕获。Native资源成本没有新增，不因此宣称全项目目标已达标。

复跑新增测试：`node test/stability-lifecycle-adversarial.test.js`、`node test/stability-probe-isolation.test.js`；它们也会被 `node tools/check.js --native` 自动收集。私有平台复跑：`python3 tools/scroll-layout-v2-p3-probe.py --isolated --scenario input-lifecycle --scale 1.0 --output /tmp/cc-niri-audit-input-100`，150%改为`--scale 1.5`并使用另一目录。不要手工设置 `--inside` 连接真实会话。

回退本轮：移除两个新增测试及本报告 / 证据，并回退探针 helper 与调用。无已安装产物需要恢复，没有触碰用户未提交改动，不需要桌面重载。
