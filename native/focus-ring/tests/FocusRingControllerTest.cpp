/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../FocusRingContext.h"
#include <QCoreApplication>
#include <QFile>
#include <QJSEngine>
#include <QRegularExpression>
#include <QTextStream>

class DesktopFixture : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString id MEMBER id CONSTANT)
public:
    QString id = QStringLiteral("A");
};
class OutputFixture : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString name MEMBER name CONSTANT)
public:
    QString name = QStringLiteral("eDP-1");
};
class WindowFixture : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString internalId MEMBER id CONSTANT)
    Q_PROPERTY(QObject *output MEMBER output CONSTANT)
    Q_PROPERTY(QList<QObject *> desktops READ desktops)
    Q_PROPERTY(bool managed READ yes CONSTANT)
    Q_PROPERTY(bool normalWindow READ yes CONSTANT)
    Q_PROPERTY(bool moveable READ yes CONSTANT)
    Q_PROPERTY(bool resizeable READ yes CONSTANT)
public:
    QString id;
    QObject *output = nullptr, *desktop = nullptr;
    bool yes() const { return true; }
    QList<QObject *> desktops() const { return {desktop}; }
    void close() { Q_EMIT closed(); }
Q_SIGNALS:
    void closed();
};
class Publisher : public QObject {
    Q_OBJECT
public:
    CcNiri::FocusRingContext context;
    bool rejected = false;
    Q_INVOKABLE bool publish(const QString &json) {
        const bool accepted = context.update(json);
        rejected |= !accepted;
        return accepted;
    }
};
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    QJSEngine engine;
    DesktopFixture desktop;
    OutputFixture output;
    Publisher publisher;
    engine.globalObject().setProperty(QStringLiteral("desktop"), engine.newQObject(&desktop));
    engine.globalObject().setProperty(QStringLiteral("output"), engine.newQObject(&output));
    engine.globalObject().setProperty(QStringLiteral("publisher"), engine.newQObject(&publisher));
    QString source;
    for (int index = 1; index < argc; ++index) {
        QFile file(app.arguments().at(index));
        if (!file.open(QIODevice::ReadOnly)) return 1;
        QString module = QString::fromUtf8(file.readAll());
        module.remove(QRegularExpression(QStringLiteral("/\\* cjs:start \\*/.*?/\\* cjs:end \\*/"), QRegularExpression::DotMatchesEverythingOption));
        source += module + QLatin1Char('\n');
    }
    const auto check = [&](const QString &script) {
        const auto result = engine.evaluate(script);
        if (result.isError()) { QTextStream(stderr) << result.toString() << '\n'; return false; }
        return true;
    };
    if (!check(source + QStringLiteral(R"JS(
var state = {enabled:true, targetOutput:output, activeWorkspaceId:'A', columns:[]};
var windows = [], windowStates = new Map();
var workspace = {windowList: () => windows};
var controller = new FocusRingController({workspace, sessionId:'qobject-test',
 getState: () => state, getCurrentDesktop: () => desktop,
 getWindowState: window => windowStates.get(window),
 membership: new WorkspaceMembership(), windowPolicy: new WindowPolicy(),
 invoke: (service, path, iface, method, json, callback) => callback(publisher.publish(json))
});
controller.start();
)JS"))) return 1;
    // Real Qt signal delivery and QObject deletion, with Columns deliberately
    // retaining the dead wrapper until the model removal notification.
    for (int index = 0; index < 2000; ++index) {
        auto *window = new WindowFixture;
        window->id = QStringLiteral("aaaaaaaa-aaaa-4aaa-8aaa-%1").arg(index + 1, 12, 16, QLatin1Char('0'));
        window->output = &output; window->desktop = &desktop;
        engine.globalObject().setProperty(QStringLiteral("window"), engine.newQObject(window));
        if (!check(QStringLiteral(R"JS(
windows.push(window); state.columns.push({window}); windowStates.set(window, {floating:false});
controller.watchWindow(window); controller.membershipChanged();
)JS")) || publisher.context.windows.size() != 1) return 2;
        window->close();
        if (!publisher.context.windows.isEmpty()) return 3;
        delete window;
        if (!check(QStringLiteral(R"JS(
controller.publish(true);
state.columns = []; windows = []; windowStates.clear(); controller.membershipChanged();
if (controller.closed.size || controller.watched.size) throw new Error('retained dead QObject');
)JS")) || !publisher.context.windows.isEmpty()) return 4;
        engine.globalObject().setProperty(QStringLiteral("window"), QJSValue());
        if (index % 64 == 0) engine.collectGarbage();
    }
    if (!check(QStringLiteral("controller.stop();")) || publisher.context.enabled || publisher.rejected) return 5;
    QTextStream(stdout) << "PASS QV4 script eligibility -> native protocol, Qt close signal and 2000 destroyed windows\n";
    return 0;
}
#include "FocusRingControllerTest.moc"
