# Focus Ring Phase 7 内屏收尾加固实施计划

日期：2026-10-05。状态：取消实施，归档保留。2026-10-05 用户确认原设计已完成，明确停止继续开发并要求合并到 main。原设计止于 Phase 6，本计划是未采用的额外建议，以下内容仅为历史提案，不属于当前任务或已完成成果。

Phase 1–6 内屏范围已完成，当前部署的 Phase 6 已由用户确认“功能正常”。本阶段整理最终验收证据、补齐失败降级与运行控制边界，并清理仍指向静态 POC 的文案。继续仅支持当前内屏，不开发双屏、跨输出迁移、mixed DPI、新样式或配置界面。

## 已核对的基线

- [Phase 6 记录](../../test/FOCUS_RING_PHASE6_RESULTS.md)：240 帧 HiDPI 回归、Ring 11 项 CTest、Clip 4 项 CTest、85 项 JS 门禁通过；内屏 eDP-1、1920×1080 @ 144Hz、scale=1，人工反馈正常。
- FocusRingController 已覆盖 endpoint 抛错不阻断模型变更、停用清理和重发；运行包测试覆盖事务内焦点、工作区、浮动与生命周期。Native 已有 eligibility、attachment 生命周期、局部 damage、圆角缓存和裁剪回归。
- Native 无 Ring 专用 timer 或持续 addRepaintFull，JS 无轮询或逐帧几何发布。该源码核对不能代替静态桌面运行观察。
- 设计第 44 节 Definition of Done 仍全部未勾选，需按阶段证据更新；原“双屏宽度正确”不属于当前完成条件，保留后续范围说明。
- CLI 开启提示和 metadata 描述仍含 static POC。CLI 的 start 路径在 opt-in=true 时调用 load_ring；库缺失或加载失败会报错退出。布局通常已启动或仍运行，但启动命令的成功语义需要明确区分可选 Ring 与核心组件。

## 工作范围

| 位置 | 拟执行内容 |
| --- | --- |
| cc-niri | 自动恢复 opt-in Ring 失败时，核心启动成功则保留运行、提示 Ring 未恢复；显式 focus-ring on 失败仍返回失败，不保存新的成功偏好。核心组件失败继续保持原有处理。 |
| test/runtime-control.test.js | 基于现有命令 mock，覆盖库缺失、loadEffect=false、自动恢复与显式开启差异，核对退出码、调用顺序、用户偏好和其他组件不被卸载。 |
| native/focus-ring/metadata.json、CLI 提示 | 更新静态 POC 描述，使文案符合当前已完成实现；不借此扩展样式或修改默认 opt-in。 |
| 原生 Item / Stroke 测试 | 核对稳定帧是否重复产生几何、缓存或 repaint 变化；复用既有测试，只补实质遗漏。没有失败证据时不重构绘制路径。 |
| 设计文档、README 与索引 | 将内屏完成清单对应到已有记录，区分源码证据、自动验证和人工反馈；写清支持范围与独立开关。 |

这是拟实施策略，不表示已经修复或验证 CLI 失败路径。优先把 Ring 作为可选视觉增强的原则落实到启动命令返回行为。

## 实施顺序

1. 扩展真实 CLI 调用的隔离 mock 回归，先保存缺失库 / 加载失败的现有行为，再实现自动恢复降级。测试只操作临时 HOME、配置和命令 mock，不删除内屏正在使用的插件。
2. 清理 POC 文案，补必要的稳定帧回归；维持逻辑宽度 3px、浅蓝色和当前圆角。
3. 更新 Definition of Done。已有证据足够的项目引用阶段记录；待运行观察的项目保留待验收，不把用户“功能正常”扩写成未执行过的详细检查。
4. 执行 node tools/check.js --native 完整门禁，覆盖 Bridge、Viewport Clip、Ring、Plasmoid 构建与已有集成检查；记录本次实际结果。
5. 按改动组件最小部署：CLI 更新不要求重启 KWin；如原生插件内容变更，沿用 immutable 安装和失败回滚。验证用户 opt-in、当前受管窗口绘制与独立 off/on。
6. 创建 test/FOCUS_RING_PHASE7_RESULTS.md，记录自动验证、部署和运行观察，再更新设计索引。

## 内屏运行观察

- 稳定桌面期间检查 Ring 相关日志是否持续刷屏，确认没有 Ring 专用定时器或全屏 repaint 请求；其他应用导致的 compositor 绘制不可归因于 Ring。
- drawCount 统计的是已有 paint 回调中的绘制，数值增长本身不能证明 Ring 主动触发重绘，也不能据此断言 idle 性能。
- 独立 off 后布局与导航继续正常，on 后立即恢复真实 active window 的归属；全屏隐藏 / 退出恢复、窗口关闭清理沿用既有验收。
- 新增 CLI 降级路径以隔离回归验证；真实内屏不通过删除插件、重启 KWin 或破坏配置制造故障。

## 完成条件

CLI 可选 Ring 自动恢复失败不影响核心启动的成功语义；显式 on 失败如实返回；相关回归与完整门禁通过；POC 文案清理；内屏 DoD 与证据一致；没有持续错误或 Ring 引入的静态全屏重绘。记录支持范围，双屏不作为本阶段完成条件。
