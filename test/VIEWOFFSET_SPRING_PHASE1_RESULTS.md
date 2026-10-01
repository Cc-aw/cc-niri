# ViewOffset Spring — Phase 0 / Phase 1

2026-10-01，分支 `codex/native-view-offset-scroll`。
用户指定先实现 ViewOffset Spring，再实现新的 Focus Ring。
设计依据：[ViewOffset Spring 设计](../doc/todo/cc-niri_niri_viewoffset_spring_implementation.md)。

## 基线与范围

- 开发起点 main `a45f2db`，W0–W9 已实现并验收。
- 文档整理独立提交 `f65aff6`，Spring 代码不与文档迁移混在一起。
- 原设计引用的 cc-niri `bde8a03` 已旧；本阶段基于 W9 后代码。
- 三个 CMake 构建缓存原引用 `/home/cc/Projects/FullScreen`，已用 `cmake --fresh`
  在 `/home/cc/cc_niri` 重配，保持 RelWithDebInfo 和原安装前缀；未执行 install。
- 修改前完整 `node tools/check.js --native` 通过：71 个 JS 测试、Bridge 4 项 CTest、
  两项隔离 D-Bus 集成、clip 2 项 CTest，以及三个 native 构建。
- 读取会话基线：KWin 6.7.5 / Qt 6.11.2 / Wayland，唯一输出 eDP-1，
  逻辑 geometry `0,0,1920x1080`，scale=1；Script、transition、clip 与 Bridge 运行。
  仅确认 clip 已加载，未重新注入窗口验证 capability role。未采集新的 H/L 视频；
  新运动接入前仍需记录视觉基线，此处不宣称 Phase 0 的视觉项已完成。

本提交仅对应设计 Commit 1 / Phase 1：纯 C++ 数学和状态，没有 KWin Window、
QObject、窗口指针、geometry 写入、DBus 或主动计时器。未连接真实 H/L，未重新部署。

## 实现

- `Spring.h/.cpp`：按 elapsed time 解析采样 position 与 velocity，无 Euler 帧积分。
  默认 dampingRatio=1、stiffness=800、mass=1、epsilon=0.0001。
  支持临界、欠阻尼、过阻尼数学；输入和派生系数验证，防止 NaN/Inf 进入投影。
- `ViewportMotion.h/.cpp`：共享 offset 的 Static / Animation 状态，调用方传入
  非负单调纳秒时间戳。current 与 target 分离，坐标保持 double 不取整。
- retarget 从同一时间的 current 开始，初速度重置为 0；第一版不继承速度。
- epoch 递增；同 epoch 同目标重复请求不重启动画，冲突/旧请求拒绝。
  finish 仅接受匹配且已完成的 epoch；snap 保留旧 epoch 屏障。
- 到达 epsilon 后精确落到 target；另外检查归一化速度 epsilon*omega，避免欠阻尼
  在高速穿越 target 时提前结束。默认临界阻尼无 overshoot，正常在 1 秒内收敛。
  3 秒硬限是异常 fail-safe，不是动画固定时长。
- 独立生产静态库 `cc-niri-viewport-motion` 与 native plugin / 测试共用 CMake 目标。
  本阶段 plugin 不调用新状态；现有 scripted SCROLL 行为保持原样。
- CI native-build 新增 CTest 执行步骤，覆盖 Bridge 与 clip，包括新增 Spring 测试。

## 验证

新增 `viewport-spring-motion` CTest，直接链接生产库：

- 文档四组位移：0→1260、1260→0、400→2520、800→0；
- 用独立 RK4 小步 ODE 积分核对解析 position/velocity，覆盖四种 dampingRatio；
- 默认临界无 overshoot，接近临界数值连续，负 elapsed 与很大 timestamp；
- 60/120/144 Hz 调用序列在相同 elapsed 的结果严格一致；
- 连续 forward/reverse retarget 的位置连续和初速度归零；
- 重复/冲突/旧 epoch、旧 completion、过早完成、非法输入不破坏旧状态；
- snap、无位移静态状态、正常收敛与 3 秒 failsafe。

独立 `g++ -std=c++20 -Wall -Wextra -Werror -O2` 编译与测试通过。
真实 KDE CMake 构建与 clip 三项 CTest 通过。
修改后完整 `node tools/check.js --native` 通过：71 个 JS 测试、Bridge 4 项 CTest、
两项隔离 D-Bus 集成、clip 3 项 CTest 与三个 native 构建。日志
`/tmp/cc-niri-spring-phase1-check.log`。本阶段源 Script / Effect bundle 与
`ViewportClipEffect` 实现没有差异，不将纯单元通过记为实机 Spring 动画验收。
ASan/UBSan 额外构建尝试因本机缺少 sanitizer runtime 库而无法链接，不记为通过。

日志：`/tmp/cc-niri-spring-baseline-native.log`、`/tmp/cc-niri-spring-native-build.log`、
`/tmp/cc-niri-spring-live-baseline.log`、`/tmp/cc-niri-spring-kwin-baseline.txt`。

## 下一阶段

Commit 2：Bridge 发布含 logical column positions 的 SCROLL plan，仅打通协议，不改变视觉。
之后按 continuing → incoming → outgoing deferred park → 绕过旧 scripted SCROLL 的顺序
接入、分别测试；不一次重写整个 Effect。新的 Focus Ring 待共享运动稳定后接入。
