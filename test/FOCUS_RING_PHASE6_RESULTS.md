# Focus Ring Phase 6 内屏 HiDPI

日期：2026-10-05。实现、自动验证和独立部署完成；用户反馈“功能正常”，内屏实机验收通过，Phase 6 内屏范围完成。本阶段只开发内屏，双屏、跨输出迁移与 mixed DPI 不在范围内。

依据：[实施计划](../doc/todo/cc-niri_Focus_Ring_Phase6_HiDPI_实施计划.md)。实时 Wayland 查询确认仅 eDP-1 连接并开启，1920×1080 @ 144Hz、scale=1、geometry=0,0 1920×1080。没有改变桌面缩放；125% / 150% / 200% 仅为单输出自动参数验证。

## 问题与修复

新增最终设备坐标回归在修改前失败：`FAIL animated inner edges follow exact window device bounds`，日志 `/tmp/cc-niri-phase6-before.log`。Phase 5 检查局部 quad 厚度，但 KWin 对每层 Item 原点及局部顶点分别取整，动画右侧 / 下侧的分数位置会丢失，角块与直边也可能分别偏移。

- `FocusRingStrokeItem` 将各 patch 的原点和局部尺寸量化为设备整数，在 patch 的局部 transform 中补回位置和尺寸余量。描边仍保持 round(3 × outputScale) 设备像素，右侧 / 下侧跟随实际窗口的分数位置，角块与直边保留相同目标边界。窗口根矩阵、动画进度和逻辑布局不变，不单独吸附 Ring 到屏幕整数位置。
- 补偿动画边沿后，回归进一步暴露 `FAIL static native inner edge matches window device bounds`。150% 下原始 3px 外扩的 -4.5px 原点与 9px 总外扩分别取整，导致静态原生边框内框少一个设备像素。`FocusRingItem` 在单位缩放绘制时先将 outline 的外扩量量化为 round(3 × outputScale) / outputScale，再交给原生 OutlinedBorderItem，内框恢复窗口设备尺寸。damage 使用实际外扩；原资格通道和四侧 clip 实现保持不变。
- 静态继续使用原生 OutlinedBorderItem；旋转、剪切、反射回退保留原 outline。圆角仍使用原生窗口半径与同帧形状，八个小 ImageItem、缓存和 attachment 生命周期沿用 Phase 5。
- 只读诊断增加 `phase=hidpi` 与 `pixelAlignment=native-child-rounding-compensated`，保留 `strokeGeometry=paint-frame-fixed-width`。

取整顺序依据本机 KWin 6.7.5 SDK 与官方 [Item renderer](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/itemrenderer_opengl.cpp)。当前逻辑宽度配置仍为 3px，分数缩放按设备像素量化，150% 对应 5 device px。

## 自动检查

新增 `focus-ring-hidpi`，使用实际 KWin Item 树和 SDK `RenderGeometry::appendWindowQuad` / `copy` 构建设备顶点，按原生逐层矩阵计算最终边界。覆盖 1 / 1.25 / 1.5 / 2 scale、四种窗口位置 / translation、三种宽度及五种 X scale（含单位缩放两侧邻近值），合计 240 帧。检查：

- Ring 与窗口同帧 root 矩阵相等；直边最终厚度与窗口内沿一致。
- 四个角块与四条直边在实际取整后相接；静态内框匹配窗口设备尺寸。
- 同一 attachment 在 scale 参数变化后使用新几何；重复绘制复用圆角缓存。
- 局部 damage 覆盖量化后的外沿；窗口几何不变，清理后无孤立节点。

Phase 5 的圆角 alpha 采样辅助函数同步识别 patch 局部 transform；静态 damage 断言使用实际量化 outline。保留既有同帧、retarget、圆角、四侧裁剪与生命周期回归。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| Ring 插件与全部测试构建 | 通过 | `/tmp/cc-niri-phase6-build-final.log` |
| Ring 全部 CTest | 11 项通过 | `/tmp/cc-niri-phase6-ring-tests-final.log` |
| Viewport Clip 全部 CTest | 4 项通过 | `/tmp/cc-niri-phase6-clip-tests.log` |
| JS 门禁、生成包与 whitespace | 85 项通过 | `/tmp/cc-niri-phase6-js-tests.log` |
| HiDPI 设备坐标组合 | 240 帧通过 | `build/native-focus-ring/bin/cc-niri-focus-ring-hidpi-tests` |

测试没有创建 GL context。角块边界相接与 CPU alpha 验证不等同于最终纹理采样无缝；renderOffset 传入 viewport，但 CPU 捕获不验证 GPU 投影像素。动画端点观感、实际屏幕清晰度与无残留仍需下列人工检查。

## 独立部署

使用现有 immutable 安装器，独立更新 Ring 新库，没有覆盖已映射的旧 canonical。自动加载 / off-on / 健康检查通过。

- 新 canonical hash：`d12a2506fdb48d10d9a05e54e50573a52c36bc63eb661cb6b4cd3f599bfe8d3c`；库位于 `~/.local/lib/cc-niri/focus-ring/<hash>/cc-niri-focus-ring.so`。
- 新代码加载依据：运行中的 `phase=hidpi`、`pixelAlignment=native-child-rounding-compensated`，宽度 3、颜色 #7FC8FF、cornerSource=round-corners。资格通道 enabled，独立开关后 generation=736，session 保持不变。
- 自动部署过程中焦点不在受管窗口，active=false、drawCount=0。加载与开关成功不代替聚焦后首次绘制和真实 GPU 像素验收。
- KWin PID 保持 2057；部署时段日志未发现新增 TypeError、ReferenceError、SyntaxError、KCrash、Segmentation fault 或 ASSERT failure。Script、动画 Effect、Native Clip、CLI 安装 hash 保持不变，相关组件与 Bridge 运行正常。
- 部署记录 `/tmp/cc-niri-focus-phase6/deployment.json`，命令脚本与日志为同目录 `deploy.py` / `deploy.log`。回滚备份 `/tmp/cc-niri-focus-phase6-backup-20261005-eud0r75a` 保留旧 canonical 引用、kwinrc、诊断、命令审计与日志。

## 内屏实机验收通过

1. Normal / Wide / Max 静止时观察四边：粗细一致、直边清晰、圆角连续，描边位于内容之外。
2. H/L 滚动、快速反向、Meta+Z 切换 Wide 并中途反向：边框始终贴合，角与直边无裂缝，动画结束无明显跳变或残留。
3. F11 全屏 / 退出、J/K、切换焦点和关闭窗口：归属唯一、清理正确；内容点击正常。

使用当前内屏 100% 缩放完成本阶段实机验收即可，不要求切换缩放或连接外屏。2026-10-05 部署后用户反馈“功能正常”，据此确认本轮内屏实机验收通过，Phase 6 内屏范围完成。用户未提供逐项测试明细，不补写逐项通过记录。其他 scale 仍仅有自动验证，双屏开发留待以后。
