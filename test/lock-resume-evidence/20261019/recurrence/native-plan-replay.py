import ctypes as c,json,re
from pathlib import Path
root=Path(__file__).resolve().parents[4]
lib=c.CDLL(str(root/'build/native-viewport-clip/bin/kwin/effects/plugins/cc-niri-viewport-clip.so'))
u32,u64,i64,d,ptr=c.c_uint32,c.c_uint64,c.c_int64,c.c_double,c.c_void_p
class U(c.Structure):_fields_=[('data',c.POINTER(c.c_uint16)),('len',u64)]
class B(c.Structure):_fields_=[('data',c.POINTER(c.c_uint8)),('len',u64)]
class R(c.Structure):_fields_=[(k,d) for k in ('x','y','width','height')]
class C(c.Structure):_fields_=[('protocol',d),('generation',d),('session',U),('workspace',U),('output',U)]
class E(c.Structure):_fields_=[('window_id',u64),('column_id',d),('logical_x',d),('pixel_width',d),('old_placement',u32),('new_placement',u32)]
class F(c.Structure):_fields_=[('window_id',u64),('rect',R)]
class P(c.Structure):_fields_=[(k,d) for k in ('protocol','epoch','issued_at','old_offset','new_offset')]+[(k,U) for k in ('kind','session','workspace','output')]+[('viewport',R),('entries',c.POINTER(E)),('entries_len',u64),('fingerprint',B)]+[(k,u32) for k in ('shape_valid','retarget_only','clip_partial')]
class PP(c.Structure):_fields_=[('plan',P),('layout',R),('max_offset',d),('scope_revision',d)]
class Bool(c.Structure):_fields_=[('value',u32),('status',u32)]
class ID(c.Structure):_fields_=[('value',u64),('status',u32),('reserved',u32)]
class Status(c.Structure):_fields_=[('epoch',i64),('active',u32),('completed',u32),('status',u32),('reserved',u32)]
def fn(name,args,result):
 f=getattr(lib,'cc_niri_scroll_'+name);f.argtypes=args;f.restype=result;return f
create=fn('create',[u32],ptr);destroy=fn('destroy',[ptr],None);intern=fn('intern',[ptr,U],ID);context=fn('update_context',[ptr,c.POINTER(C)],Bool);arm=fn('arm_partial',[ptr,c.POINTER(PP),i64,c.POINTER(F),u64,u32,R],Bool);cancel=fn('cancel',[ptr,U,i64],u32);status=fn('status',[ptr],Status)
buffers=[]
def text(s):
 b=s.encode('utf-16-le');a=(c.c_uint16*(len(b)//2)).from_buffer_copy(b);buffers.append(a);return U(a,len(a))
def rect(r):return R(*(r[k] for k in ('x','y','width','height')))
plans=[]
for line in (root/'test/lock-resume-evidence/20261019/recurrence/failure-window.log').read_text().splitlines():
 if '[SCROLL_PLAN_NATIVE] OBSERVE ' in line:
  p=json.loads(json.loads(line.split(' OBSERVE ',1)[1]));
  if p['type']=='PARTIAL_SCROLL':plans.append(p)
def run(perturb=None,retry_same=False):
 h=create(0);results=[];p=plans[0];ctx=C(2,1,text(p['sessionId']),text(p['workspaceId']),text(p['targetOutput']));assert context(h,c.byref(ctx)).value
 tokens={e['windowId']:intern(h,text(e['windowId'])).value for p in plans for e in p['entries']}
 try:
  for p in plans:
   if p['epoch']>42:assert cancel(h,text(p['sessionId']),p['epoch']-1)==0
   entries=(E*len(p['entries']))(*(E(tokens[e['windowId']],e['columnId'],e['logicalX'],e['pixelWidth'],1,1) for e in p['entries']))
   raw=json.dumps(p,sort_keys=True).encode();b=(c.c_uint8*len(raw)).from_buffer_copy(raw)
   pp=PP(P(p['protocol'],p['epoch'],p['issuedAt'],p['oldScrollOffsetX'],p['newScrollOffsetX'],text(p['type']),text(p['sessionId']),text(p['workspaceId']),text(p['targetOutput']),rect(p['viewport']),entries,len(entries),B(b,len(raw)),1,2,2),rect(p['layoutRect']),p['maxCamera'],p['scopeRevision'])
   frames=[]
   for n,e in enumerate(p['entries']):
    r=dict(x=max(0,min(e['logicalX']-p['oldScrollOffsetX'],2560-e['pixelWidth'])),y=60,width=e['pixelWidth'],height=1364)
    if perturb and n==1 and p['epoch']>42:r[perturb]+=1
    frames.append(F(tokens[e['windowId']],rect(r)))
   fs=(F*len(frames))(*frames);res=arm(h,c.byref(pp),p['epoch']*1000000000,fs,len(fs),1,rect(p['viewport']));s=status(h)
   row=dict(epoch=p['epoch'],accepted=bool(res.value),ffi_status=res.status,motion_epoch=s.epoch,active=bool(s.active))
   if retry_same and n==1:
    fs[1].rect.height=1364
    row['retry_same_epoch_after_correcting_frame']=bool(arm(h,c.byref(pp),p['epoch']*1000000000,fs,len(fs),1,rect(p['viewport'])).value)
   results.append(row)
 finally:destroy(h)
 return results
print(json.dumps(dict(scope='Recorded plans replayed through built production Rust C ABI; reconstructed safe frames, NOT historical actual frames or KWin predicate proof',stable_frames=run(),incoming_height_plus_1=run('height',True),incoming_x_plus_1=run('x')),indent=2))
