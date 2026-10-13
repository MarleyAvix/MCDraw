import { computed, toRef, type Ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { ArrowDown, ArrowUp, Braces, Code, Database, FileCode, FileJson, FileText, FileUp, FolderPlus, Info, Maximize2, Plus, RotateCcw, Server, Terminal, TextCursorInput, Webhook } from 'lucide-vue-next'
import { getDocumentType, type ActionContext, type DocumentApi, type DocumentType } from '../../core/documentType'
import { downloadBlob } from '../../composables/useFileIO'
import type { MeriseSchema } from '../../types/schema'
import { API_EXAMPLES, useApiStore } from './apiStore'
import { apiFromMcd } from './fromMcd'
import { apiToHttpFile } from './httpFile'
import { apiToMarkdown } from './markdown'
import { openApiToJson, openApiToYaml } from './openapi'
import { openApiToApi, parseOpenApiSource } from './importOpenApi'
import { apiToTypeScript } from './typescript'
import { apiToAspNet } from './aspnet'
import type { ApiDocument } from './model'
import { ROOT_PATH } from './pathTree'
import ApiRoutesCanvas from './ApiRoutesCanvas.vue'
import ApiSchemasCanvas from './ApiSchemasCanvas.vue'
import ApiTextPanel from './ApiTextPanel.vue'
import ApiLintPanel from './ApiLintPanel.vue'
import EditEndpointModal from './EditEndpointModal.vue'
import EditResourceModal from './EditResourceModal.vue'
import EditInfoModal from './EditInfoModal.vue'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function useApiDocument(): DocumentApi<ApiDocument> {
  const store = useApiStore()
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
    searchIndex: (viewId) =>
      viewId === 'schemas'
        ? store.resources.map((r) => ({ key: r.id, nodeId: r.id, label: r.name, context: `${r.fields.length} champ${r.fields.length > 1 ? 's' : ''}`, kind: 'resource' as const }))
        : store.endpoints.map((e) => ({ key: e.id, nodeId: e.path, label: `${e.method} ${e.path}`, context: e.summary ?? 'Route', kind: 'route' as const })),
  }
}

/** Chemin de la sélection, ou la racine. */
const selectedPath = (s: ReturnType<typeof useApiStore>) => s.selection.find((p) => s.tree.some((n) => n.id === p)) ?? ROOT_PATH

/** « N » : un sous-chemin sous le chemin sélectionné dans la vue des routes, un schéma dans la vue des schémas. */
function addNew({ viewId }: ActionContext) {
  const s = useApiStore()
  if (viewId === 'schemas') s.addResource()
  else s.addSubPath(selectedPath(s))
}
const addMethod = () => {
  const s = useApiStore()
  s.addEndpoint(selectedPath(s))
}
const addSchema = () => {
  const s = useApiStore()
  s.view = 'schemas'
  s.addResource()
}

/** Remplace l'API par celle que déduit le MCD ouvert (annulable avec Ctrl+Z). */
function generateFromMcd() {
  const s = useApiStore()
  const mcd = getDocumentType('mcd')?.useDocument().schema.value as MeriseSchema | undefined
  if (!mcd || !isRecord(mcd) || !mcd.entities?.length) return void alert('Le diagramme « Base de données » est vide : dessinez d’abord des entités.')
  if (s.endpoints.length && !confirm('Remplacer l’API actuelle par celle déduite du MCD ? (Ctrl+Z pour annuler)')) return
  const { api, notes } = apiFromMcd(mcd, () => Math.random().toString(36).slice(2, 10))
  s.load({ ...api, info: { ...api.info, ...(s.doc.info.title ? { title: s.doc.info.title } : {}) } })
  s.view = 'routes'
  if (notes.length) alert(`API générée. À noter :\n\n- ${notes.join('\n- ')}`)
}

/** Choisit un fichier OpenAPI (JSON ou YAML) et remplace l'API par son contenu (annulable avec Ctrl+Z). */
function importOpenApi() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.yaml,.yml,application/json,application/yaml,text/yaml' })
  input.hidden = true
  document.body.append(input)
  input.addEventListener('cancel', () => input.remove(), { once: true })
  input.addEventListener(
    'change',
    async () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      try {
        const { api, notes } = openApiToApi(await parseOpenApiSource(await file.text()), () => Math.random().toString(36).slice(2, 10))
        const s = useApiStore()
        if (s.endpoints.length && !confirm('Remplacer l’API actuelle par le contenu de ce fichier OpenAPI ? (Ctrl+Z pour annuler)')) return
        s.load(api)
        s.view = 'routes'
        setTimeout(() => useVueFlow('api-routes').fitView({ padding: 0.2 }), 50)
        if (notes.length) alert(`Fichier importé. À noter :\n\n- ${notes.join('\n- ')}`)
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Impossible de lire ce fichier OpenAPI.')
      }
    },
    { once: true },
  )
  input.click()
}

export const apiDocument: DocumentType<ApiDocument> = {
  id: 'api',
  label: 'API REST',
  tagline: 'Décrivez vos routes, exportez de l’OpenAPI.',
  icon: Webhook,
  fileName: 'api',
  accepts: (raw) => isRecord(raw) && Array.isArray(raw.endpoints),

  appearance: [
    { key: 'entity', label: 'Routes et schémas', hint: 'En-tête des routes, des chemins et des schémas' },
    { key: 'edge', label: 'Liens', hint: 'Traits entre les chemins et les schémas' },
  ],
  useDocument: useApiDocument,
  examples: API_EXAMPLES.map(({ id, label, description }) => ({ id, label, description, category: 'modele' })),
  exampleGroups: [{ category: 'modele', title: 'Modèles de départ' }],

  views: [
    { id: 'routes', label: 'Routes', title: 'Arbre des routes', flowId: 'api-routes', Component: ApiRoutesCanvas, searchPlaceholder: 'Rechercher une route… (Ctrl+F)', editable: true },
    { id: 'schemas', label: 'Schémas', title: 'Schémas des objets échangés', flowId: 'api-schemas', Component: ApiSchemasCanvas, searchPlaceholder: 'Rechercher un schéma… (Ctrl+F)', editable: true },
  ],

  panels: [
    { id: 'text', side: 'left', Component: ApiTextPanel, width: 360, visible: () => useApiStore().showTextPanel },
    { id: 'lint', side: 'canvas', Component: ApiLintPanel, visible: () => true },
  ],

  modals: [
    { id: 'endpoint', Component: EditEndpointModal, visible: () => !!useApiStore().editingEndpointId, key: () => useApiStore().editingEndpointId },
    { id: 'resource', Component: EditResourceModal, visible: () => !!useApiStore().editingResourceId, key: () => useApiStore().editingResourceId },
    { id: 'info', Component: EditInfoModal, visible: () => useApiStore().showInfoModal },
  ],

  actions: [
    { id: 'subpath', label: 'Chemin', title: 'Ajouter un sous-chemin sous le chemin sélectionné', icon: FolderPlus, iconClass: 'text-indigo-600', hint: 'N', group: 'create', views: ['routes'], run: addNew },
    { id: 'method', label: 'Méthode', title: 'Ajouter une route (GET, POST…) sur le chemin sélectionné', icon: Plus, iconClass: 'text-emerald-600', hint: 'M', group: 'create', views: ['routes'], run: addMethod },
    {
      id: 'move-up',
      label: 'Monter',
      title: 'Placer le chemin avant son voisin (vers le haut)',
      icon: ArrowUp,
      compact: true,
      group: 'tools',
      views: ['routes'],
      run: () => { const s = useApiStore(); s.movePathBy(selectedPath(s), -1) },
      disabled: () => { const s = useApiStore(); return s.selection.length !== 1 || !s.canMovePath(s.selection[0], -1) },
    },
    {
      id: 'move-down',
      label: 'Descendre',
      title: 'Placer le chemin après son voisin (vers le bas)',
      icon: ArrowDown,
      compact: true,
      group: 'tools',
      views: ['routes'],
      run: () => { const s = useApiStore(); s.movePathBy(selectedPath(s), 1) },
      disabled: () => { const s = useApiStore(); return s.selection.length !== 1 || !s.canMovePath(s.selection[0], 1) },
    },
    { id: 'schema', label: 'Schéma', title: 'Ajouter un schéma (objet échangé par l’API)', icon: Braces, iconClass: 'text-amber-600', hint: 'R', group: 'create', run: addSchema },
    {
      id: 'text',
      label: 'Texte',
      title: 'Saisir l’API en texte',
      icon: TextCursorInput,
      group: 'create',
      run: () => { const s = useApiStore(); s.showTextPanel = !s.showTextPanel },
      pressed: () => useApiStore().showTextPanel,
    },
    { id: 'mcd', label: 'Depuis le MCD', title: 'Générer l’API (CRUD, relations) à partir du diagramme « Base de données »', icon: Database, iconClass: 'text-sky-600', group: 'tools', run: generateFromMcd },
    { id: 'info', label: 'Infos', compact: true, title: 'Titre, version, serveur et authentification', icon: Info, group: 'tools', run: () => { useApiStore().showInfoModal = true } },
    { id: 'fit', label: 'Recadrer', compact: true, title: 'Afficher toute la vue', icon: Maximize2, run: ({ viewId }) => void useVueFlow(viewId === 'schemas' ? 'api-schemas' : 'api-routes').fitView({ padding: 0.2, duration: 300 }) },
    {
      id: 'reset',
      label: 'Réinitialiser',
      title: 'Effacer toute l’API',
      icon: RotateCcw,
      compact: true,
      group: 'danger',
      run: ({ doc }) => { if (confirm('Effacer toute l’API ? (Ctrl+Z pour annuler)')) doc.reset() },
    },
  ],

  // L'API décrite sert ensuite ailleurs : OpenAPI pour Swagger / Postman / générateurs (bouton principal) ; le reste dans « Fichier ».
  headerActions: [
    { id: 'openapi', label: 'OpenAPI', title: 'Exporter un OpenAPI 3.1 en YAML (Swagger, Postman, générateurs de clients)', icon: FileCode, primary: true, run: () => downloadBlob(openApiToYaml(useApiStore().schema), 'application/yaml', 'openapi.yaml') },
  ],

  fileActions: [
    { id: 'import', label: 'Importer un OpenAPI…', title: 'Remplacer l’API par un fichier OpenAPI 3 existant (JSON ou YAML)', icon: FileUp, run: importOpenApi },
    { id: 'json', label: 'OpenAPI en JSON', title: 'Exporter un OpenAPI 3.1 en JSON', icon: FileJson, run: () => downloadBlob(openApiToJson(useApiStore().schema), 'application/json', 'openapi.json') },
    { id: 'typescript', label: 'Client TypeScript', title: 'Exporter les types et un client fetch typé (api-client.ts)', icon: Code, run: () => downloadBlob(apiToTypeScript(useApiStore().schema), 'text/plain', 'api-client.ts') },
    { id: 'aspnet', label: 'Routes ASP.NET Core (C#)', title: 'Exporter les schémas en records et les routes en endpoints Minimal API à compléter (ApiEndpoints.cs)', icon: Server, run: () => downloadBlob(apiToAspNet(useApiStore().schema), 'text/plain', 'ApiEndpoints.cs') },
    { id: 'http', label: 'Requêtes .http', title: 'Exporter un fichier de requêtes .http (VS Code REST Client, JetBrains)', icon: Terminal, run: () => downloadBlob(apiToHttpFile(useApiStore().schema), 'text/plain', 'requests.http') },
    { id: 'markdown', label: 'Documentation Markdown', title: 'Exporter la documentation en Markdown', icon: FileText, run: () => downloadBlob(apiToMarkdown(useApiStore().schema), 'text/markdown', 'api.md') },
  ],

  shortcuts: [
    { key: 'n', label: 'Ajouter un sous-chemin (vue Routes) ou un schéma (vue Schémas)', run: addNew },
    { key: 'm', label: 'Ajouter une méthode sur le chemin sélectionné', run: addMethod },
    { key: 'r', label: 'Ajouter un schéma', run: addSchema },
  ],
}
