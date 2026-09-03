# 배경 제거 기본 모델 가중치를 resources/models로 내려받는다(빌드 전 1회).
# - 소스: rembg 공식 릴리스 자산(danielgatis/rembg v0.0.0) — export-sidecar의
#   rembg 2.0.81이 내려받는 것과 동일한 파일.
# - 파일명은 반드시 <session-name>.onnx 그대로 유지(rembg 플랫 레이아웃 조회 계약,
#   export.ts DEFAULT_MODEL_FILE과 동기).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$destDir = Join-Path $root 'resources\models'
$model = 'isnet-general-use.onnx'
$url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/$model"
$dest = Join-Path $destDir $model

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

if (Test-Path -LiteralPath $dest) {
    Write-Host "already present: $dest ($([math]::Round((Get-Item $dest).Length / 1MB)) MB)"
    exit 0
}

Write-Host "downloading $model (~170MB) from $url"
Invoke-WebRequest -Uri $url -OutFile $dest
Write-Host "downloaded: $dest ($([math]::Round((Get-Item $dest).Length / 1MB)) MB)"
