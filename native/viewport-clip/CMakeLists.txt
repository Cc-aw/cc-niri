cmake_minimum_required(VERSION 3.20)

project(cc-niri-viewport-clip VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(ECM 6.0 REQUIRED NO_MODULE)
list(APPEND CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)

find_package(Qt6 6.6 REQUIRED COMPONENTS Core DBus Gui Quick Widgets)
find_package(KF6 6.0 REQUIRED COMPONENTS CoreAddons)
find_package(KWin 6.7 REQUIRED COMPONENTS kwineffects)

# Pure production math/state; no KWin or Qt dependency. Window integration is a
# later phase, and both the plugin and regression test use the same library.
add_library(cc-niri-viewport-motion STATIC
    Spring.cpp Spring.h ViewportMotion.cpp ViewportMotion.h
)
set_target_properties(cc-niri-viewport-motion PROPERTIES
    AUTOMOC OFF
    POSITION_INDEPENDENT_CODE ON
)
target_include_directories(cc-niri-viewport-motion PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

kcoreaddons_add_plugin(cc-niri-viewport-clip
    SOURCES
        main.cpp
        ViewportClipEffect.cpp
        ViewportClipEffect.h
        ScrollViewportRuntime.cpp
        ScrollViewportRuntime.h
    INSTALL_NAMESPACE "kwin/effects/plugins"
)

target_link_libraries(cc-niri-viewport-clip PRIVATE
    cc-niri-viewport-motion
    Qt6::Core
    Qt6::DBus
    KF6::CoreAddons
    KWin::kwin
)

include(CTest)
if(BUILD_TESTING)
    add_executable(cc-niri-scroll-viewport-tests tests/ScrollViewportRuntimeTest.cpp ScrollViewportRuntime.cpp)
    set_target_properties(cc-niri-scroll-viewport-tests PROPERTIES AUTOMOC OFF)
    target_include_directories(cc-niri-scroll-viewport-tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(cc-niri-scroll-viewport-tests PRIVATE cc-niri-viewport-motion Qt6::Core)
    add_test(NAME scroll-viewport-runtime COMMAND cc-niri-scroll-viewport-tests)
    add_executable(cc-niri-viewport-motion-tests tests/ViewportMotionTest.cpp)
    set_target_properties(cc-niri-viewport-motion-tests PROPERTIES AUTOMOC OFF)
    target_link_libraries(cc-niri-viewport-motion-tests PRIVATE cc-niri-viewport-motion)
    add_test(NAME viewport-spring-motion COMMAND cc-niri-viewport-motion-tests)
    add_executable(cc-niri-workspace-clip-tests tests/WorkspaceClipBarrierTest.cpp)
    target_include_directories(cc-niri-workspace-clip-tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(cc-niri-workspace-clip-tests PRIVATE Qt6::Core)
    add_test(NAME workspace-clip-barrier COMMAND cc-niri-workspace-clip-tests)
endif()
