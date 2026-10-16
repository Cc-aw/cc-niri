# R7 固定 Rust 架构上的 Scroll Layout V2 P3

本次是 Scroll V2 的增量功能，不重新开启 R0–R7 语言迁移或 C++ runtime。
范围、Native/FFI/Bridge 契约、验证、性能限制和回滚统一记录在
[Scroll Layout V2 P3 结果](SCROLL_LAYOUT_V2_P3_RESULTS.md)。

V2 默认关闭，用户桌面未部署；Core 零分配和隔离测试不替代4K60、全项目内存及安全 stop/restore 实机验收。
