# R7 后续：平铺窗口圆角兼容修复

日期：2026-10-23。范围为终端控制入口的配置兼容；生产 JS、Rust、C++、FFI、CMake、Spring、Scroll 和 Focus Ring renderer 未修改。用户已确认主屏工作区 2 的 kitty＋Firefox 双 half 圆角及切换焦点后的蓝线贴合正常，此场景实机视觉验收 PASS；其他场景和长期资源验收仍 Pending。

## 原因与修复

工作区 2 的两个 half 窗口分别位于 x=16、1288，宽度均为 1256，左右及列间距均为 16，组成 2560 logical px 的完整平铺链。第三方 Rounded Corners 的几何平铺识别默认关闭这些窗口的圆角。用户另确认：其中一个改为 2/3 后圆角恢复；单窗 kitty 的四角截图也恢复。Firefox 自身的 GTK 装饰与圆角在外部裁剪跳过后仍可能可见，Focus Ring 则独立读取全局半径，造成轮廓不一致。

`cc-niri start` 在圆角特效已加载时保存 `DisableRoundTile`、`UseSquircleShape` 的原值，随后设置为 false，并同步调用现有 `reconfigureEffect`。缺省值用 `absent` 保存，停止时通过删除恢复插件默认值；显式 true / false 分别保留。半径、活动/非活动样式、全屏、最大化和描边设置不变。重复 start 不覆盖原值；实际写入或应用失败时尝试恢复，未完成的恢复保留备份状态。stop 保留启用期间用户作出的不同设置。

这两个选项是第三方特效的**全局配置**，影响其处理的所有工作区/输出，不是假称仅管理主屏窗口的私有开关。未加载圆角特效时不强制加载或安装。已运行时的 start 可以直接应用这两个设置；冷启动在布局成功启动后应用，避免先改圆角再因 Native capability 检查失败而遗留设置。正常 stop / uninstall 复用现有恢复入口，仍先执行原来的 parked-window ACK 恢复和组件清理顺序。

## 验证状态

| 项目 | 状态 | 证据或限制 |
| --- | --- | --- |
| CLI 配置恢复与失败回滚 | PASS | 真实 shell 入口 + 替代平台 I/O，含缺省/显式值组合、重复 start/stop、冷热启动、可选特效、用户后续修改、写入及 reconfigure 失败 |
| 完整 JS / bundle / whitespace 门禁 | PASS | 首轮 119/120；唯一失败为沙箱 `spawnSync python3 EPERM`，既有 P0 隔离保护测试无法启动子进程；允许子进程后同一 `node tools/check.js` 全部通过，120 个文件、262 个检查、fail=0，约 141 秒，见 [checks.log](rounded-corners-evidence/20261023/checks.log) |
| shell 语法与 whitespace | PASS | `bash -n cc-niri`、`git diff --check` |
| Rust / Native / Core differential | NOT MEASURED | 本轮未改 Native、FFI、CMake、工具链、动画或生产 JS；不重建或卸载运行中的插件 |
| 当前主屏 half＋half 四角及焦点切换贴合 | PASS | 用户对“将工作区 2 的 kitty 和 Firefox 都设回 half，观察四角及切换焦点后的蓝线贴合”明确回复“两个窗口都正常”；这是用户实机验收，不以先前存在遮挡/视口裁剪的截图代替 |
| half＋2/3、H/L、J/K、Pair/Wide、fullscreen | Pending | 未获这些修复后场景的单独确认；自动模型不能替代实机视觉验收 |
| 其他 scale / 输出视觉 | NOT MEASURED | 主屏当前 150%，不外推完整矩阵 |
| 30–60 分钟资源收敛 | NOT MEASURED | 保持 Pending |

## 资源架构与观测

CC-Niri 代码没有新增服务、线程池、timer、动画时钟、Scene Item、图像、纹理或每帧配置读取。只在 start/stop 调用已有配置接口。但是，给平铺窗口启用第三方圆角会恢复其已有的 OffscreenEffect redirect 路径，可能增加窗口尺寸的 GPU render target；不能以本仓库零新增 QImage 宣称零增量内存。

仅作容量估算：1256×1364 logical、150% 下，一份 RGBA8 窗口缓冲约 14.70 MiB，两窗约 29.41 MiB，未计阴影外扩、格式、缓存及驱动分配，不是实际显存、PSS 或项目预算结果。此方案复用已安装特效，避免新增第二套窗口裁剪 renderer；资源成本和生命周期必须计入全项目验收。

配置前/后观测：[memory-before.json](rounded-corners-evidence/20261023/memory-before.json)、[memory-after.json](rounded-corners-evidence/20261023/memory-after.json)，两侧各 20 秒、10 秒间隔、3 样本。KWin PSS / Private_Dirty 仍受进程权限限制不可读。用户正在正常操作且改变窗口宽度，前侧还有 CLI 测试进程，不是固定负载 A/B。Bridge PSS 中位数均为 1694 KiB、Private_Dirty 均为 820 KiB；不能代替整项目归因。KWin RSS 中位数 319756 → 329980 KiB 仅为辅助，不转换为 PSS。全卡 NVIDIA memory.used 为 2892 → 2978 MiB、utilization 为 6% → 34%，包含用户交互和其他应用，不能归因为本功能。内存归因 **INCONCLUSIVE**，实际纹理数量、GPU 内存、帧时间、长期增长 **NOT MEASURED**。

全项目 M0/M1/M3 结果分别继续记录在 [BASELINE](CC_NIRI_GLOBAL_MEMORY_BASELINE.md)、[AUDIT](CC_NIRI_GLOBAL_MEMORY_AUDIT.md)、[RESULTS](CC_NIRI_GLOBAL_MEMORY_RESULTS.md)。没有通过 32/64 MiB 总预算，也没有执行组件卸载、KWin 重启、热插拔或压力耗尽测试。

## 部署与回滚

18:36:54（Asia/Shanghai）已仅部署 CLI，通过已经运行时的 `start` 应用配置，没有执行完整安装器、stop/restart 或任何组件卸载。备份 `/home/cc/.local/state/cc-niri/backups/rounded-corners-20261023-183654`（0700）保存旧 CLI、只作参考的 kwinrc、原配置项和 Bridge 状态。原两项均缺省，当前显式 false；当前 CLI SHA256 为 `ec2967e490b2caf1a9dd5931b3b8dae49836a1b64befd471c3b18980be620d80`。部署前/后 KWin PID 2119、Bridge PID 616754 不变；Ring 继续 Rust backend、radius=12、width=2、原 immutable binary。部署状态 **PASS**；随后用户确认双 half 圆角与蓝线正常，此场景实机视觉验收 **PASS**，其他场景和资源验收继续 **Pending**。

回滚入口为备份目录中的 `python3 rollback.py`：仅恢复本次拥有的两个配置项/兼容备份和旧 CLI；检查新 CLI hash，保留后续不同配置编辑，不整体覆盖 kwinrc，不卸载组件。仓库回退对应 CLI 函数/调用和文档测试即可；不涉及 Native immutable 产物回滚。实机 stop 恢复未执行，恢复路径由 CLI 替代平台 I/O 测试覆盖；不冒充真实 stop/start 已验收。

## 2026-10-23 后续：配置事务、停止清理与测试成本

原修复提交 `95f69b0` 的常规视觉和启停路径已通过，但离线故障注入发现：应用第一项后读取第二项失败会留下部分配置；停止时圆角恢复失败会在布局卸载后阻止 Bridge 停用调用。本轮完善这些失败分支，并增加只读诊断。未修改 Native / JS runtime / renderer / FFI / CMake，也未改变圆角和动画参数。

- **完整事务准备**：读取并验证两项当前值、历史原值后，先保存全部缺失原值，再写配置。失败回滚到本次调用进入时的值，保留更早的原值所有权；重试失败不会把正在运行的兼容设置恢复成历史默认值。
- **有界重试记录**：新增一个 `RoundCornersPending=start|stop` 键。在配置、特效应用或元数据清理未完成时保留；后续 start/stop 可重试，成功后删除。它是一个固定配置项，不是 daemon、轮询或历史队列。
- **安全停止顺序**：parked-window ACK 和布局卸载失败仍先中止，Bridge 保留；布局与相关插件成功卸载后，圆角恢复失败不会跳过 Bridge 停用调用，最后以非零状态报告待恢复。全局 reconfigure 失败也继续这一清理阶段。没有在真实桌面注入这些故障或卸载组件。
- **重复 start**：两项值已正确、历史原值已保存且没有 pending 操作时，圆角部分零配置写入、零 reconfigure；冷启动保留显式同步，未完成操作也会重新应用。插件在启动后加载，可通过明确的 start 应用，未新增监听服务或轮询。
- **status**：只读显示加载状态、两项值、原值数量及 pending。`configured` 是文件配置状态，不声称取得第三方 shader 的实际运行状态或最终像素。
- **测试助手**：以临时目录内的 shell 平台替代命令代替每条命令启动 Node；仍逐次执行真实 CLI，保留原有缺省/显式值矩阵，并增加异常恢复和安全停止分支。助手、状态和故障注入均只用于测试，finally 清理，不进入安装产物。

| 检查 | 状态 | 本轮结果 |
| --- | --- | --- |
| 完整门禁 | PASS | `node tools/check.js`：120 个文件、262 个检查、fail=0，约 92.6 秒，见 [recovery-checks.log](rounded-corners-evidence/20261023/recovery-checks.log) |
| 补充异常分支 | PASS | 完整门禁后新增 pending 删除失败与回滚写入失败场景，最终单独运行全部圆角测试通过，约 9.4 秒，见 [recovery-focused.log](rounded-corners-evidence/20261023/recovery-focused.log) |
| 零写入重复 start / 只读 status | PASS | 平台命令日志检查：无圆角 kwriteconfig / reconfigure；status 同样无配置修改 |
| 事务、重试、用户编辑保留 | PASS | 全量读取前置、原值保存失败、两项写入失败、应用失败、回滚写入/重配失败、pending/backup 清理失败、后续 start/stop 恢复均覆盖 |
| 失败停止分支 | PASS | 圆角 read/write/query/reconfigure 失败后 layout 已卸载、Bridge 停用被调用；未确认 parked 恢复或布局卸载失败时不调用 Bridge 停用 |
| shell / whitespace | PASS | `bash -n cc-niri test/helpers/corners-platform.sh`、`git diff --check` |
| 实机热更新 / 连续 start / status | PASS | 下述热更新记录；不执行实机 stop 或故障注入 |
| Native / GPU / PSS / 帧时间 / 长测 | NOT MEASURED | 本轮不改这些路径，不重跑 Native 构建；前轮资源 INCONCLUSIVE 与未验收项保持原状态 |

旧完整门禁约 140.9 秒，其中圆角测试约 139.5 秒；本轮分别约 92.6 秒和 9.9 秒。最终补充用例后圆角测试单独运行约 9.4 秒。这些是实际运行记录，不是固定负载重复统计基准；整体门禁仍受其他 CLI 测试限制，不换算成生产 CPU、内存或动画收益。沙箱首次阻止带 timeout 的子进程启动（EPERM），后续在允许子进程的环境运行；未降低测试要求。

### 热更新与回滚

19:53:55（Asia/Shanghai）仅更新已安装 CLI。备份 `/home/cc/.local/state/cc-niri/backups/rounded-corners-recovery-20261023-195355`（0700）包含旧 CLI、更新前后状态和 `rollback.py`；脚本检查候选 hash 后只恢复旧 CLI，不改配置、不卸载组件。连续两次已加载分支 start 分别约 0.0861 / 0.0864 秒，随后 status 正确显示两项 false、saved preferences=2、pending=none。前后整个 kwinrc SHA256 相同，KWin PID 2119、Bridge PID 616754 不变，见 [recovery-deployment.json](rounded-corners-evidence/20261023/recovery-deployment.json)。此验证不替代真实故障恢复或实机 stop/start 验收；原双 half 视觉验收不外推到其他场景。
