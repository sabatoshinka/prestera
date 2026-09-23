param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$Icon)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$target = [IO.Path]::GetFullPath($Executable)
if (-not $target.StartsWith((Join-Path $workspace 'release') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Icon target must be a packaged EXE inside release.' }
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PibbleIconResource {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool delete);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr h, bool discard);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string file, IntPtr h, uint flags);
  [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr h);
  delegate bool EnumName(IntPtr h, IntPtr type, IntPtr name, IntPtr param);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr h, IntPtr type, EnumName callback, IntPtr param);
  public static void Write(string file, string icon) {
    byte[] ico = File.ReadAllBytes(icon);
    int count = BitConverter.ToUInt16(ico, 4);
    if (ico.Length < 6 + 16 * count || count < 1) throw new Exception("Invalid ICO");
    var groups = new List<int>();
    IntPtr library = LoadLibraryEx(file, IntPtr.Zero, 2);
    if (library == IntPtr.Zero) throw new Exception("Cannot inspect EXE");
    try { EnumResourceNames(library, (IntPtr)14, (h,t,n,p) => { if (n.ToInt64() <= 65535) groups.Add(n.ToInt32()); return true; }, IntPtr.Zero); }
    finally { FreeLibrary(library); }
    IntPtr update = BeginUpdateResource(file, false);
    if (update == IntPtr.Zero) throw new Exception("Cannot update EXE icon");
    bool done = false;
    try {
      byte[] group = new byte[6 + count * 14]; Array.Copy(ico, 0, group, 0, 6);
      for (int i=0; i<count; i++) {
        int entry=6+i*16, size=BitConverter.ToInt32(ico,entry+8), offset=BitConverter.ToInt32(ico,entry+12);
        if (size<1 || offset<0 || offset>ico.Length-size) throw new Exception("Invalid icon image");
        byte[] image=new byte[size]; Array.Copy(ico,offset,image,0,size);
        ushort id=(ushort)(1001+i);
        if (!UpdateResource(update,(IntPtr)3,(IntPtr)id,1033,image,(uint)size)) throw new Exception("Cannot write icon image");
        Array.Copy(ico,entry,group,6+i*14,12); Array.Copy(BitConverter.GetBytes(id),0,group,6+i*14+12,2);
      }
      if (groups.Count==0) groups.Add(1);
      foreach (int id in groups) if (!UpdateResource(update,(IntPtr)14,(IntPtr)id,1033,group,(uint)group.Length)) throw new Exception("Cannot write icon group");
      if (!EndUpdateResource(update,false)) throw new Exception("Cannot commit icon");
      done=true;
    } finally { if (!done) EndUpdateResource(update,true); }
  }
}
'@
[PibbleIconResource]::Write($target, [IO.Path]::GetFullPath($Icon))
Write-Output 'Pibble icon embedded into packaged EXE.'
