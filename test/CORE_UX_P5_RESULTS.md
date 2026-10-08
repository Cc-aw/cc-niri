# Core UX P5 — 数字键直达工作区

日期：2026-10-07。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md) 的 P5 / §§24–26 实施。P4 已由用户确认“实机验收通过”。P5 代码、完整门禁、部署及自动实机状态核验通过；用户视觉验收仍待反馈。P6 直接移动、P7 Dockless、P8 Bridge 清理和延期分数列宽未包含。

## 行为与实现

`Meta+1…9` → `CCScrollWorkspace1…9`，直达当前 KDE 顺序中第 1…9 个已存在工作区。当前目标、无效数字、缺失目标、正在切换 / 挂载、停止 / 禁用或没有管理输出时 no-op。没有活动受管列也可导航；不循环、不由数字键创建工作区、不改变任何窗口的 KDE membership。

`VirtualDesktopTopology.byNumber` 在命令发生时按一基编号查询当前顺序，不缓存 number → ID。`WorkspaceSwitchController.focusNumber` 复用现有 `requestTo`、切换 barrier、400ms 超时、Native 实际桌面挂载、快照与恢复；进入事务后仍以已解析的稳定 Workspace ID 为准。ShortcutCatalog 为九个数字分别绑定闭包，入口 glue 只转发命令。普通 J/K 与 P4 的移动 API 保留。

目标焦点继续遵从 KWin 实际活动窗口；Full / Wide、列顺序、锚点和宽度恢复记忆沿用既有 mount 与 persistence。Focus Ring 仍由 Native 实际焦点决定 owner。仅新增启动时注册的快捷键与命令时的顺序查询；没有新动画、时钟、布局 / focus authority 或每帧工作。

## 自动门禁

`node tools/build.js` 与 `node tools/check.js --native` 全部通过：

- 95 个 JS 测试文件；新增 `workspace-direct-runtime.test.js` 直接加载生成的生产包。
- Rust 1.99.0 的 fmt / clippy `-D warnings` / locked workspace tests，30 单测通过。
- 既有 GNU GCC 16.x 构建树：Bridge 16、Clip 15、Ring 22 CTest，含 Golden differential；3 个隔离 D-Bus 测试通过。
- Plasmoid、Rust 生产符号边界、生成包一致性与 patch whitespace 检查通过。

新增回归覆盖所有九个独立处理器、跨多个工作区进入空目标、一代切换提交、已有目标 / 无效输入 no-op、无活动列导航、停止 / 禁用 / 挂载保护、创建 / 删除 / 重排后编号更新、事务中编号位移但目标 ID 不变、Full / Wide 往返、Scroll / Native / Width 迟到 ACK、重叠的直达 / J/K / P4 命令、目标删除、Native 请求拒绝 / 超时与停止恢复。每次发布检查唯一 UUID owner 和根 columns / 活动快照一致。

本次没有修改 Native、CMake、FFI、Rust 依赖或 frozen oracle；未重新执行独立 Core Debug / Release、umbrella 或编译器拒绝路径。此前 Full 动画阶段的结果保留为历史。门禁日志：`/tmp/cc-niri-core-ux-p5-native-gate.log`。

## 部署与实机核验

备份 `/tmp/cc-niri-redeploy-20261007-290skrao` 保留已验收 P4 包、持久布局、KDE 配置与 Native immutable 链接。通过 KGlobalAccel 查询证实本机 Meta+1…9 的当前键与默认键均属于 Plasma `activate task manager entry 1…9`，没有自定义差异；只释放这九个默认绑定，再按既有 save-state / stop / KPackage upgrade / start 路径部署布局包。

九个数字键的实时 owner 全部核对为 CC-Niri，绑定也写入持久配置。仓库 registerShortcut 继续尊重用户已有自定义绑定，不在每次启动时抢占其他应用动作。布局安装哈希与生成源码一致；Native / Effect / Bridge / CLI / Plasmoid 安装字节、KWin PID 2050、输出、主屏独立模式、边距与 300ms PresentationDuration / 420ms WorkspaceMotion 保持。

UTC 11:52:06–11:52:27 解锁实机自动核验通过：

- 第 3 → 第 1 → 第 3 工作区直达，跳过中间工作区；第 2 工作区 Full 的实际安全区域 frame 与 Ring owner 正确。
- 第 4 个既有空工作区可进入且无 Ring；再按当前数字或缺失的 5…9，Bridge generation 与原生拓扑不变。
- 快速数字切换、H/L 滚动中直达、Wide 离场 / 返回与重启；Wide 的真实返回 frame 与离场前一致。
- 每次读取 KWin 原生桌面和窗口属性：只有 DP-1 的当前工作区变化，副屏当前桌面、窗口 frame / membership / minimized 保持；没有窗口转移或新工作区创建。
- 测试后恢复原工作区、实际焦点、列顺序与全部保存宽度 / Wide 偏好；输出、Native 产物、原设置和 KWin PID 保持；测试时段无 `INVARIANT_FAIL`、`FAIL_SAFE`、JS 类型错误、completion timeout 或 Rust panic。

首轮实机脚本误把持久快照的 Wide 表示限定为内部 `wide-focus`；现有 WorkspaceSnapshotStore 会归一为 `wide`。已更正测试并增加前后真实 frame / owner 一致性检查，重跑通过；没有因此修改生产代码。首次失败记录保留在备份目录的 `p5-first-live-attempt.log`。

用户随后报告“怎么闪退了 现在继续”。检查时 KWin PID 仍为 2050，CC-Niri / Bridge / 两个 Native 插件与 Plasma 正常；近期用户日志没有匹配的崩溃 / 脚本错误，`coredumpctl` 近 30 分钟未找到崩溃记录。实机核验期间按计划执行过 `cc-niri restart` 与恢复，尚不能据这些证据确定用户所指的应用退出原因。

日志 `/tmp/cc-niri-core-ux-p5-{deploy,live}.log`；绑定、原生 desktop / frame / Ring / Bridge 样本、成功记录与测试后恢复快照在备份目录。用户视觉验收与长期日常 smoke 待反馈；未测 FPS / GPU / 长期延迟，也没有声称自动状态核验覆盖了人工动画观感。

## 回滚

只恢复部署前 P4 布局包、持久布局及这九组数字快捷键，保留已验收 Full 动画和 Native 产物；KDE 其他设置保持：

```sh
python3 /tmp/cc-niri-redeploy-20261007-290skrao/rollback-p5.py
```

源码回退限定为 P5 的 `byNumber` / `focusNumber`、九个 catalog 动作、入口 glue 与对应回归，然后重新生成并安装布局包。不撤销 P4、half / Full 动画或用户已要求的分数列宽延期。
