import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { documentTypes, getDocumentType, type DocumentApi } from './documentType'

const KEY = 'mcdraw:document-type'

/**
 * État du shell : type de document affiché (mémorisé) et fenêtres communes à tous les types.
 * Un identifiant mémorisé inconnu retombe sur le premier type enregistré.
 */
export const useDocumentStore = defineStore('document', () => {
  const read = () => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  }
  const stored = read()
  const activeId = ref(stored && getDocumentType(stored) ? stored : (documentTypes()[0]?.id ?? ''))
  const active = computed(() => getDocumentType(activeId.value) ?? documentTypes()[0])

  // Une API de document par type, créée une fois : chaque type garde son propre état (et sa propre vue) quand on change de type.
  const docs: Record<string, DocumentApi<any>> = Object.fromEntries(documentTypes().map((t) => [t.id, t.useDocument()]))
  const doc = computed(() => docs[active.value.id])

  const showShareModal = ref(false)
  const showThemeModal = ref(false)
  const showShortcutsModal = ref(false)

  watch(activeId, (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* stockage indisponible */
    }
  })

  function select(id: string) {
    if (getDocumentType(id)) activeId.value = id
  }

  return { activeId, active, doc, select, showShareModal, showThemeModal, showShortcutsModal }
})
