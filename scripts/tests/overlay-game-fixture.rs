//! Build as Aniimo.exe inside an isolated smoke-test directory. No game data or capture.
//! Creates an offscreen native window so the real whitelist and follow loop can be exercised.
#![windows_subsystem = "windows"]
use std::{ffi::c_void, time::Duration};
#[repr(C)] struct Point { x: i32, y: i32 }
#[repr(C)] struct Message { hwnd: *mut c_void, message: u32, wparam: usize, lparam: isize, time: u32, point: Point, private: u32 }
#[link(name="user32")]
extern "system" {
    fn CreateWindowExW(ex: u32, class: *const u16, title: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32,
        parent: *mut c_void, menu: *mut c_void, instance: *mut c_void, param: *mut c_void) -> *mut c_void;
    fn IsWindow(hwnd: *mut c_void) -> i32;
    fn PeekMessageW(msg: *mut Message, hwnd: *mut c_void, min: u32, max: u32, remove: u32) -> i32;
    fn TranslateMessage(msg: *const Message) -> i32;
    fn DispatchMessageW(msg: *const Message) -> isize;
}
fn main() {
    let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
    let title: Vec<u16> = "Aniimo overlay test fixture\0".encode_utf16().collect();
    unsafe {
        let hwnd = CreateWindowExW(0x08000000, class.as_ptr(), title.as_ptr(), 0x10cf0000,
            -6000, -6000, 1936, 1119, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
        assert!(!hwnd.is_null());
        std::fs::write("game-hwnd.txt", (hwnd as usize).to_string()).unwrap();
        while IsWindow(hwnd) != 0 {
            let mut msg: Message = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, 1) != 0 {
                TranslateMessage(&msg); DispatchMessageW(&msg);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
