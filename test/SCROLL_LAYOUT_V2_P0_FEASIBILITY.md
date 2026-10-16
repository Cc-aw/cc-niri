# Scroll Layout V2 P0 可行性报告

日期：2026-10-14。基线/测试目标：`8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`。
开发分支：`scroll-layout-v2-p0`。

**更新：基本平台可行性 PASS（安全两次点击退路），V2 仍不可部署。**
当前结论、真实 Native 输入/截图/IME/Ring、完整门禁与限制见
[P0 输入/裁切续报](SCROLL_LAYOUT_V2_P0_INPUT_RESULTS.md)。
下面保留初始调查的历史记录；其中 BLOCKED/NOT RUN/NOT MEASURED 不代表续报后的最新覆盖情况。

**初始调查结论（历史，已由上方续报补充）**：当时已落地离线模型、只读基线清单和隔离 KWin API/几何 fixture，
但尚无真实 Native 输入证据，输入能力为 **INCONCLUSIVE**、安全门禁为 **BLOCKED**。
续报已验证安全两次点击退路的基本平台可行性；完整原生映射与生产 V2 验收仍不能据此宣称通过。

## 1. 范围和基线

- 开始时 HEAD 与设计基线相同，没有已跟踪文件差异。用户提供的实现规范原本未跟踪，保留原文件。
- 新增内容仅为 `test/` 中的模型/fixture/证据/报告，以及 `tools/scroll-layout-v2-p0-probe.py`。
- 没有改变生产布局、配置 schema、协议、Rust/C++、FFI、冻结 Golden 或生成模块。
- 没有向当前桌面加载 fixture、切换输出、修改窗口、安装、stop/start 或卸载组件。
- 实机清单来自只读 D-Bus/服务查询及文件 SHA；虚拟 fixture 使用独立 D-Bus、临时 XDG
  config/data/cache/state/runtime、QPainter、两个 Virtual 输出和两个无边框测试客户端。
  runner 只操作其测试客户端，回收其子进程；最终证据记录 `owned_processes_reaped=true`。

只读当前会话证据：[inventory.json](scroll-layout-v2-p0-evidence/20261014/inventory.json)。
KWin 6.7.5、Qt 6.11.2、Wayland；DP-1 逻辑 `0,0,2560×1440`、scale 1.5、60 Hz；
HDMI-A-1 逻辑 `2560,0,2560×1440`、scale 1、60 Hz；eDP-1 disabled。
CC-Niri Script、Scroll Transition、Clip、Ring 均加载，Bridge service active/running。
Scroll 状态显示 Rust backend、smooth60、420ms workspace motion、D1a/D2 关闭。
这是现有桌面的状态快照，**不是受控 B0/B1 或 V2 实机验收**。

| 已安装文件 | SHA-256 |
|---|---|
| Script main.js（与仓库生成文件一致） | `2154436e0c97251eecadadd13bb533dfedfd2146cb0dd1fff34693ad6c9814f2` |
| Bridge | `2f923a1a158fafb3bf61bf7234aa13562702d164ba97e904b116e3823d76b3f6` |
| Clip immutable artifact | `1c8c3d0174c572e3412d4e1c968bb3811e23e718f9aff7b0be2bc541b6372726` |
| Ring immutable artifact | `994e939d1c9e314d150728b13dbc250adc462f5deef652bb857f2d76716defa4` |

安装路径解析和构建树 SHA 见清单。Native/Bridge 构建树文件 SHA 与已安装文件不同；
不能据此认定源码不同，也不能用构建树 CTest 宣称当前加载二进制已被同样验证。
没有核验当前进程映射的实际 ELF SHA，**loaded-binary SHA attribution：INCONCLUSIVE**。
Rust/Cargo 使用 1.99.0；`/usr/bin/g++` 为 GNU 16.2.1；没有改变工具链。

## 2. 可复现实验及判定

| 项目 | 判定 | 证据和覆盖边界 |
|---|---|---|
| 基线、分支及现有组件只读清单 | PASS | `inventory.json`；未改变当前桌面状态 |
| 真实 KWin 脚本 clientArea 接口 | PASS（无面板条件） | `clientArea(MaximizeArea, output, desktop)` 可调用，枚举值为 2 |
| 无面板 WorkingArea | PASS（无面板条件） | 两个 Virtual 输出分别返回自己的完整逻辑区域 |
| 面板独占区域、自动隐藏面板、工作区差异 | NOT MEASURED | 未创建 layer-shell panel fixture；不能将无面板结果推广到 strut 语义 |
| 安全锚点保留主输出归属 | PASS（测试客户端） | B 的 frame `[1304,66,1256,1358]` 归属 Virtual-0 |
| 直接提交越界 visualRect 的反例 | PASS（风险复现） | B 的 frame `[2136,66,1256,1358]` 归属变为 Virtual-1 |
| 返回锚点后输出恢复 | PASS（测试客户端） | 再提交 x=1304，outputChanged 返回 Virtual-0 |
| Wayland resize 异步收敛 | PASS（测试客户端） | 请求 1680 后立即读到 1256，随后 frame-changed=1680；反向亦然 |
| configure/ack_configure serial 和迟到 ACK | NOT MEASURED | 观察了 frame/Qt resize，不是 Wayland wire serial/ACK trace |
| 左/右/双侧 partial、尺寸不缩小、负输出 origin | PASS（模型） | 纯几何模型与生产 Projection；不是实际 Native projection |
| Surface/Ring 输出裁切、100–200% 取整 | PASS（模型及既有 CTest） | 模型边缘误差 ≤0.5 physical px；既有 clip/transform CTest；V2 真实绘制待验证 |
| Native projection 下真实 surface/Ring/副屏无泄漏 | NOT MEASURED | virtual fixture 未加载 Clip/Ring，没有截图/视频证据 |
| 真实命中和客户端局部坐标重映射 | INCONCLUSIVE | 模型复现错误窗口与坐标偏差；未在 Native partial 中测试真实输入 |
| 两次点击 press/release、wheel、grab 退路 | PASS（要求模型）/INCONCLUSIVE（平台） | requirements oracle 已测试配对及等待实际 geometry；没有生产输入过滤器 |
| touch/tablet、drag、标题栏、popup、IME、screen edge | NOT MEASURED | 未模拟客户端输入或绕过 Wayland serial/grab |
| 4K60、长期生命周期、全项目 PSS/Private_Dirty/GPU | NOT MEASURED | P0 未开展性能/内存测量，不能宣称达到预算 |

隔离 fixture 的机器判定为 `PASS_API_FIXTURE_ONLY`，9 项检查全部为 true。
实验输出为两个 `2560×1440@scale=1` Virtual 输出、60 Hz、QPainter，无面板、无项目插件。
这与现有 DRM/OpenGL 混合 DPI 桌面不同，不能替代实机验证。

原始证据：

- [isolated.json](scroll-layout-v2-p0-evidence/20261014/isolated.json)：命令、scope、API 记录、9 项断言和进程回收。
- [clients.log](scroll-layout-v2-p0-evidence/20261014/clients.log)：frame、outputChanged、request 和客户端 Resize 原始记录。
- [runner.json](scroll-layout-v2-p0-evidence/20261014/runner.json)、[kwin.log](scroll-layout-v2-p0-evidence/20261014/kwin.log)：启动器退出码和 compositor 输出。
- 没有生成模拟截图；没有真实 V2 截图或视频，相关视觉验收为 NOT MEASURED。

## 3. 当前源码/API 限制

1. `native/viewport-clip/ViewportClipEffect.cpp` 的 `ViewportInputClip::apply()` 临时隐藏被
   runtime/handoff 判为 blocked 的 client，保留 scene visible ref，在 paint/event idle 恢复。
   `pointerButton()`、motion/axis/touch/tablet 路径继续返回 false，把事件交给 KWin 原链。
   它没有基于 visualDelta 重写客户端局部输入坐标，也没有消费首次 partial 点击的配对状态。
2. Rust `scroll_runtime.rs::input_blocked()` 只按 viewport 外边界和 membership 阻止输入，
   不按各列实际 visualRect 命中。安全 real frame 可能互相覆盖；只检查 OutputRect 不足以
   阻止背景 B 在视觉 A 区域被命中。`projection()` 对 source/target geometry 做 near 校验，
   未知 ACK 中间几何不会自动成为可信 source。
3. 模型中右 partial B 的 visual x=2136、real x=1304，translation=832。点击 x=2200 时，
   应用应收到局部 x=64；按真实 frame 换算则为 x=896。左 partial 的误差符号相反。
   这是无边框单 surface 模型；装饰、子 surface、popup 还需要独立平台实验。
4. 安装的 KWin headers 确认 `InputEventFilter` 返回 true 可停止下游链，
   `InputDeviceHandler::setFocus()` 可更换输入 focus；`Window::mapToLocal()` 和
   `inputTransformation()` 对应真实窗口坐标。它们本身不能证明视觉投影交互正确。
5. `/usr/include/kwin/wayland/seat.h` 确实存在
   `setFocusedPointerSurfaceTransformation()` / `notifyPointerEnter(..., transformation)`。
   这是值得验证的原生指针映射候选；位置变化会重置变换，而且仅有此接口并不能证明
   hover/hit-test、decoration、implicit grab、touch/tablet、DnD 和 subsurface 全部一致。
   不宣称“没有任何原生映射 API”。
6. `core/output.h` 暴露给 Qt/脚本的缩放属性名为 `devicePixelRatio`，READ accessor 是
   `scale()`。fixture 使用前者，避免把 JS `output.scale` 的 undefined 当作实测 scale。
7. `native/common/ViewportPaintClip.h` 会为 Ring padding 扩展 viewport clip；最终 region
   还受原 deviceRegion 限制。`FocusRingEffect.cpp` 又以 owner output region 限制 Ring 绘制。
   V2 surface 与 glow 必须在每个输出 pass 同样严格证明输出边界，不能只扩大旧 SafeArea。
8. Rust `carry`/`use_smooth` 仍拒绝 partial 的速度继承；原 `SCROLL`/`COLUMN_REINDEX`
   校验不等于 V2 typed 几何/输入能力。P0 没有放宽 validator 或移除这些保护。

## 4. 验证命令

| 命令 | 退出码 | 结果/耗时 |
|---|---:|---|
| `python3 tools/scroll-layout-v2-p0-probe.py --inventory` | 0 | PASS；只读；约 0.13s |
| `python3 tools/scroll-layout-v2-p0-probe.py --isolated` | 0 | PASS_API_FIXTURE_ONLY；有界运行；详细时间见证据 |
| `node test/scroll-layout-v2-p0-feasibility.test.js` | 0 | 12/12 PASS；约 0.03s |
| `python3 -m py_compile tools/scroll-layout-v2-p0-probe.py` | 0 | PASS |
| `node tools/build.js` | 0 | PASS；生成包无变更 |
| `node tools/build.js --check` | 0 | PASS |
| `node tools/check.js` | 0 | 107 个测试文件 PASS；约 44.60s |
| Clip CTest（下面的筛选命令） | 0 | 4/4 PASS；5.32s |
| Ring CTest（下面的筛选命令） | 0 | 2/2 PASS；1.22s |

```sh
ctest --test-dir build/native-viewport-clip --output-on-failure \
  -R '^(scroll-viewport-runtime|scroll-runtime-contract|scroll-runtime-differential|scroll-animation-frame-context)$'
ctest --test-dir build/native-focus-ring --output-on-failure \
  -R '^(focus-ring-viewport-decoration-clip|focus-ring-visual-transform)$'
```

门禁原始日志：[checks.log](scroll-layout-v2-p0-evidence/20261014/checks.log)、
[model.log](scroll-layout-v2-p0-evidence/20261014/model.log)、
[clip-ctest.log](scroll-layout-v2-p0-evidence/20261014/clip-ctest.log)、
[ring-ctest.log](scroll-layout-v2-p0-evidence/20261014/ring-ctest.log)。
完整 Rust fmt/clippy/test、`node tools/check.js --native`、Core Debug/Release umbrella、
OFF 生产边界与编译器拒绝路径：**NOT RUN**，本次没有修改 Native/FFI/CMake/工具链或构建逻辑。
所选 CTest 只验证既有构建树，不替代完整 Native Gate。

## 5. 解锁条件、后续边界和回滚

P0 尚须在相同隔离基础上加入 Native visual projection 与合法的真实输入源，记录：

1. 真实命中 ID、surface-local 坐标、press/release 和 Wayland serial，覆盖左/右/双侧 partial、
   hover、wheel、touch/tablet、decoration、grab/DnD、popup/menu/IME、跨屏移动。
2. 若原生坐标路径不能安全覆盖，验证两次点击过滤器；第一次必须只发布聚焦意图并消费完整
   序列，第二次仅在 real geometry 与视觉内容一致、Native ownership/epoch 有效时放行。
   oracle 不能作为此平台能力的证据，JS 仍是布局/焦点意图权威。
3. Source/target/configure ACK/旧 epoch、取消、窗口销毁、output 移除、effect 卸载和 stop 的
   真实恢复证据；不得在 grab 中把输入交给错误客户端。
4. 面板 exclusive-zone/WorkArea fixture，以及 surface、Ring/glow 的实际输出裁切截图/视频。

在上述输入/输出安全证据不足时，P3 保持 **BLOCKED**；P1 的纯几何工作可以离线推进，
但不能把它当作 P0 已通过，更不能在当前桌面启用 V2。

回滚：本次没有部署或运行中组件变化，无需 stop/install/start。生产 V1 保持基线。
只需停止使用新增 probe/fixture；临时配置和 socket 已随 runner 清理。
若以后撤销本阶段，只撤销 P0 新增文件或相应阶段提交，保留用户的规范及其他工作树修改；
不 reset/stash、不覆盖用户快照、不操作用户应用。
