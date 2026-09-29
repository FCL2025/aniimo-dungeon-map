//! Build as Aniimo.exe inside an isolated smoke-test directory. No game data or capture.
//! Creates an offscreen native window so the real whitelist and follow loop can be exercised.
#![windows_subsystem = "windows"]
use std::{ffi::c_void, time::Duration};
#[repr(C)] struct Point { x: i32, y: i32 }
#[repr(C)] struct Message { hwnd: *mut c_void, message: u32, wparam: usize, lparam: isize, time: u32, point: Point, private: u32 }
#[repr(C)] struct WindowClass {
    style: u32, procedure: unsafe extern "system" fn(*mut c_void, u32, usize, isize) -> isize,
    class_extra: i32, window_extra: i32, instance: *mut c_void, icon: *mut c_void,
    cursor: *mut c_void, background: *mut c_void, menu: *const u16, name: *const u16,
}
#[link(name="user32")]
extern "system" {
    fn RegisterClassW(class: *const WindowClass) -> u16;
    fn DefWindowProcW(hwnd: *mut c_void, message: u32, wparam: usize, lparam: isize) -> isize;
    fn DestroyWindow(hwnd: *mut c_void) -> i32;
    fn ShowWindow(hwnd: *mut c_void, command: i32) -> i32;
    fn CreateWindowExW(ex: u32, class: *const u16, title: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32,
        parent: *mut c_void, menu: *mut c_void, instance: *mut c_void, param: *mut c_void) -> *mut c_void;
    fn IsWindow(hwnd: *mut c_void) -> i32;
    fn PeekMessageW(msg: *mut Message, hwnd: *mut c_void, min: u32, max: u32, remove: u32) -> i32;
    fn TranslateMessage(msg: *const Message) -> i32;
    fn DispatchMessageW(msg: *const Message) -> isize;
}
#[link(name="kernel32")]
extern "system" { fn GetModuleHandleW(name: *const u16) -> *mut c_void; }

unsafe fn create_window(class_name: &str, title: &str, x: i32) -> *mut c_void {
    let class: Vec<u16> = class_name.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = title.encode_utf16().chain(Some(0)).collect();
    let instance = GetModuleHandleW(std::ptr::null());
    let spec = WindowClass { style: 0, procedure: DefWindowProcW, class_extra: 0, window_extra: 0, instance,
        icon: std::ptr::null_mut(), cursor: std::ptr::null_mut(), background: std::ptr::null_mut(),
        menu: std::ptr::null(), name: class.as_ptr() };
    RegisterClassW(&spec);
    let hwnd = CreateWindowExW(0x08000000, class.as_ptr(), title.as_ptr(), 0x10cf0000,
        x, -6000, 1936, 1119, std::ptr::null_mut(), std::ptr::null_mut(), instance, std::ptr::null_mut());
    assert!(!hwnd.is_null());
    // Hidden process startup can suppress the first window's WS_VISIBLE flag.
    // Keep the fixture capturable but offscreen, without activating it.
    ShowWindow(hwnd, 4);
    hwnd
}
fn main() {
    let with_decoy = std::env::args().any(|arg| arg == "--with-decoy");
    unsafe {
        let mut hwnd = create_window("UnityWndClass", "Aniimo overlay test fixture", -6000);
        std::fs::write("game-hwnd.txt", (hwnd as usize).to_string()).unwrap();
        // Same executable, same localized title, created last so
        // the decoy enumerates first. None of these are reliable game selectors.
        let decoy = if with_decoy {
            let h = create_window("Qt5159QWindow", "Aniimo overlay test fixture", -9000);
            std::fs::write("decoy-hwnd.txt", (h as usize).to_string()).unwrap(); h
        } else { std::ptr::null_mut() };
        while IsWindow(hwnd) != 0 || IsWindow(decoy) != 0 {
            if with_decoy && std::path::Path::new("close-game").exists() {
                DestroyWindow(hwnd); hwnd = std::ptr::null_mut();
                std::fs::remove_file("close-game").unwrap();
            }
            if with_decoy && std::path::Path::new("recreate-game").exists() {
                assert!(hwnd.is_null());
                hwnd = create_window("UnityWndClass", "Localized game title", -5000);
                std::fs::write("game-hwnd.txt", (hwnd as usize).to_string()).unwrap();
                std::fs::remove_file("recreate-game").unwrap();
            }
            let mut msg: Message = std::mem::zeroed();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, 1) != 0 {
                TranslateMessage(&msg); DispatchMessageW(&msg);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
