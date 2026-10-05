# Focus Ring Phase 5：Presentation

日期：2026-10-05。实现与自动验证完成，新库已独立部署并开启，加载 / off-on 与运行健康检查通过；用户于 2026-10-05 确认 Phase 5 已完成。

依据：[Focus Ring 设计第 37 节](../doc/done/cc-niri_Focus_Ring_实现设计.md#phase-5--presentation)。本阶段仅主屏；双屏不是前置条件。

## 实现

Normal / Wide 之间的动画会非等比缩放窗口。原 OutlinedBorderItem 直接继承该缩放，竖线粗细乘以 X scale，横线粗细乘以 Y scale；将这个行为与固定 3px 的要求组合后，新增回归在原路径失败：

```text
FAIL animated border must retain device-rounded 3px width
```

基线日志：`/tmp/cc-niri-phase5-before.log`。这是自动回归发现的尺寸动画描边问题，不据此声称用户已经在实机观察到它。

- 新增独立 `native/focus-ring/FocusRingStrokeItem`。模块只根据当前 `FocusRingPaintFrame` 解析正向轴缩放，无 Normal / Wide / Max 模式分支，也不读取 PresentationController、列宽或滚动 offset。
- isolated paint root 继续严格采用源窗口同帧 position、Item transform、WindowPaintData、native opacity 与 device clip。仅下方 Stroke Item 的子几何抵消合成的 X / Y scale，保持源窗口位置与动画进度不变。
- 描边子几何由四条直边和四个小圆角 ImageItem 构成。四边宽度为 `round(3 * outputScale)` 个设备像素；圆角按窗口的同帧非等比缩放保留椭圆轮廓，沿轮廓向外描边固定厚度。描边不覆盖窗口内容。
- 不创建窗口尺寸的离屏纹理，不直接调用 GL 或管理 GL context / shader。八个小 ImageItem 的上传、颜色空间和纹理资源由原生场景节点处理，场景绑定来自源 WindowItem。四个圆角只在缩放几何 / outputScale / 颜色变化时重绘；相同快照重复绘制复用缓存。纹理与节点随 attachment 清理。
- 静态及单位缩放恢复此前已验收的 OutlinedBorderItem。旋转、剪切、反射保留原生路径，不将它们误解为 Presentation 轴缩放。非有限、退化或过大轴缩放跳过绘制；圆角图块单边最多 1024 设备像素，避免异常数据引起超大分配。
- frame 除原有 owner / attachment / pose / opacity / clip 外，新增当前源 innerRect 与 outline 的值快照；同一回调中的后续尺寸或圆角提交不会让旧窗口帧与新边框几何混用。下一回调捕获新值。
- source window 树仍只有 non-drawing damage marker。动画时 marker 包含固定描边所需的源坐标余量，结束后恢复静态 bounds；四侧 viewport 余量继续采用共享 native clip 机制。没有改变布局几何、输入区域、JS controller、Native Clip 或 Bridge 实现。
- 只读诊断更新为 `phase=presentation`，新增 `strokeGeometry=paint-frame-fixed-width`；部署后可验证实际加载版本，`frameLifetime=scene-attachment` 继续保留。

场景兼容依据为本机 KWin 6.7.5 SDK，并核对官方 [Item renderer](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/itemrenderer_opengl.cpp)、[ImageItem](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/imageitem.cpp) 与 [OutlinedBorderItem](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/outlinedborderitem.cpp)。本阶段保留 renderer 原有的根矩阵与原生节点生命周期。

## 自动验证

新增 `focus-ring-presentation`：测试专用 Node fixture 直接导入生产 `MotionSampler` / `WideMotionGeometry` / `MotionTokens`，C++ 组合实际 Ring 与 KWin Item，并检查交给捕获 renderer 的矩阵、clip、opacity、原生子项 quad 和圆角小图的 alpha。Ring 插件本身不依赖 Node、MotionSampler、Spring 或 Presentation 状态。

- 主屏 safe area `24,50,1872,960`；Normal 932px、Wide 1348px。覆盖左右 anchor 的 Normal → Wide、Wide → Normal，在 0 / 7 / 20 / 60 / 100 / 160 / 219 / 220ms 采样，并在进入 Wide 的 60ms 从生产采样出的视觉位置反向。
- 当前项目 Maximize 直接提交几何，没有把它伪装成已有的尺寸动画。覆盖 Normal → Max → Normal 实际端点；另加通用双轴尺寸动画，验证将来 / 下游 paint 变换的适配。
- 在 1 / 1.25 / 1.5 / 2 outputScale 下，共检查 260 个帧样本，其中 196 个存在缩放。检查四边实际 native quad 顶点取整后的厚度、圆角椭圆形状、轮廓内 / 外透明度、小图块范围和重复绘制缓存。
- Ring 与窗口的绘制 root 矩阵严格相等；两次 opacity 乘法各应用一次，蓝色材质独立。检查 native Item scale 与 effect scale 的组合、同一 attachment 下捕获后提交新尺寸 / 半径、下一次捕获新形状、无效 scale、旋转回退和卸载清理。
- 原 Phase 4 retarget、owner 离开又返回、off/on、source 销毁、visual transform、四侧 clip 和圆角插件生命周期回归继续通过。

完整 JS 门禁首次运行暴露了既有 `wide-return-transition.test.js` 的真实时钟依赖：测试把预期固定在 arm 时刻，却用两次 `Date.now()`，并行构建下中间经过数毫秒导致位移断言失败。该测试改为固定测试时钟并在 finally 恢复，位移断言收紧为 1e-9；生产 JS、动画曲线和生成包没有改变。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| Ring 插件及全部测试构建 | 通过 | `/tmp/cc-niri-phase5-build-final.log` |
| Ring 全部 10 项 CTest | 通过 | `/tmp/cc-niri-phase5-ring-tests-final.log` |
| Native Clip 全部 4 项 CTest | 通过 | `/tmp/cc-niri-phase5-clip-tests.log` |
| 完整 JS 门禁、生成包与 whitespace | 85 项通过 | `/tmp/cc-niri-phase5-js-tests-final.log` |
| 新增 Presentation 组合 | 260 样本通过，其中 196 个缩放 | `/tmp/cc-niri-phase5-samples.log` |

这些检查不创建 GL context，也不替代实机最终像素和缩放动画体验。小图 alpha 只验证 CPU 圆角生成；分数 scale 的 native quad 检查不表示 Phase 6 已完成。原生 renderer 在不同层级取整位置和顶点，亚像素清晰度 / 对齐留给 Phase 6 主屏验证。

## 部署与阶段完成

仅独立部署 Ring 新库，沿用 immutable 安装器和失败回滚，保留 Phase 4 canonical；没有覆盖 KWin 已 mmap 的库文件。

- 部署前再次构建并通过全部 10 项 Ring CTest，日志 `/tmp/cc-niri-focus-phase5/build.log` / `tests.log`。
- 新 canonical：`~/.local/lib/cc-niri/focus-ring/a86c6a52871870d2a0e4c77fa64db09a46604014b3338d5066390ef5eacbed8a/cc-niri-focus-ring.so`。discovery link、安装 SHA256 与 canonical 目录一致，旧 Phase 4 canonical hash 不变。内核拒绝读取 `/proc/2057/maps`；实际新代码加载依据为运行中的新 phase / strokeGeometry 诊断，未声称已检查进程映射。
- 运行诊断为 `phase=presentation`、`strokeGeometry=paint-frame-fixed-width`、`frameLifetime=scene-attachment`、width=3、color=#7FC8FF、cornerSource=round-corners，资格通道 enabled、eligibleCount=2。
- 安装后的 CLI 独立 `focus-ring off` 成功卸载并移除诊断 endpoint，`on` 恢复新版本，插件与用户偏好恢复开启；generation 从 613 变为 614，sessionId 与部署前一致。
- 加载 / 开关检查时焦点不在受管窗口，因此 active=false、drawCount=0、cornerRadius=0；这表示当时没有 owner，不表示丢失圆角设置。首次受管窗口绘制与尺寸动画的 GPU 结果留给本轮聚焦后的实机反馈和诊断，不用加载成功替代。
- KWin PID 全程保持 2057，部署时段 journal 未发现新增 TypeError / ReferenceError / SyntaxError / KCrash / Segmentation fault / ASSERT failure。布局 Script、动画 Effect、Native Clip 与 CLI 安装 SHA256 前后相同，相关组件与 Bridge 健康。没有重启 KWin / Plasma，也没有修改阴影设置。
- 部署脚本 `/tmp/cc-niri-focus-phase5/deploy.py`；记录 `/tmp/cc-niri-focus-phase5/deployment.json`、`deploy.log`、`mapping.json`。备份 `/tmp/cc-niri-focus-phase5-backup-20261005-4aaapy0h` 保留 kwinrc、旧 canonical 引用、命令审计、诊断与 KWin 日志。自动部署通过；部署时记录的人工状态为 pending，用户随后于 2026-10-05 确认 Phase 5 已完成。

本阶段主屏人工验收清单如下（保留供回归参考）：

1. 同一工作区至少两个窗口，Meta+Z 在 Normal / Wide 间切换；分别从左、右位置触发，观察四边贴合、3px 粗细稳定、圆角连续，没有分离、延迟或残留。快速再按 Z 中途反向，以及 Wide 下 H/L，复查邻窗出现和描边归属。
2. 通过项目当前最大化入口做 Normal → Max → Normal，确认几何提交后边框立即贴合；浏览器 F11 全屏仍隐藏，退出恢复。
3. 尺寸动画中 J/K 往返、切换焦点或关闭临时窗口，确认边框唯一归属、清理及内容点击；独立 focus-ring off/on 无残留且恢复。

用户于 2026-10-05 明确确认“Phase 5已经实现完成”，据此将本阶段状态更新为完成；未补写逐项人工测试结果。下一阶段为 Phase 6 主屏 HiDPI / 像素对齐，尚未开始。
