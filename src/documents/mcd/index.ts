import { computed, toRef, type Ref } from 'vue'
import { Circle, Database, LayoutGrid, RotateCcw, Square, TextCursorInput, DatabaseZap, Code2 } from 'lucide-vue-next'
import type { DocumentApi, DocumentType } from '../../core/documentType'
import { EXAMPLES, useSchemaStore } from '../../stores/schemaStore'
import { useAutoLayout } from '../../composables/useAutoLayout'
import type { MeriseSchema } from '../../types/schema'
import FlowCanvas from '../../components/canvas/FlowCanvas.vue'
import MldDiagram from '../../components/canvas/MldDiagram.vue'
import DerivedDiagram from '../../components/canvas/DerivedDiagram.vue'
import TextPanel from '../../components/panels/TextPanel.vue'
import LintPanel from '../../components/panels/LintPanel.vue'
import MldPanel from '../../components/panels/MldPanel.vue'
import EditEntityModal from '../../components/modals/EditEntityModal.vue'
import EditRelationModal from '../../components/modals/EditRelationModal.vue'
import SqlExportModal from '../../components/panels/SqlExportModal.vue'
import SqlImportModal from '../../components/panels/SqlImportModal.vue'
import { mcdSearchIndex } from './searchIndex'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function useMcdDocument(): DocumentApi<MeriseSchema> {
  const store = useSchemaStore()
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
    selectAll: () => (store.selection = [...store.entities, ...store.relations].map((n) => n.id)),
    copy: () => void store.copyNodes(store.selection),
    paste: () => void store.paste(),
    duplicate: () => store.duplicateNodes(store.selection),
    flash: store.flash,
    searchIndex: (viewId) => mcdSearchIndex(store, viewId),
  }
}

export const mcdDocument: DocumentType<MeriseSchema> = {
  id: 'mcd',
  label: 'Base de données',
  tagline: 'Concevez vos MCD, exportez vos MLD en un clic.',
  icon: Database,
  fileName: 'mcdraw',
  accepts: (raw) => isRecord(raw) && Array.isArray(raw.entities) && Array.isArray(raw.relations) && Array.isArray(raw.links),

  appearance: [
    { key: 'entity', label: 'Entités', hint: 'En-tête des entités, tables et classes' },
    { key: 'relation', label: 'Associations', hint: 'Fond des associations' },
    { key: 'edge', label: 'Liens', hint: 'Pattes et traits de liaison' },
    { key: 'text', label: 'Écritures', hint: 'Noms, étiquettes et textes du diagramme' },
  ],
  useDocument: useMcdDocument,
  examples: EXAMPLES.map(({ id, label, description, category }) => ({ id, label, description, category })),
  exampleGroups: [
    { category: 'modele', title: 'Modèles de départ' },
    { category: 'exemple', title: 'Petits exemples' },
  ],

  views: [
    { id: 'mcd', label: 'MCD', title: 'Modèle conceptuel (édition)', flowId: 'mcdraw', Component: FlowCanvas, editable: true },
    { id: 'mld', label: 'MLD', title: 'Modèle logique : tables et clés étrangères', flowId: 'mld', Component: MldDiagram, searchPlaceholder: 'Rechercher une table, une colonne…', editable: false },
    { id: 'erd', label: 'ERD', title: 'Diagramme entité-relation (notation pattes de corbeau)', flowId: 'erd', Component: DerivedDiagram, props: { kind: 'erd' }, editable: false },
    { id: 'uml', label: 'UML', title: 'Diagramme de classes UML', flowId: 'uml', Component: DerivedDiagram, props: { kind: 'uml' }, editable: false },
  ],

  panels: [
    { id: 'text', side: 'left', Component: TextPanel, width: 340, visible: (view) => useSchemaStore().showTextPanel && view === 'mcd' },
    { id: 'lint', side: 'canvas', Component: LintPanel, visible: (view) => view === 'mcd' },
    { id: 'mld', side: 'right', Component: MldPanel, width: 340, collapsible: { storageKey: 'mcdraw.mldOpen' }, visible: () => true },
  ],

  modals: [
    { id: 'entity', Component: EditEntityModal, visible: () => !!useSchemaStore().editingEntityId, key: () => useSchemaStore().editingEntityId },
    { id: 'relation', Component: EditRelationModal, visible: () => !!useSchemaStore().editingRelationId, key: () => useSchemaStore().editingRelationId },
    { id: 'sql-export', Component: SqlExportModal, visible: () => useSchemaStore().showSqlModal },
    { id: 'sql-import', Component: SqlImportModal, visible: () => useSchemaStore().showSqlImportModal },
  ],

  actions: [
    { id: 'entity', label: 'Entité', icon: Square, iconClass: 'text-indigo-600', group: 'create', views: ['mcd'], run: ({ spawn }) => { const p = spawn(); useSchemaStore().addEntity(p.x, p.y) } },
    { id: 'relation', label: 'Association', icon: Circle, iconClass: 'text-amber-600', group: 'create', views: ['mcd'], run: ({ spawn }) => { const p = spawn(); useSchemaStore().addRelation(p.x, p.y) } },
    {
      id: 'text',
      label: 'Texte',
      title: 'Saisir le MCD en texte',
      icon: TextCursorInput,
      group: 'create',
      views: ['mcd'],
      run: () => { const s = useSchemaStore(); s.showTextPanel = !s.showTextPanel },
      pressed: () => useSchemaStore().showTextPanel,
    },
    {
      id: 'layout',
      label: 'Organiser',
      title: 'Organiser automatiquement',
      icon: LayoutGrid,
      run: ({ viewId }) => (viewId === 'mcd' ? useAutoLayout().layout() : void useSchemaStore().mldRelayout++),
    },
    {
      id: 'reset',
      label: 'Réinitialiser',
      icon: RotateCcw,
      group: 'danger',
      views: ['mcd'],
      run: ({ doc }) => { if (confirm('Effacer tout le MCD ? (Ctrl+Z pour annuler)')) doc.reset() },
    },
  ],

  headerActions: [
    { id: 'sql-import', label: 'Importer SQL', title: 'Reconstruire un MCD à partir de CREATE TABLE', icon: DatabaseZap, run: () => { useSchemaStore().showSqlImportModal = true } },
    { id: 'sql-export', label: 'Exporter SQL', icon: Code2, primary: true, run: () => { useSchemaStore().showSqlModal = true } },
  ],

  shortcuts: [
    { key: 'n', label: 'Ajouter une entité', run: ({ spawn }) => { const p = spawn(); useSchemaStore().addEntity(p.x, p.y) } },
    { key: 'a', label: 'Ajouter une association', run: ({ spawn }) => { const p = spawn(); useSchemaStore().addRelation(p.x, p.y) } },
  ],
}
