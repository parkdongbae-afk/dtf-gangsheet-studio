import { useEffect, useState } from 'react'

/** dataUrl → 로드 완료된 HTMLImageElement 캐시 (상한 초과 시 최근 사용 순 유지) */
const imageCache = new Map<string, HTMLImageElement>()
const CACHE_MAX = 32

/**
 * 프리뷰 dataUrl → Konva Image 노드에 바인딩할 HTMLImageElement.
 * 캐시 히트면 즉시 반환, 아니면 비동기 로드 완료 시 갱신. 실패 시 null.
 */
export function useHtmlImage(dataUrl: string): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null)
  const cached = imageCache.get(dataUrl) ?? null

  useEffect(() => {
    if (cached) return
    let cancelled = false
    const el = new Image()
    el.onload = (): void => {
      if (cancelled) return
      imageCache.delete(dataUrl)
      imageCache.set(dataUrl, el)
      if (imageCache.size > CACHE_MAX) {
        const oldest = imageCache.keys().next().value
        if (oldest !== undefined && oldest !== dataUrl) imageCache.delete(oldest)
      }
      setLoaded(el)
    }
    el.onerror = (): void => {
      if (!cancelled) setLoaded(null)
    }
    el.src = dataUrl
    return () => {
      cancelled = true
    }
  }, [dataUrl, cached])

  return cached ?? loaded
}
