# 배경 제거 기본 모델 가중치 번들 디렉터리
#
# 이곳에 <model>.onnx 파일(플랫 레이아웃)을 두면 electron-builder가
# resources/models 로 번들하고, 런타임 export.ts가 U2NET_HOME으로 이 폴더를
# 지정해 첫 실행 다운로드를 건너뛴다(rembg 2.0.81 legacy 플랫 조회 호환).
#
# 파일 확보: 프로젝트 루트에서 아래 한 번 실행
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-models.ps1
#
# .onnx 파일은 Git LFS/미커밋 대상 — 이 README만 커밋된다.
