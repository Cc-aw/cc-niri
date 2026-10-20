# CC Niri 锁屏解锁后布局停用修复计划

> **归档状态（2026-10-20）：已实施。** 代码修复、Native 门禁与私有合成锁屏回归已完成，并已部署；真实锁屏 / 解锁、长期稳定性和资源验收仍 Pending。见 [修复记录](../../test/RUST_NATIVE_R7_LOCK_RESUME_RESULTS.md)。 原设计正文保留为历史依据；移入 `done/` 不代表未执行的验收已通过。

2026-10-19。状态：代码修复已实现，Native 门禁与私有合成锁屏回归通过；真实锁屏、资源及部署状态见 [修复记录](../../test/RUST_NATIVE_R7_LOCK_RESUME_RESULTS.md)，未完成项继续 Pending。

目标是消除锁屏、解锁后 CC-Niri 布局停用且不再恢复的问题，同时保留 Native ownership、客户端 ACK、park / restore 和安全 stop 的确认顺序。本项属于运行时稳定性修复，独立于 Quickshell 视觉升级。

## 现有证据与待确认原因

本机两次异常均来自同一个 KWin 进程，日志时间为北京时间：

| 时间 | 观测 | 结论 |
| --- | --- | --- |
| 2026-10-19 09:49:13.624366 | `disabled reason=departure-disarm cancelled=false` | 取消安全确认失败后停用布局 |
| 2026-10-19 16:08:48.186153 | 同上 | 问题可重复发生 |
| 第二次停用后 | 用户报告 Win+\ 锁屏，再解锁后出现问题 | 锁屏生命周期是优先复现条件 |

本机 `kglobalshortcutsrc` 的 `Lock Session` 绑定与用户描述一致。两次重启均经过现有恢复流程并成功加载新会话。重启只能恢复运行，不能作为缺陷已修复的证据。

当前代码链为：`ContinuousLayoutRuntime.exclusive()` → `ColumnGeometryCoordinator.suspend()` → `ScrollPlanCommitGate.abort()` → `RuntimeBridge.disarmColumnGeometry()`。门禁默认期限为 150ms；确认要求同一 session、有效且不大于请求值的 epoch、`active=false`、`clipHandoffActive!=true`。超时、解析失败和状态不匹配最终都折叠为 `false`，日志无法区分。

失败后 `RuntimeEntry` 将布局 `enabled=false`；`exclusive()` 的失败分支清空动作并返回，保留 `blocked=true`。使用实际门禁与 exclusive 代码、注入迟到成功确认的模拟，已经复现“原生端最终释放，但 JS 仍停用”。该模拟证明机制存在，不能证明两次实际异常均为超时。

Native Clip 目前仅在输入裁剪入口避让锁屏，JS Runtime 没有完整的锁屏暂停与解锁恢复流程。`onOutputChanged()` 在过滤不符合列管理条件的窗口之前就进入 exclusive；是否确由锁屏窗口的 output 事件触发，仍待采样确认。系统日志未提供两次对应的锁定、解锁时间，不能宣称时间关联已经独立证实。

代码依据：

- [ContinuousLayoutRuntime](../../src/kwin/runtime/ContinuousLayoutRuntime.js)
- [ColumnGeometryCoordinator](../../src/kwin/layout/ColumnGeometryCoordinator.js)
- [ScrollPlanCommitGate](../../src/kwin/layout/ScrollPlanCommitGate.js)
- [RuntimeBridge](../../src/kwin/integration/RuntimeBridge.js)
- [RuntimeEntry](../../src/kwin/runtime/RuntimeEntry.js)
- [Recovery](../../src/kwin/stability/Recovery.js)
- [Native Clip Adapter](../../native/viewport-clip/ViewportClipEffect.cpp)

## 修复边界

JS 继续拥有布局、工作区、协议发布和全局恢复 authority；C++ 只观察 KWin 锁屏、窗口与输出事实，转发事件并管理生命周期。若需要新增纯状态转换算法，按现有 Core / Adapter 边界实现，不在 Adapter 建立恢复 policy。

不修改 Spring、H/L retarget、J/K 曲线、列宽、Wide、Focus Ring 外观或快捷键。Focus Ring 已有锁屏 hook，复用其避让行为，不建立第二个 Ring 时钟。锁屏不通过卸载脚本、重启 KWin、自动执行 CLI restart 或关闭安全门禁实现。

新增独立进程、服务、线程池、动画时钟和窗口尺寸图形缓冲均为零；优先使用现有 Bridge 和 RuntimeLifecycle。只有生命周期边界产生消息，禁止锁屏轮询、每帧 JSON 和常驻诊断采样。

## 实施顺序

### P0 补充可区分的诊断并建立回归

在 exclusive 与取消确认边界保留结构化失败原因：事件类型、内部窗口 UUID、session、请求及返回 epoch、active、handoff、锁屏状态及其事件序号、实际等待时长。区分 deadline、端点不可用、解析错误、session 不符、epoch 不符、motion 未退出、handoff 未释放。多个字段异常时保留观测值，避免只记录首个猜测原因。

详细诊断默认关闭；正常故障仅输出一条必要摘要。启用后每次复现最多保留 128 条事件、最多 60 秒；超限停止记录并标记截断，不记录窗口标题、内容或凭据，不在绘制热路径分配缓冲。

为迟到确认、确认失败、无关窗口事件添加确定性回归。先在私有 KWin 记录真实锁屏生命周期；实现前核验当前版本 KWin Script 可用的信号及属性，不假定 JS 存在 `workspace.screenLocked`。

锁屏事实优先使用经验证的 Script API；若不可用，由 Native Adapter 监听现有 `screenAboutToLock` / `screenLockingChanged`，经既有 Bridge 通道转发。启动时查询当前锁屏状态，事件带递增序号，查询与信号交错时丢弃旧结果。不能仅依赖锁屏时可能被禁用的全局快捷键唤醒；必须验证解锁唤醒及启动时已锁定路径，否则 P1 保持 Pending，不用轮询替代。

P0 退出条件：失败原因可以区分；有可失败的回归；锁屏事实来源与通知链已验证。若无法重现实际故障，保留 INCONCLUSIVE，并继续明确标注确定性回归的范围。

### P1 区分锁屏暂停与安全停止

引入可逆的会话暂停流程，明确区分 running、锁屏暂停、解锁恢复中和故障阻塞。不可复用 `ContinuousLayoutRuntime.stop()` 或终止全局 Recovery 来表达正常锁屏，因为它们会退休控制器及订阅。

锁屏开始时先撤销旧布局回调的执行资格，再请求 Native 释放 motion 与 retained handoff。释放确认之前禁止写窗口几何、执行待处理激活或发布新动画。锁屏期间继续处理窗口关闭和对象销毁，按实际存活窗口维护必要状态；布局事件合并为一次待协调标记，不保存无限操作历史，不覆盖持久列宽、顺序及视口锚点。

输出、成员、拖动等入口先判断事件是否影响现有布局。未管理的辅助窗口不能仅因 output 变化暂停整个布局；曾受管理、仍有 parking / ownership 义务的窗口必须继续退出清理。Dock、安全区域变化、真实输出移除保留现有处理，不能使用单一 canJoinColumn 判断跳过这些职责。

锁屏期间不对锁屏窗口执行布局或激活。若显示输出暂时不可用，维持暂停，等待真实解锁及输出有效事件，不修改布局算法以适应临时错误几何。

处理锁屏通知与取消失败的先后竞态：取消未确认时先核对带序号的会话事实；已确认正在锁定则维持暂停并保留释放义务，不能立即落入永久 disabled。会话事实未知或确为普通运行期故障时继续安全阻塞，不能把所有 departure-disarm 失败都归为锁屏。

### P2 保留释放义务并安全恢复

当前 `suspend()` 会清空 intent；后续 stop 若只凭 intent 为空就返回成功，可能失去此前未确认释放的依据。修复须把未完成的 session / epoch 释放义务作为独立的有界 DTO 保留，直到得到证明或对应会话被明确退休。不得因 intent 为空、超时或局部状态清空而宣称已释放；恢复请求与 stop 都必须检查这份义务。

解锁后获取当前锁屏、session、epoch、motion、handoff 和目标输出事实，仅对仍匹配的当前暂停周期执行有限重确认：最多 3 次，每次期限 500ms，生命周期内最多一个单次 timer；完成、重新锁屏、stop 或卸载立即撤销。普通动画 ACK 的 150ms 门禁保持现值，不能靠全局延长动画期限掩盖问题。

迟到回包不能自行解封；它最多触发当前暂停周期的一次状态核对，且计入上述总次数。会话替换、epoch 前进或未知 ownership 均不得用放大的 epoch 取消新计划，也不能将失配当成成功。必要时保持故障阻塞并提供具体原因，交给现有恢复入口。

证明原生释放后，用现有布局 store、Workspace 快照和实际存活窗口重新协调一次，通过现有客户端 ACK 与首帧确认流程恢复。只恢复因本次锁屏而暂停的运行时，不能自动重启用户主动 stop、全局故障恢复或已退休的会话。stop / 卸载优先级高于解锁，重复锁定和解锁事件应幂等。

### P3 让状态查询反映布局健康

为 CLI 提供 running、锁屏暂停、恢复中、故障阻塞及具体原因，区分“脚本已加载”和“布局可执行”。沿既有 Bridge 暴露独立的瞬时 runtime health，附 session 与状态序号；新会话、Bridge 重启和端点不可用时显示未知，不能沿用旧 running 值。health 不写入持久布局快照。

保留 `GetRecoveryStatus` 的安全恢复证明含义。Bridge 当前仅接受 running / pending / restored / blocked，并校验 pending 到恢复结果的顺序；不能直接往此协议塞入 locked 或 degraded，也不能让 health 取代 stop 的 requestId / session 恢复确认。兼容旧 Bridge 时 CLI 明确显示健康信息不可用。

## 验证矩阵与验收

| 范围 | 必测场景 | 通过条件 |
| --- | --- | --- |
| 事件边界 | 锁屏辅助窗口 output 变化；受管窗口移屏、退出成员范围；Dock 安全区变化 | 无关事件不阻塞；真实清理义务未遗漏 |
| 取消确认 | 150ms 内成功、迟到成功、断连、坏 JSON、session / epoch 不符、handoff 仍活跃 | 失败可区分；无未经证明的几何写入或解封 |
| 暂停恢复 | idle、H/L、改宽、J/K 中锁定；重复锁定；快速解锁后再锁定 | 旧回调无效；每个当前周期最多一次有效布局恢复 |
| 生命周期 | 锁屏期间关闭窗口；输出暂时不可用；Bridge / Script / Native 重载；启动时已锁定 | 无失效对象访问；旧事件不能恢复新会话 |
| 停止优先 | 取消确认超时后 stop；恢复期间 stop；迟到回包碰到卸载 | 未确认义务不丢失；stop 失败保留组件；卸载后不再回调 |
| 行为回归 | H/L、反向 retarget、R/F、Wide、J/K、partial 两次点击、浮动、全屏、Ring | 保持既有行为与安全裁剪 |
| 状态查询 | 正常、暂停、恢复、故障、未知、旧 Bridge | CLI 不再把加载状态当作健康证明 |

纯 JS 修改后执行 `node tools/build.js` 和 `node tools/check.js`。涉及 Native、Bridge、协议或 FFI 后按根及 `native/AGENTS.md` 使用 Rust 1.99.0、`--locked`、`/usr/bin/g++` GNU 16.x 执行全部强制门禁；按改动范围补齐 Debug / Release、CTest、编译器拒绝路径及生产边界检查。复用既有构建树，通常 `--parallel 2`，不并行运行高内存构建。

私有 KWin 必须验证实际锁屏事件、事件乱序及恢复证明；仅模拟事件不计为真实锁屏通过。用户桌面验收在部署后按约定进行，不自动锁定当前桌面或修改锁屏、电源、安全设置。至少覆盖 idle 锁定、H/L 中锁定、J/K 中锁定和较长锁定后返回；每类先做 3 轮，所有轮次解锁后无需手工 restart，窗口可见、焦点及快照正确，且无新的故障停用。睡眠唤醒、屏幕热插拔等另行约定，不将其列为本轮默认破坏性测试。

资源验收使用 Release、固定窗口 / 工作区负载，构建结束后低频采样；按全项目 M0–M3 账本记录 A/B PSS、Private_Dirty、对象 / 纹理 / timer / callback 数量及帧时间。重复锁屏交互后不得有随次数增长的存活状态；30–60 分钟空闲 PSS 净增长超过 4 MiB 须调查。无法取得同负载 B0 或 GPU 归因时标 INCONCLUSIVE；未测项目标 NOT MEASURED，不能宣称整体预算达标。

## 交付与回滚

P0 → P1 → P2 → P3 顺序实施，每步保留回归与结果。阶段结果统一写入 `test/RUST_NATIVE_R7_LOCK_RESUME_RESULTS.md`，记录代码及产物版本、原始证据位置、通过项、未执行项、性能限制和回滚方式。初始各阶段均为 Pending，不能将计划或模拟结果填写为实机 PASS。

实现与自动门禁完成后，按现有 [P6 操作单](SCROLL_LAYOUT_V2_P6_RUNBOOK.md)准备候选、冻结旧 Script / Effect / Native / Bridge / CLI 和配置快照，再安排用户桌面安全重载与锁屏验收。生产替换使用既有 save-state → 恢复证明 → stop → immutable install → start；安全停止失败即中止替换。保留同一套已验证旧产物的回滚入口，不单独回退协议不匹配的组件。

完成标准：锁屏触发链有可核查的证据；上述安全及功能矩阵通过；状态查询能准确报告停用；用户实际锁屏解锁验收通过。资源及独立长期稳定性未验收时，继续分别列 Pending。
