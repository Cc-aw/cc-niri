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

kcoreaddons_add_plugin(cc-niri-viewport-clip
    SOURCES
        main.cpp
        ViewportClipEffect.cpp
        ViewportClipEffect.h
    INSTALL_NAMESPACE "kwin/effects/plugins"
)

target_link_libraries(cc-niri-viewport-clip PRIVATE
    Qt6::Core
    KF6::CoreAddons
    KWin::kwin
)
