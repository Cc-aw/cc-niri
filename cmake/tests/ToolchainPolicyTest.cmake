# Exercise the configure policy with compiler metadata, independent of which
# rejected compilers happen to be installed on the developer's machine.
function(check_case name compiler id version accepted)
    execute_process(COMMAND "${CMAKE_COMMAND}"
        "-DCMAKE_CXX_COMPILER=${compiler}"
        "-DCMAKE_CXX_COMPILER_ID=${id}"
        "-DCMAKE_CXX_COMPILER_VERSION=${version}"
        -P "${CMAKE_CURRENT_LIST_DIR}/CheckCxxFixture.cmake"
        RESULT_VARIABLE result OUTPUT_VARIABLE output ERROR_VARIABLE error)
    if(accepted AND NOT result EQUAL 0)
        message(FATAL_ERROR "${name} should pass: ${output}${error}")
    elseif(NOT accepted)
        if(result EQUAL 0 OR NOT error MATCHES "CC-Niri requires")
            message(FATAL_ERROR "${name} should reject: ${output}${error}")
        endif()
    endif()
endfunction()

check_case(gcc-16-minimum /usr/bin/g++ GNU 16.0.0 TRUE)
check_case(gcc-16-patch /usr/bin/g++ GNU 16.2.1 TRUE)
check_case(gcc-15 /usr/bin/g++ GNU 15.9.0 FALSE)
check_case(gcc-17 /usr/bin/g++ GNU 17.0.0 FALSE)
check_case(clang /usr/bin/g++ Clang 16.0.0 FALSE)
check_case(alternate-path /usr/bin/c++ GNU 16.2.1 FALSE)
message(STATUS "C++ toolchain configure policy passed")
