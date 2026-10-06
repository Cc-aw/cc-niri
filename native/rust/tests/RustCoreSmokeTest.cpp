#include "cc_niri_native_core.h"

#include <cstring>
#include <iostream>

int main()
{
    const char *version = cc_niri_rust_core_version();
    if (!version || std::strcmp(version, "0.1.0") != 0
        || cc_niri_rust_core_version() != version) {
        std::cerr << "Rust Core C ABI version/lifetime smoke test failed\n";
        return 1;
    }
    std::cout << "Rust Core C ABI smoke test passed: " << version << '\n';
    return 0;
}
