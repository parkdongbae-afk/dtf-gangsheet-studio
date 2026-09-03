import { describe, expect, it } from 'vitest'
import {
  cloneWithNewGroups,
  expandSelectionToGroups,
  groupSelection,
  isSingleCompleteGroup,
  ungroupSelection,
  type GroupableItem
} from './grouping'

interface Item extends GroupableItem {
  x: number
  y: number
}

const item = (id: string, x = 0, y = 0, groupId?: string): Item => ({ id, x, y, groupId })

const G1 = 'group-1'
const G2 = 'group-2'

describe('expandSelectionToGroups', () => {
  it('그룹원 1개 선택 → 그룹 전체로 확장', () => {
    const items = [item('a', 0, 0, G1), item('b', 1, 0, G1), item('c', 2, 0)]
    expect(expandSelectionToGroups(items, ['a'])).toEqual(['a', 'b'])
  })

  it('미선택 그룹 멤버가 포함될 때만 확장 — 다른 그룹은 건드리지 않음', () => {
    const items = [
      item('a', 0, 0, G1),
      item('b', 1, 0, G1),
      item('p', 2, 0, G2),
      item('q', 3, 0, G2)
    ]
    expect(expandSelectionToGroups(items, ['a', 'p'])).toEqual(['a', 'p', 'b', 'q'])
  })

  it('그룹 없는 선택은 원본 순서 그대로 (새 배열, 동등)', () => {
    const items = [item('a'), item('b')]
    expect(expandSelectionToGroups(items, ['b', 'a'])).toEqual(['b', 'a'])
  })

  it('이미 전체가 포함된 그룹은 중복 추가 없음', () => {
    const items = [item('a', 0, 0, G1), item('b', 1, 0, G1)]
    expect(expandSelectionToGroups(items, ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('groupSelection', () => {
  it('선택 항목에 새 groupId 부여 — 미선택은 불변 참조 유지', () => {
    const items = [item('a'), item('b'), item('c')]
    const next = groupSelection(items, ['a', 'c'], G1)
    expect(next[0]).toEqual({ id: 'a', x: 0, y: 0, groupId: G1 })
    expect(next[1]).toBe(items[1])
    expect(next[2]).toEqual({ id: 'c', x: 0, y: 0, groupId: G1 })
  })

  it('기존 그룹 항목 재선택 시 새 그룹으로 병합', () => {
    const items = [item('a', 0, 0, G1), item('b')]
    const next = groupSelection(items, ['a', 'b'], G2)
    expect(next.every((i) => i.groupId === G2)).toBe(true)
  })
})

describe('ungroupSelection', () => {
  it('선택이 닿는 그룹 전체 해제 — 미선택 멤버도 해제', () => {
    const items = [item('a', 0, 0, G1), item('b', 1, 0, G1), item('c', 2, 0)]
    const next = ungroupSelection(items, ['a'])
    expect(next[0].groupId).toBeUndefined()
    expect(next[1].groupId).toBeUndefined()
    expect(next[2].groupId).toBeUndefined()
  })

  it('다른 그룹은 유지', () => {
    const items = [item('a', 0, 0, G1), item('p', 1, 0, G2), item('q', 2, 0, G2)]
    const next = ungroupSelection(items, ['a'])
    expect(next[0].groupId).toBeUndefined()
    expect(next[1].groupId).toBe(G2)
    expect(next[2].groupId).toBe(G2)
  })

  it('그룹 미포함 선택 → 원본과 동등한 새 배열', () => {
    const items = [item('a'), item('b')]
    expect(ungroupSelection(items, ['a'])).toEqual(items)
  })
})

describe('isSingleCompleteGroup', () => {
  it('동일 그룹 전체 선택 → true', () => {
    const items = [item('a', 0, 0, G1), item('b', 1, 0, G1), item('c')]
    expect(isSingleCompleteGroup(items, ['a', 'b'])).toBe(true)
  })

  it('부분 선택·그룹 없음·1개 선택 → false', () => {
    const items = [item('a', 0, 0, G1), item('b', 1, 0, G1), item('c'), item('d')]
    expect(isSingleCompleteGroup(items, ['a'])).toBe(false)
    expect(isSingleCompleteGroup(items, ['c', 'd'])).toBe(false)
    expect(isSingleCompleteGroup(items, ['a', 'b', 'c'])).toBe(false)
  })
})

describe('cloneWithNewGroups', () => {
  it('사본은 새 id·델타 위치, 그룹은 새 id로 재매핑 (같은 그룹 → 같은 새 그룹)', () => {
    const items = [item('a', 100, 200, G1), item('b', 300, 400, G1), item('c', 0, 0)]
    let seq = 0
    const copies = cloneWithNewGroups(items, { dx: 24, dy: 24 }, () => `new-${seq++}`)
    expect(copies[0]).toEqual({ id: 'new-1', x: 124, y: 224, groupId: 'new-0' })
    expect(copies[1]).toEqual({ id: 'new-2', x: 324, y: 424, groupId: 'new-0' })
    expect(copies[2]).toEqual({ id: 'new-3', x: 24, y: 24, groupId: undefined })
    expect(copies[0].groupId).toBe(copies[1].groupId)
    expect(copies[0].groupId).not.toBe(G1)
  })

  it('원본은 불변 — 사본만 생성', () => {
    const items = [item('a', 0, 0, G1)]
    cloneWithNewGroups(items, { dx: 0, dy: 0 }, () => 'x')
    expect(items[0]).toEqual({ id: 'a', x: 0, y: 0, groupId: G1 })
  })

  it('델타 0 복제 — 위치 그대로 (Ctrl+드래그 복제 시작점)', () => {
    const copies = cloneWithNewGroups([item('a', 50, 60)], { dx: 0, dy: 0 }, () => 'k')
    expect(copies[0]).toEqual({ id: 'k', x: 50, y: 60, groupId: undefined })
  })
})
