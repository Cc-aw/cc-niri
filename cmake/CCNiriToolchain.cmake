include_guard(GLOBAL)

# Call before project(): do not let PATH, CXX or CMake's default choose a
# different compiler. An explicit conflicting cache value is an error.
macro(cc_niri_select_cxx_compiler)
    if(DEFINED CMAKE_CXX_COMPILER AND NOT CMAKE_CXX_COMPILER STREQUAL "/usr/bin/g++")
        message(FATAL_ERROR
            "CC-Niri requires CMAKE_CXX_COMPILER=/usr/bin/g++; found ${CMAKE_CXX_COMPILER}. "
            "Reconfigure with -DCMAKE_CXX_COMPILER=/usr/bin/g++ or use a fresh build tree.")
    endif()
    set(CMAKE_CXX_COMPILER "/usr/bin/g++" CACHE FILEPATH "CC-Niri GCC 16 C++ compiler")
endmacro()

# Call after project(): use CMake's compiler identification, not a banner or
# executable name. GCC patch/minor releases within major 16 are supported.
function(cc_niri_check_cxx_compiler)
    if(NOT CMAKE_CXX_COMPILER STREQUAL "/usr/bin/g++")
        message(FATAL_ERROR "CC-Niri requires CMAKE_CXX_COMPILER=/usr/bin/g++")
    endif()
    if(NOT CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
        message(FATAL_ERROR "CC-Niri requires GNU GCC 16.x; found ${CMAKE_CXX_COMPILER_ID}")
    endif()
    if(CMAKE_CXX_COMPILER_VERSION VERSION_LESS "16.0" OR
       NOT CMAKE_CXX_COMPILER_VERSION VERSION_LESS "17.0")
        message(FATAL_ERROR "CC-Niri requires GNU GCC 16.x; found ${CMAKE_CXX_COMPILER_VERSION}")
    endif()
endfunction()
