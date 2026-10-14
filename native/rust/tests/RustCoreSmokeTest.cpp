#include "cc_niri_native_core.h"

#include <cstring>
#include <iostream>

int main()
{
    static_assert(sizeof(CcNiriScrollTuningStatus) == 80);
    static_assert(sizeof(CcNiriScrollPlan) == 184);
    static_assert(sizeof(CcNiriReindexPlan) == 200);
    auto *scroll = cc_niri_scroll_create(1);
    const auto stable = cc_niri_scroll_tuning_status(scroll, 0);
    const auto smooth = cc_niri_scroll_tuning_status(scroll, 1);
    const bool tuningOk = stable.status == CC_NIRI_FFI_OK && stable.stiffness == 800
        && stable.threshold_px == 0 && stable.fallback == 0
        && smooth.status == CC_NIRI_FFI_OK && smooth.stiffness == 600
        && smooth.threshold_px == 0.25 && smooth.fallback == 5
        && cc_niri_scroll_tuning_status(scroll, 2).status == CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_tuning_status(nullptr, 1).status == CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_prepare_frame_with_output(scroll, 0, 2, 1.5, 60).status == CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_prepare_frame_with_output(nullptr, 0, 1, 1.5, 60).status == CC_NIRI_FFI_INVALID_HANDLE;
    const bool reindexOk = cc_niri_scroll_arm_reindex(scroll, nullptr, 0, nullptr, 0, 0).status == CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_arm_reindex(nullptr, nullptr, 0, nullptr, 0, 0).status == CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_sequence_reindex(nullptr, nullptr, 0).status == CC_NIRI_FFI_INVALID_HANDLE;
    cc_niri_scroll_destroy(scroll);
    if (!tuningOk || !reindexOk) { std::cerr << "Scroll tuning / reindex DTO/status contract failed\n"; return 1; }
    const char *version = cc_niri_rust_core_version();
    if (!version || std::strcmp(version, "0.1.0") != 0
        || cc_niri_rust_core_version() != version) {
        std::cerr << "Rust Core C ABI version/lifetime smoke test failed\n";
        return 1;
    }
    std::cout << "Rust Core C ABI smoke test passed: " << version << '\n';
    return 0;
}
