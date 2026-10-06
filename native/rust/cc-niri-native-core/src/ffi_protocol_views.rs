// SPDX-License-Identifier: GPL-2.0-or-later
use super::OK;
use crate::native_protocol::{Rect, Text};
const INVALID_DTO: u32 = 2;
#[repr(C)]
#[derive(Clone, Copy)]
pub struct U16View {
    pub(super) data: *const u16,
    pub(super) len: u64,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ByteView {
    pub(super) data: *const u8,
    pub(super) len: u64,
}
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FfiRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl From<FfiRect> for Rect {
    fn from(r: FfiRect) -> Self {
        Self {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
        }
    }
}
impl From<Rect> for FfiRect {
    fn from(r: Rect) -> Self {
        Self {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
        }
    }
}
pub(super) unsafe fn slice<'a, T>(data: *const T, len: u64) -> Result<&'a [T], u32> {
    let len = usize::try_from(len).map_err(|_| INVALID_DTO)?;
    if len == 0 {
        return Ok(&[]);
    }
    if data.is_null() || len > (isize::MAX as usize) / std::mem::size_of::<T>() {
        return Err(INVALID_DTO);
    }
    // SAFETY: Caller promises alignment, initialized elements and a live buffer.
    Ok(unsafe { std::slice::from_raw_parts(data, len) })
}
pub(super) unsafe fn text(value: U16View) -> Result<Text, u32> {
    Ok(Text(unsafe { slice(value.data, value.len)? }.to_vec()))
}

#[repr(C)]
pub struct FfiIdResult {
    pub(super) value: u64,
    pub(super) status: u32,
    pub(super) reserved: u32,
}
#[repr(C)]
pub struct FfiTextResult {
    pub(super) value: U16View,
    pub(super) status: u32,
    pub(super) reserved: u32,
}
pub(super) fn id_result(result: Result<u64, u32>) -> FfiIdResult {
    match result {
        Ok(value) => FfiIdResult {
            value,
            status: OK,
            reserved: 0,
        },
        Err(status) => FfiIdResult {
            value: 0,
            status,
            reserved: 0,
        },
    }
}
pub(super) fn text_result(result: Result<Option<&Text>, u32>) -> FfiTextResult {
    let empty = U16View {
        data: std::ptr::null(),
        len: 0,
    };
    match result {
        Ok(value) => FfiTextResult {
            value: value.map_or(empty, |text| U16View {
                data: text.0.as_ptr(),
                len: text.0.len() as u64,
            }),
            status: OK,
            reserved: 0,
        },
        Err(status) => FfiTextResult {
            value: empty,
            status,
            reserved: 0,
        },
    }
}
