$ErrorActionPreference = 'Stop'
# Reuse the compiler discovery/environment of the native build.
. "$PSScriptRoot/build-native.ps1"
& "$compiler/bin/Hostx64/x64/cl.exe" /nologo /std:c++17 /EHsc /O2 /MT /DUNICODE /D_UNICODE "$projectRoot/native/capture-fixture.cpp" "/Fo$projectRoot/native/obj/capture-fixture.obj" "/Fe$projectRoot/native/bin/capture-fixture.exe" /link user32.lib gdi32.lib d3d11.lib dxgi.lib /SUBSYSTEM:CONSOLE
if ($LASTEXITCODE -ne 0) { throw 'Capture fixture build failed' }
