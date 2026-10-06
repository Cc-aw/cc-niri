/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "reference/ScrollViewportRuntime.h"
#include "RustScrollViewportRuntime.h"
#include <QJsonDocument>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <random>
using namespace CcNiri;
using namespace Qt::StringLiterals;
using Time=ViewportMotionBackend::TimePoint;
namespace {
constexpr std::uint64_t Seed=0x43434e4952495233ULL;
std::size_t histories=0,actions=0,projections=0,step=0;
double maxDelta=0;
QJsonObject lastPlan,lastContext;
QHash<QString,QRectF> lastFrames;
QLatin1StringView operation="initial"_L1;
std::int64_t now=0;
[[noreturn]] void fail(QLatin1StringView reason) {
    std::fprintf(stderr,"FAIL scroll seed=%llu history=%zu step=%zu action=%s now=%lld reason=%s\ncontext=%s\nplan=%s\n",
        static_cast<unsigned long long>(Seed),histories,step,operation.data(),static_cast<long long>(now),reason.data(),
        QJsonDocument(lastContext).toJson(QJsonDocument::Compact).constData(),QJsonDocument(lastPlan).toJson(QJsonDocument::Compact).constData());
    for (auto it=lastFrames.cbegin();it!=lastFrames.cend();++it) std::fprintf(stderr,"frame=%s %.17g %.17g %.17g %.17g\n",it.key().toUtf8().constData(),it->x(),it->y(),it->width(),it->height());
    std::abort();
}
void equal(double a,double b,QLatin1StringView reason) {
    if (a==b || (std::isnan(a)&&std::isnan(b))) return;
    if (!std::isfinite(a)||!std::isfinite(b)||std::abs(a-b)>1e-8+1e-12*std::max(std::abs(a),std::abs(b))) fail(reason);
    maxDelta=std::max(maxDelta,std::abs(a-b));
}
void equal(const QRectF &a,const QRectF &b) { equal(a.x(),b.x(),"rect x"_L1);equal(a.y(),b.y(),"rect y"_L1);equal(a.width(),b.width(),"rect width"_L1);equal(a.height(),b.height(),"rect height"_L1); }
QJsonObject context(QString session="s"_L1,QString workspace="a"_L1,QString output="eDP-1"_L1,int generation=1) {
    return {{"protocol"_L1,2},{"sessionId"_L1,session},{"workspaceId"_L1,workspace},{"targetOutput"_L1,output},{"generation"_L1,generation}};
}
QJsonObject plan(int epoch,double from,double to,double spacing=1260.25,double width=1252.25,double viewportWidth=2512.5,double origin=-1920.5) {
    QJsonArray entries;
    auto visible=[&](double logical,double offset) { const auto left=origin+logical-offset;return left>=origin && left+width<=origin+viewportWidth; };
    for (int i=0;i<12;++i) {
        const double x=i*spacing;
        if (!visible(x,from)&&!visible(x,to)) continue;
        entries.append(QJsonObject{{"windowId"_L1,QString::number(i)},{"columnId"_L1,i},{"logicalX"_L1,x},{"pixelWidth"_L1,width},
            {"oldPlacement"_L1,visible(x,from)?"visible"_L1:"parked"_L1},{"newPlacement"_L1,visible(x,to)?"visible"_L1:"parked"_L1}});
    }
    QJsonObject p{{"protocol"_L1,2},{"type"_L1,"SCROLL"_L1},{"sessionId"_L1,"s"_L1},{"workspaceId"_L1,"a"_L1},{"targetOutput"_L1,"eDP-1"_L1},{"issuedAt"_L1,1},{"epoch"_L1,epoch},
        {"oldScrollOffsetX"_L1,from},{"newScrollOffsetX"_L1,to},{"entries"_L1,entries},{"viewport"_L1,QJsonObject{{"x"_L1,origin},{"y"_L1,50.25},{"width"_L1,viewportWidth},{"height"_L1,1320.25}}}};
    if (from==to) p.insert("retargetOnly"_L1,true);
    return p;
}
struct Pair {
    ScrollViewportRuntime cpp; RustScrollViewportRuntime rust;
    void compare() {
        if (cpp.status()!=rust.status() || cpp.active()!=rust.active() || cpp.completed()!=rust.completed()) fail("status"_L1);
        const auto a=cpp.targets(),b=rust.targets(),sa=cpp.sourceFrames(),sb=rust.sourceFrames();
        auto maps=[](const auto &a,const auto &b) {
            if (a.size()!=b.size()) fail("map size"_L1);
            for (auto it=a.cbegin();it!=a.cend();++it) { if (!b.contains(it.key())) fail("map key"_L1);equal(it.value(),b.value(it.key())); }
        };
        maps(a,b);maps(sa,sb);
        auto project=[&](const QString &id,const QRectF &geometry) {
            ++projections; const auto p=cpp.projection(id,geometry),q=rust.projection(id,geometry);
            if (p.has_value()!=q.has_value()) fail("projection presence"_L1);
            if (p) { equal(p->translationX,q->translationX,"translation"_L1);equal(p->viewport,q->viewport); }
        };
        for (const auto &id:a.keys()+sa.keys()+QStringList{"unknown"_L1}) {
            if (cpp.role(id)!=rust.role(id)) fail("role"_L1);
            for (const auto &g:{a.value(id),sa.value(id),QRectF(-99999,50.25,1252.25,1320.25)}) {
                project(id,g); project(id,g.translated(0.5,0)); project(id,g.translated(std::nextafter(0.5,1.0),0));project(id,g.translated(0.500001,0));
                project(id,QRectF(g.x(),g.y(),g.width()+0.500001,g.height()));
            }
        }
    }
    bool update(QJsonObject c) { ++actions;operation="context"_L1;lastContext=c;const auto a=cpp.updateContext(c),b=rust.updateContext(c);if (a!=b)fail("context accept"_L1);compare();return a; }
    bool arm(QJsonObject p,std::int64_t t,QHash<QString,QRectF> frames={}) {
        ++actions;operation="arm"_L1;lastPlan=p;lastFrames=frames;now=t;const auto a=cpp.arm(p,Time(t),frames),b=rust.arm(p,Time(t),frames);
        if (a!=b)fail("arm accept"_L1);compare();return a;
    }
    void advance(std::int64_t t) { ++actions;operation="advance"_L1;now=t;if(cpp.advance(Time(t))!=rust.advance(Time(t)))fail("advance"_L1);compare(); }
    void cancel(QString session,std::int64_t epoch) { ++actions;operation="cancel"_L1;cpp.cancel(session,epoch);rust.cancel(session,epoch);compare(); }
    void clear() { ++actions;operation="clear"_L1;cpp.clear();rust.clear();compare(); }
    void remove(QString id) { ++actions;operation="remove"_L1;cpp.remove(id);rust.remove(id);compare(); }
    void copies() {
        ++actions;operation="copy"_L1;
        Pair clone{cpp,rust};clone.compare();clone.clear();compare();
        clone.cpp=cpp;clone.rust=rust;clone.rust=clone.rust;clone.compare();
    }
};
void malformed() {
    for (unsigned variant=0;variant<64;++variant) {
        ++histories;step=variant;Pair pair;pair.update(context());
        auto p=plan(1,0,1260.25);
        const QLatin1StringView numeric[]={"epoch"_L1,"issuedAt"_L1,"oldScrollOffsetX"_L1,"newScrollOffsetX"_L1};
        if (variant<16) p.insert(numeric[variant/4],QJsonValue(QJsonArray{QJsonValue(-1),QJsonValue(0.25),QJsonValue("wrong"_L1),QJsonValue(1e300)}[variant%4]));
        else if (variant<22) {
            const QLatin1StringView fields[]={"protocol"_L1,"type"_L1,"sessionId"_L1,"workspaceId"_L1,"targetOutput"_L1,"retargetOnly"_L1}; p.insert(fields[variant-16],QJsonValue(QJsonArray{}));
        } else if (variant<28) {
            auto v=p.value("viewport"_L1).toObject(); const QLatin1StringView fields[]={"x"_L1,"y"_L1,"width"_L1,"height"_L1};v.insert(fields[(variant-22)%4],variant%2?QJsonValue("bad"_L1):QJsonValue(0));p.insert("viewport"_L1,v);
        } else if (variant<32) {
            if (variant==28)p.remove("viewport"_L1);if(variant==29)p.insert("entries"_L1,QJsonArray{});if(variant==30)p.insert("entries"_L1,QJsonObject{});if(variant==31)p.insert("entries"_L1,QJsonArray{QJsonValue(false)});
        } else {
            auto e=p.value("entries"_L1).toArray();auto first=e[0].toObject();
            const QStringList ids={"UPPER"_L1," bad "_L1,"{uuid}"_L1,""_L1,QString(257,QLatin1Char('a')),QString::fromUtf8("İ"),QString::fromUtf8("i̇"),QString::fromUtf8("𐐨"),QString(QChar(0xd800)),QString::fromUtf8("\u0085")};
            if(variant<42) first.insert("windowId"_L1,ids[variant-32]);
            else if(variant<49) {const QLatin1StringView fields[]={"columnId"_L1,"logicalX"_L1,"pixelWidth"_L1,"oldPlacement"_L1,"newPlacement"_L1,"windowId"_L1,"extra"_L1};first.insert(fields[variant-42],QJsonValue(false));}
            else if(variant==49)first.insert("pixelWidth"_L1,-1);
            else if(variant==50)first.insert("logicalX"_L1,1e300);
            else if(variant==51)first.insert("oldPlacement"_L1,"parked"_L1);
            else if(variant==52)first.insert("newPlacement"_L1,"visible"_L1);
            else if(variant==53)first.insert("columnId"_L1,9007199254740992.0);
            else if(variant==54)first.insert("columnId"_L1,0.5);
            e[0]=first;
            if(variant==55)e.append(first);
            if(variant==56){auto second=e[1].toObject();second.insert("columnId"_L1,first.value("columnId"_L1));e[1]=second;}
            if(variant==57){auto second=e[1].toObject();second.insert("windowId"_L1,first.value("windowId"_L1));e[1]=second;}
            if(variant==58){while(e.size()<257)e.append(first);}
            p.insert("entries"_L1,e);
            if(variant>=59)p.insert("unknownEnvelope"_L1,QJsonObject{{"opaque"_L1,static_cast<int>(variant)}});
        }
        pair.arm(p,0);pair.arm(p,10000000);
        pair.arm(plan(2,0,1260.25),20000000);pair.advance(4000000000LL);pair.cancel("s"_L1,2);
    }
    for (unsigned variant=0;variant<20;++variant) {
        ++histories;Pair pair;pair.update(context());pair.arm(plan(1,0,1260.25),0);
        auto c=context();const QLatin1StringView keys[]={"protocol"_L1,"sessionId"_L1,"workspaceId"_L1,"targetOutput"_L1,"generation"_L1};
        c.insert(keys[variant%5],variant<5?QJsonValue("wrong"_L1):variant<10?QJsonValue(0):variant<15?QJsonValue("  "_L1):QJsonValue(1));
        pair.update(c);pair.arm(plan(2,0,1260.25),1000000);pair.update(context());pair.arm(plan(3,0,1260.25),2000000);
    }
}
void historiesTest() {
    std::mt19937_64 rng(Seed);
    for(unsigned run=0;run<256;++run) {
        ++histories;Pair pair;pair.update(context());
        const double spacing=double(600+rng()%1400)+0.25,width=spacing-8,viewportWidth=2*spacing-8;
        const double origin=run%7==0?0:-1920.5;
        double offset=0;int epoch=1;std::int64_t clock=0;QJsonObject previous;
        for(step=0;step<100;++step) {
            clock+=1'000'000'000/(run%4==0?1000:run%4==1?144:run%4==2?120:60);
            pair.advance(clock);
            const auto frames=step%3==0?pair.cpp.sourceFrames():pair.cpp.targets();
            const int index=int(rng()%9);const double target=index*spacing;
            auto p=plan(epoch++,offset,target,spacing,width,viewportWidth,origin);
            if(step%17==0) {auto v=p.value("viewport"_L1).toObject();v.insert("x"_L1,origin+1e-13);p.insert("viewport"_L1,v);}
            pair.arm(p,clock+3'000'000,frames);
            if(step%5==0)pair.arm(p,clock+4'000'000,frames);
            if(step%7==0){auto conflict=p;conflict.insert("extra"_L1,true);pair.arm(conflict,clock+4'000'000);}
            if(step%11==0&&!previous.isEmpty())pair.arm(previous,clock+5'000'000);
            if(step%13==0)pair.cancel("wrong"_L1,epoch);
            if(step%19==0)pair.cancel("s"_L1,epoch-2);
            if(step%23==0)pair.copies();
            if(step%29==0)pair.remove(QString::number(rng()%12));
            if(step%31==0)pair.arm(plan(epoch++,target,offset,spacing,width,viewportWidth,origin),-1,frames);
            offset=target;previous=p;
        }
        pair.advance(clock+4'000'000'000LL);pair.cancel("s"_L1,epoch);pair.arm(previous,clock+4'000'000'001LL);
        pair.update(context("s"_L1,"b"_L1));pair.arm(plan(epoch++,0,spacing,spacing,width,viewportWidth,origin),clock);
        pair.update(context("s"_L1,"a"_L1,"HDMI-A-1"_L1));pair.update(context());pair.arm(plan(epoch++,0,spacing,spacing,width,viewportWidth,origin),clock+4'000'000'002LL);
        pair.update(context("new"_L1));auto fresh=plan(0,0,spacing,spacing,width,viewportWidth,origin);fresh.insert("sessionId"_L1,"new"_L1);pair.arm(fresh,0);
        pair.update(QJsonObject{{"protocol"_L1,1}});pair.arm(fresh,1);pair.update(context());pair.arm(plan(0,0,spacing,spacing,width,viewportWidth,origin),0);
    }
}
void edgeFrames() {
    for (const auto &geometry:{QRectF(-1920.5,50.25,0,1320.25),QRectF(-668.25,50.25,-1252.25,1320.25),
        QRectF(-1920.5,50.25,1252.25,-1320.25),QRectF(-1920.5,50.25,std::numeric_limits<double>::quiet_NaN(),1320.25),
        QRectF(-1920.5,50.25,std::numeric_limits<double>::infinity(),1320.25),QRectF(-1920.5,50.25,1e-300,1320.25)}) {
        ++histories;Pair pair;pair.update(context());pair.arm(plan(1,0,1260.25),0,{{"0"_L1,geometry}});pair.advance(60000000);
        pair.arm(plan(2,1260.25,0),63000000,pair.cpp.targets());pair.advance(4000000000LL);
    }
    // Geometry rejection still consumes the plan, so its duplicate may return
    // active without rearming the previous motion. Also cover failed clock arms.
    ++histories;Pair pair;pair.update(context());pair.arm(plan(1,0,1260.25),10000000);pair.advance(60000000);
    auto bad=plan(2,1260.25,0);auto e=bad.value("entries"_L1).toArray();auto row=e[1].toObject();row.insert("pixelWidth"_L1,1200);e[1]=row;bad.insert("entries"_L1,e);
    pair.arm(bad,63000000);pair.arm(bad,64000000);pair.clear();pair.arm(bad,65000000);
    pair.update(context("s"_L1,"a"_L1,"eDP-1"_L1,0));pair.update(context());pair.arm(plan(0,0,1260.25),0);pair.advance(std::numeric_limits<std::int64_t>::max());
}
}
int main() {
    static_assert(sizeof(CcNiriScrollEntry)==40);
    static_assert(sizeof(CcNiriScrollContext)==64);
    static_assert(sizeof(CcNiriScrollPlan)==176);
    static_assert(sizeof(CcNiriProjectionResult)==48);
    static_assert(sizeof(CcNiriScrollStatus)==24);
    malformed();historiesTest();edgeFrames();
    std::printf("PASS scroll differential seed=%llu histories=%zu actions=%zu projections=%zu max-delta=%.17g\n",static_cast<unsigned long long>(Seed),histories,actions,projections,maxDelta);
}
