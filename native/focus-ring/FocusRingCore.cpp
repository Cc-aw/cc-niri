/* SPDX-License-Identifier: GPL-2.0-or-later */
// Numeric golden baseline extracted from the pre-R5 Ring implementation.
#include "FocusRingCore.h"
#include <algorithm>
#include <cmath>
namespace CcNiri::FocusRingReference {
CcNiriRingCorners corners(double configured,double rounded,bool loaded) {
    return {std::isfinite(configured) && configured>=0 ? std::min(configured,128.0) : -1,
        loaded && std::isfinite(rounded) ? std::clamp(rounded,0.0,128.0) : 0};
}
CcNiriRingRadius radius(CcNiriRingCorners c,const double native[4],double w,double h) {
    CcNiriRingRadius result{};
    result.source=c.configured>=0 ? 2 : (c.rounded>0 ? 1 : 0);
    if(c.configured<0 && c.rounded<=0) std::copy_n(native,4,result.values);
    else std::fill_n(result.values,4,std::min(c.configured>=0 ? c.configured : c.rounded,std::max(0.0,std::min(w,h)/2)));
    return result;
}
bool geometryValid(double w,double h,const double radii[4]) {
    if(!std::isfinite(w) || !std::isfinite(h) || w<=0 || h<=0) return false;
    for(int i=0;i<4;++i) if(!std::isfinite(radii[i]) || radii[i]<0 || radii[i]>std::min(w,h)/2) return false;
    return true;
}
CcNiriRingFrameResult capture(const CcNiriRingFrame &f) {
    return {f,std::isfinite(f.item_opacity) && f.item_opacity>0 && std::isfinite(f.effect_opacity) && f.effect_opacity>0 ? 1u : 0u,0};
}
CcNiriRingMetricsResult metrics(const CcNiriRingInput &in) {
    CcNiriRingMetricsResult result{};
    const auto &f=in.frame; const double s=in.device_scale;
    if(!std::isfinite(s) || s<=0 || !(f.inner.width>0 && f.inner.height>0)) return result;
    for(const double v : in.matrix) if(!std::isfinite(v)) return result;
    auto &m=result.value;
    m.scale_x=m.scale_y=1; m.device_scale=s; m.thickness=3;
    m.width=f.inner.width; m.height=f.inner.height; m.border_thickness=3;
    std::fill_n(m.radii,8,-1);
    const auto &a=in.matrix;
    const bool axis=a[1]==0 && a[4]==0 && a[2]==0 && a[6]==0 && a[8]==0 && a[9]==0
        && a[12]==0 && a[13]==0 && a[14]==0 && a[15]==1;
    result.valid=1;
    if(!axis || a[0]<0 || a[5]<0) return result;
    m.scale_x=a[0]; m.scale_y=a[5];
    if(m.scale_x<0.0001 || m.scale_y<0.0001 || m.scale_x>64 || m.scale_y>64) { result.valid=0; return result; }
    m.thickness=std::round(f.thickness*s)/s;
    m.width=std::round(f.inner.width*s)*m.scale_x/s;
    m.height=std::round(f.inner.height*s)*m.scale_y/s;
    for(int i=0;i<4;++i) {
        const double r=std::round(f.radii[i]*s)/s;
        m.radii[2*i]=std::min(r*m.scale_x,m.width/2);
        m.radii[2*i+1]=std::min(r*m.scale_y,m.height/2);
    }
    m.compensated=m.scale_x!=1 || m.scale_y!=1;
    m.border_thickness=m.scale_x==1 && m.scale_y==1 ? m.thickness : f.thickness;
    return result;
}
CcNiriRingLayout layout(const CcNiriRingMetrics &m) {
    CcNiriRingLayout out{};
    const double w=m.width,h=m.height,t=m.thickness,s=m.device_scale;
    // Guard texture conversions. Original production metrics satisfy these
    // conditions; malformed FFI inputs never reach a renderer or integer cast.
    for(double v : {w,h,t}) if(!std::isfinite(v) || v<0) return out;
    for(double v : {s,m.scale_x,m.scale_y}) if(!std::isfinite(v) || v<=0) return out;
    double x[4],y[4];
    for(int i=0;i<4;++i) {
        if(!std::isfinite(m.radii[2*i]) || !std::isfinite(m.radii[2*i+1]) || m.radii[2*i]<0 || m.radii[2*i+1]<0) return out;
        x[i]=std::min(std::ceil(m.radii[2*i]*s)/s,w/2);
        y[i]=std::min(std::ceil(m.radii[2*i+1]*s)/s,h/2);
    }
    const CcNiriRect rects[8]{{-t,-t,x[0]+t,y[0]+t},{w-x[1],-t,x[1]+t,y[1]+t},
        {w-x[2],h-y[2],x[2]+t,y[2]+t},{-t,h-y[3],x[3]+t,y[3]+t},
        {x[0],-t,std::max(0.0,w-x[0]-x[1]),t},{w,y[1],t,std::max(0.0,h-y[1]-y[2])},
        {x[3],h,std::max(0.0,w-x[3]-x[2]),t},{-t,y[0],t,std::max(0.0,h-y[0]-y[3])}};
    for(int i=0;i<8;++i) {
        const auto r=rects[i];
        if(!std::isfinite(r.x*s) || !std::isfinite(r.y*s) || !std::isfinite(r.width*s) || !std::isfinite(r.height*s)) return {};
        if(i<4 && (std::ceil(r.width*s)>1024 || std::ceil(r.height*s)>1024)) return {};
        auto &p=out.patches[i]; p.rect=r;
        p.geometry={std::round(r.x*s)/s,std::round(r.y*s)/s,std::max(1.0,std::round(r.width*s))/s,std::max(1.0,std::round(r.height*s))/s};
        p.translate_x=r.x-p.geometry.x; p.translate_y=r.y-p.geometry.y;
        p.scale_x=r.width/p.geometry.width; p.scale_y=r.height/p.geometry.height;
        p.visible=r.width>0 && r.height>0;
        if(i<4) { p.texture_width=std::max(1,int(std::ceil(r.width*s))); p.texture_height=std::max(1,int(std::ceil(r.height*s))); }
    }
    out.valid=1; return out;
}
CcNiriRect damage(CcNiriRect r,CcNiriRingMetrics m) {
    const double x=m.compensated ? m.thickness/m.scale_x : m.border_thickness;
    const double y=m.compensated ? m.thickness/m.scale_y : m.border_thickness;
    return {r.x-x,r.y-y,r.width+x+x,r.height+y+y};
}
double padding(double requested) { return std::isfinite(requested) ? std::clamp(requested,0.0,128.0) : 0; }
double devicePadding(double requested,double scale) { return std::ceil(padding(requested)*scale); }
}
