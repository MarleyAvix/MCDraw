import { nextTick, ref } from 'vue'

/** Renommage en place (double-clic) : `current` donne le nom affiché, `save` reçoit le nouveau nom non vide. */
export function useInlineRename(current: () => string, save: (name: string) => void) {
  const editing = ref(false)
  const draft = ref('')
  let input: HTMLInputElement | undefined
  const setInput = (el: unknown) => (input = el as HTMLInputElement | undefined)

  async function start() {
    draft.value = current()
    editing.value = true
    await nextTick()
    input?.focus()
    input?.select()
  }
  function commit() {
    if (!editing.value) return
    editing.value = false
    const name = draft.value.trim()
    if (name && name !== current()) save(name)
  }
  const cancel = () => (editing.value = false)

  return { editing, draft, setInput, start, commit, cancel }
}
