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
    int *screen() const { return output; }
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
    Window a{&primary, {{1001, true}, {1002, true}, {1003, true}, {1004, true}}};
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
    return 0;
}
