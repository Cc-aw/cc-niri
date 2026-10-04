# Focus Ring 跨应用颜色一致性修复

日期：2026-10-04。状态：实现、自动检查、部署完成；用户已确认跨应用颜色、圆角、全屏与独立开关正常；静态实机验收通过。

## 触发与依据

用户反馈某些窗口的边框浅蓝，Typora 等窗口变成深蓝。源码固定 QColor(#7FC8FF)，不按应用分配颜色。

旧 POC 把有颜色的 OutlinedBorderItem 放在 WindowItem 内，因而随窗口一起被 Rounded Corners 的 OffscreenEffect 捕获。已安装的 `/usr/share/kwin/shaders/shapecorners_core.frag` 将 frame 外区域归入 shadow，并按不同 shadow 参数重新处理；其颜色空间转换同样作用于捕获的边框。根据这条源码链推断，边框不应参与应用的阴影 / 圆角纹理处理。尚未以屏幕像素测量确认某一具体 shader 分支产生了 Typora 的色差。

本机 Rounded Corners primary / secondary outline 的 active / inactive thickness 配置都是 0；此次不修改其配置。

## 实现

- FocusRingItem 保留 WindowItem 内一个不绘制的 Item，用于外扩 4px 的 scene bounds / damage；窗口缓存里没有新的蓝色 quad。
- 独立根 Item 和其 OutlinedBorderItem 构成只有边框的绘制树，材质固定 #7FC8FF、sRGB。不含应用 surface、decoration 或 shadow，不创建纹理、overlay 窗口或输入区域。
- native FocusRingEffect 的 paintWindow 位于 96，接续 viewport clip 95；先调用下游完成窗口绘制，再调用 KWin ItemRenderer 单独绘制边框，然后由 KWin 绘制更高窗口，保留遮挡关系。
- 圆角 / 外侧 stroke 继续使用 KWin 自带 Border shader，保留已验收的 4px 与本机 12px 样式。
- 原生 WindowPaintData 的变换、淡出 opacity 和 deviceRegion 直接传递；边框 brightness / saturation 固定为 1，应用数据本身不改动。颜色只按边框 sRGB 到实际 render target 转换，不经过应用颜色 / 阴影 shader。
- 无新增 timer、animation clock、DBus 每帧传输或 full-screen repaint。独立绘制树随 owner clear / parent destruction / unload 释放。
- 诊断新增 renderer=post-window-native-item、drawCount、windowOpacity。drawCount 仅为累计绘制调用，不逐帧输出日志。

## 验证

- 四项 native CTest 全通过：AppStream、context、scene item、isolated paint。
- scene item 验证 colored node 不在窗口捕获树内、非绘制 damage marker 仍扩展 bounds，same owner 样式复用，往返 owner 和销毁无节点残留。
- CaptureRenderer 检查真实 KWin Item 树与绘制参数：没有应用 surface/shadow，独立 sRGB material；1.0/1.5/2.0 scale 下 data matrix、opacity、device clip 保持，应用 brightness/saturation 不改动，空 region / unloaded tree 不绘制。这是无 GL 的参数 / 场景检查，不能替代 compositor 最终像素验收。
- 构建与测试日志：`/tmp/cc-niri-focus-ring-color-final-build.log`。
- 本轮没有改 JS / Bridge / Spring，未重复此前已经通过的 82 项 JS gate。
- 真实 compositor 已执行新绘制路径：首次诊断 active=true、drawCount=44、windowOpacity=1；后续焦点切换诊断 drawCount 继续增加。
- KWin PID 保持 2088，Spring / layout / Bridge 与 Rounded Corners 持续运行；检查时未见新增 shader / crash 错误。
- immutable canonical：`/home/cc/.local/lib/cc-niri/focus-ring/f3d66b6de7a01a5594550d472fbcc21bf2fe7f8c6fbe07a6e20a465232e6b3cf/cc-niri-focus-ring.so`。
- 备份：`/tmp/cc-niri-focus-ring-color-backup-20261004-uqz5grt2`，含旧 canonical、kwinrc、deployment.json、result.json、status-after-paint.json、manual-result.json、final-status.json 与 final-kwin.log。

## 人工验收

用户已确认：“颜色一致，圆角正常”。跨应用静态颜色验收通过。用户复验确认：“全屏和独立开关都正常”，F11 隐藏 / 恢复与 off 无残留 / on 恢复均通过；静态 Phase 1 验收完成。动画跟随与独立资格控制器仍属后续阶段。

参考源码：[KWin 6.7 ItemRenderer](https://raw.githubusercontent.com/KDE/kwin/Plasma/6.7/src/scene/itemrenderer_opengl.cpp)、[KWin 6.7 OffscreenEffect](https://raw.githubusercontent.com/KDE/kwin/Plasma/6.7/src/effect/offscreeneffect.cpp)、[Rounded Corners 绘制路径](https://raw.githubusercontent.com/matinlotfali/KDE-Rounded-Corners/master/src/Effect.cpp)。API 签名以本机 SDK 为准。
