include_guard(GLOBAL)
option(CC_NIRI_USE_RUST_NATIVE_PROTOCOL "Use shared Rust Scroll observer and Focus Ring eligibility policy" OFF)
message(STATUS "CC-Niri Rust Native Protocol backend: ${CC_NIRI_USE_RUST_NATIVE_PROTOCOL}")
add_library(cc-niri-rust-protocol STATIC
    "${CMAKE_CURRENT_LIST_DIR}/../viewport-clip/RustScrollPlanSequence.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../focus-ring/RustFocusRingContext.cpp")
set_target_properties(cc-niri-rust-protocol PROPERTIES AUTOMOC OFF POSITION_INDEPENDENT_CODE ON)
target_include_directories(cc-niri-rust-protocol PUBLIC "${CMAKE_CURRENT_LIST_DIR}/../viewport-clip" "${CMAKE_CURRENT_LIST_DIR}/../focus-ring")
target_link_libraries(cc-niri-rust-protocol PUBLIC cc-niri-rust-core Qt6::Core)
add_library(cc-niri-native-protocol-backend INTERFACE)
target_compile_definitions(cc-niri-native-protocol-backend INTERFACE CC_NIRI_USE_RUST_NATIVE_PROTOCOL=$<BOOL:${CC_NIRI_USE_RUST_NATIVE_PROTOCOL}>)
if(CC_NIRI_USE_RUST_NATIVE_PROTOCOL)
    target_link_libraries(cc-niri-native-protocol-backend INTERFACE cc-niri-rust-protocol)
endif()
