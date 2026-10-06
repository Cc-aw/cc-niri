# Shared by the Native umbrella build and both existing standalone adapters.
if(TARGET cc-niri-rust-core)
    return()
endif()

foreach(_legacy IN ITEMS CC_NIRI_USE_RUST_SPRING CC_NIRI_USE_RUST_VIEWPORT_MOTION
        CC_NIRI_USE_RUST_SCROLL_RUNTIME CC_NIRI_TEST_RUST_SCROLL_RUNTIME
        CC_NIRI_USE_RUST_FOCUS_RING_CORE CC_NIRI_USE_RUST_NATIVE_PROTOCOL)
    if(DEFINED ${_legacy})
        message(STATUS "Retired ${_legacy}=${${_legacy}}; Native Core is always Rust")
        unset(${_legacy} CACHE)
        unset(${_legacy})
    endif()
endforeach()

find_program(CC_NIRI_CARGO_EXECUTABLE cargo REQUIRED)
find_program(CC_NIRI_RUSTC_EXECUTABLE rustc REQUIRED)
set(_repository_root "${CMAKE_CURRENT_SOURCE_DIR}/../..")
file(READ "${_repository_root}/rust-toolchain.toml" _rust_toolchain)
if(NOT _rust_toolchain MATCHES "channel[ \t]*=[ \t]*\"([0-9]+\\.[0-9]+\\.[0-9]+)\"")
    message(FATAL_ERROR "rust-toolchain.toml must pin an exact Rust version")
endif()
set(_required_rust_version "${CMAKE_MATCH_1}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${_repository_root}/rust-toolchain.toml")
execute_process(COMMAND "${CC_NIRI_RUSTC_EXECUTABLE}" --version
    WORKING_DIRECTORY "${_repository_root}"
    OUTPUT_VARIABLE _rust_version OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE _rust_result)
if(NOT _rust_result EQUAL 0 OR NOT _rust_version MATCHES "^rustc ([0-9]+\\.[0-9]+\\.[0-9]+)( |$)")
    message(FATAL_ERROR "Cannot determine Rust version: ${_rust_version}")
endif()
if(NOT CMAKE_MATCH_1 STREQUAL _required_rust_version)
    message(FATAL_ERROR "CC-Niri requires Rust ${_required_rust_version} exactly; found ${_rust_version}. Check PATH and the cached CC_NIRI_RUSTC_EXECUTABLE.")
endif()
execute_process(COMMAND "${CC_NIRI_CARGO_EXECUTABLE}" --version
    WORKING_DIRECTORY "${_repository_root}"
    OUTPUT_VARIABLE _cargo_version OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE _cargo_result)
if(NOT _cargo_result EQUAL 0 OR NOT _cargo_version MATCHES "^cargo ([0-9]+\\.[0-9]+\\.[0-9]+)( |$)")
    message(FATAL_ERROR "Cannot determine Cargo version: ${_cargo_version}")
endif()
if(NOT CMAKE_MATCH_1 STREQUAL _required_rust_version)
    message(FATAL_ERROR "CC-Niri requires Cargo ${_required_rust_version} exactly; found ${_cargo_version}. Check PATH and the cached CC_NIRI_CARGO_EXECUTABLE.")
endif()
if(CMAKE_CROSSCOMPILING)
    message(FATAL_ERROR "Rust cross-compilation is not configured for CC-Niri yet")
endif()
if(NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE RelWithDebInfo CACHE STRING "Build type" FORCE)
endif()
set(_rust_configs ${CMAKE_CONFIGURATION_TYPES} ${CMAKE_BUILD_TYPE})
foreach(_config IN LISTS _rust_configs)
    if(NOT _config MATCHES "^(Debug|Release|RelWithDebInfo|MinSizeRel)$")
        message(FATAL_ERROR "Unsupported Rust/CMake build configuration: ${_config}")
    endif()
endforeach()

set(_rust_profile "$<IF:$<CONFIG:Debug>,dev,release>")
set(_rust_directory "$<IF:$<CONFIG:Debug>,debug,release>")
set(_rust_target_dir "${CMAKE_CURRENT_BINARY_DIR}/cargo")
set(_rust_archive "${_rust_target_dir}/${_rust_directory}/libcc_niri_native_core.a")

# Cargo owns its dependency graph; invoking it each build also detects deleted
# artifacts and source changes without a stale CMake timestamp shortcut.
add_custom_target(cc-niri-rust-build ALL
    COMMAND "${CMAKE_COMMAND}" -E env "RUSTC=${CC_NIRI_RUSTC_EXECUTABLE}"
        "${CC_NIRI_CARGO_EXECUTABLE}" build --locked
        --manifest-path "${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml"
        --package cc-niri-native-core --profile "${_rust_profile}"
        --target-dir "${_rust_target_dir}"
    BYPRODUCTS "${_rust_archive}"
    WORKING_DIRECTORY "${_repository_root}"
    COMMENT "Building Rust Native Core (${_rust_profile})"
    VERBATIM)

find_package(Threads REQUIRED)
add_library(cc-niri-rust-core STATIC IMPORTED GLOBAL)
set_target_properties(cc-niri-rust-core PROPERTIES
    IMPORTED_LOCATION "${_rust_archive}"
    INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_CURRENT_SOURCE_DIR}/include"
    INTERFACE_LINK_LIBRARIES "Threads::Threads;${CMAKE_DL_LIBS};m;rt;util")
foreach(_config Debug Release RelWithDebInfo MinSizeRel)
    string(TOUPPER "${_config}" _upper_config)
    if(_config STREQUAL "Debug")
        set(_directory debug)
    else()
        set(_directory release)
    endif()
    set_property(TARGET cc-niri-rust-core PROPERTY "IMPORTED_LOCATION_${_upper_config}"
        "${_rust_target_dir}/${_directory}/libcc_niri_native_core.a")
endforeach()
add_dependencies(cc-niri-rust-core cc-niri-rust-build)

if(BUILD_TESTING)
    include("${CMAKE_CURRENT_LIST_DIR}/../common/NativeCore.cmake")
    # Frozen R0-R6 differential oracle, never linked into a production artifact.
    add_library(cc-niri-golden-reference STATIC
        tests/reference/Spring.cpp tests/reference/ViewportMotion.cpp
        tests/reference/ScrollViewportRuntime.cpp tests/reference/FocusRingCore.cpp
        tests/reference/FocusRingContext.cpp)
    set_target_properties(cc-niri-golden-reference PROPERTIES AUTOMOC OFF)
    target_include_directories(cc-niri-golden-reference PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/reference"
        "${CMAKE_CURRENT_SOURCE_DIR}/../viewport-clip"
        "${CMAKE_CURRENT_SOURCE_DIR}/../focus-ring"
        "${CMAKE_CURRENT_SOURCE_DIR}/include")
    target_compile_definitions(cc-niri-golden-reference PUBLIC CC_NIRI_GOLDEN_REFERENCE=1)
    target_link_libraries(cc-niri-golden-reference PUBLIC Qt6::Core)

    foreach(_pair IN ITEMS
        "workspace-motion;tests/WorkspaceMotionContractTest.cpp;workspace-motion-rust-contract"
        "ring;tests/FocusRingDifferentialTest.cpp;focus-ring-cpp-rust-differential"
        "spring;tests/SpringDifferentialTest.cpp;spring-cpp-rust-differential"
        "motion;tests/ViewportMotionDifferentialTest.cpp;viewport-motion-cpp-rust-differential"
        "protocol;tests/NativeProtocolDifferentialTest.cpp;native-protocol-cpp-rust-differential"
        "scroll;tests/ScrollRuntimeDifferentialTest.cpp;scroll-runtime-differential")
        list(GET _pair 0 _name)
        list(GET _pair 1 _source)
        list(GET _pair 2 _test)
        add_executable(cc-niri-${_name}-differential "${_source}")
        set_target_properties(cc-niri-${_name}-differential PROPERTIES AUTOMOC OFF)
        target_link_libraries(cc-niri-${_name}-differential PRIVATE cc-niri-golden-reference cc-niri-native-adapters)
        add_test(NAME "${_test}" COMMAND cc-niri-${_name}-differential)
    endforeach()
    foreach(_pair IN ITEMS
        "motion;../viewport-clip/tests/ViewportMotionTest.cpp;viewport-motion-rust-contract"
        "scroll;../viewport-clip/tests/ScrollViewportRuntimeTest.cpp;scroll-runtime-contract"
        "ring-context;../focus-ring/tests/FocusRingContextTest.cpp;focus-ring-rust-context-contract"
        "core-smoke;tests/RustCoreSmokeTest.cpp;rust-core-ffi-smoke")
        list(GET _pair 0 _name)
        list(GET _pair 1 _source)
        list(GET _pair 2 _test)
        add_executable(cc-niri-rust-${_name}-tests "${_source}")
        set_target_properties(cc-niri-rust-${_name}-tests PROPERTIES AUTOMOC OFF)
        target_link_libraries(cc-niri-rust-${_name}-tests PRIVATE cc-niri-native-adapters)
        add_test(NAME "${_test}" COMMAND cc-niri-rust-${_name}-tests)
    endforeach()
    add_test(NAME native-cxx-toolchain-policy COMMAND "${CMAKE_COMMAND}"
        -P "${_repository_root}/cmake/tests/ToolchainPolicyTest.cmake")
endif()
