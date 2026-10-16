#include "cc_niri_native_core.h"

#include <cstring>
#include <iostream>
#include <limits>

int main()
{
    static_assert(sizeof(CcNiriScrollTuningStatus) == 80);
    static_assert(sizeof(CcNiriScrollPlan) == 184);
    static_assert(sizeof(CcNiriReindexPlan) == 200);
    static_assert(sizeof(CcNiriPartialScrollPlan) == 232);
    static_assert(sizeof(CcNiriPartialInputResult) == 16);
    static_assert(sizeof(CcNiriPartialStatus) == 32);
    static_assert(sizeof(CcNiriColumnGeometryEntry) == 160);
    static_assert(sizeof(CcNiriColumnGeometryPlan) == 304);
    static_assert(sizeof(CcNiriClientPaint) == 208);
    static_assert(sizeof(CcNiriGeometrySourceRow) == 64);
    static_assert(sizeof(CcNiriGeometrySourceStatus) == 128);
    static_assert(sizeof(CcNiriGeometryProjection) == 56);
    static_assert(sizeof(CcNiriGeometryCompletion) == 48);
    auto *sequence = cc_niri_scroll_sequence_create();
    CcNiriColumnGeometryPlan malformedGeometry{};
    malformedGeometry.entries_len = 257;
    const bool geometryOk = cc_niri_scroll_sequence_geometry(nullptr, nullptr, 0).status == CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_sequence_geometry(sequence, nullptr, 0).status == CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_sequence_geometry(sequence, &malformedGeometry, 0).status == CC_NIRI_FFI_INVALID_DTO;
    cc_niri_scroll_sequence_destroy(sequence);
    auto *scroll = cc_niri_scroll_create(1);
    const bool newGeometryOk=cc_niri_scroll_partial_ambiguous(nullptr,0,0).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_arm_geometry(nullptr,nullptr,0,nullptr,0,0,{}).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_partial_ambiguous(scroll,std::numeric_limits<double>::quiet_NaN(),0).status==CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_partial_ambiguous(scroll,0,0).value==0
        && cc_niri_scroll_arm_geometry(scroll,nullptr,0,nullptr,0,0,{}).status==CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_geometry_source(nullptr,nullptr,0,{},{},{},nullptr,0).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_geometry_source(scroll,nullptr,257,{},{},{},nullptr,0).status==CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_geometry_projection(nullptr,0,{}).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_geometry_completion(nullptr).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_finish_geometry_frame(nullptr,0,0,0,nullptr,0).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_observe_client_frame(nullptr,0,{}).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_needs_repaint(nullptr).status==CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_frame_ready(nullptr).status==CC_NIRI_FFI_INVALID_HANDLE;
    const bool clientPaintOk = cc_niri_scroll_client_paint(nullptr,0).status == CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_client_paint(scroll,0).active == 0
        && cc_niri_scroll_client_source_complete(scroll,{},{},{}).value == 0
        && cc_niri_scroll_client_source_complete(nullptr,{},{},{}).status == CC_NIRI_FFI_INVALID_HANDLE
        && cc_niri_scroll_client_source_complete(scroll,{}, {nullptr,257},{}).status == CC_NIRI_FFI_INVALID_DTO
        && cc_niri_scroll_record_client_painted(nullptr,0,0,0,0,{}).status == CC_NIRI_FFI_INVALID_HANDLE;
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
    if (!tuningOk || !reindexOk || !geometryOk || !clientPaintOk || !newGeometryOk) { std::cerr << "Scroll tuning / typed DTO/status contract failed\n"; return 1; }
    const char *version = cc_niri_rust_core_version();
    if (!version || std::strcmp(version, "0.1.0") != 0
        || cc_niri_rust_core_version() != version) {
        std::cerr << "Rust Core C ABI version/lifetime smoke test failed\n";
        return 1;
    }
    std::cout << "Rust Core C ABI smoke test passed: " << version << '\n';
    return 0;
}
