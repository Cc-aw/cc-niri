# ViewOffset Spring Phase 6：普通 SCROLL 旧动画退出

日期：2026-10-04。实现和自动检查完成；现已与第六至第八阶段配套部署，[自动实机检查](VIEWOFFSET_SPRING_PHASE8_LIVE_RESULTS.md)通过，本轮内屏人工验收通过（快速 H/L、滚动中 J/K 与 Wide 状态保持）。

## 改动

此前 continuing 虽跳过 Script animation，仍先 arm 旧 MotionTransaction，供过渡阶段 incoming / outgoing 识别方向。第四、第五阶段已覆盖三类窗口，这一旧事务不再需要。

- 新增独立 `src/effect/NativeScrollOwnership.js`，统一判断原生接管的 continuing / incoming / outgoing-finalize。判断在 Wide 分类和旧 SCROLL transaction 创建之前完成。
- native 新增专用 role 1006：只有 native Scroll Arm 端点成功注册时才广告 capability；新增窗口也设置，卸载时清除。role 1002 继续只表示 clip 能力。
- role 1005 现在包含 protocol=2、type=SCROLL、sessionId、workspaceId、targetOutput、epoch 和窗口 role / rect。capability、类型、上下文字段和对应真实位置必须有效才跳过旧路径。
- 接管成功清理旧事务、pendingWideExit、该窗口 Script motion、parking grab 和 Wide isolation。原生普通滚动不调用 Script Translation / Scale / Opacity，不创建旧滚动事务。
- capability 消失、未安装计划 ownership、标记错误或目标位置不匹配时走旧 fallback。仅有 native clip capability 不跳过旧路径。Wide 尺寸变化继续原有 Script 路径。

## 验证

- `node tools/check.js --native`：80 个 JS 测试文件通过；Bridge 5 项 CTest、3 项隔离 D-Bus 检查、Viewport Clip 4 项 CTest，以及 Bridge / Native / Plasmoid 构建通过。
- 最后补充整批 transaction 调用观测后，`node tools/check.js`：80 项再次通过。
- 生产 Effect 类测试直接调用三类几何事件：旧 MotionController 启动次数和旧 transaction arm / begin 次数均为零；native 标记缺失时恢复 transaction 与旧动画。
- 独立 ownership 判断测试覆盖 clip-only、capability 丢失、错误 frame、Wide resize、错误 protocol/type/output/role、无效 epoch/rect、空 session/workspace 和非当前桌面。
- JS / C++ role 契约检查覆盖 1001–1006，修正旧正则的标识符边界，避免把 clip capability 误匹配为 scroll capability。
- 现有 Wide、工作区清理、延迟停放、回退和原生逐帧固定间距测试保持通过。

日志：`/tmp/cc-niri-spring-phase6-check.log`、`/tmp/cc-niri-spring-phase6-js-check.log`。

## 部署与后续

本阶段需要配套升级 Script Effect 与 native effect，再做内屏 H/L、J/K 清理和 Wide 回归验收。
旧 native 不具有 role 1006，因此仅升级 Script Effect 会保留旧 fallback，不能作为第六阶段原生接管的验收结果。

后续 Phase 7 连续 retarget 和 Phase 8 中途反向均已实现，并完成本轮主屏验收。Mixed DPI / 双屏 Phase 9 按主屏需求暂缓。
