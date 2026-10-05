/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingCornerStyle.h"
#include <KConfigGroup>
#include <QCoreApplication>
#include <QTemporaryDir>
#include <iostream>
#include <limits>
using namespace KWin;
static void check(bool ok, const char *label) {
    if (!ok) { std::cerr << "FAIL " << label << '\n'; std::exit(1); }
}
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv); QTemporaryDir dir;
    check(dir.isValid(), "temporary config");
    auto config = KSharedConfig::openConfig(dir.filePath(QStringLiteral("kwinrc")), KConfig::SimpleConfig);
    KConfigGroup rounded(config, QStringLiteral("Round-Corners"));
    KConfigGroup own(config, QStringLiteral("Effect-cc-niri-focus-ring"));
    rounded.writeEntry("Size", 12.0); config->sync();
    FocusRingCornerStyle style(nullptr, config); int changes = 0;
    QObject::connect(&style, &FocusRingCornerStyle::changed, [&] { ++changes; });
    const QSizeF size(932, 960); const BorderRadius native(0, 8, 10, 0);
    style.reconfigure(false);
    check(style.radius(BorderRadius(), size).isNull(), "Ring loads before external corner effect");
    style.reconfigure(true);
    check(style.radius(BorderRadius(), size) == BorderRadius(12) && changes == 2 && style.source() == QStringLiteral("round-corners"),
        "late effect load updates zero-radius cache and notifies existing Ring");
    style.reconfigure(false);
    check(style.radius(native, size) == native, "unloading external effect restores native per-corner shape");
    rounded.writeEntry("Size", 18.0); config->sync(); style.reconfigure(true);
    check(style.radius(native, size) == BorderRadius(18), "reload uses current corner setting");
    check(style.radius(native, QSizeF(20, 30)) == BorderRadius(10), "small frame limits radius");
    own.writeEntry("CornerRadius", 7.0); config->sync(); style.reconfigure(true);
    check(style.radius(native, size) == BorderRadius(7) && style.source() == QStringLiteral("override"), "explicit radius wins");
    own.writeEntry("CornerRadius", 0.0); config->sync(); style.reconfigure(false);
    check(style.radius(native, size).isNull(), "explicit square override respected");
    own.deleteEntry("CornerRadius"); rounded.writeEntry("Size", 900.0); config->sync(); style.reconfigure(true);
    check(style.radius(native, size) == BorderRadius(128), "oversized setting bounded");
    rounded.writeEntry("Size", std::numeric_limits<double>::quiet_NaN()); config->sync(); style.reconfigure(true);
    check(style.radius(native, size) == native, "nonfinite external setting falls back safely");
    rounded.deleteEntry("Size"); config->sync(); style.reconfigure(true);
    check(style.radius(native, size) == BorderRadius(12), "external default radius supported");
    // Cached radius queries must never schedule refreshes or read config per paint.
    const int stable = changes;
    for (int i = 0; i < 2000; ++i) style.radius(native, size);
    QCoreApplication::processEvents(); check(changes == stable, "paint queries do not produce refresh work");
    std::cout << "PASS startup order, corner effect reload, settings, native fallback and bounded radius\n";
}
