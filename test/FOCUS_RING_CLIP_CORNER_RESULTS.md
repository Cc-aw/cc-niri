# Focus Ring：滚动四侧描边与启动圆角修复

日期：2026-10-05。上下描边与圆角版本已部署；用户随后报告最左 / 最右窗口外侧描边仍延迟出现。四方向裁剪余量版本已部署，用户于本轮确认“现在正常”，本次主屏描边修复实机验收通过；修复与验证见本文末尾。

## 问题与原因

用户补充：屏幕外窗口滚入时，左右描边先出现，上下描边和窗口阴影一起在稍后出现。用户已自行关闭阴影。

- BorderOutline 的 3px 描边位于 frame 外。旧 Native Clip 将整个绘制区域限制为内容 viewport；例如窗口与 viewport 的 y 范围均为 50–1010，描边却需要 47–50 与 1010–1013。滚动期间这两条带被裁掉，原生 motion 结束、裁剪释放后才出现。这是绘制范围问题，不是等待一秒后才创建边框。
- 原生圆角 shader 不向 WindowItem 发布自己的半径。旧 Ring 仅在构造 / reconfigure 时检查该效果是否已经加载；启动加载顺序让它缓存为 0，随后插件加载没有更新。现场 Size=12、圆角插件已加载，但 cornerRadius=0。

## 实现边界

- 新增 `native/common/ViewportPaintClip.h`：scene decoration 通过轻量的 Item property 预约自身四方向描边余量，Native Clip 的 Spring 和旧 motion 分支共同使用这套裁剪算法。
- Ring 预约自身实际线宽 3px。转为设备像素时向外取整，避免分数缩放丢掉描边最外侧的一行或一列；四方向均只扩展描边所需空间。最终仍与传入 deviceRegion 求交，不能扩大原始 damage、屏幕范围或被上层窗口遮挡的区域。
- 预约随 Ring 的 attach / owner change / clear / unload 维护；旧 property 值恢复，其他写入者替换的值不被清除，源 Item 销毁由 QPointer 保护。没有新增 JS 逻辑、KWin data role、DBus 动画消息或 Spring 时钟。
- 余量作用于这个窗口的绘制区域，允许至多描边宽度的外侧像素；不额外开放完整阴影范围。没有修改用户的阴影配置。
- 新增独立 `FocusRingCornerStyle`，缓存显式 override、Round-Corners 配置与 native per-corner fallback，处理配置通知与显式 reconfigure。
- 当前 KWin SDK 没有公开的效果加载变化信号（`effectsChanged()` 是 protected 普通方法）。Ring 在已有 `prePaintScreen` 回调检查圆角插件是否存在，仅存在状态变化时重新读取配置；没有独立 timer、每帧配置读取或 DBus 轮询。
- 仍沿用当前窗口唯一 owner、3px、#7FC8FF 和同帧视觉变换。没有修改 frameGeometry、列布局、工作区或宽度偏好。新增只读 cornerSource 与 paintClip 诊断用于核实实际加载的新插件。

## 自动验证

- 新回归在修复前失败：`FAIL incoming top and bottom strokes survive first scrolling paint`，复现无阴影窗口上下描边不可见。
- `focus-ring-viewport-decoration-clip` 检查生产 Ring 的余量预约，首次滚入时上下两条描边带、左右视口裁剪、小 damage、遮挡、空 region、关闭清理及跨 owner / 销毁安全。设备 scale 为 1 / 1.25 / 1.5 / 2，并检查向外取整后的最外侧描边行。
- 扩展原有真实生产 Spring 组合测试的 144 个样本：使用生产裁剪 helper，并直接检查所有可见样本的上下描边带；原测试仅检查边框整体 bounds 相交，左右描边存在时会掩盖这个问题。
- `focus-ring-corner-style-lifecycle` 检查 Ring 先加载 / 圆角效果后加载、卸载与重新加载、当前配置、显式 0 / 非零 override、原生各角 fallback、小窗口与异常参数。反复获取圆角不产生刷新工作。
- `node tools/check.js`：85 个 JS 测试、生成包一致性及 whitespace 通过。原 Native Clip wiring 检查随共享 helper 更新，行为回归由实际原生测试验证。
- Ring 构建及全部 8 项 CTest、Native Clip 构建及全部 4 项 CTest 通过。没有把上述无 GL 参数验证当作实机像素验收。

日志：`/tmp/cc-niri-ring-fix/`。

## 部署与主屏验收

- Ring canonical：`~/.local/lib/cc-niri/focus-ring/7874eef7711ee3d80c06d054af214cdfb9e0130466b3168922305cad27a4ce59/cc-niri-focus-ring.so`。
- Clip canonical：`~/.local/lib/cc-niri/viewport-clip/ab264b523405442d5b3d993136000ba6b21b241068ffe8c21c37b113f7c1436f/cc-niri-viewport-clip.so`。
- 两个库采用现有 immutable 安装器配套安装并热重载；没有替换映射中的库。旧 canonical 保留；最终备份为 `/tmp/cc-niri-ring-fix-backup-20261005-rk9o0b0o`，审计见 `before.json` / `after.json`。
- 首轮部署校验因 KWin `/proc/PID/maps` 不可读触发自动回滚，KWin 与旧版本仍健康运行。随后改用插件自身只读诊断核实运行中的新代码：Ring 返回新增 cornerSource，Clip 返回新增 paintClip=viewport-with-decoration-padding。
- 配套加载后 active=true、width=3、cornerRadius=12、cornerSource=round-corners、eligibleCount=5。布局、动画脚本和 CLI 安装 hash 前后相同，Bridge 与布局仍运行。
- 部署与自动生命周期检查前后 KWin PID 均为 2057。圆角插件在 Ring 已加载、当前窗口有边框时短暂卸载，边框自动回落到窗口原生半径 4 / native-item；重新加载后自动恢复半径 12 / round-corners，未重载 Ring。原圆角插件恢复加载，没有修改用户的阴影配置。诊断日志 `/tmp/cc-niri-ring-fix/corner-live.json`。
- 首轮人工反馈发现最左 / 最右窗口外侧描边仍延迟出现，因此继续实施下述四方向补充修复。这一中间版本不作为最终验收版本。


## 最左 / 最右外侧描边补充修复

- 用户反馈说明上一版仅放宽 y 裁剪仍不足：贴住最左 viewport 边界的左描边、最右边界的右描边，同样位于内容范围外，仍等 motion 结束才出现。
- 共享 helper 现为四方向描边余量，实际布局 viewport 与窗口几何均不变。窗口没有 Ring 时仍为原始严格裁剪，有 Ring 时也只放宽 3px 逻辑线宽的向外像素取整余量。
- 修改前，两项实际原生回归均失败：`leftmost left stroke and rightmost right stroke survive scrolling paint`、`right stroke remains visible when the active window reaches the right viewport edge`。
- 回归扩展到四个外侧描边带 / 最外行列、四方向余量之外的裁剪、无 Ring 窗口、侧面遮挡和全部 144 个 Spring 样本的左右边界。完全停放的 incoming 首帧与 outgoing 完成帧仍不可见。
- 本次只需更新 Native Clip；现场 Ring 已使用相同的 3px scene 预约接口，圆角实现保留。只读 paintClip 标记更新为 `viewport-with-decoration-outsets`，以区别先前仅上下余量的版本。
- 修复后 Ring 8 项 CTest、Clip 4 项 CTest 均通过，Native Clip 的 JS 接口检查与 diff whitespace 通过。完全屏幕外窗口的断言仍通过。
- 仅热重载 Clip，新 canonical：`~/.local/lib/cc-niri/viewport-clip/de0a0969393e55817eac262342b145c15b5cdcabf0ba6891c138c635eddd1406/cc-niri-viewport-clip.so`。备份 `/tmp/cc-niri-ring-sides-backup-20261005-ttl4xkd8`。
- 运行中 GetScrollMotionStatus 已返回新 paintClip 标记；KWin PID 仍为 2057。Ring 原生库、布局、动画和 CLI 安装 hash 均未改变，Bridge 与布局保持运行。
- 新一轮人工验收检查最左 / 最右窗口外侧描边即时显示，并复查上下描边和圆角；用户确认“现在正常”，本次主屏修复验收通过。日志 `/tmp/cc-niri-ring-sides/`。
- 本轮确认针对四侧描边与圆角修复；快速连续 retarget 属于下一阶段。滚动中 J/K、独立 off/on 已在此前 Phase 3 验收通过，本轮不新增未经复测的人工结论。
