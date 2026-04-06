param(
  [string]$ManifestPath = "$(Resolve-Path "$PSScriptRoot\chromecast_ultimate_helper.json")"
)

$regPath = "HKCU:\Software\Mozilla\NativeMessagingHosts"
$hostName = "chromecast_ultimate_helper"
$hostKeyPath = Join-Path $regPath $hostName
$runKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$helperLauncherPath = (Resolve-Path (Join-Path $PSScriptRoot '..\helper\start-helper.cmd')).Path

if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath | Out-Null
}

if (-not (Test-Path $hostKeyPath)) {
  New-Item -Path $hostKeyPath | Out-Null
}

# Firefox expects a subkey named after the host and the manifest path as the default value.
Set-Item -Path $hostKeyPath -Value $ManifestPath

# Clean up the older incorrect property-style registration if it exists.
try {
  Remove-ItemProperty -Path $regPath -Name $hostName -ErrorAction SilentlyContinue
} catch {
}

# Keep the helper available for the extension even when native messaging is flaky.
Set-ItemProperty -Path $runKeyPath -Name "ChromecastUltimateHelper" -Value "`"$helperLauncherPath`""

# Start the helper immediately for the current session too.
Start-Process -FilePath $helperLauncherPath -WindowStyle Hidden

Write-Output "Native host registered:"
Write-Output "  $hostKeyPath (Default) -> $ManifestPath"
Write-Output "Helper startup registered:"
Write-Output "  $runKeyPath\\ChromecastUltimateHelper -> $helperLauncherPath"
