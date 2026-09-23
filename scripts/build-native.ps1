$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = 'C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Tools/MSVC/14.44.35207'
if (-not (Test-Path -LiteralPath "$compiler/bin/Hostx64/x64/cl.exe")) {
    $vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe'
    $vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    $compiler = (Get-ChildItem -LiteralPath "$vsRoot/VC/Tools/MSVC" -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
}
$sdkRoot = 'C:/Program Files (x86)/Windows Kits/10'
$sdkVersion = (Get-ChildItem -LiteralPath "$sdkRoot/Include" -Directory | Sort-Object Name -Descending | Select-Object -First 1).Name
$env:INCLUDE = "$compiler/include;$sdkRoot/Include/$sdkVersion/ucrt;$sdkRoot/Include/$sdkVersion/shared;$sdkRoot/Include/$sdkVersion/um;$sdkRoot/Include/$sdkVersion/winrt;$sdkRoot/Include/$sdkVersion/cppwinrt"
$env:LIB = "$compiler/lib/x64;$sdkRoot/Lib/$sdkVersion/ucrt/x64;$sdkRoot/Lib/$sdkVersion/um/x64"
New-Item -ItemType Directory -Force -Path "$projectRoot/native/bin","$projectRoot/native/obj" | Out-Null
& "$compiler/bin/Hostx64/x64/cl.exe" /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE "$projectRoot/native/audio.cpp" "/Fo$projectRoot/native/obj/audio.obj" "/Fe$projectRoot/native/bin/pibble-audio.exe" /link ole32.lib mmdevapi.lib user32.lib winmm.lib /SUBSYSTEM:CONSOLE
if ($LASTEXITCODE -ne 0) { throw 'Native audio build failed' }
& "$compiler/bin/Hostx64/x64/cl.exe" /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE "$projectRoot/native/gpu-video.cpp" "/Fo$projectRoot/native/obj/gpu-video.obj" "/Fe$projectRoot/native/bin/prestera-gpu-video.exe" /link windowsapp.lib d3d11.lib dxgi.lib d3dcompiler.lib dwmapi.lib user32.lib gdi32.lib /SUBSYSTEM:CONSOLE
if ($LASTEXITCODE -ne 0) { throw 'Native video build failed' }
