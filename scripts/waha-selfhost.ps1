param(
  [ValidateSet('up', 'down', 'status', 'logs')]
  [string]$Action = 'up'
)

$ErrorActionPreference = 'Stop'

$docker = Join-Path ${env:ProgramFiles} 'Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path -LiteralPath $docker)) {
  throw 'Docker Desktop não foi encontrado. Instale-o e inicie-o antes de conectar o WhatsApp.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'compose.waha.yml'
$envFile = Join-Path $projectRoot '.env.local'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Arquivo .env.local não encontrado.'
}

Push-Location $projectRoot
try {
  $compose = @('compose', '--env-file', $envFile, '-f', $composeFile)
  switch ($Action) {
    'up' { & $docker @compose 'up' '-d' }
    'down' { & $docker @compose 'down' }
    'status' { & $docker @compose 'ps' }
    'logs' { & $docker @compose 'logs' '--tail=200' '-f' 'waha' }
  }
} finally {
  Pop-Location
}
