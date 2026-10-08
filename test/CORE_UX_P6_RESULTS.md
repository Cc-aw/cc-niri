# Core UX P6 — 数字键直接移动列

日期：2026-10-08。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md) 的 P6 / §27 实施。此前 Full 邻窗外推副屏短闪已由用户确认修复。P7 Dockless、P8 Bridge 清理与延期分数列宽保留后续范围。

## 行为与实现

`Meta+Ctrl+1…9` → `CCScrollMoveColumnWorkspace1…9`，将主屏实际活动的受管列移动到当前 KDE 顺序中第 1…9 个已存在工作区，并跟随、聚焦。当前 / 缺失目标或非法编号 no-op；浮动、对话框、瞬态、副屏、sticky / 多桌面窗口、没有活动列、停止 / 禁用及工作区事务进行中不操作。

`WorkspaceMoveController.moveNumber` 复用 P5 的 `VirtualDesktopTopology.byNumber`，随后进入 P4 的 `moveTo` 事务。每次命令重新读取编号，进入事务后保存 UUID 与稳定 source / target ID。目标新增、回收或重排影响后续命令；在途目标编号变化不改投，目标删除、窗口关闭 / 实际焦点变化及停止 / 超时均由原 barrier 处理。

沿用原 Native scroll disarm ACK、membership transfer、source successor、mount / focus、400ms 超时、StabilitySupervisor、Full / half / 恢复宽度和 Wide 偏好、动态尾工作区与回收。目标列追加到已有顺序末尾，临时展示结束；受管 Fullscreen 的原生状态保留。JS 仍负责命令与布局 authority，没有新增 Native policy、协议、FFI、动画曲线或时钟。

## 自动门禁

`node tools/build.js` 与 `node tools/check.js --native` 全部通过：

- 97 个 JS 测试文件，新增 `workspace-direct-move-runtime.test.js` 直接执行生成的生产布局包，P4 / P5 回归继续通过。
- Rust 1.99.0 fmt、locked clippy `-D warnings`、locked workspace tests，31 单测通过。
- 既有 GNU GCC 16.x 构建树：Bridge 16、Clip 15、Ring 22 CTest，含 Golden differential；3 个隔离 D-Bus 测试通过。
- Plasmoid、生产 Rust 边界、生成包一致性及 patch whitespace 检查通过。

新增覆盖 first / middle / last × half / Full × occupied / empty、独立九键、同目标 / 缺失 / 无效编号、主屏实际窗口资格、唯一 UUID owner、单代提交、宽度 / Wide 偏好、源右邻 / 左邻焦点、动态编号更新、在途 ID 固定、连续数字 / 相对移动 / 导航互斥、迟到 ACK、目标删除 / 关闭 / 焦点变化 / 超时 / stop 和动态创建 / 回收后的新编号。

本轮生产改动仅 JS 快捷键、数字目标查询与入口转发。没有 Native / CMake / FFI 改动；未重跑独立 Core Debug / Release、umbrella 或 configure 编译器拒绝路径。完整门禁包含现有 CTest toolchain policy 与差分。只在命令发生时增加一次拓扑查询，不增加每帧工作；未测 FPS / GPU 或长期性能。

## 部署与验收

备份 `/tmp/cc-niri-redeploy-20261007-lccfe21b`。部署前逐个查询 Meta+Ctrl+1…9，均未被其他动作占用，没有释放或重分配任何已有快捷键。通过既有 save-state / stop / KPackage upgrade / start 路径更新布局包；安装哈希与生成源码相同，九个 KGlobalAccel 实时 owner 均属于对应 CC-Niri 动作。脚本继续尊重已有用户快捷键。

部署后核验 Native / Effect / Bridge / CLI / Plasmoid 安装字节、Rust 后端、KWin PID 2050、输出、主屏独立模式、边距与既有 420ms 工作区动画保持。部署日志 `/tmp/cc-niri-core-ux-p6-deploy.log`，绑定前后、配置与部署快照在备份目录。

UTC 06:53:19–06:53:45，解锁会话的自动实机状态核验通过：

- 当前或缺失数字目标不改变 Bridge generation；第 2 → 第 1 → 第 2 工作区的 half / Full 移动均只有一个 UUID owner，实际 KDE membership、焦点、Ring 和真实 frame 正确。
- Wide 离场后的展示恢复 normal / pair，偏好保持；H/L 后直接移动与返回、Full 移动后重启 / 返回通过。
- 每次读取 KWin 原生工作区 / 窗口属性，只有 DP-1 的当前工作区变化；副屏工作区、窗口 frame / membership / minimized 保持，其他窗口 membership 保持。
- 测试后原生拓扑、全部窗口归属、原顺序 / 宽度 / Wide 偏好、主屏记忆焦点与实际全局焦点恢复。Native 产物、输出、KWin PID、边距与原动画设置保持；测试时段没有 JS 类型错误、`INVARIANT_FAIL`、`FAIL_SAFE`、completion timeout 或 Rust panic。

实机证据在备份目录的 `p6-live/`，日志 `/tmp/cc-niri-core-ux-p6-live.log`。测试限定保留源 / 目标非空，以保护用户原生工作区 ID；空目标、非相邻直接移动、动态创建 / 回收、拓扑重排与全部九个编号由生成包回归覆盖。本轮没有实机创建 / 删除桌面，也没有替代用户的键盘动画观感验收。用户视觉验收与长期日常 smoke 待反馈；未测 FPS / GPU。

## 回滚

恢复 P6 部署前布局包与这九组快捷键，保留当前持久布局、其他快捷键、Native 产物及 KDE 设置：

```sh
python3 /tmp/cc-niri-redeploy-20261007-lccfe21b/rollback-p6.py
```

源码回退仅移除 `moveNumber`、九个直接移动 catalog 动作、入口转发与对应回归，再生成并部署布局包；保留已验收 P1–P5、half / Full 动画与分数列宽延期。
