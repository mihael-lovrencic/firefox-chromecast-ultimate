param(
  [string]$ManifestPath = "$(Resolve-Path "$PSScriptRoot\chromecast_ultimate_helper.json")"
)

$regPath = "HKCU:\Software\Mozilla\NativeMessagingHosts"
$hostName = "chromecast_ultimate_helper"

if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath | Out-Null
}

Set-ItemProperty -Path $regPath -Name $hostName -Value $ManifestPath
Write-Output "Native host registered:"
Write-Output "  $regPath\\$hostName -> $ManifestPath"
