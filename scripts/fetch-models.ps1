# 배경 제거·업스케일 모델 가중치를 resources/models로 내려받는다(빌드 전 1회).
# - isnet-general-use.onnx: rembg 공식 릴리스 자산(danielgatis/rembg v0.0.0) —
#   export-sidecar의 rembg 2.0.81이 내려받는 것과 동일한 파일. 파일명은 반드시
#   <session-name>.onnx 그대로 유지(rembg 플랫 레이아웃 조회 계약,
#   export.ts DEFAULT_MODEL_FILE과 동기).
# - RealESRGAN_x4.onnx / RealESR-AnimeVideo-x4.onnx: AI 업스케일 엔진 가중치
#   (UPSCALER.MD v2.0 — 사이드카 upscale.py가 로딩). 번들이 없으면 사이드카가
#   첫 사용 시 U2NET_HOME으로 다운로드하므로 사전 다운로드는 첫 실행 대기 제거용.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$destDir = Join-Path $root 'resources\models'

$models = @(
    @{
        File = 'isnet-general-use.onnx'
        Url  = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx'
    },
    @{
        File = 'RealESRGAN_x4.onnx'
        Url  = 'https://huggingface.co/anakhiu/realesrgan-onnx/resolve/main/realesrgan_x4plus.onnx'
    },
    @{
        File = 'RealESR-AnimeVideo-x4.onnx'
        Url  = 'https://huggingface.co/tidus2102/Real-ESRGAN/resolve/main/RealESR-AnimeVideo-v3_x4.onnx'
    }
)

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

foreach ($model in $models) {
    $dest = Join-Path $destDir $model.File
    if (Test-Path -LiteralPath $dest) {
        Write-Host "already present: $dest ($([math]::Round((Get-Item $dest).Length / 1MB)) MB)"
        continue
    }
    Write-Host "downloading $($model.File) from $($model.Url)"
    Invoke-WebRequest -Uri $model.Url -OutFile $dest
    Write-Host "downloaded: $dest ($([math]::Round((Get-Item $dest).Length / 1MB)) MB)"
}
