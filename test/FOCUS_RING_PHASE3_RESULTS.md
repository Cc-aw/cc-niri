# Focus Ring Phase 3：同帧 Visual Transform

日期：2026-10-04。实现与自动验证完成；第三阶段已单独部署并启用，自动加载 / 独立重载检查通过，主屏人工验收进行中。当前边框仍为 3px。

## 实现

- 新增独立 `native/focus-ring/FocusRingPaintFrame.{h,cpp}`，保存一次 `paintWindow` 调用里的 owner Item、原生位置 / transform / opacity、WindowPaintData、mask 和 device region；值只存在于该调用栈，不保存上一帧、不读取时钟或布局目标。
- FocusRingEffect 在项目 Script motion 与 Native viewport clip 之后（chain position 96）捕获当前帧，委托 KWin 完成窗口绘制，再用同一帧绘制独立边框。保留 paintWindow 路线，避免 drawWindow 的递归离屏捕获重新引入跨应用色差。
- FocusRingItem 使用捕获的位置和 Item transform，直接传递已有 WindowPaintData 的 translation / scale / rotation 及 native device clip；不重新计算 Spring，不另设 easing，不修改 frameGeometry。
- 修复原生 Item opacity 遗漏：独立边框根节点现在使用捕获的 Item opacity，WindowPaintData opacity 仍由 renderer 叠加，两层各一次。原先 native opacity=0.55、动画 opacity=0.8 时，边框误为 0.8；现在与窗口一致为 0.44。应用 brightness / saturation 仍归一为 1，浅蓝材质独立。
- 捕获后 owner 改变时不能将旧帧画到新 owner；Item 销毁由 QPointer 保护。完全透明的窗口帧或空 device region 跳过边框绘制。
- 3px、#7FC8FF、圆角、唯一 owner、独立资格接口与开关保持既有实现。诊断 phase 更新为 `visual-transform`，新增 `paintSource=window-paint-pass` 供后续确认已加载的新库。
- 未增加 DBus / KWin role、协议字段、timer、每帧日志、独立 GL 资源或持续 repaint。Spring 源码只链接进新测试，Ring 插件没有 Spring / scroll 状态依赖。

## 自动验证

- 先为已有真实 KWin Item 绘制测试增加两层 opacity 回归；修改前失败，日志 `/tmp/cc-niri-focus-phase3-before.log`。修改后通过。
- 扩展 `focus-ring-isolated-paint`：translation / 非等比 scale、Item transform、应用色彩隔离、两层 opacity、捕获后位置 / transform / opacity 改变、旧 owner 帧拒绝、零透明度 / 空裁剪、销毁与卸载安全。
- 新增 `focus-ring-visual-transform`：实际生产 ScrollViewportRuntime + ViewportMotion + Spring 与实际 Ring Item / PaintFrame 组合；左右方向、continuing / incoming / outgoing、8 个采样时间、1 / 1.5 / 2 device scale，共 144 个窗口与边框样本。
- 每个样本严格比较边框与源窗口送入 renderer 的矩阵、mask、device region 和实际 opacity。完全在 viewport 外的 incoming / outgoing，其投影 bounds 与 device clip 无交集。
- 几何提交回归同时检验：捕获源窗口后提交真实位置，边框仍严格使用源绘制矩阵；源与目标原生矩阵视觉连续。QMatrix4x4 使用 float，坐标运算顺序的最大差为 0.00012207，测试限制 0.001；不是放宽边框与源矩阵的严格相等检查。
- 取消 native scroll 后静态帧为 identity paint transform，边框不保留旧 Spring 位移。
- `cmake --build build/native-focus-ring` 成功；该目录全部 6 项 CTest 通过。日志 `/tmp/cc-niri-focus-phase3-final-native.log`。
- `node tools/check.js`：85 个 JS 测试文件、生成包一致性及 diff whitespace 通过。日志 `/tmp/cc-niri-focus-phase3-js.log`。

测试验证真实 KWin Item 和绘制参数，使用捕获 renderer，不创建 GL context。设备像素、实机圆角效果与真实滚动画面仍需要后续人工确认；1.5 / 2 的参数检查不代表 Phase 6 缩放实机验收通过。

## 部署与待验收

本阶段只需要更新 Ring 原生库，布局 Script、动画 Effect、Native Clip 与 Bridge 不需要配套升级。本轮采用现有 immutable 安装器和独立 focus-ring off/on 完成部署：

- 新 canonical：`~/.local/lib/cc-niri/focus-ring/399751fceefb723f68514d887c6642259ecc84d0b24b20ce03c956fe46a87db4/cc-niri-focus-ring.so`。旧 Phase 2 的 3px canonical 保留。
- 安装产物 SHA256 与独立 staging 结果一致。CMake 调整 install RPATH，因此构建树 hash 为 `7502d7e99d503ce81cccc01b0766d81801075f97ffbd0f0b84ed9251200ec527`，安装 hash 为 `399751fceefb723f68514d887c6642259ecc84d0b24b20ce03c956fe46a87db4`；部署脚本按安装产物校验。
- 新接口确认 `phase=visual-transform`、`paintSource=window-paint-pass`、width=3、color=#7FC8FF，独立资格 enabled=true。
- 首次新版本加载获得 generation=250、eligibleCount=2；再次独立 off 后 effect 卸载且 endpoint 删除，on 后获得同一独立 session 的新名单 generation=251。布局始终保持加载。
- 布局 Script、动画 Effect 与 Viewport Clip 的安装文件 hash 前后相同；动画仍包含已验收的 Wide 邻窗修复，Clip / Bridge / Dock 二进制未替换。
- 部署前后 KWin PID 均为 2088，没有重启 KWin / Plasma；日志只有预期 READY，无新增运行异常或崩溃。
- 最初快照 owner 为空、drawCount=0，仅表示当时没有符合条件的当前焦点窗口，不据此宣称实际绘制或贴合验收通过。

成功部署备份与命令审计：`/tmp/cc-niri-focus-phase3-backup-20261004-fng_qf28`，包括旧库路径、kwinrc、manifest.json、commands.json、result.json 和 KWin 日志。辅助脚本 `/tmp/cc-niri-focus-phase3-deploy.py`，失败时恢复旧版本库链接并重新开启边框。

首次部署辅助校验误把安装产物与构建树原始 hash 比较，因为 RPATH 调整而误报。已自动恢复第二阶段 3px 版本，KWin PID 未变；该次新库未进入启用检查。审计保留于 `/tmp/cc-niri-focus-phase3-backup-20261004-4wygfoyy`。改为独立 staging 安装 hash 校验后重新部署成功；未因此修改插件源码。

主屏人工验收步骤：

1. 同工作区至少 3 个半宽窗口，慢速 Meta+L 两次、Meta+H 两次，确认当前边框随窗口连续移动，不提前跳目标、不延后一帧。
2. 检查左右 viewport 边缘，移动中的边框与窗口一同裁剪，没有独立残留或重影。
3. 滚动中 J/K 往返与独立 off/on，确认新模块没有保留旧位移或旧 owner。

人工验收进度：

- 第一轮通过：用户反馈“贴合、裁剪都正常”，确认慢速 Meta+L 两次、Meta+H 两次时边框紧贴当前窗口，没有提前 / 延后、错位或重影；左右视口边缘与窗口一起裁剪且无残留。
- 第二轮滚动中 J/K 往返与独立 off/on 清理 / 恢复已邀请测试，待用户反馈，尚未标记第三阶段实机全部通过。

本阶段不把快速连续反向的完整矩阵、Wide / Maximize 的固定线宽、主屏最终像素清晰度提前标记完成；分别留给 Phase 4、5、6。双屏按用户范围暂缓。

## 绘制链核对依据

本机 KWin SDK 6.7.5；同时核对 KDE 官方对应版本源码：[WorkspaceScene](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/workspacescene.cpp)、[AnimationEffect](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/effect/animationeffect.cpp)、[ItemRendererOpenGL](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/scene/itemrenderer_opengl.cpp)、[OffscreenEffect](https://raw.githubusercontent.com/KDE/kwin/v6.7.5/src/effect/offscreeneffect.cpp)。窗口 paint 链最终进入 draw 链；离屏捕获递归 drawWindow，因而独立边框保留在 paintWindow 返回后。Root Item 的原生位置、transform、opacity 与 WindowPaintData 共同参与实际绘制，测试按该组合核对参数。
