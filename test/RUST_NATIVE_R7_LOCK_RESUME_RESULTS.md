# 锁屏解锁布局恢复修复记录

2026-10-19，基线 `a0f5853` 所在工作区。代码修复、最终 JS 与 Native 门禁完成；经用户明确批准，于北京时间 19:20 完成候选部署及安全重载，启动核验 PASS。真实锁屏解锁验收及资源验收保持 Pending。

## 故障与范围

本机 09:49:13.624366、16:08:48.186153 两次出现 `departure-disarm cancelled=false`，脚本及插件仍加载，布局却被禁用。用户随后报告 Win+\ 锁屏、解锁后发生。本轮已确认取消未证明时会清空 intent、保留 blocked，迟到成功确认不能恢复；尚无历史证据区分两次实际失败的 deadline、session / epoch 或 handoff 字段。

本机只读 API 探针确认 Script 的 `workspace.screenLocked`、`workspace.screenLockingChanged` 均为 undefined，因此通过 Native 的 KWin 信号观察会话事实。另按用户要求将 HDMI-A-1 副屏恢复到 KDE 顺序中的第一个工作区，一次性脚本已卸载；核验主屏 DP-1 工作区保持不变。桌面编号依 KDE 当前顺序，不能用已有的重复名称“桌面 3”推断编号。

## 实现

- Native Clip 仅观察 `screenAboutToLock` / `screenLockingChanged`，暴露锁定事实、实例 ID 和递增序号，并在锁定时拒绝新 arm。未加入布局或恢复 policy。
- Bridge 使用独立的单槽合并唤醒，仍经已有命令泵传递；解锁最多补发三次、间隔 100ms，槽清空或会话替换后停止 timer。唤醒内容不能作为释放证明，JS 必须回读 Native。窗口激活及暂停时的用户命令提供事件驱动的额外核验入口。
- JS `SessionPauseController` 区分锁屏暂停、恢复与普通故障。启动时已锁定会延后 hydrate；解锁后至多三次释放尝试，每次门禁 500ms，再核对当前 Native 锁定事实才协调布局。普通动画 ACK 的 150ms 参数不变。查询合并、序号及周期 token 拒绝旧结果；不使用 idle 轮询或新的动画时钟。
- 暂停撤销旧布局回调、工作区准备和超时；解锁按现有快照、实际窗口与主屏当前工作区重新 mount。无关辅助窗口事件不再使整个列布局退出，已有 parking / snapshot 义务仍需清理。
- Coordinator 以一个 epoch DTO 保留未确认释放义务，包括工作区切换清空 intent 的路径。stop 不会因 intent 为空伪造成功；新的显式恢复请求可以重新证明 Native 退休，证明前不写恢复几何。
- `GetRuntimeHealth` 与安全恢复证明分离；CLI status 额外显示布局状态，旧 Bridge 显示 unknown。健康状态不写持久布局快照。

Rust Core、FFI、CMake、Spring、retarget、列宽、Wide、J/K 曲线、Ring 外观和快捷键绑定未改。本轮使用既有构建树及固定 Rust 1.99.0、GNU GCC 16.2.1、`/usr/bin/g++`；构建并行度为 2。

## 验证

| 验证 | 结果 | 证据与范围 |
| --- | --- | --- |
| 新增 JS 定向回归 | PASS | 冷启动锁定、通知合并、迟到确认、三次释放失败、Native 实例替换、普通故障不自动解封、关窗、待处理工作区请求、stop 及显式重试 |
| 最终 `node tools/check.js` | PASS | 254 项 / 118 文件；`lock-resume-evidence/20261019/js-gate-verified.log` |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | PASS | 完整 Native 门禁日志 |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | PASS | 完整 Native 门禁日志 |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | PASS | 109 项 Rust 单元测试 |
| `node tools/check.js --native` | PASS | Bridge CTest 18/18、Clip 18/18、Ring 25/25、独立 D-Bus、Rust 生产边界及 Plasmoid 构建；其后 JS 的冷启动兼容收紧已修正，以最终 JS 门禁与私有回归为准 |
| Core Debug / Release 构建与 CTest | PASS | 各 13/13；未并行构建两个配置 |
| 私有 KWin 150% + Fcitx5 | PASS | 最终 52/52，三轮模拟锁定/解锁及真实恢复 stop，见 `verified-private-150-fcitx5/report.json` |
| 私有 KWin 100% | PASS | 最终 49/49，三轮模拟锁定/解锁，见 `verified-private-100/report.json` |
| 真实桌面锁定 / 解锁、4K60、mixed DPI 视觉验收 | NOT MEASURED / Pending | 私有测试发出合成的 KWin 信号，没有运行真实锁屏程序；没有自动锁定用户桌面 |
| A/B PSS、Private_Dirty、GPU、帧时间及 30–60 分钟资源验收 | NOT MEASURED / Pending | 不以单进程 RSS 或功能回归宣称满足全项目预算 |
| 候选、备份及回滚检查 | PASS | 既有 P6 prepare / verify 与 rollback dry-run 通过；仅证明完整性与执行顺序，未实际回滚。最终候选位置见证据目录 `candidate.json` |
| 当前桌面部署 | PASS | 19:20 经现有恢复证明和 immutable 安装入口部署，新会话布局 health=running，Native source valid，Script / Clip / Ring 版本核验通过；见 `deployment-verification.json` |

部署前后只读工作区探针确认 DP-1 保持第 2 个工作区、HDMI-A-1 保持第 1 个工作区。五个工作区分别按 ID 比较，columns（含顺序及宽度）、focusedUuid、presentation、viewportAnchorV2 均一致。

核验时发现旧版在 18:33:13.191963 又记录一次 `departure-disarm cancelled=false`，磁盘快照修改时间停留在 18:33:12，根 workspaceId 因此没有跟随之后的原生桌面切换。首次直接比较根活动快照得到 REVIEW，原始结果保留在 `deployment-verification-first.json`。最终核验按工作区 ID 比较全部保存状态，并确认新版根活动快照与重载前只读观察到的原生主屏工作区一致，结论 PASS；未用旧根字段强制切回用户桌面。

完整证据在 [lock-resume-evidence/20261019](lock-resume-evidence/20261019/)。沙箱内首轮 JS 总门禁的既有 Native fixture 失败，允许隔离测试进程后通过。私有中间回归曾因新增校验拒绝 Native 冷启动的合法 `epoch=-1` 而无法 bootstrap；该轮原始报告保持 INCONCLUSIVE，不计入最终通过。已将测试模型改成同样的冷启动契约，修正后两轮私有回归通过。

## 部署与回滚

配套更新 Script、Clip、Bridge 和 CLI，保持现有 Dock 配置。部署顺序为保存旧状态 → 证明窗口恢复 → stop → immutable 安装 → start；确认失败立即中止，不能强制卸载或强杀 KWin。

冻结候选与备份后，使用 [P6 操作单](../doc/done/SCROLL_LAYOUT_V2_P6_RUNBOOK.md)的匹配产物及回滚入口。回滚必须先证明当前窗口恢复，再切回旧 Clip / Ring immutable 路径及匹配 Script / Bridge / CLI；恢复的配置与快照取自备份时刻。回滚仅 dry-run 通过也不能记为完整回滚 PASS。

本次实际部署使用 `/tmp/cc-niri-lock-resume-20261019-deploy/manifest.json`，配套回滚入口为同目录 `rollback.sh`（默认 dry-run，实际恢复需 `--execute`）。部署日志见证据目录 `deployment.log`，未执行完整回滚。该目录包含私有配置及快照，不提交到仓库；`/tmp` 被清理后不能再依赖此回滚入口。部署后仅补记结果文档，未再次编译或改变已安装候选。

本轮保留进入任务前已有的工作区 H 测试和探针改动；本修复额外在既有 P5/P6 私有场景中增加合成锁屏生命周期回归。尚未得到用户真实锁屏解锁反馈，不宣称已完成实机验收。

## 部署后再次停用分析

用户再次报告自动停用，要求先重启再分析。已保留停用状态后经既有安全恢复流程完成重启，新会话 health=running。本轮仅分析及记录，没有修改或重新部署生产代码。

这次直接原因是 `bootstrap-arm`，与之前的 `departure-disarm cancelled=false` 不同。重启前 Native 实例与部署时一致，`GetSessionState` 返回 `locked=false, sequence=0`，没有观察到本实例的锁定状态变化，不能将本次故障归入已观测的锁屏周期。

| 北京时间 | 证据 |
| --- | --- |
| 20:04:45.415 | 单列 COLUMN_GEOMETRY epoch=41 接管成功 |
| 20:04:51.920 | 单列 bootstrap epoch=42 接管成功 |
| 20:04:52.059–52.070 | Dock 提示新增 UUID 尚在等待 TaskModel 映射；这只说明模型初始化时间点，不证明 Dock 导致 Native 拒绝 |
| 20:04:52.087 | 两列 bootstrap epoch=43 被 Native observer 接受，未出现 ARM 成功日志 |
| 20:04:52.112 | 相同两列 bootstrap 的重试 epoch=44 被 observer 接受，仍未成功 ARM |
| 20:04:52.116–52.121 | `geometry failure reason=bootstrap-arm cancelled=true`，随后 blocked 和全局窗口恢复 |

新加入的 UUID 为 `737cd844-b993-4dfe-a599-7a0bbcdef250`。用户随后明确补充：当时是把已有窗口移入当前工作区，并非刚创建新窗口。最初按跨工作区迁入排查；用户进一步明确是用鼠标从副屏直接拖到主屏，因此触发入口修正为跨输出交互移动，不能由“移入工作区”的口语描述推断发生虚拟桌面归属变化。后续只读查询该 UUID 的窗口信息为空，无法追溯其应用和当时的实际几何。

源码的处理为：bootstrap arm 返回非 true → 取消当前 epoch → 首次取消得到确认后立即 reflow 重试一次 → 再次失败时转交全局恢复 → 禁用布局并停止相关控制器。`cancelled=true` 表明本次退出已得到确认，并不表示布局恢复成功。健康状态随后显示 `stopped (runtime-stop)`，是全局恢复的退休步骤产生，不能据此判断用户手工 stop 或进程退出。

使用已部署对应的生成入口，在尚未收到 bootstrap 首帧时加入第二个窗口、仅注入两次 Native arm 拒绝，模型得到 `enabled=false, phase=stopped, recovery=restored`，并产生同样的 bootstrap-arm 日志，见 `recurrence/model-failure-chain.json`。这是对失败处理链的确定性复现，不是对实际 Native 拒绝条件的复现。

初步假设是迁移路径中“JS 几何检查完成到异步 Native arm 之间，窗口几何 / 成员事实发生变化”的时序。`WorkspaceTransferController` 会释放旧 parking、更新归属并交给 adoption；`WorkspaceMoveController` 的移动并跟随还会叠加工作区切换和 mount。迁入窗口需要从旧工作区的布局状态转为目标工作区的帧几何，不能仅按新建客户端等待首次就绪的问题处理。

Native arm 对实际输出、窗口范围、序列及源帧几何均有校验；observer 接受计划不能代替这些 arm 检查。既有 Rust `partial_rejects_resize_spoofing_and_consumes_validated_epochs` 定向测试已重跑通过，确认不匹配的实际几何会被拒绝且消费该 epoch。历史日志没有具体拒绝分支及对应 frame facts，仍不能把本次唯一归因为尺寸、窗口退出或某一检查条件。此前的模型仅复现失败升级链；下面新增私有 KWin 的实际跨工作区迁入与生产 Rust 重放结果。

后续修复应先在 Native 拒绝边界记录有界的具体原因及必要几何事实，再覆盖已有窗口迁入时 configure / 归属更新 / 发布 / arm / 首帧之间变化的回归，尤其是目标工作区原有居中 twoThirds 列、迁入 half 列、移动并跟随与原生移动入口。安全取消得到证明后，应研究等待客户端事实稳定、重建当前 epoch 或局部退回原生管理，避免把可恢复的迁移失败直接升级成永久全局停用；不得通过关闭几何校验或复用失败 epoch 绕过安全边界。

证据目录为 [recurrence](lock-resume-evidence/20261019/recurrence/)。本次重启 PASS；停用链分析 PASS；实际 Native 拒绝条件 INCONCLUSIVE；该新分支的代码修复与实机验收仍 Pending。

### 继续分析：迁入时序与历史计划重放

使用既有 Release Clip / Bridge / Ring、完整生成 JS 和私有 Virtual/Mesa KWin，先把三个已有测试客户端移到另一工作区，仅留下一个居中 twoThirds 窗口，再将已有 half 窗口迁回并激活。只追加隔离测试指令与有界的接管事实记录，没有修改生产源码、安装目录或真实桌面。

| 验证 | 结果 | 限制 |
| --- | --- | --- |
| 100% 缩放，迁入后 250ms 激活 | PASS，12/12 | 两列正常接管，Native 无拒绝，安全 stop 通过；延时只是测试变量，不是修复参数 |
| 150% 缩放，迁入后 20ms 激活 | PASS，12/12 | 两列正常接管，Native 无拒绝，安全 stop 通过 |
| 100% 缩放，同步 / 1ms 激活 | 迁入验收 FAIL | 窗口没有留在布局列中，运行仍 enabled；所有 Native arm 均成功，没有复现历史停用 |
| 历史 epoch 42 / 43 / 44，经生产 Rust C ABI 重放 | PASS | 使用重建的正确 safe frame，三次接管均成功；不是历史实际 frame |
| 重放时将迁入窗口高度或 x 增加 1px | 按预期拒绝 | 两列计划被拒绝，motion epoch 停留在 42；修正高度后复用同一失败 epoch 仍被拒绝 |

实际迁移测试表明，此操作不是每次都会导致停用。同步和 1ms 激活的私有日志显示，窗口在归属处理完成前曾进入 adoption，之后被 transfer 清理并回到 waiting-activation。这是可单独跟踪的归属与激活时序问题，不能代替 bootstrap-arm 的根因。

历史计划重放进一步证明，日志中的 wire plan 在正确输出、上下文、取消顺序与几何事实下可以被 Rust 接受，不支持把问题直接归为这两个布局计划的固定几何计算错误。仅改变一个实际 frame 事实便可重现“observer 可接受、runtime arm 拒绝且 motion epoch 不前进”的结果，但历史没有记录对应 frame，仍不能在位置、尺寸、输出 / 工作区事实和序列之间唯一归因。

证据见 `recurrence/transfer-analysis.json`、`recurrence/native-plan-replay.json` 和对应私有目录。C ABI 重放脚本保存在 `recurrence/native-plan-replay.py`；使用构建树插件，不创建 Effect，也不连接真实 KWin。私有 runner / scenario / fixture 源码快照位于 `recurrence/transfer-probe-sources/`，其中临时路径需恢复后才能重跑。两次中间探针分别因外层环境变量未传入私有环境、延迟定时器未保留引用而不计入时序比较，原始结果保留，没有将其记为生产代码失败。

以下跨屏拖动验证已进一步确认一种可触发的竞争；历史 Native 拒绝分支仍需有界诊断补齐。针对已确认的异步间隙，可研究发布后再次验证几何、取消确认后以新 epoch 等待事实稳定再尝试；现有证据不足以直接部署某个固定延时。生产代码与实机状态本轮未改。


### 用户澄清后：跨屏拖动竞争的控制复现

**最新结论：已确认副屏普通窗口仍在鼠标拖动时，JS 可以提前进行主屏布局 bootstrap；真实位置随后变化会使两次 Native arm 拒绝，并触发与现场相同的全局停用链。** 这替代了之前“已确认跨工作区迁入”的解释；虚拟桌面归属变化没有得到用户确认。

源码缺口位于 `RuntimeEntry.onInteractiveMoveResizeStarted`：不在布局列中的副屏普通窗口，既不会进入 FloatingController 的 managed detach，也会因 `layoutMode=normal` 提前返回，未设置 `state.interactiveMoveResize=true`。`OutputController.onOutputChanged` 只检查这个脚本标记，adoption 的 waitPhase 也没有检查实际 `window.move/resize`。松开后的 finished 回调目前只清零标记，没有显式协调被延后的输出 / adoption。

私有双 Virtual 输出测试使用真实鼠标按压及客户端 Wayland `startSystemMove()`，窗口从 Virtual-1 拖入 Virtual-0。额外诊断确认 Native `window.move=true`，脚本 `interactiveMoveResize=false`。不增加调用延迟时，等高窗口在拖动中先成功 arm，后续鼠标移动破坏首帧证明，出现 `bootstrap-deadline`；鼠标释放后新 epoch 接管成功。该变体最终稳定、恢复与 stop 验收 14/14 PASS，证明问题有时序依赖。

为稳定覆盖“检查成功后、Native 接管前又发生鼠标移动”的窗口，仅在私有 fixture 的前两次双列 bootstrap 调用前各增加 12ms 定时延迟。没有伪造 Native 返回、没有修改 Rust / Native / 生产 JS。两轮测试均由真实 Native 返回 false，得到 `bootstrap-arm` 两次失败、确认取消、全局恢复和 health=`stopped (runtime-stop)`。原始回归报告为 FAIL（`cross_output_drag_remains_running=false`），这是成功捕获未修复故障，不能记为功能通过。

最后一轮在调用发出前记录的事实如下，输出与工作区归属均保持正确：

| epoch | 计划要求的迁入窗口 x | 调用前实际 x | 尺寸 | Native move / 脚本 moving | 接管 |
| --- | --- | --- | --- | --- | --- |
| 7 | 1288 | 1800 | 1256×1408，匹配目标尺寸 | true / false | false |
| 8 | 1288 | 1600 | 1256×1408，匹配目标尺寸 | true / false | false |

这将“拖动期间提前接管 → 几何竞争 → 两次失败升级为全局停用”从推测提升为控制复现。现场 epoch43/44 缺少实际 frame 与 Native 拒绝分支，所以仍不能宣称已经证明现场每个底层条件完全相同，也不能把注入的 12ms 当作现场测量或建议的修复延时。

证据为 `recurrence/output-drag-analysis.json`、`private-output-drag-delayed-arm-100/` 与 `private-output-drag-facts-100/`。带 guard 的私有复现源码保存在 `recurrence/output-drag-probe/`，可在允许私有 D-Bus / Wayland socket 的环境中运行：

```sh
python test/lock-resume-evidence/20261019/recurrence/output-drag-probe/runner.py --isolated --scenario p5 --scale 1.0 --output /tmp/cc-niri-output-drag-evidence
```

其中 12ms 延迟只存在于该诊断 fixture，原始无延迟 fixture 另存为 `fixture-baseline.js`。早期 Meta+拖动没有激活纳入列；首次 system move 探针只检查列数、没有检查 pending，虽原始报告 PASS，不能用它宣称布局已稳定。后续等高与 150% 探针补上了 pending 检查并等待超过 bootstrap 截止时间。

修复方向收敛为：对所有可管理普通窗口在交互开始时同步记录事实并暂停接管，不依赖已经纳入列或已有 maximize/tile 状态；输出和 adoption 在 move / resize 期间延后；finished 按真实输出、当前桌面、Floating 策略重新协调一次。JS 发布后 / arm 前还应重新核对几何，漂移时先确认取消，再用新 epoch 等待有效事实；保留 Native 校验与 ACK 顺序。需要同时验证副屏拖入、主屏拖出、快速来回、松手在副屏以及既有 managed 窗口拖动的 Floating 行为。生产修复与实机验收仍 Pending，本轮没有部署或重载真实桌面。

## 2026-10-27：解锁后 empty-disarm 持续停用

本次先经用户明确允许，执行现有 `./cc-niri restart`：窗口恢复得到确认，随后正常停止 / 启动；重启后以及排查结束前 health 均为 `running (session-ready)`。之后的排查只有日志读取、磁盘产物核对和隔离模型，没有修改生产源码、生成包、配置或安装产物，没有再次重载或操作真实锁屏。

**结论：已确认“解锁后超时 → 持续停用”的处理链及可复现的恢复阶段缺口；现场 IPC 为什么未及时完成仍为 INCONCLUSIVE。** 用户确认故障前刚解锁，系统日志的密码验证时间也与故障相邻。不能把取消确认超时解释为 Native 已经返回拒绝，或认定 Rust / KWin 崩溃。

### 现场时间线（北京时间）

| 时间 | 观测 |
| --- | --- |
| 09:05:39.676000 | `unix_chkpwd` 密码验证成功；用户确认刚解锁屏幕 |
| 09:05:40.247366 | `blocked reason=session-query-deadline` |
| 09:05:40.263775–40.284425 | Dock 收到 generation 19201–19214，活动列数均为 0；这不证明窗口丢失或 Dock 导致故障 |
| 09:05:40.590220 | `disarm deadline epoch=2158 timeoutMs=150` |
| 09:05:40.590492 | `geometry failure reason=empty-disarm cancelled=false` |
| 09:05:40.791318 | `blocked reason=empty-disarm` |
| 16:41:12–13 | 经授权的安全恢复 / 重启成功，Bridge 接受新会话 |

重启前 CLI 显示 Script、Clip、滚动特效、Ring 仍 loaded，Bridge active，health=`blocked (empty-disarm)`。因此直接故障是布局安全停用。故障窗口日志没有记录 GPU reset、OOM 或崩溃，但日志缺失不能排除所有平台阻塞因素。

### 代码链与确定性重放

1. `SessionPauseController.query()` 的默认查询截止时间为 500ms；超时会 pause，并忽略该查询迟到的回复。这一次超时自身没有设置 `terminal`。
2. 恢复时，`attempt()` 在调用 `onResume()` **之前**清掉 `sawLock` 并发布 `running`（`src/kwin/runtime/SessionPauseController.js:103`）。`RuntimeEntry.js:797` 的 `onResume()` 此后才 mount 工作区，mount 的异步 Native 确认尚未完成。
3. 空列布局在 `ColumnGeometryCoordinator.js:94` 仍需执行取消确认；其门禁默认 150ms。`RuntimeBridge.disarmColumnGeometry()` 顺序调用 `CancelScrollPlan` 和 `GetScrollMotionStatus`，后者核对 session / epoch / active / handoff。150ms 覆盖整条确认链，超时不区分请求未执行、回调未到或状态查询未到。
4. 一旦该确认超时，coordinator 进入 quarantine 并报告 `empty-disarm`。若重新查询 Native 时仍为同实例、同 sequence、未锁定，刚刚清掉的 `sawLock` 不会恢复。`SessionPauseController.refresh()` 把它作为普通故障，设置 `terminal=true`；`RuntimeEntry.js:814` 的 `onFault()` 设置 `mainScreenState.enabled=false`。
5. 已超时的 gate 不再接受迟到确认；后续快捷键触发的 `refresh()` 又因 `terminal` 直接返回。故障因而不会随 IPC 恢复自动消失。未知 ownership 时不写恢复几何仍是必要安全约束，不能跳过 ACK 来消除停用。

通过既有 fixture 加载与安装盘上相同的完整生成入口，在空工作区注入查询 / 状态回调延迟。不是伪造 Native 拒绝，也没有连接真实 KWin：

| 场景 | 模型观测 | 结论 |
| --- | --- | --- |
| 正常 lock / unlock | running、enabled=true，无遗留 timer | PASS |
| 仅会话查询超时，随后新 wake，取消证明及时到达 | 从 session-query-deadline 恢复 running | PASS；第一次超时单独不足以解释持续停用 |
| 解锁后仅空布局取消确认超时 | terminal=true、enabled=false；迟到的 inactive 证明和快捷键无效 | 停用链复现 PASS；功能恢复 FAIL |
| 查询超时，再恢复，再空布局取消确认超时 | 按现场顺序产生相同四条 warning；最终 terminal=true、enabled=false | 停用链复现 PASS；实际 IPC 延迟原因 INCONCLUSIVE |

这里的“恢复阶段缺口”是可复现的时序：控制器已经宣告恢复并退出锁屏恢复语义，布局重建的异步确认仍可能失败。现场没有保存中间 health、Native sequence 或每段 IPC 回调时刻，因此这条重放与日志一致，但不能断言现场每个内部状态完全相同。空列是活动布局无可管理列，不等同于全部工作区都无窗口。

### 验证、证据与后续边界

- `node test/lock-resume-evidence/20261027/replay.js`：PASS，四组断言通过；其中两组有意重现功能失败，不能计为修复通过。
- `node --test test/session-pause.test.js test/scroll-layout-v2-coordinator.test.js test/runtime-bridge.test.js`：PASS，三个既有测试入口。
- 完整 `node tools/check.js`：PASS，281 项 / 122 个入口，生成包一致性和 `git diff --check` 通过；见 `js-gate-unsandboxed.log`。首次沙箱执行因既有 CLI 测试 `spawnSync /usr/bin/bash EPERM` 失败并中止；允许测试子进程后重跑通过，该限制不是现场桌面故障。
- 磁盘上的生成 Script / CLI 与仓库 SHA-256 完全相同：PASS。没有保存重启前 Native 内存映像，不能据此证明旧内存中的 Native 与当前构建逐字节一致。
- Rust / Native 构建、fmt / clippy / CTest：NOT RUN；本次未改 Native、FFI、CMake、工具链或生产 JS。
- 真实锁屏时序复现、混合缩放 / 4K60 验收：NOT RUN / Pending。PSS、Private_Dirty、GPU / 帧时间：NOT MEASURED。新增生产服务、线程、时钟和图形缓冲均为 0。

证据目录：[20261027](lock-resume-evidence/20261027/)，包含选取的现场 journal、产物哈希、独立重放源码 / JSON 及检查日志。重放命令同上，无实际时间采样或长期 capture。回退本轮仅需删除该证据目录与本节，已恢复的桌面不依赖它们。

后续修复应将解锁后的首个布局确认纳入同一有界恢复阶段；取得同实例、当前 epoch 的 Native 取消证明后再重建，失败保留 ownership 义务，并覆盖 relock / stop / 迟到回调。普通非锁屏故障仍须安全隔离，不应仅延长全局超时或无条件自动重启。现场延迟的进一步归因需要在显式诊断中有界记录查询、cancel 和 status 的起止及返回分支；现有日志不足以判定是 KWin 事件队列拥塞、D-Bus 排队还是回调投递延迟。**修复、部署与实机验收均保持 Pending。**

## 2026-10-27 修复候选：首轮布局确认属于会话恢复

用户要求开始修复后，修改限于 JS 会话恢复编排、既有 coordinator 完成回调的接线及对应测试；通过 `node tools/build.js` 重新生成包。Native / Rust / FFI / CMake / 工具链没有改动，经 `git diff --exit-code HEAD -- native bridge cmake rust-toolchain.toml` 核验。进入本轮前的其他未提交改动全部保留。

`SessionPauseController` 在取消证明和新鲜的未锁定事实均成立后，启动布局重建，但保持 `resuming` 与锁屏来源标记。`ContinuousLayoutRuntime` 将当前 epoch 的既有 coordinator 完成事件接回会话 owner；空布局等待取消证明，普通布局等待首个有效 painted 完成，fullscreen / maximized 挂起不强制生成滚动计划。回调之后再读取会话事实，只有仍属同一 Native 实例和同一 sequence、且未锁定时才报告 `running`。同步空布局完成也必须等整个 mount 函数成功返回，避免后续拒绝被提前的成功覆盖。

同一锁屏 sequence 的 release / 重建合计最多三轮。重建有一个 4000ms 单次 lifetime deadline，覆盖既有最长 3500ms 的几何确认；查询仍为 500ms，普通取消 ACK 仍为 150ms，未放宽 Native 校验或改变动画参数。每轮重试先 pause、保留释放义务并取得新的 Native 取消证明，再 remount；迟到的旧证明不能替新一轮解除暂停。反复用户 wake 不重置预算，耗尽后保持 paused / blocked 且清空本次恢复定时器，只有更新的实际锁屏 sequence 才开启新预算。非锁屏普通故障与 Native 实例替换仍走原终止路径。

暂停、再次锁屏、超时、stop 均退休本轮 callback / deadline；取消后的旧 deadline 无权清掉新 deadline。正常 idle 新增 timer 为 0；恢复中新增最多一个有界单次 lifetime timer，不采样动画、不常驻轮询。新增生产状态为 O(1)，不按交互历史积累。

| 检查 | 最终候选结果 |
| --- | --- |
| 新增 `test/session-resume-confirmation.test.js` | PASS，10 项；首轮证明 / 最终事实重读、release 和 layout 期间 wake、relock / Native 替换、迟到 callback / deadline、持续失败预算、同步完成后拒绝、现场连续超时、未知 ownership 不写几何、stop、fullscreen 挂起 |
| `node tools/check.js` | PASS，291 项 / 123 个测试入口；含生成包一致性、既有功能回归及 whitespace；见 `20261027/fix-final-js-gate.log` |
| 私有 Virtual/Mesa KWin，100%，P6 最终候选 | PASS，53/53；含真实取消证明延迟、三轮合成 lock / unlock、宽度 / 顺序 / signed anchor、Ring / 输入、副屏边界及 CLI 恢复证明后卸载 |
| 私有 Virtual/Mesa KWin，150% + Fcitx5，P5 最终候选 | PASS，49/49；含相同解锁延迟场景、真实中文候选 / 提交与 safe stop |
| Rust fmt / clippy / tests、Native 构建 / CTest | NOT RUN；纯 JS 修复，不修改 Native / FFI / 构建 / 工具链，复用已配置产物；未把 JS 门禁称为完整 Native 门禁 |
| 真实锁屏、4K60 / mixed-DPI 主观交互、持续资源验收 | NOT RUN / Pending；不能由私有虚拟输出替代 |
| A/B PSS、Private_Dirty、对象 / 纹理和 GPU 成本、帧时间 | NOT MEASURED；未宣称全项目资源目标达标 |

私有 fixture 只在独立 D-Bus / Virtual 输出中，将一次**真实** `GetScrollMotionStatus` 回复延迟 240ms，超过既有 150ms 取消门禁；记录延迟时 `resuming + sawLock=true`，再取得新取消证明、重建、恢复 `running`。旧回复到达后仍保持 enabled / running，未伪造 Native 成功或把历史 IPC 延迟当作已测量。第一轮候选曾通过 100%=46/46、150%+IME=49/49；加入同步完成的额外防护后重新运行上述最终候选检查，最终结果不复用旧候选的通过数。

模型中一个新增 stop 断言的中间失败来自假 timer 的 `emit()` 没有模拟真实 singleShot 自动退出 running；测试触发 helper 补上这一事实后通过，没有改变生产 deadline 或放宽 ownership 断言。原调查的 `replay.js / model.json` 记录修复前行为；当前候选用新增生产回归测试复跑，不将旧模型的“预期停用断言通过”当作修复成功。

最终私有原始目录为 `/tmp/cc-niri-resume-fix-final-100`、`/tmp/cc-niri-resume-fix-final-150`；检查摘要、关键日志和候选完整性记录保存在 [本日证据](lock-resume-evidence/20261027/)。当前阶段为 **代码与隔离验证 PASS，部署待执行，真实锁屏验收 Pending**。完整回滚未执行，不能把 dry-run 记为回滚实测。

部署前发现构建树 Clip / Ring 的 SHA-256 与当前安装的 immutable 文件不同，Bridge 则相同。纯 JS 修复不替换 Native；因此补用当前安装的两份 Native 文件，在保留私有总线 / 目录 / 输出所有 guard 的临时探针中重跑：100% P6 为 53/53 PASS，150% + IME P5 为 49/49 PASS。临时探针只调整 ROOT / 插件路径常量及仓库外产物的报告 key，没有更改生产 Native 或测试的成功条件；第一次因路径记录要求仓库内相对路径而未启动 KWin，修正后通过，不能算作生产失败。

此次部署使用既有 P6 prepare / verify / rollback dry-run 冻结与备份，实际只调用 `install.sh` 已使用的 KPackage 脚本升级入口，沿用 `save-current-state → cc-niri stop → kpackagetool6 --type=KWin/Script --upgrade → cc-niri start`。不执行全量安装器的 Native 替换和其他配置迁移。准备或停止失败即中止；升级失败尝试恢复旧脚本包并启动。候选及全组件备份位于 `/tmp/cc-niri-unlock-script-fix-20261027`，完整回滚入口为该目录 `rollback.sh`，默认 dry-run，实际回滚仍须先通过当前窗口恢复证明；`/tmp` 清理后不能依赖该退路。

### 2026-10-28 部署与启动核验

上次 turn 在部署前被服务器重启中断。恢复任务后，核对无部署日志、安装脚本仍为旧 SHA、候选完整性及 rollback dry-run 均 PASS，旧桌面 health 为 running；没有假定先前操作已经完成。

第一次实际部署在旧运行时恢复确认超时处安全中止，组件保持 loaded，脚本包仍为旧版本，没有强制卸载。随后通过当前 session / generation 重新提交真实恢复请求，唤醒原有命令泵后取得 `state=restored, restoredCount=1` 的恢复证明。一次诊断程序在解析 gdbus 的 `(true,)` 布尔回复时退出，请求实际已提交；继续唤醒该请求并读取真实证明，没有将解析错误作为拒绝或重复执行强制操作。初次请求未及时确认的具体原因尚未唯一归因，不能将重试成功称为 CLI 故障已修复。

之后沿既有安全停止流程再次确认恢复，KPackage 脚本升级、start、两次 health 核验均 PASS：`running (session-ready)`，Bridge active，Clip / 滚动特效 / Ring 均 loaded。安装脚本 SHA-256 为 `6b857d7d48563893bc2a32e097376052128af0b074208b0cc79acec7df305c6b`，与已验证生成包完全一致。Clip、Ring、Bridge 和 CLI 的字节哈希均与部署前备份相同，未替换 Native 文件。

最终状态：**代码 / 隔离回归 / 脚本部署 / 启动核验 PASS；真实锁屏、4K60 / mixed-DPI 交互与资源验收仍 Pending / NOT MEASURED**。结果及初次中止 / 成功重试日志见 `20261027/fix-deployment.json`、`fix-deployment.log`、`fix-deployment-retry.log`。完整回滚仍未执行。部署后仅补记此结果文档，未改变已安装的生产候选；manifest 的冻结源码用于部署当时校验，后续 `--current` 会因这份文档补记而不再匹配，备份完整性校验与 rollback dry-run 不受影响。
