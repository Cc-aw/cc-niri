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
