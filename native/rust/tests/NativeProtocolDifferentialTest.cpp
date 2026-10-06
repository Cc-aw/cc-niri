/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "../../focus-ring/FocusRingContext.h"
#include "../../focus-ring/RustFocusRingContext.h"
#include "../../viewport-clip/RustScrollPlanSequence.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QUuid>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <random>
using namespace CcNiri;
using namespace Qt::StringLiterals;
static std::uint64_t actions=0,permissions=0,validations=0;
static void check(bool ok,const char *label) { if (!ok) { std::cerr<<"FAIL "<<label<<" action="<<actions<<'\n'; std::exit(1); } }
static QString json(const QJsonObject &value) { return QString::fromUtf8(QJsonDocument(value).toJson(QJsonDocument::Compact)); }
static const QString A=QStringLiteral("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
static const QString B=QStringLiteral("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
static QJsonObject eligibility(double generation=1) {
    return {{"protocol"_L1,1},{"type"_L1,"focus-ring-eligibility"_L1},{"enabled"_L1,true},{"sessionId"_L1,"s"_L1},
        {"workspaceId"_L1,"w"_L1},{"targetOutput"_L1,"eDP-1"_L1},{"generation"_L1,generation},{"windows"_L1,QJsonArray{A,B}}};
}
static FocusRingCandidate candidate(std::uint32_t flags) {
    FocusRingCandidate c; c.id=A; c.workspace=QStringLiteral("w"); c.output=QStringLiteral("eDP-1"); c.opacity=1;
    c.active=flags&1; c.managed=flags&2; c.normal=flags&4; c.visible=flags&8; c.onCurrentActivity=flags&16;
    c.onCurrentDesktop=flags&32; c.insideOutput=flags&64; c.minimized=flags&128; c.deleted=flags&256; c.fullscreen=flags&512; return c;
}
static void compare(FocusRingContext &cpp,RustFocusRingContext &rust) {
    check(cpp.session==rust.session && cpp.workspace==rust.workspace && cpp.output==rust.output && cpp.generation==rust.generation
        && cpp.enabled==rust.enabled && cpp.windows==rust.windows && cpp.retiredSessions==rust.retiredSessions,"eligibility snapshot");
    for (std::uint32_t flags: {0x7fu,0u,0x3ffu,0x7eu,0x7du,0x7bu,0x77u,0x6fu,0x5fu,0x3fu,0xffu,0x17fu,0x27fu}) {
        auto c=candidate(flags); ++permissions; check(cpp.permits(c)==rust.permits(c),"native flags");
    }
    for (double opacity: {0.0,-1.0,std::numeric_limits<double>::quiet_NaN(),std::numeric_limits<double>::infinity(),0.5}) {
        auto c=candidate(0x7f); c.opacity=opacity; ++permissions; check(cpp.permits(c)==rust.permits(c),"opacity");
    }
    for (int field=0;field<3;++field) { auto c=candidate(0x7f); (field==0?c.id:field==1?c.workspace:c.output)=QStringLiteral("other");
        ++permissions; check(cpp.permits(c)==rust.permits(c),"identity"); }
}
static QJsonObject scroll(double epoch=0) {
    QJsonArray entries;
    for (int i=0;i<3;++i) entries.append(QJsonObject{{"windowId"_L1,QString::number(i)},{"columnId"_L1,i},{"logicalX"_L1,i*1260.25},{"pixelWidth"_L1,1252.25},
        {"oldPlacement"_L1,i<2?"visible"_L1:"parked"_L1},{"newPlacement"_L1,i>0?"visible"_L1:"parked"_L1}});
    return {{"protocol"_L1,2},{"type"_L1,"SCROLL"_L1},{"sessionId"_L1,"s"_L1},{"workspaceId"_L1,"w"_L1},{"targetOutput"_L1,"eDP-1"_L1},{"epoch"_L1,epoch},{"issuedAt"_L1,1},
        {"oldScrollOffsetX"_L1,0},{"newScrollOffsetX"_L1,1260.25},{"viewport"_L1,QJsonObject{{"x"_L1,0},{"y"_L1,0},{"width"_L1,2512.5},{"height"_L1,996}}},{"entries"_L1,entries}};
}
static_assert(sizeof(CcNiriProtocolResult)==16);
static_assert(sizeof(CcNiriEligibilitySnapshot)==112);
static_assert(sizeof(CcNiriEligibilityCandidate)==64);
static_assert(sizeof(CcNiriEligibilityStatus)==32);
int main() {
    std::mt19937_64 random(0x43434e4952495236ULL);
    // Both invalid messages and stale messages must produce identical state,
    // including metadata retained after fail-closed and session tombstones.
    for (int history=0;history<100;++history) {
        FocusRingContext cpp; RustFocusRingContext rust; QJsonObject latest=eligibility();
        for (int step=0;step<300;++step) {
            ++actions; auto next=eligibility(step);
            QString raw;
            switch(random()%25) {
            case 0: next.insert("generation"_L1,step/2); break;
            case 1: next=latest; break;
            case 2: next.insert("sessionId"_L1,QString::number(random()%8)); break;
            case 3: next.insert("workspaceId"_L1,"other"_L1); break;
            case 4: next.insert("targetOutput"_L1,"DP-1"_L1); break;
            case 5: next.insert("windows"_L1,QJsonArray{B}); break;
            case 6: next.insert("windows"_L1,QJsonArray{A,QString("{"_L1+A.toUpper()+"}"_L1)}); break;
            case 7: next.insert("windows"_L1,QJsonArray{"not-a-uuid"_L1}); break;
            case 8: next.insert("windows"_L1,QJsonArray{QStringLiteral("00000000-0000-0000-0000-000000000000")}); break;
            case 9: next.insert("windows"_L1,QJsonArray{42}); break;
            case 10: next.insert("generation"_L1,0.5); break;
            case 11: next.insert("generation"_L1,9007199254740992.0); break;
            case 12: next.insert("protocol"_L1,2); break;
            case 13: next.remove("enabled"_L1); break;
            case 14: next.insert("enabled"_L1,false); next.insert("windows"_L1,QJsonArray{}); next.insert("workspaceId"_L1,""_L1); next.insert("targetOutput"_L1,""_L1); break;
            case 15: next.insert("sessionId"_L1,QString(129,QLatin1Char('a'))); break;
            case 16: next.insert("sessionId"_L1,QStringLiteral(" ")); break;
            case 17: next.insert("windows"_L1,QJsonArray{}); break;
            case 18: next.insert("sessionId"_L1,QString::fromUcs4(U"会话😀")); break;
            case 19: raw=QStringLiteral("[]"); break;
            case 20: raw=QString(256*1024+1,QLatin1Char('x')); break;
            case 21: next.insert("sessionId"_L1,QString(1,QChar(0xd800))); break;
            case 22: next.insert("windows"_L1,QJsonArray{QString("{"_L1+A.toUpper()+"}"_L1)}); break;
            case 23: cpp.clear(); rust.clear(); break;
            default: break;
            }
            if (raw.isEmpty()) raw=json(next);
            check(cpp.update(raw)==rust.update(raw),"eligibility acceptance"); compare(cpp,rust); latest=next;
            if (step%37==0) { auto clone=rust; compare(cpp,clone); clone.clear(); compare(cpp,rust); }
        }
    }
    {
        FocusRingContext cpp; RustFocusRingContext rust;
        for(int i=0;i<260;++i) { ++actions; auto next=eligibility(0); next.insert("sessionId"_L1,QString::number(i));
            check(cpp.update(json(next))==rust.update(json(next)),"tombstone cap"); compare(cpp,rust); }
    }
    {
        FocusRingContext cpp; RustFocusRingContext rust;
        for (int count: {0,1,256,257}) {
            auto next=eligibility(count+1); QJsonArray names;
            for (int i=0;i<count;++i) names.append(QStringLiteral("aaaaaaaa-aaaa-4aaa-8aaa-%1").arg(i+1,12,16,QLatin1Char('0')));
            next.insert("windows"_L1,names); ++actions;
            check(cpp.update(json(next))==rust.update(json(next)),"membership bounds"); compare(cpp,rust);
        }
        for (int units: {128,129}) { auto next=eligibility(0); next.insert("sessionId"_L1,QString(units,QChar(0xd800))); ++actions;
            check(cpp.update(json(next))==rust.update(json(next)),"UTF-16 length bounds");compare(cpp,rust); }
        auto next=eligibility(9007199254740991.0); next.insert("sessionId"_L1,"max-safe"_L1); ++actions;
        check(cpp.update(json(next))==rust.update(json(next)),"maximum generation"); compare(cpp,rust);
        next.insert("unknown"_L1,42); ++actions;
        check(cpp.update(json(next))==rust.update(json(next)),"ring duplicate ignores extra metadata"); compare(cpp,rust);
        for (const auto &key: {"protocol"_L1,"type"_L1,"sessionId"_L1,"workspaceId"_L1,"targetOutput"_L1,"generation"_L1,"windows"_L1,"enabled"_L1}) {
            auto broken=next; broken.remove(key); ++actions;
            check(cpp.update(json(broken))==rust.update(json(broken)),"required field"); compare(cpp,rust);
        }
    }
    for (int history=0;history<100;++history) {
        ViewportScrollPlanSequence cpp; RustScrollPlanSequence rust;
        QJsonObject latest=scroll();
        for(int step=0;step<300;++step) {
            ++actions; QJsonObject ctx{{"protocol"_L1,2},{"sessionId"_L1,"s"_L1},{"workspaceId"_L1,"w"_L1},{"targetOutput"_L1,"eDP-1"_L1},{"generation"_L1,step}};
            if(step%5==0) {
                switch(random()%8) { case 0:ctx.insert("protocol"_L1,1);break; case 1:ctx.insert("generation"_L1,-1);break;
                case 2:ctx.insert("generation"_L1,0.5);break; case 3:ctx.insert("generation"_L1,0);break;case 4:ctx.insert("sessionId"_L1,"reload"_L1);break;
                case 5:ctx.insert("workspaceId"_L1,"other"_L1);break;case 6:ctx.insert("sessionId"_L1," "_L1);break;default:break; }
                check(cpp.updateContext(ctx)==rust.updateContext(ctx),"observer context acceptance");
                check(cpp.hasAuthority()==rust.hasAuthority(),"observer authority");
            }
            auto plan=scroll(step);
            switch(random()%22) {
            case 0:plan=latest;break; case 1:plan.insert("epoch"_L1,0);break; case 2:plan.insert("epoch"_L1,0.5);break;
            case 3:plan.insert("epoch"_L1,9007199254740992.0);break;case 4:plan.insert("protocol"_L1,1);break;
            case 5:plan.insert("sessionId"_L1,"reload"_L1);break;case 6:plan.insert("workspaceId"_L1,"other"_L1);break;
            case 7:plan.insert("type"_L1,"WIDE"_L1);break;case 8:plan.insert("retargetOnly"_L1,true);break;
            case 9:plan.insert("newScrollOffsetX"_L1,0);break;case 10:plan.insert("issuedAt"_L1,"1"_L1);break;
            case 11:plan.insert("entries"_L1,QJsonArray{});break;case 12:plan.insert("viewport"_L1,QJsonObject{});break;
            case 13:plan.insert("extra"_L1,step);break;case 14:plan.insert("sessionId"_L1,QString::fromUcs4(U"😀"));break;
            default:break;
            }
            if(step%3==0) { auto entries=plan.value("entries"_L1).toArray(); if(!entries.isEmpty()) {
                auto e=entries[0].toObject();
                switch(random()%8) {case 0:e.insert("windowId"_L1," X "_L1);break;case 1:e.insert("columnId"_L1,1);break;
                case 2:e.insert("pixelWidth"_L1,0);break;case 3:e.insert("oldPlacement"_L1,42);break;case 4:e.insert("logicalX"_L1,-1);break;
                case 5:e.insert("windowId"_L1,QString(1,QChar(0xd800)));break;case 6:e.insert("columnId"_L1,0.5);break;default:break;}
                entries[0]=e;plan.insert("entries"_L1,entries);
            }}
            ++validations; check(validViewportScrollPlan(plan)==rust.validPlan(plan),"scroll validation");
            check(cpp.observe(plan)==rust.observe(plan),"observer sequence disposition"); latest=plan;
        }
    }
    std::cout<<"PASS native protocol differential actions="<<actions<<" permissions="<<permissions<<" validations="<<validations<<" seed=4846803700800901686\n";
}
