//! Offscreen, isolated Aniimo.exe fixture: paints only the cropped test HUD on a blank canvas.
#![windows_subsystem = "windows"]
use std::{ffi::c_void, time::Duration};
type Handle = *mut c_void;
#[repr(C)] struct Point { x:i32, y:i32 }
#[repr(C)] struct Size { w:i32, h:i32 }
#[repr(C)] struct Blend { operation:u8, flags:u8, alpha:u8, format:u8 }
#[repr(C)] struct Rect { left:i32, top:i32, right:i32, bottom:i32 }
#[repr(C)] struct Message { hwnd:Handle, message:u32, wparam:usize, lparam:isize, time:u32, point:Point, private:u32 }
#[repr(C)] struct Paint { dc:Handle, erase:i32, rect:Rect, restore:i32, update:i32, reserved:[u8;32] }
#[repr(C)] struct WindowClass { style:u32, procedure:unsafe extern "system" fn(Handle,u32,usize,isize)->isize,
    class_extra:i32,window_extra:i32,instance:Handle,icon:Handle,cursor:Handle,background:Handle,menu:*const u16,name:*const u16 }
#[link(name="user32")] extern "system" {
    fn SetProcessDPIAware()->i32;
    fn RegisterClassW(class:*const WindowClass)->u16;
    fn DefWindowProcW(hwnd:Handle,message:u32,wparam:usize,lparam:isize)->isize;
    fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:Handle,menu:Handle,instance:Handle,param:Handle)->Handle;
    fn ShowWindow(hwnd:Handle,command:i32)->i32;
    fn PeekMessageW(msg:*mut Message,hwnd:Handle,min:u32,max:u32,remove:u32)->i32;
    fn TranslateMessage(msg:*const Message)->i32;
    fn DispatchMessageW(msg:*const Message)->isize;
    fn InvalidateRect(hwnd:Handle,rect:*const Rect,erase:i32)->i32;
    fn BeginPaint(hwnd:Handle,paint:*mut Paint)->Handle;
    fn EndPaint(hwnd:Handle,paint:*const Paint)->i32;
    fn LoadImageW(instance:Handle,name:*const u16,kind:u32,w:i32,h:i32,flags:u32)->Handle;
    fn UpdateLayeredWindow(hwnd:Handle,dc:Handle,dest:*const Point,size:*const Size,source:Handle,origin:*const Point,key:u32,blend:*const Blend,flags:u32)->i32;
}
#[link(name="gdi32")] extern "system" {
    fn CreateCompatibleDC(dc:Handle)->Handle;
    fn SelectObject(dc:Handle,obj:Handle)->Handle;
    fn DeleteObject(obj:Handle)->i32;
    fn DeleteDC(dc:Handle)->i32;
    fn BitBlt(dc:Handle,x:i32,y:i32,w:i32,h:i32,source:Handle,sx:i32,sy:i32,op:u32)->i32;
    fn SetPixel(dc:Handle,x:i32,y:i32,color:u32)->u32;
}
#[link(name="kernel32")] extern "system" { fn GetModuleHandleW(name:*const u16)->Handle; }
static mut BITMAP: Handle = std::ptr::null_mut();
static mut TICK: u32 = 0;
unsafe extern "system" fn procedure(hwnd:Handle,message:u32,wparam:usize,lparam:isize)->isize {
    if message == 15 && !BITMAP.is_null() {
        let mut paint: Paint = std::mem::zeroed();let dc = BeginPaint(hwnd,&mut paint);
        let memory = CreateCompatibleDC(dc);let old=SelectObject(memory,BITMAP);
        BitBlt(dc,0,0,1920,1080,memory,0,0,0x00cc0020);
        // Keep the compositor producing fresh frames even when the text is unchanged.
        TICK=TICK.wrapping_add(711);for y in 5..10 { for x in 5..10 { SetPixel(dc,x,y,TICK); } }
        SelectObject(memory,old);DeleteDC(memory);EndPaint(hwnd,&paint);return 0;
    }
    DefWindowProcW(hwnd,message,wparam,lparam)
}
fn main() { unsafe {
    SetProcessDPIAware();
    let class:Vec<u16>="UnityWndClass".encode_utf16().chain(Some(0)).collect();
    let title:Vec<u16>="Aniimo evacuation test fixture".encode_utf16().chain(Some(0)).collect();
    let instance=GetModuleHandleW(std::ptr::null());
    let spec=WindowClass {style:0,procedure,class_extra:0,window_extra:0,instance,icon:std::ptr::null_mut(),
        cursor:std::ptr::null_mut(),background:std::ptr::null_mut(),menu:std::ptr::null(),name:class.as_ptr()};
    RegisterClassW(&spec);
    let hwnd=CreateWindowExW(0x08080000,class.as_ptr(),title.as_ptr(),0x90000000,-6000,-6000,1920,1080,
        std::ptr::null_mut(),std::ptr::null_mut(),instance,std::ptr::null_mut());
    assert!(!hwnd.is_null());ShowWindow(hwnd,4);
    std::fs::write("game-hwnd.txt",(hwnd as usize).to_string()).unwrap();
    let mut current=String::new();let mut count=0;
    loop {
        if let Ok(next)=std::fs::read_to_string("frame.txt") { if next!=current {
            let name:Vec<u16>=format!("{}.bmp",next.trim()).encode_utf16().chain(Some(0)).collect();
            let bitmap=LoadImageW(std::ptr::null_mut(),name.as_ptr(),0,0,0,0x10);
            if !bitmap.is_null() { if !BITMAP.is_null(){DeleteObject(BITMAP);} BITMAP=bitmap;current=next; }
        }}
        for (file,command) in [("minimize",6),("restore",4)] { if std::path::Path::new(file).exists() {
            ShowWindow(hwnd,command);let _=std::fs::remove_file(file);
        }}
        if count%20==0 && !BITMAP.is_null() {
            // Explicit surfaces remain capturable offscreen; GDI window DCs are clipped there.
            let memory=CreateCompatibleDC(std::ptr::null_mut());let old=SelectObject(memory,BITMAP);
            TICK=TICK.wrapping_add(711);for y in 5..10 {for x in 5..10 {SetPixel(memory,x,y,TICK);}}
            let dest=Point{x:-6000,y:-6000};let origin=Point{x:0,y:0};let size=Size{w:1920,h:1080};
            let blend=Blend{operation:0,flags:0,alpha:255,format:0};
            let result=UpdateLayeredWindow(hwnd,std::ptr::null_mut(),&dest,&size,memory,&origin,0,&blend,2);
            if result==0 { std::fs::write("fixture-error.txt",std::io::Error::last_os_error().to_string()).unwrap(); }
            SelectObject(memory,old);DeleteDC(memory);
        }count+=1;
        let mut msg:Message=std::mem::zeroed();
        while PeekMessageW(&mut msg,std::ptr::null_mut(),0,0,1)!=0 {TranslateMessage(&msg);DispatchMessageW(&msg);}
        std::thread::sleep(Duration::from_millis(10));
    }
}}
