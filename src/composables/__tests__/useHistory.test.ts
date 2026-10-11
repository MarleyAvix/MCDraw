import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useHistory } from '../useHistory'

function setup(opts: { max?: number; coalesceMs?: number } = {}) {
  const state = ref({ n: 0 })
  const scope = effectScope()
  const history = scope.run(() => useHistory({ state, load: (s) => (state.value = s), ...opts }))!
  /** Modifie l'état et laisse le watcher réagir ; `gap` fait avancer l'horloge avant la modification. */
  const set = async (n: number, gap = 1000) => {
    vi.advanceTimersByTime(gap)
    state.value = { n }
    await nextTick()
  }
  return { state, history, set, stop: () => scope.stop() }
}

describe('useHistory', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("ne compte pas l'état initial comme une étape", () => {
    const { history } = setup()
    expect(history.canUndo.value).toBe(false)
    expect(history.canRedo.value).toBe(false)
  })

  it('annule puis rétablit', async () => {
    const { state, history, set } = setup()
    await set(1)
    await set(2)
    history.undo()
    expect(state.value.n).toBe(1)
    history.undo()
    expect(state.value.n).toBe(0)
    expect(history.canUndo.value).toBe(false)
    history.redo()
    expect(state.value.n).toBe(1)
    expect(history.canRedo.value).toBe(true)
  })

  it('fusionne les modifications rapprochées en une seule étape', async () => {
    const { state, history, set } = setup({ coalesceMs: 600 })
    await set(1)
    await set(2, 100)
    await set(3, 100)
    history.undo()
    expect(state.value.n).toBe(0)
    expect(history.canUndo.value).toBe(false)
  })

  it('une nouvelle modification vide le rétablissement', async () => {
    const { history, set } = setup()
    await set(1)
    history.undo()
    expect(history.canRedo.value).toBe(true)
    await set(5)
    expect(history.canRedo.value).toBe(false)
  })

  it('plafonne le nombre d’étapes', async () => {
    const { state, history, set } = setup({ max: 3 })
    for (let i = 1; i <= 6; i++) await set(i)
    for (let i = 0; i < 10; i++) history.undo()
    expect(state.value.n).toBe(3)
  })

  it('ignore une modification qui ne change pas l’état sérialisé', async () => {
    const { history, set } = setup()
    await set(0)
    expect(history.canUndo.value).toBe(false)
  })
})
