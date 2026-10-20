# J/H 交叠居中问题排查

2026-10-17，基线 `a0f5853`。用户报告：J 进入已有居中 2/3 窗口的工作区，在动画途中按 H，1/2 也居中。问题状态 **INCONCLUSIVE / Pending**，尚未复现，不宣称修复。

本批仅增加测试和隔离探针，生产 JS、生成包、Rust、C++、FFI、Spring 和安装文件均未改动；没有部署或重载用户桌面。已询问用户 H 是普通 Win+H 还是 Win+Shift+H，等待确认。

完整生成入口的模型回归覆盖两窗口来源工作区、五窗口目标工作区（half / twoThirds / twoThirds / half / half），保存第二列居中后通过 J 返回，并在目标工作区首帧前、首帧后分别执行普通 H。均得到 camera=636、half.x=16，宽度和焦点正确。

私有 Release KWin 增加真实客户端场景：目标工作区左 half、右 twoThirds 居中，J 后 40ms 执行普通 H。P5/P6 隔离配置显式启用 420ms 原生工作区动画并禁用系统 Slide，记录输入时 Native `workspaceAnimationActive=true`、camera=1484，最终 half.x=16、camera=636，实际焦点正确。该正常路径不能排除其他按键、时序或仅在动画中出现的异常。

| 验证 | 结果 |
| --- | --- |
| `node tools/check.js` | PASS，240 项 / 117 文件；首轮受限沙箱的既有 Native 输入 fixture 失败，允许隔离测试进程后完整重跑通过 |
| `node test/scroll-layout-v2-workspace.test.js` | PASS，18 项，包含新增首帧前 / 后回归 |
| 私有 KWin P5，150% | PASS，36/36 |
| 私有 KWin P6，150% + Fcitx5 | PASS，46/46，含真实安全停止、重复停止和恢复证明 |
| 用户桌面异常复现 / 视觉验收 | Pending |
| 全项目 PSS / Private_Dirty、GPU、4K60、长期资源验收 | NOT MEASURED |

详见[验证摘要](scroll-layout-v2-workspace-h-evidence/20261017/validation.json)，原始日志目录记录在其中。0/8/16ms 等早期扩展实验曾因未禁用系统 Slide、动作检查点或连续场景超时而为 INCONCLUSIVE；未计为产品失败或通过。保留其 `/tmp/cc-niri-workspace-h-*-baseline-20261017` 诊断目录供继续分析。

测试客户端最长 60 秒、外层私有进程最长 70 秒；新增延迟和诊断仅存在于隔离 fixture，没有新增生产 timer、常驻状态、图形缓冲或服务。回退本批测试改动即可，不涉及已安装版本。
