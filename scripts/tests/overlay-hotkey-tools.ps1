# Dot-source with an isolated test directory containing process-id.txt and game-process-id.txt.
param([Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference = 'Stop'
$TestRoot = [IO.Path]::GetFullPath($TestRoot)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class HotkeyTestWindows {
 public delegate bool Callback(IntPtr hwnd,IntPtr param);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h,StringBuilder text,int size);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int command);
 [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h,uint message,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h,int id,uint modifiers,uint key);
 [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h,int id);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 public static IntPtr Find(uint pid,string prefix) {IntPtr result=IntPtr.Zero; EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid){var text=new StringBuilder(512);GetWindowTextW(h,text,512);if(text.ToString().StartsWith(prefix))result=h;}return true;},IntPtr.Zero);return result;}
}
'@
function Get-HotkeyTestWindow([string]$Kind) {
    $file = if ($Kind -eq 'game') { 'game-process-id.txt' } else { 'process-id.txt' }
    $processId = [int](Get-Content -LiteralPath (Join-Path $TestRoot $file))
    $process = Get-Process -Id $processId
    if (!$process.Path.StartsWith($TestRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Not an isolated test process' }
    $title = switch ($Kind) { 'game' {'Aniimo overlay test fixture'} 'overlay' {'伊莫地圖 · 覆蓋視窗'} 'main' {'伊莫地城地圖'} default {throw 'Unknown window'} }
    $handle = [HotkeyTestWindows]::Find($processId,$title)
    if ($handle -eq [IntPtr]::Zero) { throw "Missing test window: $Kind" }
    return $handle
}
function Get-HotkeyTestState([string]$Kind = 'overlay') {
    $handle = Get-HotkeyTestWindow $Kind
    $rect = New-Object HotkeyTestWindows+Rect
    [void][HotkeyTestWindows]::GetWindowRect($handle,[ref]$rect)
    return [pscustomobject]@{handle=$handle.ToInt64();visible=[HotkeyTestWindows]::IsWindowVisible($handle);x=$rect.Left;y=$rect.Top;width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top;foreground=[HotkeyTestWindows]::GetForegroundWindow().ToInt64()}
}
function Test-F1Available {
    $registered = [HotkeyTestWindows]::RegisterHotKey([IntPtr]::Zero,0x424e,0x4000,0x70)
    if ($registered) { [void][HotkeyTestWindows]::UnregisterHotKey([IntPtr]::Zero,0x424e) }
    return $registered
}
function Send-TestF1([int]$Repeats = 1) {
    # Only send while the test overlay owns F1; never send unhandled keys into the game.
    [void](Get-HotkeyTestWindow 'overlay')
    if (Test-F1Available) { throw 'F1 is not registered; refusing to send an unhandled key' }
    try {
        for ($i=0; $i -lt $Repeats; $i++) {
            [HotkeyTestWindows]::keybd_event(0x70,0,0,[UIntPtr]::Zero)
            Start-Sleep -Milliseconds 60
        }
    } finally { [HotkeyTestWindows]::keybd_event(0x70,0,2,[UIntPtr]::Zero) }
    Start-Sleep -Milliseconds 200
}
