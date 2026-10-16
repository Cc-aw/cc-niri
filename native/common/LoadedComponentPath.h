/* SPDX-License-Identifier: GPL-2.0-or-later */
#pragma once
#include <QString>
#include <dlfcn.h>

namespace CcNiri {
// Event-time component diagnostics. The caller supplies an address in its own
// DSO; no /proc access, ELF scan, frame-time work or retained filesystem cache.
inline QString loadedComponentPath(const void *address)
{
    Dl_info info{};
    return dladdr(address, &info) && info.dli_fname
        ? QString::fromLocal8Bit(info.dli_fname) : QString();
}
}
