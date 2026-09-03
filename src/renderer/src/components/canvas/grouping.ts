/**
 * 그룹 연산 (TECH §4.4) — UI 라이브러리 의존 없는 순수 함수 (Vitest 선검증).
 * 그룹은 선택적 groupId 문자열 공유로 표현한다 (PlacedImage.groupId).
 * 렌더는 일반 노드와 동일하게 각 항목별로 이뤄지며, 그룹 성질은 선택 확장·
 * 원자적 해제·복제 시 새 그룹 id 재매핑에만 개입한다.
 */

/** PlacedImage를 구조적으로 만족하는 최소 입력 */
export interface GroupableItem {
  id: string
  groupId?: string
}

/**
 * 선택 id에 그룹원이 포함되면 그룹 전체로 확장한다 (Figma 관례 — 클릭·마키·
 * Ctrl 추가 선택 모두 동일 규칙). 입력 순서를 유지하고 확장 멤버는 뒤에 붙인다.
 */
export function expandSelectionToGroups<T extends GroupableItem>(
  items: readonly T[],
  selected: readonly string[]
): string[] {
  const byGroup = new Map<string, string[]>()
  for (const item of items) {
    if (item.groupId === undefined) continue
    const members = byGroup.get(item.groupId)
    if (members) members.push(item.id)
    else byGroup.set(item.groupId, [item.id])
  }
  const result = [...selected]
  const seen = new Set(selected)
  for (const id of selected) {
    const group = items.find((item) => item.id === id)?.groupId
    if (group === undefined) continue
    for (const member of byGroup.get(group) ?? []) {
      if (seen.has(member)) continue
      seen.add(member)
      result.push(member)
    }
  }
  return result
}

/** 선택 항목 전체를 하나의 그룹으로 묶는다 — 기존 그룹에 속한 항목은 새 그룹으로 이동(병합). */
export function groupSelection<T extends GroupableItem>(
  items: readonly T[],
  selected: readonly string[],
  groupId: string
): T[] {
  return items.map((item) =>
    selected.includes(item.id) && item.groupId !== groupId ? { ...item, groupId } : item
  )
}

/** 선택이 닿는 그룹 전체(미선택 멤버 포함)의 groupId를 제거한다. */
export function ungroupSelection<T extends GroupableItem>(
  items: readonly T[],
  selected: readonly string[]
): T[] {
  const touched = new Set(
    items
      .filter((item) => item.groupId !== undefined && selected.includes(item.id))
      .map((item) => item.groupId)
  )
  if (touched.size === 0) return [...items]
  return items.map((item) => {
    if (item.groupId === undefined || !touched.has(item.groupId)) return item
    const next = { ...item }
    delete next.groupId
    return next
  })
}

/** 선택 전체가 이미 동일한 단일 그룹인가 — 그룹화 no-op 가드 (빈 undo 단계 방지) */
export function isSingleCompleteGroup<T extends GroupableItem>(
  items: readonly T[],
  selected: readonly string[]
): boolean {
  if (selected.length < 2) return false
  const selectedItems = items.filter((item) => selected.includes(item.id))
  if (selectedItems.length !== selected.length) return false
  const groupId = selectedItems[0]?.groupId
  if (groupId === undefined) return false
  return selectedItems.every((item) => item.groupId === groupId)
}

/** 복제에 필요한 최소 구조 — 사본은 델타 이동 위치를 가진다 */
export interface CloneableItem extends GroupableItem {
  x: number
  y: number
}

/**
 * 선택 항목 복제 — 새 id와 델타 오프셋 적용. 같은 그룹의 사본끼리는 새 그룹 id 하나로
 * 재매핑되어 복제 후에도 그룹이 유지된다 (randomUUID 주입 — 순수 함수 규칙).
 */
export function cloneWithNewGroups<T extends CloneableItem>(
  sources: readonly T[],
  delta: { dx: number; dy: number },
  newId: () => string
): T[] {
  const groupRemap = new Map<string, string>()
  return sources.map((source) => {
    let groupId = source.groupId
    if (groupId !== undefined) {
      let mapped = groupRemap.get(groupId)
      if (mapped === undefined) {
        mapped = newId()
        groupRemap.set(groupId, mapped)
      }
      groupId = mapped
    }
    return { ...source, id: newId(), x: source.x + delta.dx, y: source.y + delta.dy, groupId }
  })
}
