// Private harness composition of the actual production P2/P4 modules. The
// command pump below is a bounded fixture replacement for the private desktop's
// disabled global shortcut delivery; it never samples motion or presentation.
(function() {
const p4UseIme=__P4_IME__;
const out=Array.from(workspace.screens).find(o=>o.name==="Virtual-0");
if(!out || Array.from(workspace.screens).length!==2)throw new Error("requires private two-output KWin");
const allClients=workspace.windowList().filter(w=>/^CC_NIRI_P0_[ABCD]$/.test(w.caption));
const windows=workspace.windowList().filter(w=>/^CC_NIRI_P0_[AB]$/.test(w.caption)).sort((a,b)=>a.caption.localeCompare(b.caption));
if(windows.length!==2)throw new Error("requires bounded private clients");
const uuid=w=>String(w.internalId).replace(/[{}]/g,"").toLowerCase();
const state={enabled:true,workspaceSwitching:false,columns:[],focusedColumnIndex:-1,nextColumnId:1,scrollOffsetX:0,activeWorkspaceId:null,targetOutput:null,geometryGeneration:1};
const store=new ColumnStore(state,()=>{}, {scrollLayoutV2Enabled:true});
const transaction=new LayoutTransaction({audit:()=>{},debug:()=>{}});transaction.epoch=1;
const geom=createScrollLayoutGeometry({outputRect:{x:0,y:0,width:2560,height:1440},workingArea:{x:0,y:50,width:2560,height:1390},gap:16,physicalScale:out.scale});
const timers=new Set();
function timer(fn,ms){const t=new QTimer();t.singleShot=true;const h={t,slot:null};h.slot=()=>{timers.delete(h);t.timeout.disconnect(h.slot);fn();};timers.add(h);t.timeout.connect(h.slot);t.start(ms);return h;}
function clear(h){if(!h)return;timers.delete(h);h.t.stop();try{h.t.timeout.disconnect(h.slot);}catch(_e){}}
const record=v=>callDBus("org.cc.CCNiriP0Fixture","/P0","org.cc.CCNiriP0Fixture1","Record",JSON.stringify(v),()=>{});
const states=new WeakMap();
const stateFor=w=>{if(!states.has(w))states.set(w,{floating:false,layoutMode:null,internalChange:false,scrollLastRequestedGeometry:null,scrollOriginalOpacity:null,scrollParkingMinimized:false});return states.get(w);};
const parking=new ParkingManager({stateFor,getState:w=>states.get(w),debug:()=>{}});
const same=(a,b)=>a&&b&&["x","y","width","height"].every(k=>a[k]===b[k]);
const copy=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
const committer=new GeometryCommitter({stateFor,sameRect:same,rectCopy:copy,rectText:r=>JSON.stringify(copy(r)),isTileMode:()=>false,debug:()=>{}});
let driver,controller;
const bridge=new RuntimeBridge({invoke:(...args)=>callDBus(...args),service:"org.cc.CCNiriBridge",path:"/CCNiriBridge",interfaceName:"org.cc.CCNiriBridge1",handlers:{},sessionId:"p3-private",protocol:1,snapshotProtocol:2,now:()=>Date.now(),random:()=>0,debug:()=>{},warn:v=>record({kind:"p4-warning",text:v})});
bridge.generationValue=1;
bridge.handlers["focus-partial-column"]=command=>record({kind:"p4-partial-intent",epoch:command.epoch,windowUuid:command.windowUuid,valid:controller.validToken(command)});
const desktop=()=>workspace.currentDesktop.id;
const canJoin=(w,scope)=>workspace.windowList().includes(w)&&w.normalWindow&&!w.fullScreen&&w.output===scope.output&&Array.from(w.desktops).some(d=>d.id===scope.workspaceId);
controller=new ContinuousViewportController({state,columnStore:store,transaction,enabled:true,sessionId:bridge.sessionId(),
    getPrimaryOutput:()=>out,getCurrentWorkspaceId:desktop,getUuid:uuid,canJoin,getPainted:()=>driver.getPainted(),onTarget:p=>driver.submit(p)});
const width=new ColumnWidthController({scrollLayoutV2Enabled:true,getAppState:()=>state,getActiveWindow:()=>(store.focusedColumn()||{}).window,applyV2Width:(c,m,r)=>controller.setWidth(c,m,r)});
let phase="cycle",cycles=0,saved=null,completionProof=null;
const snapshot=()=>{const columns=state.columns.map(c=>({uuid:uuid(c.window),widthMode:c.widthMode}));return{workspaceId:state.activeWorkspaceId,targetOutput:out.name,columns,workspaces:[{id:state.activeWorkspaceId,columns}]};};
function checkpoint(label,p){record({kind:"p4-checkpoint",label,epoch:p.epoch,bootstrap:Boolean(completionProof&&completionProof.bootstrap),modes:state.columns.map(c=>c.widthMode),count:state.columns.length,
    shown:state.columns.filter(c=>!c.window.minimized&&c.window.opacity>0).length,focus:workspace.activeWindow?uuid(workspace.activeWindow):null,focusedUuid:p.focusedUuid,
    frames:state.columns.map(c=>({uuid:uuid(c.window),frame:copy(c.window.frameGeometry)}))});}
function probeAmbiguousInput(){
    callDBus("org.cc.CCNiriP0Fixture","/P0","org.cc.CCNiriP0Fixture1","Mark","p4-ambiguous",()=>{
        callDBus("org.kde.KWin","/ccNiriViewportMotion","org.cc.NiriViewportMotion1","GetColumnGeometrySource",raw=>{
            let source;try{source=JSON.parse(raw);}catch(_e){record({kind:"p4-ambiguous-input",overlap:false});return;}
            const rs=(source.entries||[]).map(e=>e.visualRect).filter(Boolean);
            if(source.valid!==true || rs.length!==2){record({kind:"p4-ambiguous-input",overlap:false,source});return;}
            const left=Math.max(0,rs[0].x,rs[1].x),right=Math.min(2560,rs[0].x+rs[0].width,rs[1].x+rs[1].width);
            if(right<=left){record({kind:"p4-ambiguous-input",overlap:false,source});return;}
            const point={x:(left+right)/2,y:300};
            const steps=[{kind:"move",x:point.x,y:point.y},{kind:"press"},{kind:"release"}];
            let accepted=true;
            const next=()=>{if(!steps.length){record({kind:"p4-ambiguous-input",overlap:true,accepted,epoch:source.epoch,source,point});return;}
                callDBus("org.kde.KWin","/ccNiriP0Input","org.cc.CCNiriP0Input1","Input",JSON.stringify(Object.assign({},steps.shift(),{epoch:0})),ok=>{accepted=accepted&&ok===true;next();});};next();
        });
    });
}
function complete(p,proof){
    completionProof=proof;
    if(phase==="cycle"){
        if(cycles<12){cycles++;width.cycle();return;}
        checkpoint("r12",p);phase="rapid";
        timer(()=>{for(let i=0;i<12;i++)width.cycle();controller.focusRelative(1);controller.moveFocused(-1);width.cycle();controller.focusRelative(1);controller.moveFocused(-1);controller.focusRelative(1);controller.focusRelative(-1);},100);return;
    }
    if(phase==="rapid"){
        checkpoint("rapid",p);phase="reverse-start";
        timer(()=>{controller.focusRelative(1);timer(()=>{phase="reverse";controller.focusRelative(-1);width.cycle();},60);},1500);return;
    }
    if(phase==="reverse-start")return;
    if(phase==="reverse"){
        checkpoint("reverse",p);phase="overlap-wait";
        timer(()=>{phase="overlap-start";controller.reorder([uuid(windows[1]),uuid(windows[0])]);timer(probeAmbiguousInput,80);},p4UseIme?3000:100);return;
    }
    if(phase==="overlap-wait")return;
    if(phase==="overlap-start"){phase="overlap-return";controller.reorder([uuid(windows[0]),uuid(windows[1])]);return;}
    if(phase==="overlap-return"){
        checkpoint("overlap",p);phase="close-start";
        timer(()=>{controller.setWidth(state.columns.find(c=>c.window===windows[0]),"full");timer(()=>{phase="closed";callDBus("org.cc.CCNiriP0Fixture","/P0","org.cc.CCNiriP0Fixture1","CloseClient","CC_NIRI_P0_A",()=>{});},30);},100);return;
    }
    if(phase==="close-start")return;
    if(phase==="closed"){
        checkpoint("closed",p);phase="insert-start";
        timer(()=>{
            const c=allClients.find(w=>w.caption==="CC_NIRI_P0_C"),d=allClients.find(w=>w.caption==="CC_NIRI_P0_D");
            // P0 initially minimized these unmanaged clients. Establish actual
            // ParkingManager ownership before asking P4 to unhide them.
            [c,d].forEach(w=>{w.opacity=0;w.minimized=false;parking.setVisibility(w,false);});
            controller.adopt(c,{widthMode:"full",focus:false,index:state.columns.length});controller.adopt(d,{widthMode:"half",focus:false,index:state.columns.length});
            controller.focusWindow(d);
            timer(()=>{phase="inserted";controller.focusWindow(windows[1]);},60);
        },100);return;
    }
    if(phase==="insert-start")return;
    if(phase==="inserted"){
        checkpoint("inserted",p);phase="remove-extras";
        callDBus("org.cc.CCNiriP0Fixture","/P0","org.cc.CCNiriP0Fixture1","CloseClient","CC_NIRI_P0_C",()=>{});
        callDBus("org.cc.CCNiriP0Fixture","/P0","org.cc.CCNiriP0Fixture1","CloseClient","CC_NIRI_P0_D",()=>{});return;
    }
    if(phase==="remove-extras"){
        if(state.columns.length!==1)return;
        checkpoint("removed",p);saved={entries:state.columns.map(c=>({window:c.window,widthMode:c.widthMode,previousNonFullWidthMode:c.previousNonFullWidthMode})),view:controller.captureView(),desktop:workspace.currentDesktop};
        phase="empty";driver.releaseForWorkspace();workspace.createDesktop(workspace.desktops.length,"P4 private");workspace.currentDesktop=workspace.desktops[workspace.desktops.length-1];
        timer(()=>controller.mount({workspaceId:desktop(),output:out,geometry:geom},[]),80);return;
    }
    if(phase==="empty"){
        phase="workspace-return";driver.releaseForWorkspace();workspace.currentDesktop=saved.desktop;
        timer(()=>controller.mount({workspaceId:desktop(),output:out,geometry:geom},saved.entries,saved.view),80);return;
    }
    if(phase==="workspace-return"){
        checkpoint("workspace-return",p);phase="recovered";
        const arm=bridge.armScrollPlan.bind(bridge);let lose=true;
        bridge.armScrollPlan=(e,cb)=>arm(e,ok=>{if(lose){lose=false;record({kind:"p4-injected-lost-arm-reply",epoch:e.epoch});cb(false);}else cb(ok);});
        timer(()=>controller.setWidth(state.columns[0],"half"),100);return;
    }
    if(phase==="recovered"){
        checkpoint("recovered",p);phase="stop";
        timer(()=>driver.stop(disarmed=>{
            pump.stop();record({kind:"p4-finished",disarmed,timers:timers.size,listener:Boolean(driver.listener),shown:state.columns.filter(c=>!c.window.minimized&&c.window.opacity>0).length});
        }),100);
    }
}
driver=new ColumnGeometryCoordinator({bridge,currentEpoch:()=>state.geometryGeneration,
    isScope:p=>state.enabled&&!state.workspaceSwitching&&p.workspaceId===desktop()&&p.targetOutput===out.name,
    columnFor:id=>state.columns.find(c=>uuid(c.window)===id),eligible:(w,p)=>state.columns.some(c=>c.window===w)&&canJoin(w,{workspaceId:p.workspaceId,output:out}),
    prepare:(p,done)=>bridge.commit(snapshot(),p.reason,done),committer,setVisibility:(w,v)=>parking.setVisibility(w,v),activate:w=>{workspace.activeWindow=w;},
    recover:(p,proof)=>record({kind:"p4-fault",epoch:p.epoch,proof}),reissue:()=>controller.reflow(),
    setTimer:timer,clearTimer:clear,now:()=>Date.now(),warn:v=>record({kind:"p4-warning",text:v}),onComplete:complete});
allClients.forEach(w=>w.closed.connect(()=>controller.remove(w)));
const pump=new QTimer();pump.interval=20;pump.timeout.connect(()=>bridge.takePendingCommand());pump.start();
controller.mount({workspaceId:desktop(),output:out,geometry:geom},windows.map(window=>({window,widthMode:"half"})));
})();
