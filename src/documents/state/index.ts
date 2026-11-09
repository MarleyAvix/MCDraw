import { computed, toRef, type Ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { ArrowDown, ArrowRight, ArrowUp, CircleDot, ClipboardCopy, Diamond, FileCode2, FileDown, FileText, Layers, Maximize2, Play, RotateCcw, SlidersHorizontal, Square, Table2, TextCursorInput } from 'lucide-vue-next'
import type { ActionContext, DocumentApi, DocumentType } from '../../core/documentType'
import { downloadBlob } from '../../composables/useFileIO'
import { STATE_EXAMPLES, useStateStore } from './stateStore'
import { stateToMermaid } from './mermaid'
import { stateToPlantUml } from './plantuml'
import { tableToCsv, tableToMarkdown, transitionTable } from './table'
import type { StateDocument } from './model'
import StateCanvas from './StateCanvas.vue'
import StateTextPanel from './StateTextPanel.vue'
import StatePanel from './StatePanel.vue'
import EditStateModal from './EditStateModal.vue'
import TransitionTableModal from './TransitionTableModal.vue'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function useStateDocument(): DocumentApi<StateDocument> {
  const store = useStateStore()
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
    selectAll: store.selectAll,
    copy: () => void store.copy(),
    paste: () => void store.paste(),
    duplicate: store.duplicate,
    flash: store.flash,
    searchIndex: () => store.searchIndex(),
  }
}

// --- Actions --------------------------------------------------------------------
const addState = () => void useStateStore().addState()
const addChoice = () => void useStateStore().addState('choice')
const addTransition = () => void useStateStore().addTransition()
const addComposite = () => void useStateStore().addComposite()

/** Supprime la sélection ; retirer un état retire aussi ses transitions (et ses états contenus), on prévient donc d'abord. */
function removeSelected() {
  const s = useStateStore()
  const names = s.selection.filter((k) => k.startsWith('s:')).map((k) => k.slice(2))
  const used = names.length ? s.usageOf(names) : 0
  if (used && !confirm(`Supprimer ce(s) état(s) retire aussi ${used} élément(s) (transitions, états contenus). Continuer ? (Ctrl+Z pour annuler)`)) return
  s.removeSelection()
}
/** Entrée : modifie l'élément sélectionné. */
function editSelected() {
  const s = useStateStore()
  if (s.selection.length === 1) s.editing = s.selection[0]
}
const toggleSim = () => {
  const s = useStateStore()
  if (s.sim.on) s.simStop()
  else s.simStart()
}

/** Copie un texte dans le presse-papiers et le confirme ; sinon, propose de le télécharger. */
async function copyText(text: string, what: string, fallbackName: string) {
  try {
    await navigator.clipboard.writeText(text)
    alert(`${what} copié dans le presse-papiers.`)
  } catch {
    downloadBlob(text, 'text/plain', fallbackName)
  }
}
const markdownBlock = (s: StateDocument) => `\`\`\`mermaid\n${stateToMermaid(s)}\`\`\`\n`

export const stateDocument: DocumentType<StateDocument> = {
  id: 'state',
  label: 'États',
  tagline: 'Dessinez un cycle de vie, simulez-le, exportez en Mermaid.',
  icon: CircleDot,
  fileName: 'states',
  accepts: (raw) => isRecord(raw) && Array.isArray(raw.states) && Array.isArray(raw.transitions),

  appearance: [
    { key: 'entity', label: 'États', hint: 'Fond des états et de leur en-tête' },
    { key: 'relation', label: 'Notes', hint: 'Fond des notes' },
    { key: 'edge', label: 'Transitions', hint: 'Flèches, point de départ et d’arrivée' },
    { key: 'text', label: 'Écritures', hint: 'Noms, étiquettes et textes du diagramme' },
  ],
  useDocument: useStateDocument,
  examples: STATE_EXAMPLES.map(({ id, label, description }) => ({ id, label, description, category: 'modele' })),
  exampleGroups: [{ category: 'modele', title: 'Modèles de départ' }],

  views: [{ id: 'diagram', label: 'Diagramme', title: 'Diagramme d’états', flowId: 'state-diagram', Component: StateCanvas, searchPlaceholder: 'Rechercher un état ou une transition… (Ctrl+F)', editable: true }],

  panels: [
    { id: 'text', side: 'left', Component: StateTextPanel, width: 360, visible: () => useStateStore().showTextPanel },
    { id: 'check', side: 'canvas', Component: StatePanel, visible: () => true },
  ],

  modals: [
    { id: 'edit', Component: EditStateModal, visible: () => !!useStateStore().editing, key: () => useStateStore().editing },
    { id: 'table', Component: TransitionTableModal, visible: () => useStateStore().showTable },
  ],

  actions: [
    { id: 'state', label: 'État', title: 'Ajouter un état (dans le composite s’il est sélectionné)', icon: Square, iconClass: 'text-indigo-600', hint: 'E', group: 'create', run: addState },
    { id: 'transition', label: 'Transition', title: 'Ajouter une transition depuis l’état sélectionné', icon: ArrowRight, iconClass: 'text-emerald-600', hint: 'T', group: 'create', run: addTransition },
    { id: 'choice', label: 'Choix', title: 'Ajouter un choix (losange) : plusieurs sorties selon des gardes', icon: Diamond, iconClass: 'text-amber-600', hint: 'C', compact: true, group: 'create', run: addChoice },
    { id: 'composite', label: 'Composite', title: 'Ajouter un état composite ; enveloppe les états sélectionnés', icon: Layers, iconClass: 'text-sky-600', hint: 'G', compact: true, group: 'create', run: addComposite },
    {
      id: 'move-up',
      label: 'Monter',
      title: 'Placer l’état avant son voisin',
      icon: ArrowUp,
      compact: true,
      group: 'tools',
      run: () => { const s = useStateStore(); if (s.selectedState) s.moveStateBy(s.selectedState, -1) },
      disabled: () => { const s = useStateStore(); return !s.canMoveState(s.selectedState, -1) },
    },
    {
      id: 'move-down',
      label: 'Descendre',
      title: 'Placer l’état après son voisin',
      icon: ArrowDown,
      compact: true,
      group: 'tools',
      run: () => { const s = useStateStore(); if (s.selectedState) s.moveStateBy(s.selectedState, 1) },
      disabled: () => { const s = useStateStore(); return !s.canMoveState(s.selectedState, 1) },
    },
    {
      id: 'text',
      label: 'Texte',
      title: 'Saisir le diagramme en texte (syntaxe proche de Mermaid)',
      icon: TextCursorInput,
      group: 'tools',
      run: () => { const s = useStateStore(); s.showTextPanel = !s.showTextPanel },
      pressed: () => useStateStore().showTextPanel,
    },
    { id: 'simulate', label: 'Simuler', title: 'Faire avancer l’état courant de transition en transition', icon: Play, iconClass: 'text-emerald-600', group: 'tools', run: toggleSim, pressed: () => useStateStore().sim.on },
    { id: 'table', label: 'Tableau', title: 'Tableau des transitions : états × événements', icon: Table2, compact: true, group: 'tools', run: () => { useStateStore().showTable = true } },
    { id: 'settings', label: 'Réglages', title: 'Titre et sens de lecture', icon: SlidersHorizontal, compact: true, group: 'tools', run: () => { useStateStore().editing = 'doc' } },
    { id: 'fit', label: 'Recadrer', title: 'Afficher tout le diagramme', icon: Maximize2, compact: true, run: () => void useVueFlow('state-diagram').fitView({ padding: 0.15, duration: 300 }) },
    {
      id: 'reset',
      label: 'Réinitialiser',
      title: 'Effacer tout le diagramme',
      icon: RotateCcw,
      compact: true,
      group: 'danger',
      run: ({ doc }: ActionContext<StateDocument>) => { if (confirm('Effacer tout le diagramme ? (Ctrl+Z pour annuler)')) doc.reset() },
    },
  ],

  // Le diagramme sert ensuite dans la documentation : Mermaid (README GitHub, GitLab, Notion) ou PlantUML.
  headerActions: [
    { id: 'mermaid', label: 'Mermaid', title: 'Exporter un diagramme Mermaid (.mmd) à coller dans un README GitHub ou GitLab', icon: FileCode2, primary: true, run: () => downloadBlob(stateToMermaid(useStateStore().schema), 'text/plain', 'states.mmd') },
    { id: 'plantuml', label: 'PlantUML', title: 'Exporter un diagramme PlantUML (.puml)', icon: FileCode2, run: () => downloadBlob(stateToPlantUml(useStateStore().schema), 'text/plain', 'states.puml') },
  ],

  fileActions: [
    { id: 'copy-mermaid', label: 'Copier le Mermaid', title: 'Copier le code Mermaid dans le presse-papiers', icon: ClipboardCopy, run: () => void copyText(stateToMermaid(useStateStore().schema), 'Le code Mermaid', 'states.mmd') },
    { id: 'markdown', label: 'Bloc Markdown (README)', title: 'Exporter un fichier Markdown contenant le bloc ```mermaid', icon: FileText, run: () => downloadBlob(markdownBlock(useStateStore().schema), 'text/markdown', 'states.md') },
    { id: 'table-md', label: 'Tableau des transitions (Markdown)', title: 'Exporter le tableau états × événements en Markdown', icon: FileText, run: () => downloadBlob(tableToMarkdown(transitionTable(useStateStore().schema)), 'text/markdown', 'transitions.md') },
    { id: 'table-csv', label: 'Tableau des transitions (CSV)', title: 'Exporter le tableau états × événements en CSV', icon: FileDown, run: () => downloadBlob(tableToCsv(transitionTable(useStateStore().schema)), 'text/csv', 'transitions.csv') },
  ],

  shortcuts: [
    { key: 'e', label: 'Ajouter un état', run: addState },
    { key: 't', label: 'Ajouter une transition', run: addTransition },
    { key: 'c', label: 'Ajouter un choix', run: addChoice },
    { key: 'g', label: 'Ajouter un composite (enveloppe la sélection)', run: addComposite },
    { key: 'enter', keyLabel: 'Entrée', label: 'Modifier l’élément sélectionné', run: editSelected },
    { key: 'delete', keyLabel: 'Suppr', label: 'Supprimer la sélection', run: removeSelected },
    { key: 'backspace', keyLabel: 'Retour arrière', label: 'Supprimer la sélection', run: removeSelected },
  ],
}
