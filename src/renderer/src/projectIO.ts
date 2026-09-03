/**
 * .dtf 프로젝트 로드 후처리 — 저장된 filePath에서 프리뷰(dataUrl) 재생성.
 * 프로젝트 파일은 경량화를 위해 dataUrl을 담지 않으므로 로드 시 필수 과정이다.
 * 원본이 이동·삭제된 항목은 제외하고 목록을 안내한다 (링크 기반 문서 관례).
 */
import type { PlacedImage } from './components/canvas/ProxyCanvas'
import type { ProjectImage } from '../../core/project'

export async function hydrateProjectImages(items: readonly ProjectImage[]): Promise<PlacedImage[]> {
  const hydrated: PlacedImage[] = []
  const missing: string[] = []
  for (const item of items) {
    try {
      const preview = await window.api.importImage(item.filePath)
      hydrated.push({ ...item, dataUrl: preview.dataUrl })
    } catch {
      missing.push(item.filePath)
    }
  }
  if (missing.length > 0) {
    alert(
      `원본 파일을 찾을 수 없어 ${missing.length}개 항목을 제외했습니다:\n${missing.join('\n')}`
    )
  }
  return hydrated
}
