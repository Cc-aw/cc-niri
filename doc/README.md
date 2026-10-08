# 设计文档索引

按当前源码、Git 实施记录和验收结果整理，更新于 2026-10-07。

旧 `docx/` 的 8 份 Markdown 已核对正文与对应设计一致，统一合并到下列 `done/`、`todo/`；重复副本及旧目录已移除。

- `done/`：已实施的设计阶段和历史规格。被撤除、替代或延期的子项在状态栏说明；归档不表示原文所有备选方案均已实现。
- `todo/`：仍有未实现内容的设计，以及未采用的旧提案。部分完成文档列出完成边界，后续开发只处理剩余内容。
- 验收结果保留在 [`test/`](../test/)，源码职责以当前实现和仓库 [README](../README.md) 为准。

## 本轮专项目标与结果

Rust Native Core 重构 R0–R7 已完成并归档到 `done/`。Spring、ViewportMotion、Scroll Runtime、Focus Ring 数值和共享 Native Protocol / eligibility 的生产实现固定 Rust，迁移开关已退休；旧 C++ 只保留冻结差分测试基线。2026-10-07 从 `c9a5cee` 重新部署，完整 Native 门禁与安装后核验通过，用户确认“全部正常”并明确 Rust 重构完成，见 [R7 验收记录](../test/RUST_NATIVE_R7_RESULTS.md)。早期 R0–R6 记录保留历史阶段的 OFF 开关和部署证据，不代表当前生产配置。

重构期间发现的 [Pair→Wide 动画中 J/K](../test/WORKSPACE_WIDE_DEPARTURE_RESULTS.md)交接缺陷已修复并由用户确认成功；双屏工作区现按主屏独立切换，帧率采样见 [输出与帧率记录](../test/WORKSPACE_OUTPUT_FRAME_RESULTS.md)。Rust 完成结论不覆盖 V3 完整 daily smoke / release gate、热插拔和长期压力等独立验收。

2026-10-01 用户明确指定以下两个目标，并确认先实现 ViewOffset Spring，再实现 Focus Ring；优先于 Quickshell 后续视觉升级：

| 目标 | 设计与起点 |
| --- | --- |
| [focus_ring](done/cc-niri_Focus_Ring_实现设计.md) | 新的主屏原生 Focus Ring；[Phase 1 Static Native POC](../test/FOCUS_RING_PHASE1_RESULTS.md) 已实现并通过自动检查，[已部署并通过静态实机验收](../test/FOCUS_RING_PHASE1_LIVE_RESULTS.md)。[Phase 2 独立资格与归属](../test/FOCUS_RING_PHASE2_RESULTS.md) 已实现、配套部署并通过三轮人工实机验收；验收后按用户要求改为 3px 并部署；[Phase 3 同帧 Visual Transform](../test/FOCUS_RING_PHASE3_RESULTS.md) 已实现并通过自动验证，已单独部署并通过两轮主屏实机验收。2026-10-05 四侧外沿描边裁剪与启动圆角修复已部署并通过本轮主屏实机验收，见 [修复记录](../test/FOCUS_RING_CLIP_CORNER_RESULTS.md)。[Phase 4 Retarget](../test/FOCUS_RING_PHASE4_RESULTS.md) 已完成实现与自动验证，已独立部署并通过自动加载 / 开关检查，三轮主屏人工验收全部通过，[Phase 5 Presentation](../test/FOCUS_RING_PHASE5_RESULTS.md) 已实现并通过自动检查，已独立部署并开启，用户已确认 Phase 5 完成；[Phase 6 内屏像素对齐](../test/FOCUS_RING_PHASE6_RESULTS.md) 已实现、自动验证通过并独立部署，用户确认功能正常，内屏实机验收通过，Phase 6 内屏范围完成；双屏开发不属于本阶段。历史 Phase 9.5 的实现仅作背景。 |
| [viewoffset_spring](todo/cc-niri_niri_viewoffset_spring_implementation.md) | 普通 H/L 使用共享 ViewOffset + Spring；[Phase 1 数学与状态](../test/VIEWOFFSET_SPRING_PHASE1_RESULTS.md)、[Phase 2 SCROLL plan](../test/VIEWOFFSET_SPRING_PHASE2_RESULTS.md)、[Phase 3 continuing 投影](../test/VIEWOFFSET_SPRING_PHASE3_RESULTS.md)、[Phase 4 incoming 投影](../test/VIEWOFFSET_SPRING_PHASE4_RESULTS.md)、[Phase 5 outgoing 延迟停放](../test/VIEWOFFSET_SPRING_PHASE5_RESULTS.md)、[Phase 6 旧 SCROLL 退出](../test/VIEWOFFSET_SPRING_PHASE6_RESULTS.md)、[Phase 7 连续 retarget](../test/VIEWOFFSET_SPRING_PHASE7_RESULTS.md)、[Phase 8 中途反向](../test/VIEWOFFSET_SPRING_PHASE8_RESULTS.md) 已实现；主屏核心代码阶段完成，已配套部署并通过本轮内屏验收。第一版不改 Wide 尺寸动画或 J/K 切换。 |

两个目标分别模块化实施与验收。Spring 已完成数学、协议、原生 continuing/incoming/outgoing 接入、旧普通 SCROLL 动画退出、连续 retarget 与中途反向；第六至第八阶段已配套部署，[自动实机检查](../test/VIEWOFFSET_SPRING_PHASE8_LIVE_RESULTS.md)及本轮内屏人工验收通过：快速 H/L 连续且间距稳定、滚动中 J/K 清理正常、Wide 工作区状态保持。第四、第五阶段已配套部署，[自动实机检查](../test/VIEWOFFSET_SPRING_PHASE5_LIVE_RESULTS.md)通过，本轮内屏人工验收通过：慢速 H/L 间距稳定且连续滑出、滚动中 J/K 清理正常，Wide J/K 状态保持。第三阶段已部署并完成一轮[内屏验收](../test/VIEWOFFSET_SPRING_PHASE3_LIVE_RESULTS.md)；之前的滚动间距变化在第四、第五阶段慢速 H/L 人工验收中已消失。Focus Ring 第一阶段静态原生 POC 已部署并启用，加载 / 卸载检查通过；用户确认单一 owner，已按反馈[加粗并匹配圆角](../test/FOCUS_RING_STYLE_RESULTS.md)，调整后的样式、全屏 / 关闭 / 点击已由用户验收通过；随后发现跨应用色差，已部署[独立绘制修复](../test/FOCUS_RING_COLOR_RESULTS.md)，颜色和圆角已由用户确认正常，独立开关及全屏复验也通过；静态 Phase 1 实机验收完成。Phase 2 已新增独立 FocusRingController 与 Script → Native 资格通道，完整自动门禁通过；[配套部署与实机验收](../test/FOCUS_RING_PHASE2_RESULTS.md)通过，三轮人工验收全部完成。部署前另修复了 [Wide → Pair 邻窗偶发不可见](../test/WIDE_NEIGHBOR_RACE_RESULTS.md)：邻窗不再依赖几何变化才能退出旧透明 hold，自动回归通过，已单独部署动画脚本，用户确认原缺窗问题已修复，实机验收通过；Focus Ring Phase 2 已配套部署并通过验收，随后按用户要求将边框调整为 3px 并部署。Phase 3 新增独立绘制帧快照，同步既有 Spring 变换、原生透明度和裁剪，85 个 JS 回归与 6 项 Ring 原生检查通过，[已单独部署并通过两轮主屏实机验收](../test/FOCUS_RING_PHASE3_RESULTS.md)：慢速 H/L 贴合与裁剪正常、滚动中 J/K 清理正常、独立开关恢复正常。

## 已实施

| 文档 | 状态 / 依据 |
| --- | --- |
| [4K 60Hz 工作区动画](../test/WORKSPACE_ANIMATION_RESULTS.md) | 独立 Rust 420ms 曲线已部署；完整自动门禁与主屏普通 / 反向呈现采样通过，人工 Wide / 流畅度待验收。 |
| [Focus Ring](done/cc-niri_Focus_Ring_实现设计.md) | Phase 1–6 内屏范围已完成、部署并通过用户验收，见 [Phase 6 记录](../test/FOCUS_RING_PHASE6_RESULTS.md)；Phase 4 / 6 计划同步归档。额外 [Phase 7 提案](done/cc-niri_Focus_Ring_Phase7_收尾加固_实施计划.md) 取消实施，仅保留历史记录。双屏不属于本轮范围。 |
| [V1 Safe Area](done/cc-niri-maximize_Codex_Implementation_Spec.md) | 已实现；早期最大化方案，当前由 V3 列布局接续。 |
| [V2 Safe Area / Quick Tile](done/cc-niri-maximize_V2_SafeArea_QuickTile_InnerGap_Codex_Spec.md) | 已实现；主屏 Safe Area 与 gap 基础。 |
| [V3 Scrollable Columns](done/cc-niri-maximize_V3_Scrollable_Columns_Codex_Spec.md) | 已实现当前单窗口 Column 范围；Multi-window Column、Overview 等扩展不属于已完成范围。 |
| [Phase 8.5 Dock 双向顺序](done/cc-niri-maximize_V3_Phase8_5_Bidirectional_Dock_Order_Sync_Codex_Spec.md) | 已实现；见 [Phase 8.5 验收](../test/PHASE_8_5_RESULTS.md)。 |
| [Phase 9.5 Presentation / Focus Ring](done/cc-niri-maximize_V3_Phase9_5_Mouse_First_Presentation_Focus_Ring_Codex_Spec.md) | Presentation 已实现；自定义 Focus Ring 曾实施后撤除，现使用原生 Dock 活跃指示，本文保留历史设计，不重新启用旧 Focus Ring。 |
| [模块化与稳定性](done/cc-niri_模块化稳定性与动画重构设计.md) | 已实现模块化架构与稳定性职责拆分（a6d590b）。 |
| [Rust Native Core R0–R7](done/CC-Niri%20Rust%20Native%20Core%20重构实施设计.md) | 已完成并通过用户验收；R7 固定 Rust 生产并删除生产 Legacy / 迁移开关，2026-10-07 重新部署后用户确认正常。冻结 oracle 只用于差分测试，验证与回滚见 [R7 记录](../test/RUST_NATIVE_R7_RESULTS.md)。V3 总体验收仍由独立清单管理。 |
| [R1 Spring 迁移准备](done/CC-Niri%20Rust%20Native%20R1%20Spring%20迁移实施准备.md) | 已完成；R1–R6 是实施历史，当前生产 Core 固定 Rust。 |
| [连续滚动 / Native Clip](done/cc-niri_niri风格连续滚动动画与双屏Viewport_Clipping实现设计.md) | 已实现选定的 native clip 路线；shader 路线未采用；旧阶段未实现 spring，新的 viewoffset_spring 已列为下一目标。 |
| [Phase 14 Motion Hardening](done/cc-niri_Phase14_Viewport_Motion_Runtime_Hardening.md) | 已实现 MotionTransaction、native clip 与 full-delta 滚动（883f778）。 |
| [Phase 15 Contextual Wide](done/cc-niri_Phase15_WidePreference_ContextualViewport实现设计.md) | 已实现；当前 Wide 语义依据（b9c54b8）。 |
| [Phase 15.1 Wide Hardening](done/cc-niri_Phase15.1_Contextual_Wide_Runtime_Hardening.md) | 已实现（1e87364）。 |
| [Phase 16 WindowPolicy](done/cc-niri_Phase16_WindowPolicy_Dialog_Always_Floating.md) | 已实现语义策略与辅助窗口 policy-floating（5a17d0e）。 |
| [Workspace W0–W9](done/cc-niri_KDE_Virtual_Desktop_Workspace架构设计.md) | 当前主屏范围 W0–W9 已实现、部署并由用户验收；见 [W9 验收](../test/WORKSPACE_W9_RESULTS.md)；返回桌面的 [Wide 恢复修复](../test/WORKSPACE_WIDE_RESTORE_RESULTS.md) 已部署并验证。历史双屏要求不作为本轮验收范围。 |

## 未完成 / 未采用

| 文档 | 剩余范围 / 状态 |
| --- | --- |
| [Core UX 下一阶段](todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md) | P1 底部默认留白 8、P2–P3 持久 half / Full、P4 相邻移动、P5 数字直达、P6 数字移动已实现并部署；P7 Dockless Core 用户验收通过，P8 通用 Bridge 命名 / 兼容清理、完整门禁、部署与实机矩阵通过，P8 用户实机 / 日常 smoke 验收通过，见 [P3](../test/CORE_UX_P3_RESULTS.md)、[P4](../test/CORE_UX_P4_RESULTS.md)、[P5](../test/CORE_UX_P5_RESULTS.md)、[P6](../test/CORE_UX_P6_RESULTS.md)、[P7](../test/CORE_UX_P7_RESULTS.md)、[P8](../test/CORE_UX_P8_RESULTS.md) 记录。Core UX 专项验收剩余项见设计 DOD；1/3、2/3 列宽开发延期。 |
| [V3 稳定版收尾](todo/cc-niri_V3_日常稳定版收尾设计.md) | 部分完成；native CI 与自动安全恢复已实现（b97594a），已有受控实机检查（8b6c887），但 [V3 实机验收](../test/V3_DAILY_ACCEPTANCE.md) 的完整交互矩阵与 release gate 仍有 Pending / Partial 项。 |
| [Clavis Motion](todo/CC_Niri_Maximize_Clavis_Motion_实现设计.md) | 部分实现；窗口 MotionController、retarget、MotionTransaction、native clip 已有，Dock UI Motion、OSD、Spotlight 等尚未完成。后续视觉工作优先参考 Quickshell 升级设计。 |
| [Quickshell 视觉升级](todo/cc-niri_Quickshell视觉升级_模块化实现设计.md) | 部分实现；V1 MotionProfiles 已完成（bde8a03），V2–V11 尚未完整实施。 |
| [Wide Column / Partial Viewport 旧提案](todo/cc-niri_Phase15_Wide_Column与Partial_Viewport重构设计.md) | 未按本文完整实施；当前采用 Wide Preference + Contextual Viewport。这是已被替代的候选方案，保留作参考，不作为默认下一阶段任务。 |

## 阅读顺序

当前 Workspace 行为优先阅读 `done/` 中的 Workspace 架构与 W9 验收记录。
Focus Ring 本轮开发已完成，优先阅读 `done/` 中的设计与 Phase 6 验收记录；额外 Phase 7 提案已取消实施。ViewOffset Spring 当前实现依据仍见其设计与阶段验收记录。
Quickshell V2–V11 暂列后续，Clavis 旧文档作为背景参考。
Partial Viewport 旧提案已被 Contextual Wide 取代，重新采用需要新的明确需求。
