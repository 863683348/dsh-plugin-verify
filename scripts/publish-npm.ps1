# One-shot npm publish. Token from $DSH_HOME/secrets/npm-token.txt or $env:NPM_TOKEN.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
if (-not $env:DSH_NODE_DIR) { $env:DSH_NODE_DIR = 'C:\Users\l''x\.workbuddy\binaries\node\versions\22.22.2' }
$node = Join-Path $env:DSH_NODE_DIR 'node.exe'
$npmCli = Join-Path $env:DSH_NODE_DIR 'node_modules\npm\bin\npm-cli.js'
$secrets = Join-Path $env:DSH_HOME 'secrets\npm-token.txt'
$token = $env:NPM_TOKEN
if (-not $token -and (Test-Path $secrets)) { $token = (Get-Content $secrets -Raw).Trim() }
if (-not $token) { throw 'npm token missing' }
Push-Location $root
$npmrc = Join-Path $root '.npmrc'
try {
  Set-Content -Path $npmrc -Value ("//registry.npmjs.org/:_authToken=" + $token) -Encoding ascii
  & $node $npmCli publish --ignore-scripts --cache (Join-Path $root '.npm-cache') 2>&1
  if ($LASTEXITCODE -ne 0) { throw "npm publish failed (exit $LASTEXITCODE)" }
  Write-Host 'published'
} finally {
  Remove-Item -Force $npmrc -ErrorAction SilentlyContinue
  Pop-Location
}
