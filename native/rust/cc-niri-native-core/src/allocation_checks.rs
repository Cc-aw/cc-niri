// SPDX-License-Identifier: GPL-2.0-or-later
//! Test-only per-thread accounting; other parallel tests do not affect a scope.
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
thread_local! {
    static ENABLED: Cell<bool> = const { Cell::new(false) };
    static COUNT: Cell<usize> = const { Cell::new(0) };
}
struct Allocator;
// SAFETY: Delegates allocation/deallocation and their layout contract to System.
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ENABLED.try_with(|enabled| {
            if enabled.get() {
                let _ = COUNT.try_with(|count| count.set(count.get() + 1));
            }
        });
        // SAFETY: Forward the allocation layout unchanged.
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        // SAFETY: Forward the live allocation and matching layout unchanged.
        unsafe {
            System.dealloc(pointer, layout);
        }
    }
}
#[global_allocator]
static ALLOCATOR: Allocator = Allocator;
pub(crate) fn count(f: impl FnOnce()) -> usize {
    COUNT.with(|count| count.set(0));
    ENABLED.with(|enabled| enabled.set(true));
    f();
    ENABLED.with(|enabled| enabled.set(false));
    COUNT.with(Cell::get)
}
