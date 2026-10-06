#ifndef CC_NIRI_NATIVE_CORE_H
#define CC_NIRI_NATIVE_CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Borrowed immutable NUL-terminated UTF-8; valid until library unload.
 * Never free or modify this pointer. This entry point cannot fail or panic. */
const char *cc_niri_rust_core_version(void);

enum { CC_NIRI_FFI_OK = 0, CC_NIRI_FFI_INVALID_HANDLE = 1, CC_NIRI_FFI_INVALID_DTO = 2 };
typedef struct CcNiriSpring CcNiriSpring;
typedef struct { double damping_ratio, stiffness, epsilon, mass; } CcNiriSpringParams;
typedef struct { double position, velocity; } CcNiriSpringSample;
typedef struct { CcNiriSpringSample value; uint32_t status, reserved; } CcNiriSpringSampleResult;
typedef struct { uint32_t value, status; } CcNiriSpringBoolResult;

/* create/clone each return one owned reference, released with destroy.
 * State is immutable; clone retains the same allocation without allocating.
 * Sampling performs no allocation. Invalid math inputs create an invalid but
 * safely sampleable Spring, distinct from an INVALID_HANDLE status.
 * Non-null pointers must be live handles from this library: arbitrary pointers,
 * use-after-destroy and double-destroy violate the ABI contract.
 * Null clone/destroy are no-ops; null queries return INVALID_HANDLE.
 * No entry may unwind into C++; allocation failure follows panic=abort. */
const CcNiriSpring *cc_niri_spring_create(double from, double target, double velocity, CcNiriSpringParams params);
const CcNiriSpring *cc_niri_spring_clone(const CcNiriSpring *handle);
void cc_niri_spring_destroy(const CcNiriSpring *handle);
CcNiriSpringBoolResult cc_niri_spring_is_valid(const CcNiriSpring *handle);
CcNiriSpringSampleResult cc_niri_spring_sample(const CcNiriSpring *handle, int64_t elapsed_ns);
CcNiriSpringBoolResult cc_niri_spring_is_settled(const CcNiriSpring *handle, CcNiriSpringSample sample);

/* Motion owns mutable Rust state. create/clone allocate independent handles;
 * destroy releases each once. copy replaces state without allocation, supports
 * self-copy. Other calls allocate nothing. Mutations require exclusive access;
 * sample/clone require shared access with no concurrent mutation. Null calls
 * return INVALID_HANDLE (clone returns null, destroy is a no-op). Invalid math,
 * stale epochs and rejected sequences return value=0, status=OK without mutation.
 * Non-null handle validity and panic rules are the same as for Spring above. */
typedef struct CcNiriMotion CcNiriMotion;
enum { CC_NIRI_MOTION_STATIC = 0, CC_NIRI_MOTION_ANIMATION = 1 };
typedef struct {
    double current, target, velocity;
    int64_t epoch;
    uint32_t kind, status;
} CcNiriMotionSample;
CcNiriMotion *cc_niri_motion_create(CcNiriSpringParams params);
CcNiriMotion *cc_niri_motion_clone(const CcNiriMotion *handle);
void cc_niri_motion_destroy(CcNiriMotion *handle);
uint32_t cc_niri_motion_copy(CcNiriMotion *destination, const CcNiriMotion *source);
CcNiriSpringBoolResult cc_niri_motion_start(CcNiriMotion *handle, double from, double target, int64_t epoch, int64_t now_ns);
CcNiriSpringBoolResult cc_niri_motion_retarget(CcNiriMotion *handle, double target, int64_t epoch, int64_t now_ns);
CcNiriSpringBoolResult cc_niri_motion_finish(CcNiriMotion *handle, int64_t epoch, int64_t now_ns);
CcNiriSpringBoolResult cc_niri_motion_snap(CcNiriMotion *handle, double offset);
CcNiriMotionSample cc_niri_motion_sample(const CcNiriMotion *handle, int64_t now_ns);

/* Independent finite workspace camera. Qt/KWin owns desktop authority, objects,
 * visibility refs and the presentation clock. Unique create/destroy ownership;
 * mutations require exclusive access, projection shared access. Null calls
 * return INVALID_HANDLE; rejected inputs return false/OK without mutation.
 * All calls except create allocate nothing. Epoch, panic rules match Motion.
 * Retarget starts from the last advanced/painted position, not wall-clock time. */
typedef struct CcNiriWorkspace CcNiriWorkspace;
typedef struct { double x,y; } CcNiriPoint;
typedef struct { CcNiriPoint point; uint32_t active,status; } CcNiriWorkspaceSample;
typedef struct { CcNiriPoint translation; uint32_t visible,status; } CcNiriWorkspaceProjection;
CcNiriWorkspace *cc_niri_workspace_create(void);
void cc_niri_workspace_destroy(CcNiriWorkspace *handle);
CcNiriSpringBoolResult cc_niri_workspace_configure(CcNiriWorkspace *handle,uint32_t grid_width,uint32_t grid_height,uint32_t wrap);
CcNiriSpringBoolResult cc_niri_workspace_start(CcNiriWorkspace *handle,CcNiriPoint from,CcNiriPoint target,int64_t epoch,int64_t now_ns,int64_t duration_ns);
CcNiriSpringBoolResult cc_niri_workspace_gesture(CcNiriWorkspace *handle,CcNiriPoint point,int64_t epoch,int64_t now_ns);
CcNiriWorkspaceSample cc_niri_workspace_advance(CcNiriWorkspace *handle,int64_t now_ns);
CcNiriWorkspaceProjection cc_niri_workspace_projection(const CcNiriWorkspace *handle,CcNiriPoint desktop,double width,double height,double gap_x,double gap_y);

/* Scroll state is uniquely owned, with independent deep clones/copies.
 * All DTO buffers are borrowed for the call, valid/aligned for their lengths;
 * UTF-16 preserves Qt string units without sharing any Qt object. Nonempty null
 * buffers return INVALID_DTO; arbitrary non-null/freed pointers are caller UB.
 * Mutations require exclusive access; queries shared access. Returned text views
 * are borrowed until the next mutation/destroy, and must not overlap mutations.
 * create/clone/copy/intern/context/arm may allocate; frame operations
 * advance/projection/status/role/frames/remove/clear do not allocate.
 * Semantic rejection returns false/OK; panic and handle rules match Motion.
 * Window tokens are stable per handle; only interned tokens may be used in plans.
 * fuzzy_zero transports the platform's rectangle equality capability. */
typedef struct CcNiriScroll CcNiriScroll;
typedef struct { const uint16_t *data; uint64_t len; } CcNiriU16View;
typedef struct { const uint8_t *data; uint64_t len; } CcNiriByteView;
typedef struct { double x,y,width,height; } CcNiriRect;
typedef struct { double protocol,generation; CcNiriU16View session,workspace,output; } CcNiriScrollContext;
typedef struct {
    uint64_t window_id; double column_id,logical_x,pixel_width;
    uint32_t old_placement,new_placement; /* 0 invalid, 1 visible, 2 parked */
} CcNiriScrollEntry;
typedef struct { uint64_t window_id; CcNiriRect rect; } CcNiriWindowFrame;
typedef struct {
    double protocol,epoch,issued_at,old_offset,new_offset;
    CcNiriU16View kind,session,workspace,output; CcNiriRect viewport;
    const CcNiriScrollEntry *entries; uint64_t entries_len;
    CcNiriByteView fingerprint; uint32_t shape_valid,retarget_only;
    /* retarget_only: 0 absent, 1 false, 2 true, 3 wrong JSON type */
} CcNiriScrollPlan;
typedef struct { int64_t epoch; uint32_t active,completed,status,reserved; } CcNiriScrollStatus;
typedef struct { uint64_t value; uint32_t status,reserved; } CcNiriIdResult;
typedef struct { CcNiriRect viewport; double translation_x; uint32_t active,status; } CcNiriProjectionResult;
typedef struct { CcNiriU16View value; uint32_t status,reserved; } CcNiriTextResult;
CcNiriScroll *cc_niri_scroll_create(uint32_t fuzzy_zero);
CcNiriScroll *cc_niri_scroll_clone(const CcNiriScroll *handle);
void cc_niri_scroll_destroy(CcNiriScroll *handle);
uint32_t cc_niri_scroll_copy(CcNiriScroll *destination,const CcNiriScroll *source);
CcNiriIdResult cc_niri_scroll_intern(CcNiriScroll *handle,CcNiriU16View name);
CcNiriSpringBoolResult cc_niri_scroll_update_context(CcNiriScroll *handle,const CcNiriScrollContext *context);
CcNiriSpringBoolResult cc_niri_scroll_arm(CcNiriScroll *handle,const CcNiriScrollPlan *plan,int64_t now_ns,const CcNiriWindowFrame *frames,uint64_t frames_len);
uint32_t cc_niri_scroll_cancel(CcNiriScroll *handle,CcNiriU16View session,int64_t epoch);
uint32_t cc_niri_scroll_clear(CcNiriScroll *handle);
uint32_t cc_niri_scroll_remove(CcNiriScroll *handle,uint64_t id);
CcNiriSpringBoolResult cc_niri_scroll_advance(CcNiriScroll *handle,int64_t now_ns);
CcNiriScrollStatus cc_niri_scroll_status(const CcNiriScroll *handle);
CcNiriTextResult cc_niri_scroll_context_text(const CcNiriScroll *handle,uint32_t field); /* session/workspace/output=0/1/2 */
CcNiriProjectionResult cc_niri_scroll_projection(const CcNiriScroll *handle,uint64_t id,CcNiriRect geometry);
CcNiriSpringBoolResult cc_niri_scroll_role(const CcNiriScroll *handle,uint64_t id); /* absent/continuing/incoming/outgoing=0/1/2/3 */
CcNiriIdResult cc_niri_scroll_frames(const CcNiriScroll *handle,uint32_t kind,CcNiriWindowFrame *out,uint64_t capacity); /* targets/source=0/1; zero capacity queries count */

/* Ring geometry uses fixed-size borrowed DTOs, no handles, allocation or
 * platform pointers. Frame values are frozen for one paint call; the adapter
 * guards owner/attachment lifetime. Matrices are row-major values composed by
 * the platform renderer. Status: 0 OK, 1 null input; valid=0 semantic rejection.
 * Layout rejects nonfinite/negative extents before texture integer conversion.
 * No returned buffers need freeing. All calls are synchronous/thread-local. */
/* R6 shared protocol policy. Existing wire schemas/entry points are unchanged.
 * New results separate ABI status from semantic NativeError (0 means no error).
 * Sequence and eligibility handles are unique owned state. All input buffers are
 * borrowed for the call; returned text is borrowed until mutation/destroy.
 * No concurrent access. Null/invalid DTO rules and panic=abort match Scroll.
 * Eligibility permits/status/text queries allocate nothing. The adapter alone
 * decodes JSON/QUuid; Rust owns validation, generations and retired sessions. */
enum { CC_NIRI_NATIVE_INVALID_PROTOCOL = 1, CC_NIRI_NATIVE_INVALID_EPOCH = 2,
       CC_NIRI_NATIVE_INVALID_GEOMETRY = 3, CC_NIRI_NATIVE_CONTEXT_MISMATCH = 4,
       CC_NIRI_NATIVE_UNKNOWN_WINDOW = 5, CC_NIRI_NATIVE_SEQUENCE_REJECTED = 6,
       CC_NIRI_NATIVE_INTERNAL_INVARIANT = 7 };
typedef struct { uint32_t value,status,error,reserved; } CcNiriProtocolResult;
typedef struct CcNiriScrollSequence CcNiriScrollSequence;
CcNiriScrollSequence *cc_niri_scroll_sequence_create(void);
void cc_niri_scroll_sequence_destroy(CcNiriScrollSequence *handle);
CcNiriIdResult cc_niri_scroll_sequence_intern(CcNiriScrollSequence *handle,CcNiriU16View name);
CcNiriProtocolResult cc_niri_scroll_sequence_update(CcNiriScrollSequence *handle,const CcNiriScrollContext *context);
/* observe=0 validates without consuming an epoch; observe=1 returns disposition
 * rejected/duplicate/accepted = 0/1/2 and consumes an accepted epoch. */
CcNiriProtocolResult cc_niri_scroll_sequence_plan(CcNiriScrollSequence *handle,const CcNiriScrollPlan *plan,uint32_t observe);
CcNiriSpringBoolResult cc_niri_scroll_sequence_authority(const CcNiriScrollSequence *handle);
typedef struct CcNiriEligibility CcNiriEligibility;
typedef struct {
    double protocol,generation; CcNiriU16View kind,session,workspace,output;
    const CcNiriU16View *windows; uint64_t windows_len,message_bytes;
    uint32_t shape_valid,enabled;
} CcNiriEligibilitySnapshot;
typedef struct { CcNiriU16View window,workspace,output; double opacity; uint32_t flags,reserved; } CcNiriEligibilityCandidate;
/* flags bits 0..6: active,managed,normal,visible,current activity,current desktop,
 * inside output; bits 7..9: minimized,deleted,fullscreen. */
typedef struct { int64_t generation; uint64_t windows,retired_sessions; uint32_t enabled,status; } CcNiriEligibilityStatus;
CcNiriEligibility *cc_niri_eligibility_create(void);
CcNiriEligibility *cc_niri_eligibility_clone(const CcNiriEligibility *handle);
void cc_niri_eligibility_destroy(CcNiriEligibility *handle);
CcNiriProtocolResult cc_niri_eligibility_update(CcNiriEligibility *handle,const CcNiriEligibilitySnapshot *snapshot);
CcNiriSpringBoolResult cc_niri_eligibility_permits(const CcNiriEligibility *handle,const CcNiriEligibilityCandidate *candidate);
uint32_t cc_niri_eligibility_clear(CcNiriEligibility *handle);
CcNiriEligibilityStatus cc_niri_eligibility_status(const CcNiriEligibility *handle);
/* field 0/1/2 context, 3 window, 4 retired session; index used only for 3/4. */
CcNiriTextResult cc_niri_eligibility_text(const CcNiriEligibility *handle,uint32_t field,uint64_t index);

typedef struct { double configured,rounded; } CcNiriRingCorners;
typedef struct { double values[4]; uint32_t source,status; } CcNiriRingRadius;
typedef struct {
    CcNiriRect inner;
    double thickness,radii[4],item_opacity,effect_opacity;
} CcNiriRingFrame;
typedef struct { CcNiriRingFrame frame; uint32_t valid,status; } CcNiriRingFrameResult;
typedef struct { CcNiriRingFrame frame; double device_scale,matrix[16]; } CcNiriRingInput;
typedef struct {
    double scale_x,scale_y,device_scale,thickness,width,height,radii[8],border_thickness;
    uint32_t compensated,reserved;
} CcNiriRingMetrics;
typedef struct { CcNiriRingMetrics value; uint32_t valid,status; } CcNiriRingMetricsResult;
typedef struct {
    CcNiriRect rect,geometry;
    double translate_x,translate_y,scale_x,scale_y;
    uint32_t texture_width,texture_height,visible,reserved;
} CcNiriRingPatch;
typedef struct { CcNiriRingPatch patches[8]; uint32_t valid,status; } CcNiriRingLayout;
CcNiriRingCorners cc_niri_ring_corners(double configured,double rounded,uint32_t loaded);
CcNiriRingRadius cc_niri_ring_radius(CcNiriRingCorners corners,const double native_radii[4],double width,double height);
uint32_t cc_niri_ring_geometry_valid(double width,double height,const double radii[4]);
CcNiriRingFrameResult cc_niri_ring_capture(const CcNiriRingFrame *frame);
CcNiriRingMetricsResult cc_niri_ring_metrics(const CcNiriRingInput *input);
CcNiriRingLayout cc_niri_ring_layout(const CcNiriRingMetrics *metrics);
CcNiriRect cc_niri_ring_damage(CcNiriRect inner,CcNiriRingMetrics metrics);
double cc_niri_ring_padding(double requested);
double cc_niri_ring_device_padding(double requested,double device_scale);

#ifdef __cplusplus
}
#endif

#endif
