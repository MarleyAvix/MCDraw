import { computed, toRef, type Ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { ArrowDown, ArrowUp, BrainCircuit, CornerDownRight, FileCode2, FileText, Maximize2, Plus, RotateCcw, TextCursorInput } from 'lucide-vue-next'
import type { DocumentApi, DocumentType } from '../../core/documentType'
import { downloadBlob } from '../../composables/useFileIO'
import { MINDMAP_EXAMPLES, useMindmapStore } from './mindmapStore'
import { mindmapToMarkdown, mindmapToOpml, type MindmapSchema } from './engine'
import MindmapCanvas from './MindmapCanvas.vue'
import MindmapTextPanel from './MindmapTextPanel.vue'
import EditNodeModal from './EditNodeModal.vue'

function useMindmapDocument(): DocumentApi<MindmapSchema> {
  const store = useMindmapStore()
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
    selectAll: () => (store.selection = store.nodesList.map((n) => n.id)),
    copy: () => void store.copy(store.selection),
    paste: () => void store.paste(),
    duplicate: () => store.duplicate(store.selection),
    flash: store.flash,
    searchIndex: () => store.nodesList.map((n) => ({ key: n.id, nodeId: n.id, label: n.text, context: n.note ?? 'Idée', kind: 'idea' as const })),
  }
}

/** Nouvelle idée sous l'idée sélectionnée (une idée centrale si rien n'est sélectionné). */
const addChild = () => {
  const s = useMindmapStore()
  s.addNode(s.selection[0])
}
const addSibling = () => {
  const s = useMindmapStore()
  if (s.selection[0]) s.addSibling(s.selection[0])
  else s.addNode()
}
const toggleCollapse = () => {
  const s = useMindmapStore()
  if (s.selection.length === 1) s.toggleCollapse(s.selection[0])
}

export const mindmapDocument: DocumentType<MindmapSchema> = {
  id: 'mindmap',
  label: 'Carte mentale',
  tagline: 'Jetez vos idées, organisez-les en branches.',
  icon: BrainCircuit,
  fileName: 'carte-mentale',
  accepts: (raw) => typeof raw === 'object' && raw !== null && Array.isArray((raw as { nodes?: unknown }).nodes),

  // Une couleur par branche est déjà automatique : seules les écritures se règlent ici.
  appearance: [{ key: 'text', label: 'Écritures', hint: 'Texte des idées' }],
  useDocument: useMindmapDocument,
  examples: MINDMAP_EXAMPLES.map(({ id, label, description }) => ({ id, label, description, category: 'modele' })),
  exampleGroups: [{ category: 'modele', title: 'Modèles de départ' }],

  views: [{ id: 'map', label: 'Carte', title: 'Carte mentale', flowId: 'mindmap', Component: MindmapCanvas, editable: true }],

  panels: [{ id: 'text', side: 'left', Component: MindmapTextPanel, width: 320, visible: () => useMindmapStore().showTextPanel }],

  modals: [{ id: 'idea', Component: EditNodeModal, visible: () => !!useMindmapStore().editingNodeId, key: () => useMindmapStore().editingNodeId }],

  actions: [
    { id: 'idea', label: 'Idée', title: 'Ajouter une sous-idée à l’idée sélectionnée', icon: Plus, iconClass: 'text-indigo-600', hint: 'Tab', group: 'create', run: addChild },
    { id: 'sibling', label: 'Même niveau', title: 'Ajouter une idée au même niveau', icon: CornerDownRight, iconClass: 'text-amber-600', hint: 'Entrée', group: 'create', run: addSibling },
    {
      id: 'move-up',
      label: 'Monter',
      title: 'Placer l’idée avant sa sœur (vers le haut)',
      icon: ArrowUp,
      group: 'tools',
      run: () => { const s = useMindmapStore(); s.moveNodeBy(s.selection[0], -1) },
      disabled: () => { const s = useMindmapStore(); return s.selection.length !== 1 || !s.canMove(s.selection[0], -1) },
    },
    {
      id: 'move-down',
      label: 'Descendre',
      title: 'Placer l’idée après sa sœur (vers le bas)',
      icon: ArrowDown,
      group: 'tools',
      run: () => { const s = useMindmapStore(); s.moveNodeBy(s.selection[0], 1) },
      disabled: () => { const s = useMindmapStore(); return s.selection.length !== 1 || !s.canMove(s.selection[0], 1) },
    },
    {
      id: 'text',
      label: 'Texte',
      title: 'Saisir la carte en texte',
      icon: TextCursorInput,
      group: 'create',
      run: () => { const s = useMindmapStore(); s.showTextPanel = !s.showTextPanel },
      pressed: () => useMindmapStore().showTextPanel,
    },
    { id: 'fit', label: 'Recadrer', title: 'Afficher toute la carte', icon: Maximize2, run: () => void useVueFlow('mindmap').fitView({ padding: 0.2, duration: 300 }) },
    {
      id: 'reset',
      label: 'Réinitialiser',
      icon: RotateCcw,
      group: 'danger',
      run: ({ doc }) => { if (confirm('Effacer toute la carte ? (Ctrl+Z pour annuler)')) doc.reset() },
    },
  ],

  // La carte sert ensuite ailleurs : une liste Markdown pour la documentation, un plan OPML pour les autres outils de cartes mentales.
  headerActions: [
    { id: 'markdown', label: 'Markdown', title: 'Exporter la carte en liste Markdown', icon: FileText, run: () => downloadBlob(mindmapToMarkdown(useMindmapStore().schema) + '\n', 'text/markdown', 'carte-mentale.md') },
    { id: 'opml', label: 'OPML', title: 'Exporter un plan OPML, lisible par la plupart des outils de cartes mentales', icon: FileCode2, primary: true, run: () => downloadBlob(mindmapToOpml(useMindmapStore().schema), 'text/x-opml', 'carte-mentale.opml') },
  ],

  shortcuts: [
    { key: 'tab', label: 'Ajouter une sous-idée', run: addChild },
    { key: 'enter', label: 'Ajouter une idée au même niveau', run: addSibling },
    { key: ' ', keyLabel: 'Espace', label: 'Replier / déplier la branche', run: toggleCollapse },
  ],
}
