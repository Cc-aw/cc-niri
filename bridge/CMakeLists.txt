cmake_minimum_required(VERSION 3.20)
project(cc-scroll-dock-bridge VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)

set(CMAKE_AUTOMOC ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 6.6 REQUIRED COMPONENTS Core DBus)

qt_add_executable(cc-scroll-dock-bridge
    src/main.cpp
    src/ScrollDockBridge.cpp
    src/ScrollDockBridge.h
)

target_link_libraries(cc-scroll-dock-bridge PRIVATE Qt6::Core Qt6::DBus)

install(TARGETS cc-scroll-dock-bridge
    RUNTIME DESTINATION "${CMAKE_INSTALL_LIBEXECDIR}"
)

include(CTest)
if(BUILD_TESTING)
    qt_add_executable(cc-scroll-motion-plan-tests
        tests/ScrollMotionPlanTest.cpp src/ScrollDockBridge.cpp src/ScrollDockBridge.h)
    target_include_directories(cc-scroll-motion-plan-tests PRIVATE src)
    target_link_libraries(cc-scroll-motion-plan-tests PRIVATE Qt6::Core Qt6::DBus)
    add_test(NAME scroll-motion-protocol COMMAND cc-scroll-motion-plan-tests)
    find_package(Qt6 6.6 REQUIRED COMPONENTS Qml)
    qt_add_executable(cc-niri-workspace-recycle-qobject-tests tests/WorkspaceRecycleQObjectTest.cpp)
    target_link_libraries(cc-niri-workspace-recycle-qobject-tests PRIVATE Qt6::Core Qt6::Qml)
    add_test(NAME workspace-recycle-qobject-lifetime COMMAND cc-niri-workspace-recycle-qobject-tests
        "${CMAKE_CURRENT_SOURCE_DIR}/../src/kwin/policy/WindowPolicy.js"
        "${CMAKE_CURRENT_SOURCE_DIR}/../src/kwin/workspace/WorkspaceMembership.js"
        "${CMAKE_CURRENT_SOURCE_DIR}/../src/kwin/workspace/WorkspaceOccupancy.js"
        "${CMAKE_CURRENT_SOURCE_DIR}/../src/kwin/workspace/WorkspaceRecycleController.js")
    qt_add_executable(cc-niri-workspace-qobject-tests tests/WorkspaceQObjectTest.cpp)
    target_link_libraries(cc-niri-workspace-qobject-tests PRIVATE Qt6::Core Qt6::Qml)
    add_test(NAME workspace-qobject-lifetime COMMAND cc-niri-workspace-qobject-tests
        "${CMAKE_CURRENT_SOURCE_DIR}/../src/kwin/workspace/WorkspaceTransferController.js")
    qt_add_executable(cc-niri-kwin-syntax-tests tests/KWinSyntaxTest.cpp)
    target_link_libraries(cc-niri-kwin-syntax-tests PRIVATE Qt6::Core Qt6::Qml)
    add_test(NAME kwin-javascript-syntax COMMAND cc-niri-kwin-syntax-tests
        "${CMAKE_CURRENT_SOURCE_DIR}/../package/contents/code/main.js"
        "${CMAKE_CURRENT_SOURCE_DIR}/../effect/contents/code/main.js")
    qt_add_executable(cc-scroll-dock-bridge-tests
        tests/ScrollDockBridgeTest.cpp src/ScrollDockBridge.cpp src/ScrollDockBridge.h)
    target_include_directories(cc-scroll-dock-bridge-tests PRIVATE src)
    target_link_libraries(cc-scroll-dock-bridge-tests PRIVATE Qt6::Core Qt6::DBus)
    add_test(NAME workspace-persistence COMMAND cc-scroll-dock-bridge-tests)
endif()
