#include <QCoreApplication>
#include <QFile>
#include <QJSEngine>
#include <QObject>
#include <QRegularExpression>
#include <QTextStream>

class DesktopFixture : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString id MEMBER id CONSTANT)
public:
    QString id;
};
class WindowFixture : public QObject {
    Q_OBJECT
    Q_PROPERTY(QList<QObject *> desktops READ desktops)
public:
    QObject *owner = nullptr;
    QList<QObject *> desktops() const { return {owner}; }
};
class Backend : public QObject {
    Q_OBJECT
public:
    Q_INVOKABLE void remove(QObject *desktop) { delete desktop; }
};
int main(int argc, char **argv)
{
    QCoreApplication app(argc, argv);
    QJSEngine engine;
    Backend backend;
    DesktopFixture first, tail;
    first.id = QStringLiteral("first"); tail.id = QStringLiteral("tail");
    WindowFixture window; window.owner = &first;
    auto check = [&](const QString &script) {
        const auto result = engine.evaluate(script);
        if (result.isError()) { QTextStream(stderr) << result.toString() << '\n'; return false; }
        return true;
    };
    for (int index = 1; index < argc; ++index) {
        QFile file(app.arguments().at(index));
        if (!file.open(QIODevice::ReadOnly)) return 1;
        QString source = QString::fromUtf8(file.readAll());
        source.remove(QRegularExpression(QStringLiteral("/\\* cjs:start \\*/.*?/\\* cjs:end \\*/"), QRegularExpression::DotMatchesEverythingOption));
        // One evaluation keeps lexical module declarations in the same scope.
        engine.globalObject().setProperty(QStringLiteral("source%1").arg(index), source);
    }
    engine.globalObject().setProperty(QStringLiteral("backend"), engine.newQObject(&backend));
    engine.globalObject().setProperty(QStringLiteral("first"), engine.newQObject(&first));
    engine.globalObject().setProperty(QStringLiteral("tail"), engine.newQObject(&tail));
    engine.globalObject().setProperty(QStringLiteral("window"), engine.newQObject(&window));
    QString source;
    for (int index = 1; index < argc; ++index) source += engine.globalObject().property(QStringLiteral("source%1").arg(index)).toString() + '\n';
    if (!check(source + QStringLiteral(R"JS(
var membership = new WorkspaceMembership();
var occupancy = new WorkspaceOccupancy({membership});
function recycleCandidate() {
 var live = true, timers = [], confirmed = [], rows = [];
 var controller = new WorkspaceRecycleController({
  enabled:true, isReady:()=>true,
  transitionStatus:callback=>callback(false),
  getDesktopIds:()=>live?[first.id,candidate.id,tail.id]:[first.id,tail.id],
  getProtectedIds:()=>[first.id], getWindows:()=>[window], occupancy,
  removeDesktop(id) { if(id!==candidate.id) throw new Error('wrong candidate'); backend.remove(candidate); candidate=null; live=false; controller.request(); },
  onRemoved:id=>confirmed.push(id), ensureVerticalLayout:count=>rows.push(count),
  setTimer(callback){timers.push(callback);return callback;}, clearTimer(){},
  warn(message){throw new Error(message);}
 });
 controller.request();
 for(var i=0;timers.length&&i<10;++i)timers.shift()();
 if(timers.length||confirmed.length!==1||rows[rows.length-1]!==2||controller.pendingId!==null)throw new Error('lifetime/confirmation failure');
 controller.stop();
}
)JS"))) return 1;
    for (int index = 0; index < 500; ++index) {
        auto *candidate = new DesktopFixture();
        candidate->id = QStringLiteral("candidate-%1").arg(index);
        engine.globalObject().setProperty(QStringLiteral("candidate"), engine.newQObject(candidate));
        if (!check(QStringLiteral("recycleCandidate()"))) return 1;
        if (index % 32 == 0) engine.collectGarbage();
    }
    return 0;
}
#include "WorkspaceRecycleQObjectTest.moc"
