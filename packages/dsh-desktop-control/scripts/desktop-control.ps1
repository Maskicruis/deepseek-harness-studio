[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('screenshot', 'list-windows', 'focus-window', 'move', 'click', 'scroll', 'type', 'hotkey')]
  [string]$Action,
  [string]$OutputPath = '',
  [int]$X = 0,
  [int]$Y = 0,
  [ValidateSet('left', 'right', 'middle')]
  [string]$Button = 'left',
  [int]$Clicks = 1,
  [int]$Delta = 0,
  [string]$WindowHandle = '',
  [string]$TextBase64 = '',
  [string]$Keys = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class StudioDesktopNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extraInfo);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);

    public static void SendUnicode(string text) {
        foreach (char ch in text) {
            INPUT[] inputs = new INPUT[2];
            inputs[0].type = 1;
            inputs[0].U.ki.wScan = ch;
            inputs[0].U.ki.dwFlags = 0x0004;
            inputs[1].type = 1;
            inputs[1].U.ki.wScan = ch;
            inputs[1].U.ki.dwFlags = 0x0004 | 0x0002;
            if (SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT))) != 2) {
                throw new InvalidOperationException("SendInput could not type the requested character.");
            }
        }
    }
}
'@

Add-Type -TypeDefinition $nativeSource
[StudioDesktopNative]::SetProcessDPIAware() | Out-Null

function Write-Result([object]$Value) {
  $Value | ConvertTo-Json -Compress -Depth 8
}

function Get-VirtualDesktopBounds {
  [pscustomobject]@{
    originX = [StudioDesktopNative]::GetSystemMetrics(76)
    originY = [StudioDesktopNative]::GetSystemMetrics(77)
    width = [StudioDesktopNative]::GetSystemMetrics(78)
    height = [StudioDesktopNative]::GetSystemMetrics(79)
  }
}

function Assert-DesktopPoint([int]$PointX, [int]$PointY) {
  $bounds = Get-VirtualDesktopBounds
  if ($PointX -lt $bounds.originX -or $PointX -ge ($bounds.originX + $bounds.width) -or
      $PointY -lt $bounds.originY -or $PointY -ge ($bounds.originY + $bounds.height)) {
    throw "Desktop point ($PointX, $PointY) is outside the virtual desktop bounds."
  }
}

switch ($Action) {
  'screenshot' {
    if ([string]::IsNullOrWhiteSpace($OutputPath)) { throw 'OutputPath is required for screenshot.' }
    $bounds = Get-VirtualDesktopBounds
    if ($bounds.width -le 0 -or $bounds.height -le 0) { throw 'Windows reported an invalid virtual desktop size.' }
    $bitmap = [System.Drawing.Bitmap]::new($bounds.width, $bounds.height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.originX, $bounds.originY, 0, 0, $bitmap.Size, [System.Drawing.CopyPixelOperation]::SourceCopy)
      $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
    $cursor = [StudioDesktopNative+POINT]::new()
    [StudioDesktopNative]::GetCursorPos([ref]$cursor) | Out-Null
    Write-Result ([pscustomobject]@{
      originX = $bounds.originX; originY = $bounds.originY
      width = $bounds.width; height = $bounds.height
      cursorX = $cursor.X; cursorY = $cursor.Y
    })
  }
  'list-windows' {
    $script:windows = [System.Collections.Generic.List[object]]::new()
    $callback = [StudioDesktopNative+EnumWindowsProc]{
      param([IntPtr]$hWnd, [IntPtr]$lParam)
      if (-not [StudioDesktopNative]::IsWindowVisible($hWnd)) { return $true }
      $length = [StudioDesktopNative]::GetWindowTextLength($hWnd)
      if ($length -le 0) { return $true }
      $builder = [System.Text.StringBuilder]::new($length + 1)
      [StudioDesktopNative]::GetWindowText($hWnd, $builder, $builder.Capacity) | Out-Null
      $title = $builder.ToString().Trim()
      if (-not $title) { return $true }
      $rect = [StudioDesktopNative+RECT]::new()
      if (-not [StudioDesktopNative]::GetWindowRect($hWnd, [ref]$rect)) { return $true }
      [uint32]$processId = 0
      [StudioDesktopNative]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null
      $processName = ''
      try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}
      $script:windows.Add([pscustomobject]@{
        handle = $hWnd.ToInt64().ToString()
        title = $title
        process = $processName
        x = $rect.Left
        y = $rect.Top
        width = [Math]::Max(0, $rect.Right - $rect.Left)
        height = [Math]::Max(0, $rect.Bottom - $rect.Top)
      })
      return $script:windows.Count -lt 100
    }
    [StudioDesktopNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    Write-Result ([pscustomobject]@{ windows = @($script:windows) })
  }
  'focus-window' {
    [long]$handleValue = 0
    if (-not [long]::TryParse($WindowHandle, [ref]$handleValue)) { throw 'WindowHandle must be a decimal integer.' }
    $handle = [IntPtr]::new($handleValue)
    if (-not [StudioDesktopNative]::IsWindow($handle)) { throw 'The requested window no longer exists.' }
    [StudioDesktopNative]::ShowWindowAsync($handle, 9) | Out-Null
    if (-not [StudioDesktopNative]::SetForegroundWindow($handle)) { throw 'Windows did not allow the requested window to take focus.' }
    Write-Result ([pscustomobject]@{ ok = $true })
  }
  'move' {
    Assert-DesktopPoint $X $Y
    if (-not [StudioDesktopNative]::SetCursorPos($X, $Y)) { throw 'Windows could not move the mouse pointer.' }
    Write-Result ([pscustomobject]@{ ok = $true })
  }
  'click' {
    Assert-DesktopPoint $X $Y
    if ($Clicks -lt 1 -or $Clicks -gt 2) { throw 'Clicks must be 1 or 2.' }
    if (-not [StudioDesktopNative]::SetCursorPos($X, $Y)) { throw 'Windows could not move the mouse pointer.' }
    $flags = switch ($Button) {
      'left' { @(0x0002, 0x0004) }
      'right' { @(0x0008, 0x0010) }
      'middle' { @(0x0020, 0x0040) }
    }
    for ($index = 0; $index -lt $Clicks; $index++) {
      [StudioDesktopNative]::mouse_event($flags[0], 0, 0, 0, [UIntPtr]::Zero)
      [StudioDesktopNative]::mouse_event($flags[1], 0, 0, 0, [UIntPtr]::Zero)
      if ($index + 1 -lt $Clicks) { Start-Sleep -Milliseconds 90 }
    }
    Write-Result ([pscustomobject]@{ ok = $true })
  }
  'scroll' {
    Assert-DesktopPoint $X $Y
    if ($Delta -eq 0 -or [Math]::Abs($Delta) -gt 2400) { throw 'Delta must be between -2400 and 2400 and cannot be zero.' }
    if (-not [StudioDesktopNative]::SetCursorPos($X, $Y)) { throw 'Windows could not move the mouse pointer.' }
    [StudioDesktopNative]::mouse_event(0x0800, 0, 0, $Delta, [UIntPtr]::Zero)
    Write-Result ([pscustomobject]@{ ok = $true })
  }
  'type' {
    if (-not $TextBase64) { throw 'TextBase64 is required.' }
    $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextBase64))
    if ($text.Length -lt 1 -or $text.Length -gt 2000) { throw 'Text must contain 1-2000 characters.' }
    [StudioDesktopNative]::SendUnicode($text)
    Write-Result ([pscustomobject]@{ ok = $true; characters = $text.Length })
  }
  'hotkey' {
    $normalized = $Keys.Trim().ToUpperInvariant()
    if ($normalized -notmatch '^(?:(?:CTRL|ALT|SHIFT|WIN)\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|ENTER|TAB|ESC|SPACE|BACKSPACE|DELETE|HOME|END|PAGEUP|PAGEDOWN|LEFT|RIGHT|UP|DOWN)$') {
      throw 'Unsupported hotkey.'
    }
    $map = @{
      CTRL=0x11; ALT=0x12; SHIFT=0x10; WIN=0x5B
      ENTER=0x0D; TAB=0x09; ESC=0x1B; SPACE=0x20; BACKSPACE=0x08; DELETE=0x2E
      HOME=0x24; END=0x23; PAGEUP=0x21; PAGEDOWN=0x22; LEFT=0x25; UP=0x26; RIGHT=0x27; DOWN=0x28
    }
    for ($number = 1; $number -le 12; $number++) { $map["F$number"] = 0x6F + $number }
    [byte[]]$virtualKeys = @(
      foreach ($token in $normalized.Split('+')) {
        if ($map.ContainsKey($token)) { [byte]$map[$token] }
        elseif ($token.Length -eq 1) { [byte][char]$token }
        else { throw "Unsupported hotkey token: $token" }
      }
    )
    foreach ($virtualKey in $virtualKeys) { [StudioDesktopNative]::keybd_event($virtualKey, 0, 0, [UIntPtr]::Zero) }
    [array]::Reverse($virtualKeys)
    foreach ($virtualKey in $virtualKeys) { [StudioDesktopNative]::keybd_event($virtualKey, 0, 0x0002, [UIntPtr]::Zero) }
    Write-Result ([pscustomobject]@{ ok = $true })
  }
}
