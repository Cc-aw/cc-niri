include_guard(GLOBAL)
# One production implementation. The C++ objects only marshal Qt values and
# own Rust handles; test references are created separately under BUILD_TESTING.
find_package(Qt6 6.6 REQUIRED COMPONENTS Core)
add_library(cc-niri-native-adapters STATIC
    "${CMAKE_CURRENT_LIST_DIR}/../viewport-clip/RustSpring.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../viewport-clip/RustViewportMotion.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../viewport-clip/RustScrollViewportRuntime.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../viewport-clip/RustScrollPlanSequence.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../focus-ring/RustFocusRingContext.cpp")
set_target_properties(cc-niri-native-adapters PROPERTIES AUTOMOC OFF POSITION_INDEPENDENT_CODE ON)
target_include_directories(cc-niri-native-adapters PUBLIC
    "${CMAKE_CURRENT_LIST_DIR}/../viewport-clip"
    "${CMAKE_CURRENT_LIST_DIR}/../focus-ring")
target_link_libraries(cc-niri-native-adapters PUBLIC cc-niri-rust-core Qt6::Core)
message(STATUS "CC-Niri Native Core: Rust production")
