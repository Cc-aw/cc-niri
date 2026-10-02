# ViewOffset Spring Phase 4：原生 incoming 投影

日期：2026-10-02（Asia/Shanghai）。基线：`b3aec81`；分支 `codex/native-view-offset-scroll`。

## 实现与模块边界

- `ScrollViewportRuntime` 接管所有 newPlacement=visible 的 entries，即 continuing
  与 incoming。按 UUID 保存 target rect 与 role；两类窗口使用同一帧 offset / translation。
  incoming 不使用 parking X 作为视觉起点，绘制位置始终来自 logical strip。
- 右侧进屏首帧从 viewport.right + gap 开始；反向进屏首帧的右边界在
  viewport.left - gap；projection 的 target-geometry 检查阻止 parking frame 被误投影。
- 无 continuing 的非重叠跳跃也允许原生 incoming。outgoing 仍不进入 native target map。
- Native role 1005 增加 incoming/continuing 标识；清理、取消、workspace/session barrier、
  settle、窗口关闭/删除继续复用已有 runtime 生命周期，role 与 target 一起清除。
- `ScrollPlanCommitGate` 只有 native Arm ACK 成功才在提交 context 中置 nativeScroll=true。
  拒绝、异常和超时的提交明确为 false，不将 native 显示顺序套到 fallback。
- `GeometryCommitter` 对已确认的隐藏 incoming 先恢复原 opacity / 解除脚本 minimize，
  再提交目标几何；fallback 与 Wide 保留原提交顺序。焦点仍在提交后激活。
- Scripted Effect 在 ownership 安装及匹配 incoming 的几何事件中取消旧 motion，
  释放旧 minimize/unminimize grab 和 Wide isolation；不播放 incoming 的
  Translation / Scale / Opacity。continuing 继续建立 transaction 供旧 outgoing 使用。
- 不匹配 target 的旧 marker 不抑制 Script fallback。关闭和结构替换的非 SCROLL incoming
  继续使用原路径，避免把 ordinary H/L 接管扩展到其他动画。

## 验证

`node tools/check.js --native` 完整通过：

- 76 项 JS 测试。新增生产 GeometryCommitter + ParkingManager 测试验证 native reveal
  顺序、fallback 的 hidden commit 顺序以及用户原 opacity 保留。
- Scripted Effect 生产分支测试验证 matching native incoming 不启动旧动画，
  outgoing transaction 保留、错误 target 回退；gate 测试验证 ACK 成功/超时的提交标识。
- Bridge 5 项 CTest、3 项隔离 D-Bus 集成通过。
- Native 4 项 CTest。生产 ScrollViewportRuntime 的测试扩展到 incoming 角色、
  首帧双向 strip 起点、停车几何排除、非重叠跳跃、关闭 continuing 后 incoming 保持、
  取消清理，以及 0/7/20/60/100/220/400 ms 帧采样的双向固定间距。
- Bridge、Viewport Clip、Plasmoid 全部构建成功，bundle 与 whitespace 校验通过。

日志：`/tmp/cc-niri-spring-phase4-check.log`、`/tmp/cc-niri-spring-phase4-native.log`。

## 部署与验收状态

本阶段未安装、未重新启用新 bundle / .so，日用会话仍是已验收的 Phase 3。
测试证明 continuing/incoming 共享投影的数学间距固定；不能代替真实 KWin 绘制验收。
Phase 3 用户报告的“窗口之间拉开缝隙”需在部署后复验，不能现在宣称整体视觉问题已消除。

outgoing 仍使用旧动画、实际 parking/minimize 提交路径；Phase 5 将实现 pendingPark，
让 outgoing 跟随共享 Spring 完整滑出，再在完成后提交 parking/hide。
之后才继续验证完整 H/L 固定间距、连续按键与 reverse。
