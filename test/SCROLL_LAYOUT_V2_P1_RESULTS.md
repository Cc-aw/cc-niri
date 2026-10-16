# Scroll Layout V2 P1：纯几何与三档列宽

日期：2026-10-15。基线 HEAD：`8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`；
开发分支：`scroll-layout-v2-p0`。本阶段工作树未提交，保留既有 P0 文件和用户提供的设计规范。

**状态：P1 离线实现 PASS；V2 运行时 NOT READY / 未部署。**
用户接受 P0 的安全两次点击退路，并说明主要使用 H/L 导航。
P0 证据见 [输入/裁切报告](SCROLL_LAYOUT_V2_P0_INPUT_RESULTS.md)。

## 实现范围

- `ContinuousColumnLayout.js` 实现独立 V2 纯几何：`max(1,floor((W-g)*p-g))`，
  half/twoThirds/full、prefix sum、统一 gap、leading/trailing inset、stripEnd 和非负 camera。
  不改 V1 `ColumnLayout.js` / `SafeArea.js`。
- `focusV2Camera()` 从调用方给出的 camera 求目标：twoThirds 总是居中；多列 half/full 以最小位移 fit；
  单列居中。改变焦点不改变列宽和逻辑位置。它不决定真实焦点、不创建动画、不以旧 target 替代 painted pose。
- `ColumnStore` 和 `ColumnWidthController` 只有明确构造参数 `scrollLayoutV2Enabled:true` 才接受三档。
  cycle 严格 `half → twoThirds → full → half`；toggleFull 恢复各列进入 Full 前的 half/twoThirds。
  保留窗口/列 identity、persistentWide 兼容元数据，以及 capture/cancel/clear/focus/recompute/fit/relayout/commit 次序。
- KConfig、配置 UI 与 `RuntimeConfig` 增加 `ScrollLayoutV2Enabled=false`、`ScrollLayoutGap=16`。
  gap 配置限制为有限整数 0–1000，几何层再按实际 WorkingArea 限制，异常值有诊断。
  配置只在启动时读取，未添加帧内切换。
- `OutputTopology.v2Geometry(output, desktop)` 仅针对配置选中的主输出，优先调用真实 clientArea provider；
  面板 WorkArea、物理 OutputRect、physicalScale 分开。API 不可用/区域无效时显式标记 fallback，
  使用保守旧 SafeArea；无法得到可信区域时返回 null。副屏继续用既有 SafeArea。
- logical 列宽与 camera 不乘 DPI；`v2DeviceRect()` 在输出映射边界按相同规则取整两端，再计算尺寸。
  partial 的可见区域取 OutputRect 交集，不将列宽缩成可见条带。
- 用 `node tools/build.js` 注册并生成新模块；main 手写编排仅注入 WorkArea provider 和未就绪提示。
  没有手改生成模块段，没有 Native/Rust/FFI/Bridge/schema/Spring/Golden 改动。

## 提前启用保护

P1 还没有混合宽度 runtime、Native input protection、typed geometry ACK 和 V2 快照契约。
因此本构建的 V2 UI 开关/gap 控件暂不可选；即使用户手工将配置设为 true，
生产入口也仅提示未就绪并继续 V1，**不会把 twoThirds 写入旧生产协议**。
离线测试通过构造参数验证 V2 Store/Controller；这不表示桌面 Meta+R/Meta+F 已启用三档。
既有 H/L/J/K、half↔full、Wide、Fullscreen、副屏和快照迁移保留 V1 行为。

后续 P2 消费这些纯函数，接入统一视口/工作区事件；P3 实现真实 partial paint/input/ACK；
P5 才扩展持久化。不得仅凭本阶段函数可算出视觉矩形就把它直接提交为跨屏真实 frame。

## 离线验证

新增两个文件，共 16 个具名测试：

- [geometry](scroll-layout-v2-geometry.test.js)：10 项。含 half+half、twoThirds+half、half+twoThirds、
  full+half、五列混合，左右/双侧 partial、单列/首尾居中、负 output origin、50px panel、
  WorkArea fallback、空列/窄屏/大 gap/nonfinite/strip overflow 和 H/L 目标序列。
- [width-cycle](scroll-layout-v2-width-cycle.test.js)：6 项。含严格循环、各列 Full 记忆、V1 归一化、
  fullscreen/floating/secondary/switching/disabled/null no-op、默认配置、真实生成入口提前启用保护。
- 几何矩阵：3 个逻辑宽度（2559/2560/2561）× gap 0/16 × scale 1/1.25/1.5/1.75/2；
  五组列组合逐列设焦点，共 390 个 target layout，1230 个列投影检查。
  device edge 误差 ≤0.5 physical px，宽/高和 center 误差 ≤1 physical px；不是实机混合 DPI 验收。
- `W=2560,g=16` 得到宽 `[1256,1680,2528]`，双侧 inset=652。
  twoThirds+half、焦点首列：camera=212、x=[440,2136]、右邻仅露424；双 half fit：camera=636、x=[16,1288]。
- KConfig XML 解析和 Qt `QUiLoader` offscreen 载入通过；V2 开关关闭且控件 disabled，gap 默认16/最大1000。

执行命令：

```sh
node tools/build.js
node --test test/scroll-layout-v2-geometry.test.js test/scroll-layout-v2-width-cycle.test.js
CMAKE_BUILD_PARALLEL_LEVEL=2 node tools/check.js --native
```

| 检查 | 退出码 | 结果与范围 |
|---|---:|---|
| `node tools/build.js` / `--check` | 0 | PASS；生成模块一致 |
| P1 两文件单独运行 | 0 | PASS；16/16；[原始 TAP](scroll-layout-v2-p1-evidence/20261015/p1-tests.log) |
| `node tools/check.js --native`，parallel=2 | 0 | PASS；110 个 JS 测试文件，Node 147 项，fail=0；JS 44.56s |
| Rust fmt / locked workspace all-targets clippy `-D warnings` / locked workspace test | 0 | PASS；精确1.99.0，71 tests，doc tests 0 |
| 既有 Bridge configure 产物 build / CTest | 0 | PASS；18/18，14.14s |
| Bridge private-bus restart/workspace/SCROLL/legacy/compatibility | 0 | PASS；不连接桌面 bus |
| 既有 Clip build / CTest | 0 | PASS；18/18，8.38s |
| 既有 Ring build / CTest | 0 | PASS；25/25，21.36s |
| Native boundary / Plasmoid build | 0 | PASS；三个生产产物无 Legacy C++ policy |
| KConfig XML / Qt config UI offscreen | 0 | PASS；未显示窗口或连接桌面 |
| `git diff --check` | 0 | PASS |

完整原始日志：[native-gate.log](scroll-layout-v2-p1-evidence/20261015/native-gate.log)。
源码/产物哈希与命令记录：[verification.json](scroll-layout-v2-p1-evidence/20261015/verification.json)。
本阶段没有 CMake/FFI/Core 改动，未额外重跑 Core Debug/Release、umbrella、OFF 构建；不把 P0 的历史检查追记为本次结果。

## 资源、限制与回滚

- 源码账本：新增配置/模式 flag O(1)；几何推导按当前列数 O(N)，返回值由调用方使用，不在模块留历史缓存。
  focus target 仅做数值计算，未新增逐帧布局/JSON。新增常驻服务、线程池、动画时钟、全屏/窗口图像、纹理均为0。
- **NOT MEASURED**：V2 特性 PSS/Private_Dirty/GPU、对象/纹理计数、framePresented、4K60 与30–60分钟生命周期。
  无受控 B0/B1，不宣称满足全项目≤32/64MiB或特性≤2/8MiB目标；账本见全项目资源报告的 P1 补充。
- **NOT IMPLEMENTED**：V2 H/L 连续 retarget、真实激活/动画、Native two-click input、通用宽度 ACK、
  V2 workspace mount/快照迁移、真实 Meta+F/Meta+Z 切换。
- **NOT RUN**：本阶段实机部署、用户视觉验收、真实 DRM/同时混合 DPI、实际 Fcitx5 配置和安全 stop/restore。
  完整自动门禁不能替代上述验收；不启动 P2 或更改当前桌面。
- 运行桌面没有安装/配置/stop/start 变更，无需桌面回滚。
  撤回本阶段时逐文件撤销 P1 源码/配置/手写编排与模块清单，移除 P1 新增文件，再 `node tools/build.js`；
  保留 P0、用户规范和其他工作树文件，不做整体 reset/stash。
