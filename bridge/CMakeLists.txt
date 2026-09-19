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
