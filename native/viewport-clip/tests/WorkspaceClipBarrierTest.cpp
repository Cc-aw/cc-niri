#include "WorkspaceClipBarrier.h"
#include <QHash>
#include <QList>
#include <QSet>
#include <cstdio>
#include <cstdlib>
#include <functional>

struct Window {
    int *output;
    QHash<int, QVariant> roles;
    std::function<void(int)> changed;
    bool current = true;
    int *screen() const { return output; }
    bool isOnCurrentDesktop() const { return current; }
    QVariant data(int role) const { return roles.value(role); }
    void setData(int role, const QVariant &value) {
        roles.insert(role, value);
        if (changed) changed(role);
    }
};
void require(bool condition)
{
    if (!condition) { std::fputs("workspace clip barrier assertion failed\n", stderr); std::exit(1); }
}
int main()
{
    int primary = 1, secondary = 2;
    Window a{&primary, {{1001, true}, {1002, true}, {1003, true}, {1004, true}}, {}, true};
    Window b = a; b.output = &secondary;
    // Include a window whose marker remains even without active set membership.
    Window orphan = a;
    QList<Window *> windows{&a, &b, &orphan};
    QSet<Window *> active{&a, &b}, plans{&a, &b};
    a.changed = [&](int role) {
        if (role == 1001) active.remove(&a);
        if (role == 1003) plans.remove(&a);
    };
    KWin::clearWorkspaceClipWindows(windows, &primary, active, plans, 1001, 1003, 1004);
    require(active == QSet<Window *>{&b} && plans == QSet<Window *>{&b});
    for (Window *window : {&a, &orphan}) {
        for (int role : {1001, 1003, 1004}) require(!window->roles.value(role).isValid());
        require(window->roles.value(1002).toBool());
    }
    require(b.roles.value(1001).toBool() && b.roles.value(1003).toBool());
    KWin::clearWorkspaceClipWindows(windows, static_cast<int *>(nullptr), active, plans, 1001, 1003, 1004);
    require(active.isEmpty() && plans.isEmpty());
    require(!KWin::acceptsWorkspaceMotion(999, 1000, true));
    require(!KWin::acceptsWorkspaceMotion(2000, 1000, false));
    require(KWin::acceptsWorkspaceMotion(1000, 1000, true));
    require(KWin::acceptsWorkspaceMotion(1001, 1000, true));
    // A Slide paint of the source desktop keeps the active Wide viewport but
    // retires its authority/completion roles. Repeated J/K preserves it until
    // the source returns; ordinary SCROLL and unrelated outputs still clear.
    const QVariantMap clip{{QStringLiteral("enabled"), true}, {QStringLiteral("x"), 24}};
    a.current = false;
    a.roles[1001] = clip;
    a.roles[1003] = QVariantMap{{QStringLiteral("type"), QStringLiteral("PAIR_TO_WIDE")}};
    orphan.current = false;
    orphan.roles[1001] = clip;
    orphan.roles[1003] = QVariantMap{{QStringLiteral("type"), QStringLiteral("SCROLL")}};
    b.roles[1001] = clip;
    active = {&a, &b, &orphan}; plans = active;
    KWin::clearWorkspaceClipWindows(windows, &primary, active, plans, 1001, 1003, 1004, true);
    require(active == QSet<Window *>{&a, &b} && plans == QSet<Window *>{&b});
    require(a.data(1001).toMap().value(QStringLiteral("workspaceDeparture")).toBool());
    require(!a.data(1003).isValid() && !a.data(1004).isValid());
    require(!orphan.data(1001).isValid());
    KWin::clearWorkspaceClipWindows(windows, &primary, active, plans, 1001, 1003, 1004, true);
    require(active.contains(&a));
    a.current = true;
    KWin::clearWorkspaceClipWindows(windows, &primary, active, plans, 1001, 1003, 1004, true);
    require(active == QSet<Window *>{&b});
    require(!a.data(1001).isValid());
    return 0;
}
