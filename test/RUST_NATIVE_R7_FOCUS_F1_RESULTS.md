# R7 后续 Focus Ring F1：清晰内边框与弱柔光

日期：2026-10-09。分支：feat/animation-60hz。基线：f0849b1（A5）。生产代码提交：11a6197；部署与实机验收未再修改生产代码。

F1 仅做静态分层。保留 #7FC8FF、唯一真实 Native owner、JS Ring v1 eligibility 与发布 authority、fullscreen / off-on / 对象生命周期。当前边框配置为 1.5 logical px / alpha=0.85；柔光从清晰边框外缘向外衰减 7 logical px，峰值 alpha=0.35，总支持范围 8.5 logical px（历次参数与用户反馈见末节）。没有焦点淡入淡出、收敛、持续 pulse 或新动画时钟；H/L、J/K、Spring 参数和布局未改。

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

Rust fmt / clippy --locked -D warnings / workspace tests（52 tests）通过。node tools/check.js --native 通过（100 JS，Bridge 17、Clip 16、Ring 23 CTest，plasmoid 与生产符号门禁）；Core Debug / Release 各 12 CTest、umbrella Debug 27 CTest 全部通过，冻结 Golden differential 保留。日志在 build/focus-f1/results.json。本轮未改 CMake / FFI / Core 边界，不重复已验的编译器拒绝 / BUILD_TESTING=OFF 矩阵。短实机验收已完成，见下文。

## 部署与实机短验收

持久私有备份：`/home/cc/.local/state/cc-niri/backups/focus-f1-20261009-192033`（0700）。原配置键 / 完整 kwinrc、workspace 持久快照、原窗口 / 焦点 / 输出、组件 canonical/hash、代码 / 用户设计文档、部署命令、回滚入口、原始 capture 与截图均已保留。

按现有 save-state → stop → immutable Ring install → start 完成，parked windows 恢复成功。Ring canonical/hash：`216770cc8b23e4cf7b8b73d69d84e12173def313161acf3d298aa43ba715274f`。KWin PID 2050 不变；Clip 仍为 A5 `a873c8719ccee73cb3258b91ff93b4d05c7c04b5b9788b7276d1381008c86cba`，CLI / Bridge / JS 组件未替换。安装 hash 与版本目录一致、显式 reload 后 phase=layered-f1 和新参数可查询；OS 禁止读取 KWin /proc maps，进程实际映射文件 hash 未独立验证。

实机环境：DP-1，3840×2160 / 60Hz / 150%；HDMI-A-1，2560×1440 / 60Hz / 100%。保留 smooth60 / 600 / 0.25px、Workspace=420ms 优化与当前宽度偏好。构建结束后才进行一组短检查，不作长循环或重复 A/B。

| 实机场景 | 结果 |
| --- | --- |
| 三个自建静态 Konsole / sleep 窗口，一次 L/H | 通过，唯一当前 owner、两层跟随 motion；A5 持续全局请求仍为 0 |
| 当前 owner 静态截图 | 通过，四角连续、蓝边细且清楚、外侧柔光弱，没有方角或内容覆盖 |
| half → full → half | 通过，实机 owner / 终态正确；逐帧两层 render geometry 由 Native fixture / SDK 契约覆盖 |
| Wide / return 与工作区中途返回 | 通过，角和 owner 恢复 |
| fullscreen / restore | 通过，同时隐藏 / 恢复两层 |
| focus-ring off / on | 通过，完整卸载后新资格与两层绘制恢复 |
| 空闲 1 秒 | glowRasterizations 保持不变，Scroll paint / full / target repaint 均 0 |
| 安全 restart、桌面恢复、KWin 日志 | 通过，无 JS / invariant / fail-safe / completion timeout / panic |

静态 screenshot 与四角裁剪位于 `short-f1-acceptance/f1-desktop.png` / `cc-niri-f1-four-corners.png`。Spectacle 导出 10240×2880，统一 2× 栅格；用于检查实际合成外观，不据其输出像素直接推算 150% 显示物理边宽。其他 scale / 负输出原点由自动契约覆盖，本轮未切实际显示设置。实机运动检查核对真实输入、owner、终态与 Scroll capture；未录制 GL 动画逐帧视频。GPU 时长 / 输入到面板延迟与不同 scale 的长期视觉反馈未量化。

临时客户端全部关闭。所有原窗口 geometry / membership / minimized / fullscreen、实际与 Bridge 焦点、viewport anchor、当前列偏好、原桌面 ID / 每输出桌面、输出、配置和组件已核验恢复。没有改动本轮的空白尾工作区 ID，也没有删除新增用户窗口。记录在 `short-f1-acceptance/restoration-success.json`；全部执行脚本与门禁 / 分析在备份目录，仓库日志在 `build/focus-f1/`。

## 限制与回滚

F1 不实现 F2 focus fade / F3 gain convergence / F4 timeline / F5 edge weighting。CPU / SDK 变换和纹理 alpha 测试不等同于 GL compositor 或所有显示设置的实机像素；实际用户视觉反馈仍须单独记录。5.5 是有限外缘支持半径，使用轻量衰减纹理而非高强度 bloom；末端透明。

部署采用现有 save-state → stop（恢复失败即停止）→ immutable Ring installer → start；仅更新 Ring。初版组件回滚入口为上述私有备份的 `rollback-component.sh`，先 stop 恢复 parked windows（失败即停止），仅恢复旧 immutable Ring `e58a356f587dce070c18677bb51792777712d7825bb1d904effd58e4a7622077` 的 discovery 绑定，再 start。不整体覆写配置 / workspace，不删除用户窗口。初版必要门禁、部署与短实机功能通过，但用户反馈“只能看到很小的蓝色边框，根本看不到弱柔光”，静态视觉验收未通过，因此先修正 F1，不进入 F2。

## 用户反馈后的柔光修正

初版从窗口轮廓开始以 `(1-u)^2` 衰减，柔光的高 alpha 区域被清晰边框覆盖，边框外的有效蓝色过弱。修正将当前同帧、经 Rust device alignment 得到的清晰边框宽度作为绘制衰减起点，边框外使用 smoothstep 降到透明，峰值 alpha 为设计范围内的 0.18。四边与圆角复用同一颜色函数；圆角、5.5 logical px 支持半径、damage / viewport padding、缓存、owner 与动画时钟不变。非轴变换继续使用现有局部轮廓 fallback。

回归新增对 100% / 125% / 150% / 175% / 200% 四边真实纹理的检查：清晰边框外约 1 logical px 处 alpha 至少 30/255，确保可见部分不会再次退化为只有被边框遮住的峰值；同时保留单调衰减、末端透明、alpha 上限、client area 透明、纹理大小与静态缓存检查。仅修正绘制材质，没有修改 Core、FFI、Qt 数值转换、CMake 或生产动画。

修正源码提交：`ea9ddef`。Rust 1.99.0 fmt、clippy --locked --workspace --all-targets -D warnings、cargo test --locked --workspace（52 tests）均经 `node tools/check.js --native` 执行并通过；完整门禁通过（100 JS、Bridge 17、Clip 16、Ring 23 CTest，冻结 Golden differential、生产符号边界和 plasmoid 构建）。配置复用既有 Ring 构建树，显式 `/usr/bin/g++`。首轮旧断言要求最后一个纹理像素 alpha <=1/255，在新的柔和曲线下失败；像素中心距全透明的支持边界仍有半像素，因此将该采样容差调整为 <=3/255，重新执行门禁通过。首轮与最终日志均保存在 `build/focus-f1-glow/`。本次无 Core / FFI / Qt 转换 / CMake 改动，未重复 Debug / Release、umbrella 和工具链拒绝矩阵。

修正版部署备份：`/home/cc/.local/state/cc-niri/backups/focus-f1-glow-20261009-194552`（0700）。save-state → stop 成功恢复 parked windows → immutable Ring install → start。新 Ring canonical/hash 为 `f7634ae301e6ff00f7541bdce41ad20210e8b6bf2ec862d2ece3ca749b772ff4`；显式 reload 后 `glowAlpha=0.18`、`glowFalloff=border-edge-smoothstep` 可查询。KWin PID 2050、输出、配置、Clip / CLI / Bridge / JS 组件均保持一致。进程 maps 仍受 OS 限制，安装 hash、reload 与新查询接口已核对，未独立读取实际映射文件 hash。

仅做一次静态实机检查：一个自有临时 Konsole 客户端、一张 Spectacle 合成截图、1 秒空闲观测，没有重复 H/L、J/K、resize、Wide、fullscreen 或 off-on 测试。截图 `short-glow-check/f1-desktop.png`（统一 2× 导出栅格）及四角裁剪 `cc-niri-f1-glow-corners.png` 可见细线外连续的浅蓝柔光，四角衰减连续。空闲期间 glowRasterizations 不增加，Scroll paint / full / target repaint 均为 0；无 KWin 相关错误。临时客户端关闭后，原窗口 geometry / membership / minimized / fullscreen、实际与 Bridge 焦点、viewport anchor、列状态、桌面 ID / 每输出桌面、输出、配置与组件全部核验恢复，见 `short-glow-check/restoration-success.json`。截图检查不代表用户已接受视觉强度，也未量化 GPU 时间或其他 scale 的实机显示效果。

本次窄回滚入口为该修正版备份中的 `rollback-component.sh`，通过 stop → 恢复初版 immutable Ring `216770cc8b23e4cf7b8b73d69d84e12173def313161acf3d298aa43ba715274f` discovery 绑定 → start 回退；不覆盖用户配置 / 工作区。源码可回退 `ea9ddef`。这次实现通过门禁、部署与静态功能检查，但用户继续反馈“还是看不到，完全没有柔光”，视觉强度仍未验收通过。

## 第二次反馈：正常比例下的柔光辨识

先在用户实际活动窗口（DP-1、frame x=1284 / y=50 / 1252×1382）保留相同场景，抓取 Ring on / off 两张合成截图，逐边比较边框外 100 个采样位置的 RGB 中位差。0.18 版本四边均有合成差异，因此不是加载旧插件或光晕被完全裁掉：顶部距窗口外缘 2.75 logical px 的蓝通道中位差约 19/255，3.75 px 约 8/255，4.75 px 约 1/255。有效区域狭窄且与壁纸 / 阴影融合，前次仅根据放大截图认定可见不足以代表用户正常比例体验。对照期间未移动窗口，on / off 后原焦点、视口、窗口状态与配置核验恢复。

修正保留细边框与颜色，将柔光的衰减宽度定义为边框外缘之后 7 logical px，总支持范围为 1.5+7=8.5，峰值 alpha 从 0.18 提高到 0.35。强度超出初始文档的建议区间，依据连续两次实机“看不到”的反馈调整；清晰线仍是主要焦点标记。沿用 smoothstep 衰减、轮廓外绘制、有限小纹理和静态缓存，没有 blur framebuffer / 持续动画。

damage 保守外扩为 9 logical px，但共享 Native viewport reservation 保留原 6 logical px。首轮检查发现如果也扩到 9，会在 8px 列间距场景中暴露完全屏外窗口的细边框 / 应用像素，因此将 damage 与 viewport reservation 分开，保留既有 clipped device region / occlusion。滚动 / 部分窗口视口中柔光可被原有 Native clip 限定；不扩大窗口内容的可绘制区域。自动检查覆盖此屏外行为、五档缩放 / 圆角 / 同帧几何、边框外 1px 和 3px 处的有效 alpha，以及缓存 / damage / 生命周期。

源码提交 `43b9420`。最终 `node tools/check.js --native` 通过，包含 Rust 1.99.0 fmt / clippy --locked --workspace --all-targets -D warnings / cargo test --locked --workspace（52 tests）、100 JS、Bridge 17 / Clip 16 / Ring 23 CTest、冻结差分、生产边界与 plasmoid 构建。显式 `/usr/bin/g++` 配置既有 Ring 构建树。首轮屏外裁剪失败与最终修正通过日志均在 `build/focus-f1-halo/`；没有通过放宽屏外断言规避失败。本轮未改 Core / FFI / Qt 转换 / CMake / 动画时钟，未重复 Core Debug / Release、umbrella、编译器拒绝或动画实机场景矩阵。

部署备份为 `/home/cc/.local/state/cc-niri/backups/focus-f1-halo-20261009-200306`（0700），保留快照 / 配置 / immutable 组件路径 / 用户设计文档 / 执行脚本 / 回滚。save-state → stop 成功恢复 parked windows → immutable Ring install → start；新 Ring canonical/hash 为 `c6bbaf8e63e65ac065d82c5604f8d26ed6ad77c70b33cb05260060aa1fc0f86e`。查询确认 `glowRadius=7`、`glowExtent=8.5`、`glowAlpha=0.35`、`paintOutset=9`、`viewportOutset=6`；KWin PID 2050，其他组件与配置保持一致。OS 仍禁止读取 KWin maps，进程映射文件 hash 未独立确认，安装 hash / reload / 新参数已核对。

部署后只对当前实际活动窗口（frame x=24 / y=50 / 2512×1382）做 Ring on / off 同场景截图，没有创建测试窗口或重复键盘场景。Spectacle 统一 2× 导出栅格，原截图和逐边 100 点中位差在 `actual-window-check/`。顶部距窗口外缘 2.75 / 3.75 / 4.75 / 5.75 logical px 的蓝通道中位差分别约 50 / 37 / 27 / 18；左、右、下也保留连续衰减，支持范围外约 9px 的差异基本为零。前后两版采样的活动窗口和几何不同，各自的 on / off 为相同窗口 / 相同场景；不将两版数值当作完全匹配背景的 A/B 比率。检查实际四角，并将裁剪按 2× 导出 / 150% 输出的比例缩小用于观察，当前光晕外扩及色彩差异明显增强；没有将该检查当作用户视觉验收或物理像素计量。

Ring reload 后 1 秒空闲：纹理 rasterizations 不增加，Scroll paint / full / target repaint 均为零，无相关 KWin 错误。全部原窗口 geometry / membership / minimized / fullscreen、实际与 Bridge 焦点、viewport anchor / columns、原桌面 ID / 输出桌面 / 显示配置、插件与配置核验恢复，见 `actual-window-check/restoration-success.json`。运行中未替换 Clip、Bridge 或 JS，没有扩展生产动画或窗口内容的裁剪范围。

窄回滚为本备份的 `rollback-component.sh`：stop → 仅恢复旧 0.18 版本 `f7634ae301e6ff00f7541bdce41ad20210e8b6bf2ec862d2ece3ca749b772ff4` 的 immutable Ring discovery → start；不整体覆写配置 / 工作区。源码可回退 `43b9420`。用户仍反馈“还是看不到柔光，只能看到很细很细的蓝色边框”，本版视觉未通过，暂不进入 F2。后续改为高斯衰减并分离柔光 clip，进度见 [渲染路径修正](RUST_NATIVE_R7_FOCUS_GLOW_PIPELINE_RESULTS.md)。
