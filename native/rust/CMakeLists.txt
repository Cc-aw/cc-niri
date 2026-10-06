# Shared by the Native umbrella build and both existing standalone adapters.
if(TARGET cc-niri-rust-core)
    return()
endif()

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
    find_package(Qt6 6.6 REQUIRED COMPONENTS Core)
    add_executable(cc-niri-ring-differential tests/FocusRingDifferentialTest.cpp ../focus-ring/FocusRingCore.cpp)
    set_target_properties(cc-niri-ring-differential PROPERTIES AUTOMOC OFF)
    target_include_directories(cc-niri-ring-differential PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../focus-ring")
    target_link_libraries(cc-niri-ring-differential PRIVATE cc-niri-rust-core)
    add_test(NAME focus-ring-cpp-rust-differential COMMAND cc-niri-ring-differential)
    add_executable(cc-niri-spring-differential tests/SpringDifferentialTest.cpp
        ../viewport-clip/Spring.cpp ../viewport-clip/RustSpring.cpp)
    set_target_properties(cc-niri-spring-differential PROPERTIES AUTOMOC OFF)
    target_include_directories(cc-niri-spring-differential PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../viewport-clip")
    target_link_libraries(cc-niri-spring-differential PRIVATE cc-niri-rust-core)
    add_test(NAME spring-cpp-rust-differential COMMAND cc-niri-spring-differential)
    foreach(_backend cpp rust)
        add_executable(cc-niri-spring-motion-${_backend}-tests
            ../viewport-clip/tests/ViewportMotionTest.cpp ../viewport-clip/ViewportMotion.cpp ../viewport-clip/Spring.cpp)
        set_target_properties(cc-niri-spring-motion-${_backend}-tests PROPERTIES AUTOMOC OFF)
        target_include_directories(cc-niri-spring-motion-${_backend}-tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../viewport-clip")
        if(_backend STREQUAL "rust")
            target_sources(cc-niri-spring-motion-${_backend}-tests PRIVATE ../viewport-clip/RustSpring.cpp)
            target_link_libraries(cc-niri-spring-motion-${_backend}-tests PRIVATE cc-niri-rust-core)
            target_compile_definitions(cc-niri-spring-motion-${_backend}-tests PRIVATE CC_NIRI_USE_RUST_SPRING=1)
        else()
            target_compile_definitions(cc-niri-spring-motion-${_backend}-tests PRIVATE CC_NIRI_USE_RUST_SPRING=0)
        endif()
        add_test(NAME spring-motion-${_backend} COMMAND cc-niri-spring-motion-${_backend}-tests)
    endforeach()
    add_executable(cc-niri-motion-differential tests/ViewportMotionDifferentialTest.cpp
        ../viewport-clip/ViewportMotion.cpp ../viewport-clip/Spring.cpp ../viewport-clip/RustViewportMotion.cpp)
    set_target_properties(cc-niri-motion-differential PROPERTIES AUTOMOC OFF)
    target_compile_definitions(cc-niri-motion-differential PRIVATE CC_NIRI_USE_RUST_SPRING=0)
    target_include_directories(cc-niri-motion-differential PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../viewport-clip")
    target_link_libraries(cc-niri-motion-differential PRIVATE cc-niri-rust-core)
    add_test(NAME viewport-motion-cpp-rust-differential COMMAND cc-niri-motion-differential)
    add_executable(cc-niri-rust-motion-tests ../viewport-clip/tests/ViewportMotionTest.cpp
        ../viewport-clip/Spring.cpp ../viewport-clip/RustViewportMotion.cpp)
    set_target_properties(cc-niri-rust-motion-tests PROPERTIES AUTOMOC OFF)
    target_compile_definitions(cc-niri-rust-motion-tests PRIVATE CC_NIRI_USE_RUST_SPRING=0 CC_NIRI_USE_RUST_VIEWPORT_MOTION=1)
    target_include_directories(cc-niri-rust-motion-tests PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../viewport-clip")
    target_link_libraries(cc-niri-rust-motion-tests PRIVATE cc-niri-rust-core)
    add_test(NAME viewport-motion-rust-contract COMMAND cc-niri-rust-motion-tests)
    add_executable(cc-niri-native-protocol-differential tests/NativeProtocolDifferentialTest.cpp
        ../focus-ring/FocusRingContext.cpp ../focus-ring/RustFocusRingContext.cpp ../viewport-clip/RustScrollPlanSequence.cpp)
    set_target_properties(cc-niri-native-protocol-differential PROPERTIES AUTOMOC OFF)
    target_link_libraries(cc-niri-native-protocol-differential PRIVATE cc-niri-rust-core Qt6::Core)
    add_test(NAME native-protocol-cpp-rust-differential COMMAND cc-niri-native-protocol-differential)
    add_executable(cc-niri-rust-ring-context-tests ../focus-ring/tests/FocusRingContextTest.cpp ../focus-ring/RustFocusRingContext.cpp)
    set_target_properties(cc-niri-rust-ring-context-tests PROPERTIES AUTOMOC OFF)
    target_compile_definitions(cc-niri-rust-ring-context-tests PRIVATE CC_NIRI_USE_RUST_NATIVE_PROTOCOL=1)
    target_link_libraries(cc-niri-rust-ring-context-tests PRIVATE cc-niri-rust-core Qt6::Core)
    add_test(NAME focus-ring-rust-context-contract COMMAND cc-niri-rust-ring-context-tests)
    foreach(_test differential contract)
        if(_test STREQUAL "differential")
            set(_source tests/ScrollRuntimeDifferentialTest.cpp)
        else()
            set(_source ../viewport-clip/tests/ScrollViewportRuntimeTest.cpp)
        endif()
        add_executable(cc-niri-scroll-${_test} ${_source} ../viewport-clip/ScrollViewportRuntime.cpp
            ../viewport-clip/ViewportMotion.cpp ../viewport-clip/Spring.cpp ../viewport-clip/RustScrollViewportRuntime.cpp)
        set_target_properties(cc-niri-scroll-${_test} PROPERTIES AUTOMOC OFF)
        target_include_directories(cc-niri-scroll-${_test} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../viewport-clip")
        target_compile_definitions(cc-niri-scroll-${_test} PRIVATE CC_NIRI_USE_RUST_SPRING=0 CC_NIRI_USE_RUST_VIEWPORT_MOTION=0)
        if(_test STREQUAL "contract")
            target_compile_definitions(cc-niri-scroll-${_test} PRIVATE CC_NIRI_TEST_RUST_SCROLL_RUNTIME=1)
        endif()
        target_link_libraries(cc-niri-scroll-${_test} PRIVATE cc-niri-rust-core Qt6::Core)
        add_test(NAME scroll-runtime-${_test} COMMAND cc-niri-scroll-${_test})
    endforeach()
    add_executable(cc-niri-rust-core-smoke tests/RustCoreSmokeTest.cpp)
    set_target_properties(cc-niri-rust-core-smoke PROPERTIES AUTOMOC OFF)
    target_link_libraries(cc-niri-rust-core-smoke PRIVATE cc-niri-rust-core)
    add_test(NAME rust-core-ffi-smoke COMMAND cc-niri-rust-core-smoke)
    add_test(NAME native-cxx-toolchain-policy COMMAND "${CMAKE_COMMAND}"
        -P "${_repository_root}/cmake/tests/ToolchainPolicyTest.cmake")
endif()
