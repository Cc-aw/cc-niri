# R7 后续 Focus Ring F1：清晰内边框与弱柔光

日期：2026-10-09。分支：feat/animation-60hz。基线：f0849b1（A5）。

F1 仅做静态分层。保留 #7FC8FF、唯一真实 Native owner、JS Ring v1 eligibility 与发布 authority、fullscreen / off-on / 对象生命周期。边框配置为 1.5 logical px / alpha=0.85；外缘柔光为 5.5 logical px / alpha=0.15。没有焦点淡入淡出、收敛、持续 pulse 或新动画时钟；H/L、J/K、Spring 参数和布局未改。

## 渲染与边界

- 两层共用一次 paintWindow 的冻结 position / transform / WindowPaintData / opacity / region，始终跟随当前 render geometry，不读取布局终点或另采 motion。
- 复用既有 Rust Ring metrics / layout / damage / viewport padding，分别提供边框宽度与柔光绘制宽度，Core / FFI / schema / CMake 未改。C++ 只转换平台矩阵、绘制材质、缓存纹理和管理 Scene Item。
- 保留 detached paint tree 与 non-drawing window damage child，应用 / rounded-corners offscreen capture 不包含蓝色像素。当前 KWin 后窗口绘制路径内，先画外侧 glow，再画清晰线；两层均只在窗口轮廓外，不填 client area，不改 frameGeometry / 输入 / 列宽。
- 光圈内轮廓复用窗口四角；外轮廓自然随向外距离扩展。Native / effect opacity 各乘一次，独立 sRGB 不受应用 brightness / saturation 染色。
- 柔光采用向外递减的平方 falloff，四张小角纹理由 16 个 outside contour 近似，source replacement 避免叠亮；四边使用一像素宽的渐变条，不分配窗口大小的 blur texture 或 shader / offscreen pass。
- 平移与静态重绘复用缓存；仅几何 / 半径 / scale / 颜色变化重新栅格化。owner 清理同时释放两层与 clip 余量。没有 timer、repaint loop、每帧 JSON。
- 保留已有 device pixel alignment。1.5 px 按实际 scale 对齐整物理像素，不将取整写入 motion；柔光半径同样由 Core 对齐。保守 viewport / 初始 damage outset=6 logical px，覆盖 5.5 的最大像素舍入，原 occlusion / damage region 仍限制绘制。一般旋转 / 非轴变换复用 local-shape native fallback 和同一 root matrix。

## 验证

Rust 1.99.0、GNU /usr/bin/g++ 16.2.1、Cargo --locked、Cargo.lock 不变。并发 2；构建与实机采样分开。

已有 scene / paint / viewport / motion / retarget / presentation / HiDPI 契约更新到双层范围；新增实际 QImage alpha 上限、四边单调衰减、client 内透明、小纹理和翻译 / idle cache 检查。900 个 SDK 样本覆盖 100 / 125 / 150 / 175 / 200%、负 / 零 / 正输出原点、fractional position、非均匀缩放；两层 inner bounds / extent / seams、corner 与 device vertices 一致。薄边框的角像素检查考虑抗锯齿覆盖，175% 近单位浮点矩阵使用实际 Core compensation 结果。

Rust fmt / clippy --locked -D warnings / workspace tests（52 tests）通过。node tools/check.js --native 通过（100 JS，Bridge 17、Clip 16、Ring 23 CTest，plasmoid 与生产符号门禁）；Core Debug / Release 各 12 CTest、umbrella Debug 27 CTest 全部通过，冻结 Golden differential 保留。日志在 build/focus-f1/results.json。本轮未改 CMake / FFI / Core 边界，不重复已验的编译器拒绝 / BUILD_TESTING=OFF 矩阵。短实机结果将在部署后补齐。

## 限制与回滚

F1 不实现 F2 focus fade / F3 gain convergence / F4 timeline / F5 edge weighting。CPU / SDK 变换和纹理 alpha 测试不等同于 GL compositor 或所有显示设置的实机像素；实际用户视觉反馈仍须单独记录。5.5 是有限外缘支持半径，使用轻量衰减纹理而非高强度 bloom；末端透明。

部署采用现有 save-state → stop（恢复失败即停止）→ immutable Ring installer → start；仅更新 Ring。备份与旧组件回滚入口将在部署后记录，不整体覆写配置 / workspace，不删除用户窗口。
