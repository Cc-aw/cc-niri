#include <QCoreApplication>
#include <QFile>
#include <QJSEngine>
#include <QTextStream>

// Compile production scripts with KWin's JavaScript engine without executing
// workspace or Effects APIs. Node accepts syntax that QJSEngine cannot parse.
int main(int argc, char **argv)
{
    QCoreApplication application(argc, argv);
    QJSEngine engine;
    for (const QString &path : application.arguments().mid(1)) {
        QFile source(path);
        if (!source.open(QIODevice::ReadOnly)) {
            QTextStream(stderr) << "Cannot read " << path << '\n';
            return 1;
        }
        const auto result = engine.evaluate(QStringLiteral("(function(){\n")
            + QString::fromUtf8(source.readAll()) + QStringLiteral("\n})"), path);
        if (result.isError()) {
            QTextStream(stderr) << path << ':'
                << result.property(QStringLiteral("lineNumber")).toInt()
                << ' ' << result.toString() << '\n';
            return 1;
        }
    }
    return 0;
}
