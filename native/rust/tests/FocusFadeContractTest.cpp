/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../../focus-ring/RustFocusFade.h"
#include "../../common/CompositorFrameContext.h"
#include <QCoreApplication>
#include <cmath>
#include <cstdlib>
#include <iostream>
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QObject host;
    std::optional<CcNiri::CompositorFrame> copied;
    check(!CcNiri::ScopedCompositorFrame::snapshot(&host), "no dangling clock before pass");
    {
        CcNiri::ScopedCompositorFrame outer(&host, {123, 1000000000, true});
        copied = CcNiri::ScopedCompositorFrame::snapshot(&host);
        {
            CcNiri::ScopedCompositorFrame nested(&host, {456, 2000000000, false});
            check(!CcNiri::ScopedCompositorFrame::snapshot(&host)->real, "offscreen pass is explicit");
        }
        check(CcNiri::ScopedCompositorFrame::snapshot(&host)->output == 123, "nested pass restores outer output");
    }
    check(copied && copied->presentationNs == 1000000000 && !CcNiri::ScopedCompositorFrame::snapshot(&host),
        "copied DTO survives stack, property does not");
    auto *destroyed = new QObject;
    { CcNiri::ScopedCompositorFrame scope(destroyed, {123, 1, true}); delete destroyed; }
    CcNiri::RustFocusFade old, incoming;
    old.retarget(true); old.advance(1); old.advance(140000001);
    old.retarget(false); incoming.retarget(true);
    for (int64_t elapsed : {0, 35000000, 70000000, 105000000, 140000000}) {
        CcNiri::ScopedCompositorFrame scope(&host, {123, copied->presentationNs + elapsed, true});
        const auto frame = CcNiri::ScopedCompositorFrame::snapshot(&host);
        const auto a = old.advance(frame->presentationNs), b = incoming.advance(frame->presentationNs);
        check(std::abs(a.opacity + b.opacity - 1) < 1e-12, "both decorations share finite presentation time");
        check(incoming.advance(frame->presentationNs).opacity == b.opacity, "duplicate pass cannot advance twice");
    }
    check(incoming.glowMix()==0, "gain completes on the same finite shared frame");
    check(old.sample().retired && !incoming.sample().active, "finite completion releases repaint demand");
    incoming.retarget(false); incoming.advance(2000000000);
    const auto halfway = incoming.advance(2070000000).opacity;
    check(incoming.retarget(true).opacity == halfway, "reverse consumes last displayed opacity");
    incoming.advance(2080000000); incoming.advance(2220000000);
    check(incoming.sample().opacity == 1 && !incoming.sample().active, "rapid reversal settles exactly");
    std::cout << "PASS shared frame scope/lifetime, finite crossfade and reversal\n";
}
