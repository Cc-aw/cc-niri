# Focus Ring 静态样式调整

日期：2026-10-04。已部署，调整后的静态样式人工验收通过。

用户初次反馈边框圆角不一致、2px 不明显，随后明确纠正：边框只留在当前窗口。当前 owner 选择正常，不将最初描述记录为多窗口残留故障；圆角纹理缓存仅曾作为排查假设，未确认。

## 修改

- 默认线宽从 2 改为 4 logical px，颜色仍为 #7FC8FF，外侧描边，不更改窗口 frame / 列布局 / 输入。
- FocusRingItem 接受四角 BorderRadius，同 owner 改样式复用节点，square / rounded 切换更新 outline，无孤立节点。
- Effect 在 load / reconfigure 读取配置；已加载的 Rounded Corners 的 active `[Round-Corners] Size` 作为兼容半径，当前本机为 12。未加载该效果时使用 windowContainer 声明的原生 radius。静态 POC 未复制第三方插件的每应用排除、squircle 或动画规则。
- 可在 `[Effect-cc-niri-focus-ring] CornerRadius` 明确指定非负半径；缺省 -1 为自动，随后对效果调用 reconfigureEffect，或 off / on。0 明确使用直角。
- 半径检查非负、有限值与窗口尺寸；对外部配置夹到最大 128 及半窗尺寸，避免非法几何。
- 原有 Rounded Corners 插件与配置继续使用；本轮未修改其配置。

## 检查与部署

- Focus Ring 三项原生 CTest 通过；场景测试验证 932×960 窗口外扩到 (-4,-4,940,968)、4px 厚度和 12px inner radius、四个 corner quad、同 owner 样式切换、40 次两 owner 往返只有当前窗口有子项、负 / 非有限半径拒绝、无 frameGeometry 变化。
- 本轮仅修改原生样式路径，未重新运行上一轮已通过的 82 项 JS 回归；相邻安装 / 启停代码未再修改。
- immutable canonical：`/home/cc/.local/lib/cc-niri/focus-ring/b122ee325e6324c182d2f3ff49272a5c818906ffae79ea0424b9aa52ba6de294/cc-niri-focus-ring.so`。
- 加载瞬间 owner 为空，焦点返回后诊断确认 active=true、width=4、cornerRadius=12、targetOutput=eDP-1。
- KWin PID 仍为 2088，布局 / Spring / Bridge 正常，Rounded Corners 持续加载。
- 回退备份：`/tmp/cc-niri-focus-ring-style-backup-20261004-f9pcj25t`，保存旧 canonical 路径、kwinrc、deployment.json、result.json、status-after-focus.json 与 kwin.log。
- 构建与测试日志：`/tmp/cc-niri-focus-ring-style-final-build.log`。

用户已确认：“粗细合适，圆角都正常”。随后发现 Typora 跨应用颜色不一致，已改为[独立边框绘制](FOCUS_RING_COLOR_RESULTS.md)，新路径颜色验收进行中。4px 线宽与当前圆角样式的静态人工验收通过；全屏、关闭、卸载及动画矩阵仍按阶段实机验收。
