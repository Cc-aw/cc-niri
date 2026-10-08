# Core UX P4 — 相邻工作区移动

日期：2026-10-07。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md) 的 P4 / §§15–23 实施。代码、自动门禁和本机部署通过；**用户随后反馈“实机验收通过”，P4 用户实机验收已通过**。部署时锁屏、未执行的自动实机采集保留为历史记录；该反馈不代表测过 FPS 或长期压力。P5–P8、延期分数列宽不包含在本阶段。

## 行为

| 动作 | 结果 |
| --- | --- |
| `Meta+Shift+J` | 当前受管列移到下一工作区，跟随并聚焦该列 |
| `Meta+Shift+K` | 当前受管列移到上一工作区，跟随并聚焦该列 |
| half / Full / Wide 偏好 | 保留 `widthMode`、`previousNonFullWidthMode`、`persistentWide`；目标以正常 pair 展示，不继承旧临时展示或动画 |
| 源工作区 | 快照聚焦右邻列，否则左邻列；允许变空，沿用 W8/W9 |
| 无效对象或目标 | 浮动 / 对话框 / transient / 副屏 / Sticky / 多桌面窗口、无活动受管列、忙碌事务、首尾边界均 no-op，不查找记忆中的列、不循环、不隐式创建工作区 |
| 已受管 Fullscreen 列 | 移动保留原生 Fullscreen；退出后恢复原列宽 |

目标列追加到目标既有顺序末尾，移动命令只请求脚本管理输出的工作区。主屏独立切换依赖现有 `cc-niri workspace primary` 设置；没有独立工作区的平台继续遵从 KDE 的全局桌面 authority。

## 架构与生命周期

新增 `WorkspaceMoveController` 管理命令意图。`WorkspaceSwitchController.requestTo` 复用现有切换 barrier 和 400ms 超时：先取消现有视觉 / 滚动事务，再由 `ScrollPlanCommitGate.whenIdle` 等待 Native Scroll disarm 回调，最后重新按 UUID / Workspace ID 解析对象，检查实际活动窗口与 membership，修改 KDE 的原生桌面属性。复用幂等 `WorkspaceTransferController` 处理同步、异步与重复 membership 通知；不直接搬运 live Column / QObject 到目标快照。

源布局重新计算并捕获快照。目标快照保存列偏好、焦点 UUID 和可见锚点；`WorkspaceMountController` 挂载时将显式移动焦点应用到布局，再调用已有 geometry / motion activation gate。普通 J/K 保留原生焦点选择规则。整个命令复用既有工作区动画，不添加移动专用动画、时钟或 Rust / C++ policy。

等待回调期间仅保存 UUID、源 / 目标 Workspace ID 和输出名称；关闭、目标删除、焦点变化、Native 桌面变化、停止与超时均使迟到回调失效。对象所有权异常和 membership setter 异常复用全局恢复。Native 跟随请求失败或没有信号时，按实际 KDE 桌面挂载，已经成功修改的窗口 membership 保持实际值，不伪造跟随成功、不逆写原生 authority。

结束后请求现有 DynamicWorkspaceController / WorkspaceRecycleController。原生 ID、当前输出与副屏保护、动画期间回收屏障均沿用既有规则。Focus Ring 继续由 Native 实际焦点决定唯一 owner，不在快照中保存 Ring 状态。

## 自动验证

`node tools/build.js` 生成生产布局包；`node tools/check.js --native` 全部通过：

- 94 个 JS 测试文件，含新 `workspace-move-runtime.test.js`，直接加载生成的生产包。
- 固定 Rust 1.99.0 的 fmt / clippy `-D warnings` / `cargo test --locked --workspace`，30 单测通过。
- GNU GCC 16.x 的既有构建树：Bridge 16、Clip 15、Ring 22 CTest，含 Golden differential；3 个隔离 D-Bus 测试通过。
- Plasmoid 构建、Rust 生产符号边界、生成包一致性和 `git diff --check` 通过。

P4 新回归覆盖首 / 中 / 末列的 half / Full 往返、右 / 左源焦点、目标既有顺序、Wide 前后 ACK、旧 Full 邻窗 parking、真实活动列与待激活 H/L 目标不同、Scroll / Native / Cancel ACK 延迟及迟到回调、同步与重复 membership 通知、Fullscreen 退出、setter 失败恢复、对象关闭 / 目标删除 / Native 切换 / 停止 / 超时、跟随失败、逐次发布唯一 UUID owner，以及 W8 新尾部创建 / W9 空源回收。

没有修改 Rust Core、FFI、CMake 或 frozen C++ oracle；未重新执行本轮不适用的独立 Core Debug / Release / umbrella / 编译器拒绝路径。它们在此前已验收 Full 动画阶段通过，不能当成本次独立执行记录。

门禁日志：`/tmp/cc-niri-core-ux-p4-native-gate.log`。

## 部署、实机与性能

使用既有 `--save-current-state` → `cc-niri stop` → `kpackagetool6 --type=KWin/Script --upgrade package` → `cc-niri start` 路径仅升级布局包。Meta+Shift+J/K 已注册，布局安装哈希与源码生成包一致。Native / Effect / CLI / Bridge / Plasmoid 字节、KWin PID 2050、主副屏输出、独立工作区设置、边距、300ms PresentationDuration / 420ms WorkspaceMotion 均保持。日志：`/tmp/cc-niri-core-ux-p4-deploy.log`；审计与部署后快照保存在下述备份目录。

会话锁屏，未注入移动快捷键、改动原生窗口桌面归属或声称真实 Ring / 焦点通过。解锁后需检查 half 和 Full 的 Meta+Shift+J/K 往返、动画中移动、源工作区返回、Wide 偏好、主副屏独立性和重启；再按设计 §§60–61 验证移入尾部自动新增空工作区与空源回收。用户视觉反馈、长期日常 smoke 仍待验收。

后续用户反馈“实机验收通过 进入下一阶段”：P4 用户实机验收通过，进入 P5。上段描述首次部署时的检查限制，不再表示 P4 等待用户验收；未提供独立 FPS / GPU 或长期压力测量。

仅在移动命令与既有异步 ACK 回调执行时枚举活窗口，未新增每帧任务、JSON、时钟或 Native 分配。未测 FPS / GPU / 长期延迟；自动测试与部署状态核验不能证明动画性能。

## 回滚

部署前已验收 half / Full 动画基线备份：`/tmp/cc-niri-redeploy-20261007-5chqvmpg`，含安装包、当前持久布局、KDE 配置和原 Native immutable 链接。P4 未重装 Native，回滚脚本仅恢复部署前布局包及持久布局，保留 KDE 用户设置和已验收 Native / Full 动画：

```sh
python3 /tmp/cc-niri-redeploy-20261007-5chqvmpg/rollback-p4.py
```

回滚不逆改用户随后自行移动的原生窗口 membership；快照恢复仍以 KDE 实际窗口归属为准。开发回退限于 P4 新控制器 / 快捷键 / Switch / Mount / Gate 接口与 glue，不撤销此前已验收的 half / Full 动画和分数列宽延期改动。
