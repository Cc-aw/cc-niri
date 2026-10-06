/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "FocusRingCore.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <random>
#include <type_traits>
namespace Ref=CcNiri::FocusRingReference;
static constexpr std::uint64_t Seed=0x43434e4952495235;
static std::uint64_t cases=0,values=0,layouts=0;
static double maxDelta=0;
static CcNiriRingInput current{};
static void check(bool ok,const char *field) {
    if(ok) return;
    std::cerr<<"FAIL seed="<<Seed<<" case="<<cases<<" field="<<field<<" deviceScale="<<current.device_scale
        <<" size="<<current.frame.inner.width<<','<<current.frame.inner.height<<" matrix=";
    for(double x:current.matrix) std::cerr<<x<<',';
    std::cerr<<'\n'; std::exit(1);
}
static void same(double a,double b,const char *field) {
    ++values;
    if(std::isnan(a)||std::isnan(b)) { check(std::isnan(a)&&std::isnan(b),field); return; }
    if(!std::isfinite(a)||!std::isfinite(b)) { check(a==b,field); return; }
    const double delta=std::abs(a-b); maxDelta=std::max(maxDelta,delta);
    check(delta<=1e-10+1e-12*std::max(std::abs(a),std::abs(b)),field);
}
static void rect(CcNiriRect a,CcNiriRect b,const char *field) {
    same(a.x,b.x,field);same(a.y,b.y,field);same(a.width,b.width,field);same(a.height,b.height,field);
}
static void compare(CcNiriRingInput input) {
    current=input; ++cases;
    const auto a=Ref::metrics(input),b=cc_niri_ring_metrics(&input);
    check(a.valid==b.valid && b.status==0,"metrics acceptance");
    const auto ca=Ref::capture(input.frame),cb=cc_niri_ring_capture(&input.frame);
    check(ca.valid==cb.valid && cb.status==0,"snapshot acceptance");
    if(cb.valid) {
        rect(ca.frame.inner,cb.frame.inner,"frozen frame");
        same(ca.frame.item_opacity,cb.frame.item_opacity,"item opacity");
        same(ca.frame.effect_opacity,cb.frame.effect_opacity,"effect opacity");
        same(ca.frame.thickness,cb.frame.thickness,"frame thickness");
        for(int i=0;i<4;++i) same(ca.frame.radii[i],cb.frame.radii[i],"frame radius");
    }
    check(Ref::geometryValid(input.frame.inner.width,input.frame.inner.height,input.frame.radii)==
        bool(cc_niri_ring_geometry_valid(input.frame.inner.width,input.frame.inner.height,input.frame.radii)),"attach geometry");
    if(!a.valid) return;
    const auto &x=a.value; const auto &y=b.value;
    same(x.scale_x,y.scale_x,"scale x"); same(x.scale_y,y.scale_y,"scale y");
    same(x.device_scale,y.device_scale,"device scale");same(x.thickness,y.thickness,"thickness");
    same(x.width,y.width,"body width");same(x.height,y.height,"body height");same(x.border_thickness,y.border_thickness,"native thickness");
    for(int i=0;i<8;++i) same(x.radii[i],y.radii[i],"radii");
    check(x.compensated==y.compensated,"native/compensated selection");
    rect(Ref::damage(input.frame.inner,x),cc_niri_ring_damage(input.frame.inner,y),"damage bounds");
    const auto la=Ref::layout(x),lb=cc_niri_ring_layout(&y);
    check(la.valid==lb.valid && lb.status==0,"layout acceptance");
    if(!la.valid) return;
    ++layouts;
    for(int i=0;i<8;++i) {
        const auto &p=la.patches[i], &q=lb.patches[i];
        rect(p.rect,q.rect,"patch rect");rect(p.geometry,q.geometry,"pixel geometry");
        same(p.translate_x,q.translate_x,"pixel translation x");same(p.translate_y,q.translate_y,"pixel translation y");
        same(p.scale_x,q.scale_x,"pixel scale x");same(p.scale_y,q.scale_y,"pixel scale y");
        check(p.texture_width==q.texture_width && p.texture_height==q.texture_height && p.visible==q.visible,"texture extent/visibility");
    }
}
static CcNiriRingInput base() {
    return {{{0,0,932,701},3,{12,12,12,12},0.55,0.8},1.5,
        {1,0,0,-230,0,1,0,10,0,0,1,0,0,0,0,1}};
}
int main() {
    static_assert(sizeof(CcNiriRingFrame)==88 && sizeof(CcNiriRingInput)==224);
    static_assert(sizeof(CcNiriRingMetrics)==128 && sizeof(CcNiriRingMetricsResult)==136);
    static_assert(sizeof(CcNiriRingPatch)==112 && sizeof(CcNiriRingLayout)==904);
    static_assert(std::is_standard_layout_v<CcNiriRingInput>);
    const double nan=std::numeric_limits<double>::quiet_NaN(),inf=std::numeric_limits<double>::infinity();
    for(double s:{1.0,1.25,1.5,1.75,2.0,3.0,4.0})
    for(double w:{0.25,10.0,931.0,932.0,932.4,1800.0})
    for(double fraction:{0.0,0.25,0.5,0.75})
    for(double sx:{0.0001,0.713,0.9999,1.0,1.0001,1.317,64.0}) {
        auto in=base();in.device_scale=s;in.frame.inner.width=w+fraction;in.frame.inner.height=701+fraction;
        in.matrix[0]=double(float(sx));in.matrix[5]=sx==1?1:double(float(0.973));
        in.frame.radii[0]=0;in.frame.radii[1]=2.5;in.frame.radii[2]=12;in.frame.radii[3]=20;
        compare(in);
    }
    // Every matrix cell nonfinite; non-axis affine/projective/reflection stays
    // on the original native path. Scale limits retain their inclusive edges.
    for(int i=0;i<16;++i) for(double v:{nan,inf,-inf,-0.5,0.0,0.00009,0.0001,1.0,64.0,64.0001}) {
        auto in=base();in.matrix[i]=v;compare(in);
    }
    for(double v:{nan,inf,-inf,-1.0,-0.0,0.0,0.25,0.5,1.0,128.0,1024.0}) {
        auto in=base();in.device_scale=v;compare(in);
        in=base();in.frame.inner.width=v;compare(in);
        in=base();in.frame.item_opacity=v;compare(in);
        in=base();in.frame.effect_opacity=v;compare(in);
        in=base();in.frame.radii[0]=v;compare(in);
        in=base();in.frame.thickness=v;compare(in);
        for(double s:{1.0,1.25,1.5,2.0}) {
            same(Ref::padding(v),cc_niri_ring_padding(v),"padding");
            same(Ref::devicePadding(v,s),cc_niri_ring_device_padding(v,s),"outward device padding");
        }
        for(double r:{nan,-1.0,0.0,12.0,128.0,900.0}) for(bool loaded:{false,true}) {
            const auto a=Ref::corners(v,r,loaded),b=cc_niri_ring_corners(v,r,loaded);
            same(a.configured,b.configured,"override config");same(a.rounded,b.rounded,"corner effect config");
            const double native[4]{0,2,10,12};
            const auto x=Ref::radius(a,native,10,20),y=cc_niri_ring_radius(b,native,10,20);
            check(x.source==y.source && y.status==0,"corner source");
            for(int i=0;i<4;++i) same(x.values[i],y.values[i],"corner clamp");
        }
    }
    std::mt19937_64 rng(Seed);
    const auto uniform=[&](double lo,double hi) { return std::uniform_real_distribution<double>(lo,hi)(rng); };
    for(int i=0;i<30000;++i) {
        auto in=base();in.device_scale=uniform(0.5,4);in.frame.inner.width=uniform(0.25,3000);in.frame.inner.height=uniform(0.25,2000);
        for(double &r:in.frame.radii) r=uniform(0,std::min(in.frame.inner.width,in.frame.inner.height)/2);
        in.matrix[0]=double(float(uniform(0.1,2)));in.matrix[5]=double(float(uniform(0.1,2)));
        in.matrix[3]=double(float(uniform(-4000,4000)));in.matrix[7]=double(float(uniform(-2000,2000)));
        if(i%11==0) in.matrix[1]=0.2;
        if(i%13==0) in.matrix[0]=-in.matrix[0];
        compare(in);
    }
    check(cc_niri_ring_metrics(nullptr).status==1 && cc_niri_ring_capture(nullptr).status==1 && cc_niri_ring_layout(nullptr).status==1,"null DTO");
    std::cout<<"PASS Focus Ring differential seed="<<Seed<<" cases="<<cases<<" layouts="<<layouts
        <<" numeric-values="<<values<<" max-delta="<<maxDelta<<" tolerance=1e-10+1e-12*scale\n";
}
