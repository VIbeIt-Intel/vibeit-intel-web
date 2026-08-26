# One-time: hook Start website to your GitHub + Cursor account.
# Run from PowerShell:  .\setup-build.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "1/3  GitHub token (from your existing gh login)..."
$githubToken = gh auth token
if (-not $githubToken) {
  throw "Run: gh auth login   then try again."
}
$githubToken | npx wrangler secret put GITHUB_TOKEN
Write-Host "GitHub is connected."

Write-Host ""
Write-Host "2/3  Create a Cursor API key (browser will open)."
Write-Host "    Dashboard -> Integrations -> New API key"
Start-Process "https://cursor.com/dashboard/integrations"
$cursorKey = Read-Host "Paste the Cursor API key"
if (-not $cursorKey) {
  throw "No Cursor key pasted."
}
$cursorKey | npx wrangler secret put CURSOR_API_KEY
Write-Host "Cursor is connected."

Write-Host ""
Write-Host "3/3  In Cursor Integrations, connect GitHub so cloud agents can see new repos."
Write-Host ""
Write-Host "Done. Open a request, pick business type + customer action, hit Start website."
