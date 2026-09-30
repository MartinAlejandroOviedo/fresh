; -------------------------------------------------------------
;  NuIde — instalador Inno Setup 6
;  Compilar: ISCC.exe nuide.iss   (desde la carpeta installer\)
;  NuIde es un fork de Fresh (sinelaw/fresh, GPL-2.0).
; -------------------------------------------------------------

#define MyAppName      "NuIde"
#define MyAppVersion   "0.5.1"
#define MyAppPublisher "NuIde"
#define MyAppURL       "https://github.com/MartinAlejandroOviedo/fresh"
#define MyAppExeName   "nuide.exe"

[Setup]
AppId={{6E1B7C2A-3D4F-5A6B-8C9D-0E1F2A3B4C5D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
AllowNoIcons=yes
LicenseFile=..\LICENSE
OutputDir=out
OutputBaseFilename=NuIde-Setup-{#MyAppVersion}
SetupIconFile=nuide.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
AlwaysRestart=no
CloseApplications=yes
RestartApplications=no
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos adicionales:"
Name: "pathadd";     Description: "Agregar NuIde al PATH (comando `nuide` desde cualquier terminal)"; GroupDescription: "Integracion:"; Flags: unchecked
Name: "cfg";         Description: "Instalar la configuracion NuIde (tema mi-dracula y plugins de editor)"; GroupDescription: "Integracion:"; Flags: unchecked

[Files]
; binario principal (build de release)
Source: "..\target\release\nuide.exe"; DestDir: "{app}"; Flags: ignoreversion
; docs y atribucion
Source: "attributions.txt";              DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md";                  DestDir: "{app}"; DestName: "README.md"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\LICENSE";                    DestDir: "{app}"; DestName: "LICENSE-fresh.txt"; Flags: ignoreversion skipifsourcedoesntexist
; snapshot de config (empacado por build-instalador.ps1 desde %APPDATA%\fresh)
Source: "cfg\themes\*";  DestDir: "{userappdata}\fresh\themes";  Tasks: cfg; Flags: ignoreversion createallsubdirs recursesubdirs
Source: "cfg\plugins\*"; DestDir: "{userappdata}\fresh\plugins"; Tasks: cfg; Flags: ignoreversion createallsubdirs recursesubdirs

[Dirs]
Name: "{userappdata}\fresh"; Tasks: cfg

[Icons]
; nuide.exe es de subsistema consola: se lanza via cmd /K para que la ventana
; sobreviva al salir del editor (con doble clic directo, Windows la cerraria).
Name: "{group}\{#MyAppName}";           Filename: "{sys}\cmd.exe"; Parameters: "/K ""{app}\{#MyAppExeName}"""; WorkingDir: "{userdocs}"
Name: "{autodesktop}\{#MyAppName}";     Filename: "{sys}\cmd.exe"; Parameters: "/K ""{app}\{#MyAppExeName}"""; WorkingDir: "{userdocs}"; Tasks: desktopicon

[Registry]
; la tarea cfg no toca el registro; PATH se maneja por [Code] (REG_EXPAND_SZ).

[UninstallDelete]
Type: files; Name: "{app}\nuide.exe"

[Code]
const EnvKey = 'Environment';

procedure AddToPath;
var
  Cur, New: String;
begin
  if RegQueryStringValue(HKCU, EnvKey, 'Path', Cur) then
  begin
    if Pos(Lowercase(ExpandConstant('{app}')), Lowercase(Cur)) = 0 then
    begin
      if Copy(Cur, Length(Cur), 1) = ';' then
        New := Cur + ExpandConstant('{app}')
      else
        New := Cur + ';' + ExpandConstant('{app}');
      RegWriteExpandStringValue(HKCU, EnvKey, 'Path', New);
    end;
  end
  else
    RegWriteExpandStringValue(HKCU, EnvKey, 'Path', ExpandConstant('{app}'));
end;

procedure RemoveFromPath;
var
  Cur, Item, Res, Part: String;
  P: Integer;
begin
  if RegQueryStringValue(HKCU, EnvKey, 'Path', Cur) then
  begin
    Item := Lowercase(ExpandConstant('{app}'));
    Res := '';
    Cur := Cur + ';';
    while Pos(';', Cur) > 0 do
    begin
      P := Pos(';', Cur);
      Part := Copy(Cur, 1, P - 1);
      if Lowercase(Part) <> Item then
        Res := Res + Part + ';';
      Delete(Cur, 1, P);
    end;
    while (Length(Res) > 0) and (Copy(Res, Length(Res), 1) = ';') do
      Delete(Res, Length(Res), 1);
    if Length(Res) = 0 then
      RegDeleteValue(HKCU, EnvKey, 'Path')
    else
      RegWriteExpandStringValue(HKCU, EnvKey, 'Path', Res);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('pathadd') then
    AddToPath;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    RemoveFromPath;
end;
