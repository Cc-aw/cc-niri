cmake_minimum_required(VERSION 3.20)
project(cc-scroll-tasks VERSION 0.1.0 LANGUAGES CXX)

find_package(ECM 6.0 REQUIRED NO_MODULE)
set(CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs6)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)
include(ECMQtDeclareLoggingCategory)

find_package(Qt6 6.6 REQUIRED COMPONENTS Core Qml Quick)
find_package(KF6 6.0 REQUIRED COMPONENTS
    Config
    I18n
    KIO
    Notifications
    Service
    WindowSystem
)
find_package(Plasma 6.0 REQUIRED)
find_package(PlasmaActivities 6.0 REQUIRED)
find_package(PlasmaActivitiesStats 6.0 REQUIRED)
find_package(LibNotificationManager 6.0 REQUIRED)
find_package(KSysGuard 6.0 REQUIRED)

plasma_add_applet(com.cc.scrolltasks
    QML_SOURCES
        qml/AudioStream.qml
        qml/ConfigAppearance.qml
        qml/ConfigBehavior.qml
        qml/config.qml
        qml/ContextMenu.qml
        qml/GroupDialog.qml
        qml/GroupExpanderOverlay.qml
        qml/main.qml
        qml/MouseHandler.qml
        qml/PipeWireThumbnail.qml
        qml/PlayerController.qml
        qml/PulseAudio.qml
        qml/ScrollableTextWrapper.qml
        qml/TaskBadgeOverlay.qml
        qml/TaskList.qml
        qml/TaskProgressOverlay.qml
        qml/Task.qml
        qml/ToolTipDelegate.qml
        qml/ToolTipInstance.qml
        qml/ToolTipWindowMouseArea.qml
        qml/cc/DockBridge.qml
        qml/cc/DockAppearance.qml
        qml/cc/DockController.qml
        qml/cc/DockOrder.qml
        qml/cc/DockPresentation.qml
        qml/cc/DockState.qml
        qml/code/LayoutMetrics.js
        qml/code/TaskTools.js
    CPP_SOURCES
        backend.cpp
        smartlauncherbackend.cpp
        smartlauncheritem.cpp
    RESOURCES
        main.xml
    GENERATE_APPLET_CLASS
)

kconfig_add_kcfg_files(com.cc.scrolltasks kactivitymanagerd_plugins_settings.kcfgc)

ecm_qt_declare_logging_category(com.cc.scrolltasks
    HEADER log_settings.h
    IDENTIFIER TASKMANAGER_DEBUG
    CATEGORY_NAME com.cc.scrolltasks
)

target_link_libraries(com.cc.scrolltasks PRIVATE
    Qt6::Core
    Qt6::Qml
    Qt6::Quick
    Plasma::Activities
    Plasma::ActivitiesStats
    KF6::ConfigGui
    KF6::I18n
    KF6::KIOCore
    KF6::KIOGui
    KF6::KIOFileWidgets
    KF6::Notifications
    Plasma::Plasma
    KSysGuard::ProcessCore
    KF6::Service
    KF6::WindowSystem
    PW::LibNotificationManager
)
