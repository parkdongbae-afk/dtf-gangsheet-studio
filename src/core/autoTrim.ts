/**
 * 투명 여백 자동 제거(Auto-Trim) 상수 — autotrim.py와 동기 유지.
 *
 * 알파 임계값(alpha threshold): 배경 제거 결과 가장자리에 남는 눈에 보이지
 * 않는 알파 1~5 수준의 옅은 잔상이 바운딩 박스를 과대 계산하는 것을 막기 위해
 * ``알파 > 임계값`` 픽셀만 보이는 픽셀로 간주한다(기본 10).
 */
export const AUTO_TRIM_ALPHA_THRESHOLD = 10
