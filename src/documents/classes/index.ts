import { computed, toRef, type Ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { Boxes, ClipboardCopy, FileCode2, FileText, Maximize2, RotateCcw, SlidersHorizontal, Spline, SquarePlus, TextCursorInput } from 'lucide-vue-next'
import type { ActionContext, DocumentApi, DocumentType } from '../../core/documentType'
import { downloadBlob } from '../../composables/useFileIO'
import { CLASS_EXAMPLES, useClassStore } from './classStore'
import { classesToMermaid } from './mermaid'
import { classesToPlantUml } from './plantuml'
import type { ClassDocument } from './model'
import ClassCanvas from './ClassCanvas.vue'
import ClassTextPanel from './ClassTextPanel.vue'
import EditClassModal from './EditClassModal.vue'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function useClassDocument(): DocumentApi<ClassDocument> {
  const store = useClassStore()
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
const addClass = () => void useClassStore().addClass()
const addRelation = () => void useClassStore().addRelation()

/** Supprime la sélection ; retirer une classe retire aussi ses relations, on prévient donc d'abord. */
function removeSelected() {
  const s = useClassStore()
  const used = s.selectedClasses.length ? s.usageOf(s.selectedClasses) : 0
  if (used && !confirm(`Supprimer cette (ces) classe(s) retire aussi ${used} relation(s). Continuer ? (Ctrl+Z pour annuler)`)) return
  s.removeSelection()
}
/** Entrée : modifie l'élément sélectionné. */
function editSelected() {
  const s = useClassStore()
  if (s.selection.length === 1) s.editing = s.selection[0]
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
const markdownBlock = (d: ClassDocument) => `\`\`\`mermaid\n${classesToMermaid(d)}\`\`\`\n`

export const classesDocument: DocumentType<ClassDocument> = {
  id: 'classes',
  label: 'Classes',
  tagline: 'Écrivez ou dessinez des classes UML, exportez en Mermaid.',
  icon: Boxes,
  fileName: 'classes',
  accepts: (raw) => isRecord(raw) && Array.isArray(raw.classes) && Array.isArray(raw.relations),

  appearance: [
    { key: 'entity', label: 'Classes', hint: 'Fond des classes et de leur en-tête' },
    { key: 'edge', label: 'Relations', hint: 'Traits, symboles et multiplicités' },
    { key: 'text', label: 'Écritures', hint: 'Noms, membres et textes du diagramme' },
  ],
  useDocument: useClassDocument,
  examples: CLASS_EXAMPLES.map(({ id, label, description }) => ({ id, label, description, category: 'modele' })),
  exampleGroups: [{ category: 'modele', title: 'Modèles de départ' }],

  views: [{ id: 'diagram', label: 'Diagramme', title: 'Diagramme de classes', flowId: 'class-diagram', Component: ClassCanvas, searchPlaceholder: 'Rechercher une classe ou une relation… (Ctrl+F)', editable: true }],

  panels: [{ id: 'text', side: 'left', Component: ClassTextPanel, width: 360, visible: () => useClassStore().showTextPanel }],

  modals: [{ id: 'edit', Component: EditClassModal, visible: () => !!useClassStore().editing, key: () => useClassStore().editing }],

  actions: [
    { id: 'class', label: 'Classe', title: 'Ajouter une classe, une interface ou une énumération', icon: SquarePlus, iconClass: 'text-indigo-600', hint: 'C', group: 'create', run: addClass },
    {
      id: 'relation',
      label: 'Relation',
      title: 'Ajouter une relation entre les classes sélectionnées (héritage s’il y en a deux)',
      icon: Spline,
      iconClass: 'text-emerald-600',
      hint: 'R',
      group: 'create',
      run: addRelation,
      disabled: () => useClassStore().doc.classes.length < 2,
    },
    {
      id: 'text',
      label: 'Texte',
      title: 'Saisir le diagramme en texte (syntaxe de Mermaid)',
      icon: TextCursorInput,
      group: 'tools',
      run: () => { const s = useClassStore(); s.showTextPanel = !s.showTextPanel },
      pressed: () => useClassStore().showTextPanel,
    },
    { id: 'settings', label: 'Réglages', title: 'Titre du diagramme', icon: SlidersHorizontal, compact: true, group: 'tools', run: () => { useClassStore().editing = 'doc' } },
    { id: 'fit', label: 'Recadrer', title: 'Afficher tout le diagramme', icon: Maximize2, compact: true, run: () => void useVueFlow('class-diagram').fitView({ padding: 0.28, duration: 300 }) },
    {
      id: 'reset',
      label: 'Réinitialiser',
      title: 'Effacer tout le diagramme',
      icon: RotateCcw,
      compact: true,
      group: 'danger',
      run: ({ doc }: ActionContext<ClassDocument>) => { if (confirm('Effacer tout le diagramme ? (Ctrl+Z pour annuler)')) doc.reset() },
    },
  ],

  // Le diagramme sert ensuite dans la documentation : Mermaid (README GitHub, GitLab, Notion) ou PlantUML.
  headerActions: [
    { id: 'mermaid', label: 'Mermaid', title: 'Exporter un diagramme Mermaid (.mmd) à coller dans un README GitHub ou GitLab', icon: FileCode2, primary: true, run: () => downloadBlob(classesToMermaid(useClassStore().schema), 'text/plain', 'classes.mmd') },
    { id: 'plantuml', label: 'PlantUML', title: 'Exporter un diagramme PlantUML (.puml)', icon: FileCode2, run: () => downloadBlob(classesToPlantUml(useClassStore().schema), 'text/plain', 'classes.puml') },
  ],

  fileActions: [
    { id: 'copy-mermaid', label: 'Copier le Mermaid', title: 'Copier le code Mermaid dans le presse-papiers', icon: ClipboardCopy, run: () => void copyText(classesToMermaid(useClassStore().schema), 'Le code Mermaid', 'classes.mmd') },
    { id: 'markdown', label: 'Bloc Markdown (README)', title: 'Exporter un fichier Markdown contenant le bloc ```mermaid', icon: FileText, run: () => downloadBlob(markdownBlock(useClassStore().schema), 'text/markdown', 'classes.md') },
  ],

  shortcuts: [
    { key: 'c', label: 'Ajouter une classe', run: addClass },
    { key: 'r', label: 'Ajouter une relation', run: addRelation },
    { key: 'enter', keyLabel: 'Entrée', label: 'Modifier l’élément sélectionné', run: editSelected },
    { key: 'delete', keyLabel: 'Suppr', label: 'Supprimer la sélection', run: removeSelected },
    { key: 'backspace', keyLabel: 'Retour arrière', label: 'Supprimer la sélection', run: removeSelected },
  ],
}
