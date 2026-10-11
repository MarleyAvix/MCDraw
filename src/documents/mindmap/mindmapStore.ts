import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Edge, Node } from '@vue-flow/core'
import { useHistory } from '../../composables/useHistory'
import { usePersistence } from '../../composables/usePersistence'
import { moveSibling } from '../../core/tree'
import { childrenOf, emptyMindmap, hiddenIds, layoutMindmap, parseMindmapText, sanitizeMindmap, subtreeIds, type MindNode, type MindmapSchema } from './engine'

const STORAGE_KEY = 'mcdraw:mindmap:v1'
const uid = () => Math.random().toString(36).slice(2, 10)

/** Taille d'une idée, pour la mise en page. */
export const NODE_W = 170
export const NODE_H = 40

/** Couleur de chaque branche (l'idée centrale garde une couleur sombre). */
export const BRANCH_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#8b5cf6']
export const branchColor = (branch: number) => (branch < 0 ? '#334155' : BRANCH_COLORS[branch % BRANCH_COLORS.length])

export interface MindmapExample {
  id: string
  label: string
  description: string
  text: string
}

export const MINDMAP_EXAMPLES: MindmapExample[] = [
  {
    id: 'architecture',
    label: 'Architecture d’une application web',
    description: 'Front, back, données, infrastructure et sécurité.',
    text: `Application web
  Front-end
    Framework -- Vue, React…
    Routage
    État global
    Design system
  Back-end
    API REST
    Authentification
    Tâches asynchrones
  Données
    Base relationnelle
    Cache
    Migrations
  Infrastructure
    Conteneurs
    Hébergement
    Monitoring
  Sécurité
    HTTPS
    Gestion des secrets
    Mises à jour des dépendances`,
  },
  {
    id: 'cicd',
    label: 'Pipeline CI/CD',
    description: 'Intégration, tests, build, déploiement et suivi.',
    text: `CI/CD
  Intégration
    Pull request
    Revue de code
    Lint et formatage
  Tests
    Unitaires
    Intégration
    Bout en bout
    Couverture -- seuil à définir
  Build
    Image Docker
    Cache des dépendances
    Artefacts
  Déploiement
    Staging
    Production
    Retour arrière
  Suivi
    Logs
    Alertes
    Métriques`,
  },
  {
    id: 'api',
    label: 'Concevoir une API REST',
    description: 'Ressources, authentification, erreurs, versions et documentation.',
    text: `API REST
  Ressources
    Nommage des routes
    Pagination
    Filtres et tri
  Authentification
    JWT
    OAuth 2
    Rôles et permissions
  Erreurs
    Codes HTTP
    Format des messages
  Évolution
    Versionnage
    Dépréciation
  Documentation
    OpenAPI
    Exemples de requêtes
  Qualité
    Tests de contrat
    Limitation de débit`,
  },
]

export const useMindmapStore = defineStore('mindmap', () => {
  const nodesList = ref<MindNode[]>([])
  const selection = ref<string[]>([])
  const editingNodeId = ref<string | null>(null)
  const showTextPanel = ref(typeof window !== 'undefined' && window.innerWidth >= 1024)
  const highlightId = ref<string | null>(null)
  const view = ref('map')
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let clipboard: MindNode[] = []

  const schema = computed<MindmapSchema>(() => ({ nodes: nodesList.value }))
  const byId = computed(() => new Map(nodesList.value.map((n) => [n.id, n])))

  // --- Mise en page : calculée à partir de la structure seule --------------------------------
  const layout = computed(() => layoutMindmap(nodesList.value, { w: NODE_W, h: NODE_H }, { x: 70, y: 14 }))
  const hidden = computed(() => hiddenIds(nodesList.value))
  const visible = computed(() => nodesList.value.filter((n) => !hidden.value.has(n.id)))

  const nodes = computed<Node[]>(() =>
    visible.value.map((n) => ({
      id: n.id,
      type: 'idea',
      position: layout.value.pos.get(n.id) ?? { x: 0, y: 0 },
      data: {
        node: n,
        side: layout.value.side.get(n.id) ?? 'center',
        color: branchColor(layout.value.branch.get(n.id) ?? -1),
        isRoot: !n.parentId || !byId.value.has(n.parentId),
        childCount: childrenOf(nodesList.value, n.id).length,
      },
      selected: selection.value.includes(n.id),
      draggable: false,
      connectable: false,
    })),
  )
  const edges = computed<Edge[]>(() =>
    visible.value
      .filter((n) => n.parentId && byId.value.has(n.parentId))
      .map((n) => {
        const left = layout.value.side.get(n.id) === 'left'
        return {
          id: `e:${n.id}`,
          source: n.parentId!,
          target: n.id,
          sourceHandle: left ? 'sl' : 'sr',
          targetHandle: left ? 'tr' : 'tl',
          type: 'default',
          style: { stroke: branchColor(layout.value.branch.get(n.id) ?? -1), strokeWidth: 2.5 },
          selectable: false,
          focusable: false,
        }
      }),
  )

  // --- Actions ---------------------------------------------------------------
  function flash(id: string) {
    clearTimeout(highlightTimer)
    // Une idée masquée par un repli est d'abord révélée.
    for (let p = byId.value.get(id)?.parentId; p; p = byId.value.get(p)?.parentId) {
      const a = byId.value.get(p)
      if (a?.collapsed) delete a.collapsed
    }
    highlightId.value = id
    highlightTimer = setTimeout(() => (highlightId.value = null), 2200)
  }

  /** Indice de la dernière idée du sous-arbre de `id` (les sous-arbres sont contigus dans l'ordre d'affichage, pas du tableau). */
  function lastIndexOfSubtree(id: string): number {
    const ids = subtreeIds(nodesList.value, id)
    let last = -1
    nodesList.value.forEach((n, i) => ids.has(n.id) && (last = i))
    return last
  }

  /** Ajoute une idée sous `parentId` (une idée centrale si absent), déplie la mère et sélectionne la nouvelle. */
  function addNode(parentId?: string, text = 'Nouvelle idée'): MindNode {
    const parent = parentId ? byId.value.get(parentId) : undefined
    const node: MindNode = { id: uid(), text, ...(parent ? { parentId } : {}) }
    if (parent?.collapsed) delete parent.collapsed
    const at = parent ? lastIndexOfSubtree(parent.id) + 1 : nodesList.value.length
    nodesList.value.splice(at, 0, node)
    selection.value = [node.id]
    return node
  }

  /** Nouvelle idée au même niveau, juste après celle-ci (et son sous-arbre). */
  function addSibling(id: string): MindNode {
    const parentId = byId.value.get(id)?.parentId
    const node: MindNode = { id: uid(), text: 'Nouvelle idée', ...(parentId && byId.value.has(parentId) ? { parentId } : {}) }
    nodesList.value.splice(lastIndexOfSubtree(id) + 1, 0, node)
    selection.value = [node.id]
    return node
  }

  function updateNode(id: string, patch: Partial<Pick<MindNode, 'text' | 'note'>>) {
    const n = byId.value.get(id)
    if (!n) return
    if (patch.text !== undefined) n.text = patch.text
    if (patch.note !== undefined) {
      const v = patch.note.trim()
      if (v) n.note = v
      else delete n.note
    }
  }

  function toggleCollapse(id: string) {
    const n = byId.value.get(id)
    if (!n || !childrenOf(nodesList.value, id).length) return
    if (n.collapsed) {
      delete n.collapsed
      return
    }
    n.collapsed = true
    // Une sélection cachée par le repli est ramenée sur l'idée repliée.
    const gone = subtreeIds(nodesList.value, id)
    gone.delete(id)
    if (selection.value.some((s) => gone.has(s))) selection.value = [id]
  }

  /** Décale l'idée d'un rang parmi ses sœurs (vers le haut : -1, vers le bas : +1). */
  function moveNodeBy(id: string, dir: -1 | 1): boolean {
    const next = moveSibling(nodesList.value, id, dir)
    if (next) nodesList.value = next
    return !!next
  }
  const canMove = (id: string | undefined, dir: -1 | 1) => !!id && !!moveSibling(nodesList.value, id, dir)

  /** Supprime les idées et tout ce qui est en dessous. */
  function removeNodes(ids: string[]) {
    const gone = new Set(ids.flatMap((id) => [...subtreeIds(nodesList.value, id)]))
    nodesList.value = nodesList.value.filter((n) => !gone.has(n.id))
    selection.value = selection.value.filter((id) => !gone.has(id))
    if (editingNodeId.value && gone.has(editingNodeId.value)) editingNodeId.value = null
  }

  /** Idées sélectionnées dont aucune ancêtre n'est elle-même sélectionnée (un sous-arbre n'est pris qu'une fois). */
  function topSelected(ids: string[]): string[] {
    const set = new Set(ids)
    const hasSelectedAncestor = (n: MindNode) => {
      for (let cur = n.parentId ? byId.value.get(n.parentId) : undefined, i = 0; cur && i < 1000; cur = cur.parentId ? byId.value.get(cur.parentId) : undefined, i++) {
        if (set.has(cur.id)) return true
      }
      return false
    }
    return nodesList.value.filter((n) => set.has(n.id) && !hasSelectedAncestor(n)).map((n) => n.id)
  }

  /** Copie les sous-arbres sélectionnés (dans l'ordre de l'arbre). */
  function copy(ids: string[]): boolean {
    const tops = topSelected(ids)
    if (!tops.length) return false
    const keep = new Set(tops.flatMap((id) => [...subtreeIds(nodesList.value, id)]))
    clipboard = nodesList.value.filter((n) => keep.has(n.id)).map((n) => ({ ...n }))
    return true
  }

  /** Colle sous `parentId` (une idée centrale si absent), avec de nouveaux identifiants. */
  function pasteUnder(parentId: string | undefined): boolean {
    if (!clipboard.length) return false
    const ids = new Set(clipboard.map((n) => n.id))
    const remap = new Map(clipboard.map((n) => [n.id, uid()]))
    const copies = clipboard.map((n) => {
      const { parentId: pp, ...rest } = n
      return { ...rest, id: remap.get(n.id)!, ...(pp && ids.has(pp) ? { parentId: remap.get(pp)! } : parentId ? { parentId } : {}) }
    })
    const parent = parentId ? byId.value.get(parentId) : undefined
    if (parent?.collapsed) delete parent.collapsed
    const at = parentId ? lastIndexOfSubtree(parentId) + 1 : nodesList.value.length
    nodesList.value.splice(at, 0, ...copies)
    selection.value = copies.filter((c) => c.parentId === parentId || !c.parentId).map((c) => c.id)
    return true
  }

  const paste = () => pasteUnder(selection.value.length ? selection.value[0] : undefined)

  function duplicate(ids: string[]) {
    const tops = topSelected(ids)
    if (!copy(tops)) return
    // Chaque sous-arbre est dupliqué chez sa propre mère.
    const parents = new Set(tops.map((id) => byId.value.get(id)?.parentId))
    if (parents.size === 1) pasteUnder([...parents][0])
    else for (const id of tops) (copy([id]), pasteUnder(byId.value.get(id)?.parentId))
  }

  function load(s: MindmapSchema) {
    nodesList.value = s.nodes
    editingNodeId.value = null
    const alive = new Set(s.nodes.map((n) => n.id))
    selection.value = selection.value.filter((id) => alive.has(id))
  }

  const importSchema = (raw: unknown) => load(sanitizeMindmap(raw, uid))
  const reset = () => load(emptyMindmap())
  function loadExample(id: string) {
    const ex = MINDMAP_EXAMPLES.find((e) => e.id === id)
    if (ex) load(parseMindmapText(ex.text, uid).schema)
  }

  // --- Sauvegarde locale et historique ------------------------------------------
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) load(sanitizeMindmap(JSON.parse(raw), uid))
    else loadExample(MINDMAP_EXAMPLES[0].id)
  } catch {
    loadExample(MINDMAP_EXAMPLES[0].id)
  }
  usePersistence(schema, STORAGE_KEY)
  const { undo, redo, canUndo, canRedo } = useHistory({ state: schema, load })

  return {
    nodesList, selection, editingNodeId, showTextPanel, highlightId, view, schema, nodes, edges, byId,
    flash, addNode, addSibling, updateNode, toggleCollapse, moveNodeBy, canMove, removeNodes, copy, paste, pasteUnder, duplicate, load, importSchema, reset, loadExample,
    undo, redo, canUndo, canRedo, childrenOf: (id: string) => childrenOf(nodesList.value, id),
  }
})
