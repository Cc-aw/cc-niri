# Frozen C++ Golden Baseline

这些文件仅是 R0–R6 差分测试的冻结 oracle。R7 已从生产目录和生产链接路径删除旧 Spring、ViewportMotion、Scroll Runtime、Ring geometry / eligibility 与 Scroll sequence policy；生产仅使用 Rust。

算法、参数和状态行为保留，只有共享 DTO include、旧 backend alias 和测试 reference 名称做了机械调整。不得继续开发这套算法。新增契约和边界行为应测试 Rust；需要更新预期时添加独立 fixture，不把新功能写回 reference。

所有 reference header 要求 `CC_NIRI_GOLDEN_REFERENCE`。唯一编译入口为 `BUILD_TESTING` 内的 `cc-niri-golden-reference`，只链接差分可执行文件。生产插件和 Bridge 必须通过 `tools/check-native-boundary.py` 符号检查；`BUILD_TESTING=OFF` 不生成 reference target。
