$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$target = Join-Path $project 'runtime/llama'
$archive = Join-Path $project 'build-cache/llama-b11417.zip'
New-Item -ItemType Directory -Force -Path (Split-Path $archive -Parent),$target | Out-Null
try { Invoke-WebRequest -Uri 'https://github.com/ggml-org/llama.cpp/releases/download/b11417/llama-b11417-bin-win-cpu-x64.zip' -OutFile $archive }
catch { Invoke-WebRequest -Uri ('https://api.github.com/repos/ggml-org/llama.cpp/releases/assets/612647191?radar=' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Headers @{Accept='application/octet-stream'} -OutFile $archive }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne '3b2519bcfd83f2d8d3082e545470b93ab18bb32742daaff60eea55216540d537') { throw 'Runtime checksum mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
Write-Output 'Local AI runtime prepared. The app downloads its model only on request.'
