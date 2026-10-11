import { computed } from 'vue'
import { useSpawnPoint } from '../composables/useSpawnPoint'
import { useDocumentStore } from './documentStore'
import type { ActionContext } from './documentType'

/** Le document affiché, sa vue courante et le contexte à fournir à ses actions. À appeler dans un `setup`. */
export function useActiveDocument() {
  const store = useDocumentStore()
  const type = computed(() => store.active)
  const doc = computed(() => store.doc)
  const view = computed(() => type.value.views.find((v) => v.id === doc.value.view.value) ?? type.value.views[0])
  const editableView = computed(() => type.value.views.find((v) => v.editable) ?? type.value.views[0])
  const spawn = useSpawnPoint(() => editableView.value.flowId)
  const ctx = (): ActionContext<any> => ({ doc: doc.value, viewId: view.value.id, spawn })
  return { type, doc, view, editableView, ctx }
}
