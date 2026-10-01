#include <QCoreApplication>
#include <QFile>
#include <QJSEngine>
#include <QObject>
#include <QRegularExpression>
#include <QTextStream>

class WindowFixture : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString internalId MEMBER id CONSTANT)
public:
    QString id;
};

int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QJSEngine engine;
    QFile file(app.arguments().value(1));
    if (!file.open(QIODevice::ReadOnly)) return 1;
    QString source = QString::fromUtf8(file.readAll());
    source.remove(QRegularExpression(QStringLiteral("/\\* cjs:start \\*/.*?/\\* cjs:end \\*/"),
        QRegularExpression::DotMatchesEverythingOption));
    auto check = [&](const QString &script) {
        const auto result = engine.evaluate(script);
        if (result.isError()) {
            QTextStream(stderr) << result.toString() << '\n';
            return false;
        }
        return true;
    };
    if (!check(source + QStringLiteral(R"JS(
var controller = new WorkspaceTransferController({
 appState: {enabled:true}, normalizeUuid: value => String(value),
 snapshots: {removeWindow() {}, workspaceForWindow(){return null;}, get(){return null;}},
 stateFor: () => ({workspaceOwnerId:'A'}), getColumn: () => null,
 membership: {ownerId: () => 'A'}, topology: {byId: () => true},
 windowPolicy: {canJoinColumn: () => false}, cancelPending() {}, releaseWindow() {},
 canCommit: () => true, commitDock() {},
 adoption: {onMembershipChanged() {}, begin() {}},
 onFailure(error) { throw error; }
});
function verifyCollections() {
 if (!(controller.closedUuids instanceof Set)) throw new Error('closed records must be UUID Set');
 for (const value of controller.closedUuids) if (typeof value !== 'string') throw new Error('retained QObject');
 for (const value of controller.processing) if (typeof value !== 'string') throw new Error('processing QObject');
}
)JS"))) return 1;
    for (int index = 0; index < 5000; ++index) {
        auto *window = new WindowFixture();
        window->id = QStringLiteral("window-%1").arg(index);
        engine.globalObject().setProperty(QStringLiteral("window"), engine.newQObject(window));
        if (!check(QStringLiteral(R"JS(
controller.onMembershipChanged(window);
controller.onWindowClosed(window);
if (controller.onMembershipChanged(window)) throw new Error('closed window adopted');
verifyCollections();
)JS"))) return 1;
        delete window;
        engine.globalObject().setProperty(QStringLiteral("window"), QJSValue());
        if (index % 64 == 0) engine.collectGarbage();
    }
    if (!check(QStringLiteral("if (controller.closedUuids.size !== 4096) throw new Error('unbounded history');"))) return 1;
    return 0;
}
#include "WorkspaceQObjectTest.moc"
