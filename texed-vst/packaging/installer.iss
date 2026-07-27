; Inno Setup script for the Windows installer. Driven by packaging.cmake, which
; passes the paths and the version in; do not run it by hand.

#ifndef Version
  #define Version "0.0.0"
#endif

#define Name "Texed"
#define Publisher "Wouter van Nifterick"

[Setup]
OutputBaseFilename={#Name}-{#Version}-win
AppName={#Name}
AppPublisher={#Publisher}
AppVerName={#Name}
AppVersion={#Version}
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
CloseApplicationsFilter=*.exe,*.vst3
DefaultDirName={autopf}\{#Name}\
DefaultGroupName={#Name}
DisableProgramGroupPage=yes
SolidCompression=yes
UninstallDisplayIcon={uninstallexe}
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full"
Name: "custom"; Description: "Custom"; Flags: iscustom

[Components]
Name: "VST3"; Description: "VST3 plugin"; Types: full custom; Flags: checkablealone
Name: "SA"; Description: "Standalone application"; Types: full custom; Flags: checkablealone
Name: "Library"; Description: "Patch library"; Types: full custom

[Files]
Source: "{#Staged}\VST3\{#Name}.vst3\*"; DestDir: "{autocf}\VST3\{#Name}.vst3\"; \
  Components: VST3; Flags: ignoreversion recursesubdirs
Source: "{#Staged}\Standalone\{#Name}.exe"; DestDir: "{app}"; \
  Components: SA; Flags: ignoreversion
#ifdef Library
Source: "{#Library}\*"; DestDir: "{code:DataDir}\{#Name}\library"; \
  Components: Library; Flags: ignoreversion recursesubdirs
#endif
; Evergreen bootstrapper: ~2 MB, pulls the runtime down only when it is absent.
Source: "{#Bootstrapper}"; DestDir: "{tmp}"; Flags: deleteafterinstall; \
  Check: not WebViewRuntimePresent

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installing the Microsoft Edge WebView2 runtime..."; \
  Check: not WebViewRuntimePresent

[Icons]
Name: "{group}\{#Name}"; Filename: "{app}\{#Name}.exe"; Flags: createonlyiffileexists

[Code]
const
  WebViewClient = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

// Mirrors webViewRuntimeAvailable() in Source/WebAssets.cpp: the runtime
// registers its version here, and '0.0.0.0' means a stale uninstalled entry.
function VersionAt(Root: Integer; Key: string): Boolean;
var
  Version: string;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', Version) and (Version <> '') and
            (Version <> '0.0.0.0');
end;

function WebViewRuntimePresent: Boolean;
begin
  Result := VersionAt(HKLM, 'SOFTWARE\WOW6432Node\' + WebViewClient) or
            VersionAt(HKLM, 'SOFTWARE\' + WebViewClient) or
            VersionAt(HKCU, 'SOFTWARE\' + WebViewClient);
end;

// The plugin looks in the user data folder first, then the machine-wide one, so
// the library follows whichever install mode the user picked.
function DataDir(Param: string): string;
begin
  if IsAdminInstallMode then
    Result := ExpandConstant('{commonappdata}')
  else
    Result := ExpandConstant('{userappdata}');
end;
