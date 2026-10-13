import { computed, toRef, type Ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  ClipboardCopy,
  FileCode2,
  FileText,
  Maximize2,
  RotateCcw,
  SlidersHorizontal,
  SquareDashed,
  StickyNote,
  TextCursorInput,
  UserPlus,
  Webhook,
  Workflow,
} from 'lucide-vue-next'
import type { ActionContext, DocumentApi, DocumentType } from '../../core/documentType'
import { downloadBlob } from '../../composables/useFileIO'
import { SEQUENCE_EXAMPLES, useSequenceStore } from './sequenceStore'
import { seqToMermaid } from './mermaid'
import { seqToPlantUml } from './plantuml'
import type { SeqDocument } from './model'
import SequenceCanvas from './SequenceCanvas.vue'
import SequenceTextPanel from './SequenceTextPanel.vue'
import EditSequenceModal from './EditSequenceModal.vue'
import FromApiModal from './FromApiModal.vue'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function useSequenceDocument(): DocumentApi<SeqDocument> {
  const store = useSequenceStore()
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
const addParticipant = () => void useSequenceStore().addParticipant()
const addMessage = () => void useSequenceStore().addMessage()
const addNote = () => void useSequenceStore().addNote()
const addBlock = () => void useSequenceStore().addBlock()

/** Supprime la sélection ; retirer un participant retire aussi ses messages, on prévient donc d'abord. */
function removeSelected() {
  const s = useSequenceStore()
  const names = s.selection.filter((k) => k.startsWith('p:')).map((k) => k.slice(2))
  const used = names.length ? s.usageOf(names) : 0
  if (used && !confirm(`Supprimer ce(s) participant(s) retire aussi ${used} message(s) ou note(s). Continuer ? (Ctrl+Z pour annuler)`)) return
  s.removeSelection()
}
/** Entrée : modifie l'élément sélectionné. */
function editSelected() {
  const s = useSequenceStore()
  if (s.selection.length === 1) s.editing = s.selection[0]
}

const oneItem = (s: ReturnType<typeof useSequenceStore>) => (s.selection.length === 1 && !s.selection[0].startsWith('p:') ? s.selection[0] : undefined)
const oneParticipant = (s: ReturnType<typeof useSequenceStore>) => (s.selection.length === 1 ? s.selectedParticipant : undefined)

/** Copie un texte dans le presse-papiers et le confirme ; sinon, propose de le télécharger. */
async function copyText(text: string, what: string, fallbackName: string) {
  try {
    await navigator.clipboard.writeText(text)
    alert(`${what} copié dans le presse-papiers.`)
  } catch {
    downloadBlob(text, 'text/plain', fallbackName)
  }
}
const markdownBlock = (s: SeqDocument) => `\`\`\`mermaid\n${seqToMermaid(s)}\`\`\`\n`

export const sequenceDocument: DocumentType<SeqDocument> = {
  id: 'sequence',
  label: 'Séquence',
  tagline: 'Écrivez ou dessinez des échanges, exportez en Mermaid.',
  icon: Workflow,
  fileName: 'sequence',
  accepts: (raw) => isRecord(raw) && Array.isArray(raw.participants) && Array.isArray(raw.items),

  appearance: [
    { key: 'entity', label: 'Participants', hint: 'Fond des boîtes des participants' },
    { key: 'relation', label: 'Notes', hint: 'Fond des notes' },
    { key: 'edge', label: 'Flèches', hint: 'Messages, lignes de vie et numéros' },
    { key: 'text', label: 'Écritures', hint: 'Noms, étiquettes et textes du diagramme' },
  ],
  useDocument: useSequenceDocument,
  examples: SEQUENCE_EXAMPLES.map(({ id, label, description }) => ({ id, label, description, category: 'modele' })),
  exampleGroups: [{ category: 'modele', title: 'Modèles de départ' }],

  views: [{ id: 'diagram', label: 'Diagramme', title: 'Diagramme de séquence', flowId: 'seq-diagram', Component: SequenceCanvas, searchPlaceholder: 'Rechercher un message ou un participant… (Ctrl+F)', editable: true }],

  panels: [{ id: 'text', side: 'left', Component: SequenceTextPanel, width: 360, visible: () => useSequenceStore().showTextPanel }],

  modals: [
    { id: 'edit', Component: EditSequenceModal, visible: () => !!useSequenceStore().editing, key: () => useSequenceStore().editing },
    { id: 'from-api', Component: FromApiModal, visible: () => useSequenceStore().showApiModal },
  ],

  actions: [
    { id: 'participant', label: 'Participant', title: 'Ajouter un participant (acteur, service, base de données)', icon: UserPlus, iconClass: 'text-indigo-600', hint: 'P', group: 'create', run: addParticipant },
    { id: 'message', label: 'Message', title: 'Ajouter un message après l’élément sélectionné (dans le bloc s’il est sélectionné)', icon: ArrowRightLeft, iconClass: 'text-emerald-600', hint: 'M', group: 'create', run: addMessage },
    { id: 'note', label: 'Note', title: 'Ajouter une note', icon: StickyNote, iconClass: 'text-amber-600', hint: 'N', group: 'create', run: addNote },
    { id: 'block', label: 'Bloc', title: 'Ajouter un bloc (alt, opt, loop, par, critical, break) ; enveloppe les éléments sélectionnés', icon: SquareDashed, iconClass: 'text-sky-600', hint: 'B', group: 'create', run: addBlock },
    {
      id: 'move-up',
      label: 'Monter',
      title: 'Placer l’élément avant son voisin (vers le haut)',
      icon: ArrowUp,
      compact: true,
      group: 'tools',
      run: () => { const s = useSequenceStore(); const id = oneItem(s); if (id) s.moveItemBy(id, -1) },
      disabled: () => { const s = useSequenceStore(); return !s.canMoveItem(oneItem(s), -1) },
    },
    {
      id: 'move-down',
      label: 'Descendre',
      title: 'Placer l’élément après son voisin (vers le bas)',
      icon: ArrowDown,
      compact: true,
      group: 'tools',
      run: () => { const s = useSequenceStore(); const id = oneItem(s); if (id) s.moveItemBy(id, 1) },
      disabled: () => { const s = useSequenceStore(); return !s.canMoveItem(oneItem(s), 1) },
    },
    {
      id: 'move-left',
      label: 'À gauche',
      title: 'Décaler le participant vers la gauche',
      icon: ArrowLeft,
      compact: true,
      group: 'tools',
      run: () => { const s = useSequenceStore(); const n = oneParticipant(s); if (n) s.moveParticipantBy(n, -1) },
      disabled: () => { const s = useSequenceStore(); return !s.canMoveParticipant(oneParticipant(s), -1) },
    },
    {
      id: 'move-right',
      label: 'À droite',
      title: 'Décaler le participant vers la droite',
      icon: ArrowRight,
      compact: true,
      group: 'tools',
      run: () => { const s = useSequenceStore(); const n = oneParticipant(s); if (n) s.moveParticipantBy(n, 1) },
      disabled: () => { const s = useSequenceStore(); return !s.canMoveParticipant(oneParticipant(s), 1) },
    },
    {
      id: 'text',
      label: 'Texte',
      title: 'Saisir le diagramme en texte (syntaxe proche de Mermaid)',
      icon: TextCursorInput,
      group: 'tools',
      run: () => { const s = useSequenceStore(); s.showTextPanel = !s.showTextPanel },
      pressed: () => useSequenceStore().showTextPanel,
    },
    { id: 'from-api', label: 'Depuis l’API', title: 'Générer le diagramme d’une route décrite dans l’onglet « API REST »', icon: Webhook, iconClass: 'text-sky-600', compact: true, group: 'tools', run: () => { useSequenceStore().showApiModal = true } },
    { id: 'settings', label: 'Réglages', title: 'Titre et numérotation des messages', icon: SlidersHorizontal, compact: true, group: 'tools', run: () => { useSequenceStore().editing = 'doc' } },
    { id: 'fit', label: 'Recadrer', title: 'Afficher tout le diagramme', icon: Maximize2, compact: true, run: () => void useVueFlow('seq-diagram').fitView({ padding: 0.28, duration: 300 }) },
    {
      id: 'reset',
      label: 'Réinitialiser',
      title: 'Effacer tout le diagramme',
      icon: RotateCcw,
      compact: true,
      group: 'danger',
      run: ({ doc }: ActionContext<SeqDocument>) => { if (confirm('Effacer tout le diagramme ? (Ctrl+Z pour annuler)')) doc.reset() },
    },
  ],

  // Le diagramme sert ensuite dans la documentation : Mermaid (README GitHub, GitLab, Notion) ou PlantUML.
  headerActions: [
    { id: 'mermaid', label: 'Mermaid', title: 'Exporter un diagramme Mermaid (.mmd) à coller dans un README GitHub ou GitLab', icon: FileCode2, primary: true, run: () => downloadBlob(seqToMermaid(useSequenceStore().schema), 'text/plain', 'sequence.mmd') },
    { id: 'plantuml', label: 'PlantUML', title: 'Exporter un diagramme PlantUML (.puml)', icon: FileCode2, run: () => downloadBlob(seqToPlantUml(useSequenceStore().schema), 'text/plain', 'sequence.puml') },
  ],

  fileActions: [
    { id: 'copy-mermaid', label: 'Copier le Mermaid', title: 'Copier le code Mermaid dans le presse-papiers', icon: ClipboardCopy, run: () => void copyText(seqToMermaid(useSequenceStore().schema), 'Le code Mermaid', 'sequence.mmd') },
    { id: 'markdown', label: 'Bloc Markdown (README)', title: 'Exporter un fichier Markdown contenant le bloc ```mermaid', icon: FileText, run: () => downloadBlob(markdownBlock(useSequenceStore().schema), 'text/markdown', 'sequence.md') },
  ],

  shortcuts: [
    { key: 'p', label: 'Ajouter un participant', run: addParticipant },
    { key: 'm', label: 'Ajouter un message', run: addMessage },
    { key: 'n', label: 'Ajouter une note', run: addNote },
    { key: 'b', label: 'Ajouter un bloc (enveloppe la sélection)', run: addBlock },
    { key: 'enter', keyLabel: 'Entrée', label: 'Modifier l’élément sélectionné', run: editSelected },
    { key: 'delete', keyLabel: 'Suppr', label: 'Supprimer la sélection', run: removeSelected },
    { key: 'backspace', keyLabel: 'Retour arrière', label: 'Supprimer la sélection', run: removeSelected },
  ],
}
