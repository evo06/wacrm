param(
  [Parameter(Position = 0)]
  [ValidateSet("up", "down", "status", "logs")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$dockerBin = "C:\Program Files\Docker\Docker\resources\bin"
$docker = Join-Path $dockerBin "docker.exe"
if (-not (Test-Path -LiteralPath $docker)) {
  throw "Docker Desktop was not found at $docker"
}

$env:PATH = "$dockerBin;$env:PATH"
$projectRoot = Split-Path -Parent $PSScriptRoot
$supabaseRoot = Join-Path $projectRoot "infra\supabase"
$envFile = Join-Path $supabaseRoot ".env"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing infra/supabase/.env. Generate the self-hosted secrets first."
}

Push-Location $supabaseRoot
try {
  switch ($Action) {
    "up" {
      & $docker compose --env-file .env up -d --wait
    }
    "down" {
      # Intentionally keep the database, Storage files, and named volumes.
      & $docker compose --env-file .env down
    }
    "status" {
      & $docker compose --env-file .env ps
    }
    "logs" {
      & $docker compose --env-file .env logs --tail 200
    }
  }

  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
