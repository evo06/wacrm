param(
  [ValidateSet('up', 'down', 'status', 'logs', 'build')]
  [string]$Action = 'up'
)

$ErrorActionPreference = 'Stop'

$docker = Join-Path ${env:ProgramFiles} 'Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path -LiteralPath $docker)) {
  throw 'Docker Desktop não foi encontrado. Instale-o e inicie-o antes de usar o scraper.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot 'compose.scraper.yml'
$envFile = Join-Path $projectRoot '.env.local'

if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Arquivo .env.local não encontrado.'
}

Push-Location $projectRoot
try {
  $compose = @('compose', '--env-file', $envFile, '-f', $composeFile)
  switch ($Action) {
    # `up --build` so a first run (or a code change in services/scraper)
    # rebuilds the image; the initial build downloads the browsers and is slow.
    'up' { & $docker @compose 'up' '-d' '--build' }
    'build' { & $docker @compose 'build' }
    'down' { & $docker @compose 'down' }
    'status' { & $docker @compose 'ps' }
    'logs' { & $docker @compose 'logs' '--tail=200' '-f' 'scraper' }
  }
} finally {
  Pop-Location
}
