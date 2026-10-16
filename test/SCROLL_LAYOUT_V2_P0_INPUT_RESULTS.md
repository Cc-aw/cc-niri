# Scroll Layout V2 P0 Native 输入/裁切续报

日期：2026-10-14；基线：`8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`；分支：`scroll-layout-v2-p0`。

**结论：基本平台可行性 PASS，选择安全两次点击退路作为后续实现路径。**
初始报告的“尚无真实 Native 输入证据”阻塞已解除。这个结论限于下面明确列出的隔离实验；
不是完整 V2 功能验收，也不是“所有输入设备都与 niri 等价”。
V2 未部署，P1 尚未开始；生产协议/动画/安全恢复的实现与全量验收仍属 P2–P6。

## 范围与隔离

新增测试插件位于 `test/fixtures/native-p0/`，只有 `BUILD_TESTING=ON` 能 configure，
没有 install 规则，不进入生产 Bridge/Clip/Ring 的构建或链接。
工厂和每个变更入口要求临时 XDG/runtime 标记、私有 D-Bus 环境，以及两个名为
Virtual-0/Virtual-1 的输出；运行工具不接受安装产物替代构建树插件，拒绝过期测试插件。
测试 JavaScript 决定测试窗口几何和激活，C++ 仅消费已收敛的测试矩形、执行 paint/input 实验和观察平台事实。

每次运行有 28s 主进程组期限和有界清理，最多约 35s；只回收自身进程组。
配置、数据、缓存、状态、runtime 均在临时 XDG 目录；Fcitx 要求 HOME，测试只继承原值，
不把 HOME 当作测试目录。Fcitx 使用临时 profile、本地拼音词库和合成文本，禁用 cloudpinyin/clipboard/notifications。
没有安装、重启、停用或卸载当前桌面组件，没有改变物理输出模式或操作用户窗口。

输入由测试入口调用 KWin 的 Pointer/Touch/KeyboardInputRedirection，再经过原生 filter、Seat 和 Wayland 客户端。
没有直接伪造客户端 button/触摸事件或绕过 Wayland serial；DnD、popup 和 startSystemResize 使用客户端收到的真实测试 serial。
这验证 compositor/客户端输入链，**不覆盖实际 libinput 硬件驱动行为**。

OpenGL 实验使用 KWin Virtual backend 的离屏 Mesa Intel UHD Graphics (CML GT2)，没有 DRM 扫描输出。
`LIBGL_ALWAYS_SOFTWARE` 未能强制该 backend 使用 llvmpipe，日志中保留实际 renderer；不标记为软件渲染。
截图借用已有 framebuffer，GL 路径只对显式捕获读取已有 color attachment，没有新增 GL texture/FBO。
读回的 CPU QImage 和 PNG 编码只存在于有界测试捕获，不进入生产绘制路径或持久缓存。

真实 Focus Ring 来自现有 `build/native-focus-ring/bin`；只在私有 KWin 中加载。
它继续使用 Rust geometry/eligibility/fade 和真实 KWin focus。测试 Adapter 在已有 paint pass 上提供共享帧事实，
没有新增动画 timer/Spring/Ring owner。没有更改生产源码、Rust/FFI、冻结 Golden 或 JS schema。

## 最终实验结果

| 条件 | 检查数 | 结果 | 原始证据 |
|---|---:|---|---|
| 双 Virtual 输出、100%、2560×1440 framebuffer | 49/49 | PASS_BASIC_TWO_CLICK_FIXTURE_ONLY | [100%](scroll-layout-v2-p0-evidence/20261014/native-input/input-results.json) |
| 双 Virtual 输出、150%、逻辑 2560×1440 / framebuffer 3840×2160 | 49/49 | PASS_BASIC_TWO_CLICK_FIXTURE_ONLY | [150%](scroll-layout-v2-p0-evidence/20261014/native-input-150/input-results.json) |
| 100% + 隔离 Fcitx5/Pinyin | 53/53 | PASS_BASIC_TWO_CLICK_FIXTURE_ONLY | [Fcitx5](scroll-layout-v2-p0-evidence/20261014/native-input-fcitx5/input-results.json) |

三次最终实验使用同一测试插件 SHA：
`9f19366b0d4316a9aac9718765da26626e8b3e54342840632ec8f4e3911fa4c3`。
各次实际 Ring SHA、renderer、配置前/后 output support、状态、客户端事件和回收结论均在 JSON 中。

覆盖与结论：

- **PASS**：直接锚定真实 frame 于主输出，同时 Native paint 将完整 client 投影到左/右/双侧 partial。
  严格按 OutputRect 裁切；每组捕获不仅取样，还检查整张副输出 RGB 全黑，无窗口/Ring 像素泄漏。
- **PASS（风险复现）**：无保护时，visual B 的 x=2200 应为局部 x=64，客户端实际收到 x=896；
  visual A 区域 x=1500 会被真实重叠 B 命中。这些是已验证的坏路径，不是选定方案。
- **PASS（选定退路）**：partial 的 pointer press/release 和 wheel 被消费，首次只向 JS 测试控制器发布聚焦意图。
  半透明/部分绘制邻居保持完整 client 宽度，没有缩成可见条带；被遮挡的前景 A 收到自己的正确坐标。
- **PASS**：关闭窗口、改变 geometry/epoch 时，已消费 press 对应的 release 不转交客户端；第二次点击完整可见 B 时
  原生 spontaneous press/release 坐标为 x=48；stale epoch 拒绝，最终按钮/touch 状态归零。
- **PASS**：partial touch down/move/up 消费；左右及双侧 partial 发布正确目标的意图；跨输出点按不落到主输出 client。
- **PASS**：指针跨副输出、右邻、前景、左邻后只向前景 A 分发 enter/motion，局部 x=1060；masked 邻居没有 hover 事件。
  x=0/2559 的首次点按分别只请求左/右邻聚焦，x=2560 不发主输出聚焦意图，也没有 client button。
- **PASS**：JS 请求原生 maximize 后 A 为 `[0,0,2560,1440]`、output=Virtual-0；unmaximize 恢复 `[440,66,1680,1358]`。
  重新建立 partial 后首次点击仍只请求 B 聚焦，所有真实 frame 仍在主输出；这是平台循环，不是尚未实现的 V2 Meta+F 行为。
- **PASS**：原生 popup grab、Modal、真实 Wayland DnD 不转化为列聚焦；菜单由原生链关闭，DnD grab 正常结束。
- **PASS**：partial 标题栏首次只聚焦；完整可见的标题栏执行原生 interactive move；客户端用 press serial 请求
  `startSystemResize`，KWin 实际进入并退出 interactive resize，未留下按键/grab。
- **PASS**：layer-shell panel 的 50 logical px exclusive zone 令主输出 WorkArea 为 `[0,50,2560,1390]`，
  副输出不变；将 zone 设为 0 并等待 surface commit 后恢复 `[0,0,2560,1440]`。
- **PASS**：构建树的真实 Rust Ring 跟随 Native translation，原真实 x=438 处没有残留边框；
  投影边缘处有 Ring 像素，输入 mask 与 Ring 共存，副输出全黑。shared paint samples/owner/output 状态有日志。
- **PASS**：私有 Ring 卸载；测试 effect 带 live input mask 卸载后 masked/hidden test windows/entry refs 均为 0。
  所有自身进程回收；不是当前桌面 `cc-niri stop` 的验收。

图像证据（真实 compositor framebuffer，非模拟绘图）：

- [双侧 partial 主输出](scroll-layout-v2-p0-evidence/20261014/native-input/fallback-both-Virtual-0.png)
- [对应副输出](scroll-layout-v2-p0-evidence/20261014/native-input/fallback-both-Virtual-1.png)
- [Ring 与 input mask](scroll-layout-v2-p0-evidence/20261014/native-input/ring-masked-Virtual-0.png)
- [4K / 150% partial](scroll-layout-v2-p0-evidence/20261014/native-input-150/fallback-both-Virtual-0.png)
- [Fcitx5 候选窗覆盖邻居](scroll-layout-v2-p0-evidence/20261014/native-input-fcitx5/ime-candidate-Virtual-0.png)

OpenGL 的第三方 ShapeCorners 会在窗口边界产生约一物理像素的 antialias；颜色断言取窗口内部，
布局几何和 output clip 边界另外核验。没有把 fully opaque 像素边界冒充逻辑 frame 边界。

## 输入方案选择及发现的缺口

**选安全两次点击退路。** 当前 Seat setter 原型在额外 motion 后能纠正局部坐标，
但第一次 `wl_pointer.enter` 已用真实 frame 发送 x=896，立即点击也可能沿用错误坐标。
因此不能将“设置 Seat transformation”直接当作完整原生映射，更不能删除现有 input protection。
这不证明所有可能的 KWin API 组合都无法实现原生重映射。
源代码说明与原始事件一致：[KWin pointer input](https://raw.githubusercontent.com/KDE/kwin/Plasma/6.7/src/pointer_input.cpp)。

Fcitx5 发现并修正了测试原型中的一个安全缺口：Qt/DBus 前端候选 UI 是**无 grab 的 popup**，
KWin 的 `isInputMethod()` 可为 false。只检查 active grab/Modal 不够，覆盖 partial 时会错误发布 B 聚焦。
失败证据保留在 [修正前记录](scroll-layout-v2-p0-evidence/20261014/ime-popup-before-guard/input-results.json)。
修正后，以原生 top-level 命中观察到的非列 popup/InputMethod 委派给 KWin；候选点击改变组合而不聚焦 B，
Return 确认后测试应用收到 `泥hao`（选中了第一音节的中文候选，余下输入保留拉丁字符）。
真实候选窗口、点击前后 hit/focus、组合变化、文本提交和截图都有记录，不能用一句“没有崩溃”替代这些断言。

生产 P3 必须正式设计 Rust 验证过的 projected hit/pairing 状态及 Adapter 的 native popup/grab/visibility 事实，
使用原 membership → motion → arm ACK → geometry → activation 顺序；不要把这个测试插件或其 caption 匹配模型装进生产。
新能力须 fail closed；按下/释放所有权要跨 epoch/窗口销毁保留到序列终点。

## 门禁和复现

```sh
cmake -S test/fixtures/native-p0 -B build/scroll-layout-v2-p0-fixture \
  -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build build/scroll-layout-v2-p0-fixture --parallel 2
python3 tools/scroll-layout-v2-p0-input-probe.py --isolated
python3 tools/scroll-layout-v2-p0-input-probe.py --isolated --scale 1.5 \
  --output test/scroll-layout-v2-p0-evidence/20261014/native-input-150
python3 tools/scroll-layout-v2-p0-input-probe.py --isolated --ime \
  --output test/scroll-layout-v2-p0-evidence/20261014/native-input-fcitx5
```

不要并发执行有固定期限的 GUI fixture 和重型构建/CTest；一次 Fcitx5 最终运行在并发门禁下提前断开，
该结果记 INCONCLUSIVE，门禁结束后独立重跑才通过。自动化隔离守卫拒绝正常桌面的 `--inside/--clients/--panel`，且不产生输出目录。

| 门禁 | 退出码 | 结果 |
|---|---:|---|
| Rust 1.99.0 fmt / locked clippy / locked workspace test | 0 | PASS；Rust 71 tests |
| `node tools/build.js`、`--check` | 0 | PASS；生成文件无改动 |
| 最终 `node tools/check.js --native`（parallel=2） | 0 | PASS；108 个 JS 测试文件、Bridge/Clip/Ring/Plasmoid、DBus、边界审计 |
| Core Debug configure/build/CTest | 0 | PASS；13/13，34.38s |
| Core Release configure/build/CTest | 0 | PASS；13/13，7.44s |
| Native umbrella Debug configure/build/CTest | 0 | PASS；30/30，46.60s |
| OFF Native 两插件及 Bridge Release 构建 | 0 | PASS；无 reference/differential targets，production symbol audit PASS |
| C++ 编译器策略与固定 Rust/Cargo 版本拒绝 | 0（测试器） | PASS；拒绝 GCC15/17、非GNU/路径和版本不符；仅元数据负向 fixture，未用其他工具链构建 |
| P0 fixture `BUILD_TESTING=OFF` | 非0（预期） | PASS_EXPECTED_REJECTION |
| 补齐边缘/hover/maximize 后模型与非隔离拒绝守卫复核 | 0 | PASS；15/15；两种比例及 Fcitx5 GUI 矩阵独立顺序重跑 |

日志：[最终 Native gate](scroll-layout-v2-p0-evidence/20261014/native-gate-final.log)、
[Debug Core](scroll-layout-v2-p0-evidence/20261014/debug-core.log)、
[Release Core](scroll-layout-v2-p0-evidence/20261014/release-core.log)、
[umbrella](scroll-layout-v2-p0-evidence/20261014/umbrella.log)、
[Rust/Cargo 拒绝](scroll-layout-v2-p0-evidence/20261014/toolchain-rejection.json)。

## 限制、阶段边界和回滚

- **NOT MEASURED**：真实 DRM 会话、主150%/副100%的同时混合 DPI、物理 tablet/libinput、IBus、原生指针锁/约束、真实桌面 J/K/H/L、当前 `cc-niri stop`/恢复。
- **NOT IMPLEMENTED**：V2 配置、三档持久宽度、纯几何模块、typed partial/column-geometry 生产能力、连续 spring retarget、快照迁移。P0 工具不是新运行时。
- **NOT MEASURED**：4K60 framePresented、30–60min 稳态、全项目 PSS/Private_Dirty/GPU、feature 增量与生命周期斜率。
  4K framebuffer 出现不等于 4K60 流畅度通过；截图和短测试不等于长期稳定性。
- P0 的基本平台可行性可以支持离线 P1；P3/P6 对上述真实功能/输入/资源项目仍须门禁，不能据此宣称 V2 READY 或直接部署。
- 测试前后当前脚本/已安装组件 SHA 与加载状态只读对照见 [结束清单](scroll-layout-v2-p0-evidence/20261014/post/inventory.json)。
  [机器对照](scroll-layout-v2-p0-evidence/20261014/post/comparison.json) 确认安装 SHA、脚本加载、Bridge service 和 loaded effect names 一致。
  安装文件 SHA 不等于已核验运行中 ELF 映射 SHA，后者仍 INCONCLUSIVE。
- 回滚无需 stop/install/start：停止使用测试工具即可。私有服务、窗口、socket、配置和 input masks 已有界清理；
  生产 V1 与用户提供的设计规范保留，撤销本阶段仅移除 P0 新增文件/相应阶段提交。
