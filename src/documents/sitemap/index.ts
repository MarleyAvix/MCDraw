import { computed, toRef, type Ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { ArrowLeft, ArrowRight, CornerDownRight, FileCode2, FileText, ListTree, Maximize2, Plus, RotateCcw, TextCursorInput } from 'lucide-vue-next'
import type { DocumentApi, DocumentType } from '../../core/documentType'
import { downloadBlob } from '../../composables/useFileIO'
import { SITEMAP_EXAMPLES, useSitemapStore } from './sitemapStore'
import { sitemapToMarkdown, sitemapToXml, type SitemapSchema } from './engine'
import SitemapCanvas from './SitemapCanvas.vue'
import SitemapTextPanel from './SitemapTextPanel.vue'
import EditPageModal from './EditPageModal.vue'

const BASE_URL_KEY = 'mcdraw:sitemap:baseUrl'

function useSitemapDocument(): DocumentApi<SitemapSchema> {
  const store = useSitemapStore()
  return {
    schema: computed(() => store.schema),
    importRaw: store.importSchema,
    reset: store.reset,
    loadExample: store.loadExample,
    undo: store.undo,
    redo: store.redo,
    canUndo: computed(() => store.canUndo),
    canRedo: computed(() => store.canRedo),
    view: toRef(store, 'view') as unknown as Ref<string>,
    selection: toRef(store, 'selection'),
    selectAll: () => (store.selection = store.pages.map((p) => p.id)),
    copy: () => void store.copy(store.selection),
    paste: () => void store.paste(),
    duplicate: () => store.duplicate(store.selection),
    flash: store.flash,
    searchIndex: () => store.pages.map((p) => ({ key: p.id, nodeId: p.id, label: p.title, context: p.url ?? 'Page', kind: 'page' as const })),
  }
}

/** Nouvelle page sous la page sélectionnée (une racine si rien n'est sélectionné). */
const addChild = () => {
  const s = useSitemapStore()
  s.addPage(s.selection[0])
}
const addSibling = () => {
  const s = useSitemapStore()
  if (s.selection[0]) s.addSibling(s.selection[0])
  else s.addPage()
}

function exportXml() {
  const stored = (() => {
    try {
      return localStorage.getItem(BASE_URL_KEY)
    } catch {
      return null
    }
  })()
  const base = prompt('Adresse du site pour le sitemap.xml', stored ?? 'https://exemple.fr')?.trim()
  if (!base) return
  try {
    localStorage.setItem(BASE_URL_KEY, base)
  } catch {
    /* stockage indisponible */
  }
  downloadBlob(sitemapToXml(useSitemapStore().schema, base), 'application/xml', 'sitemap.xml')
}

export const sitemapDocument: DocumentType<SitemapSchema> = {
  id: 'sitemap',
  label: 'Plan de site',
  tagline: 'Posez le plan de votre site en quelques lignes.',
  icon: ListTree,
  fileName: 'sitemap',
  accepts: (raw) => typeof raw === 'object' && raw !== null && Array.isArray((raw as { pages?: unknown }).pages),

  useDocument: useSitemapDocument,
  examples: SITEMAP_EXAMPLES.map(({ id, label, description }) => ({ id, label, description, category: 'modele' })),
  exampleGroups: [{ category: 'modele', title: 'Modèles de départ' }],

  views: [{ id: 'tree', label: 'Arbre', title: 'Plan du site', flowId: 'sitemap', Component: SitemapCanvas, editable: true }],

  panels: [{ id: 'text', side: 'left', Component: SitemapTextPanel, width: 320, visible: () => useSitemapStore().showTextPanel }],

  modals: [{ id: 'page', Component: EditPageModal, visible: () => !!useSitemapStore().editingPageId, key: () => useSitemapStore().editingPageId }],

  actions: [
    { id: 'page', label: 'Page', title: 'Ajouter une sous-page à la page sélectionnée', icon: Plus, iconClass: 'text-indigo-600', group: 'create', run: addChild },
    { id: 'sibling', label: 'Même niveau', title: 'Ajouter une page au même niveau', icon: CornerDownRight, iconClass: 'text-amber-600', group: 'create', run: addSibling },
    {
      id: 'move-left',
      label: 'Avant',
      title: 'Placer la page avant sa sœur (vers la gauche)',
      icon: ArrowLeft,
      group: 'tools',
      run: () => { const s = useSitemapStore(); s.movePageBy(s.selection[0], -1) },
      disabled: () => { const s = useSitemapStore(); return s.selection.length !== 1 || !s.canMove(s.selection[0], -1) },
    },
    {
      id: 'move-right',
      label: 'Après',
      title: 'Placer la page après sa sœur (vers la droite)',
      icon: ArrowRight,
      group: 'tools',
      run: () => { const s = useSitemapStore(); s.movePageBy(s.selection[0], 1) },
      disabled: () => { const s = useSitemapStore(); return s.selection.length !== 1 || !s.canMove(s.selection[0], 1) },
    },
    {
      id: 'text',
      label: 'Texte',
      title: 'Saisir le plan en texte',
      icon: TextCursorInput,
      group: 'create',
      run: () => { const s = useSitemapStore(); s.showTextPanel = !s.showTextPanel },
      pressed: () => useSitemapStore().showTextPanel,
    },
    { id: 'fit', label: 'Recadrer', title: 'Afficher tout le plan', icon: Maximize2, run: () => void useVueFlow('sitemap').fitView({ padding: 0.2, duration: 300 }) },
    {
      id: 'reset',
      label: 'Réinitialiser',
      icon: RotateCcw,
      group: 'danger',
      run: ({ doc }) => { if (confirm('Effacer tout le plan ? (Ctrl+Z pour annuler)')) doc.reset() },
    },
  ],

  // Le plan sert ensuite ailleurs : une liste Markdown pour la documentation, un sitemap.xml pour le référencement.
  headerActions: [
    { id: 'markdown', label: 'Markdown', title: 'Exporter le plan en liste Markdown', icon: FileText, run: () => downloadBlob(sitemapToMarkdown(useSitemapStore().schema) + '\n', 'text/markdown', 'sitemap.md') },
    { id: 'xml', label: 'sitemap.xml', title: 'Exporter un sitemap.xml (sitemaps.org) pour les moteurs de recherche', icon: FileCode2, primary: true, run: exportXml },
  ],

  shortcuts: [
    { key: 'n', label: 'Ajouter une sous-page', run: addChild },
    { key: 's', label: 'Ajouter une page au même niveau', run: addSibling },
  ],
}
