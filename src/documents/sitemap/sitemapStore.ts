import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Edge, Node } from '@vue-flow/core'
import { useHistory } from '../../composables/useHistory'
import { usePersistence } from '../../composables/usePersistence'
import { childrenOf, depths, emptySitemap, layoutTree, movePage, parseSitemapText, sanitizeSitemap, subtreeIds, type SitemapPage, type SitemapSchema } from './engine'

const STORAGE_KEY = 'mcdraw:sitemap:v1'
const uid = () => Math.random().toString(36).slice(2, 10)

/** Taille d'une carte de page, pour la mise en page (la carte réelle s'y adapte). */
export const PAGE_W = 190
export const PAGE_H = 58

export interface SitemapExample {
  id: string
  label: string
  description: string
  text: string
}

export const SITEMAP_EXAMPLES: SitemapExample[] = [
  {
    id: 'vitrine',
    label: 'Site vitrine',
    description: 'Accueil, présentation, services, contact et mentions.',
    text: `Accueil /
  Présentation /presentation
    L'équipe /presentation/equipe
    Nos valeurs /presentation/valeurs
  Services /services
    Conseil /services/conseil
    Formation /services/formation
  Actualités /actualites
  Contact /contact
  Mentions légales /mentions-legales`,
  },
  {
    id: 'boutique',
    label: 'Boutique en ligne',
    description: 'Catalogue, compte client et tunnel de commande.',
    text: `Accueil /
  Catalogue /catalogue
    Fiche produit /catalogue/produit -- une page par produit
    Promotions /catalogue/promotions
  Panier /panier
    Livraison /commande/livraison
    Paiement /commande/paiement
    Confirmation /commande/confirmation
  Mon compte /compte
    Mes commandes /compte/commandes
    Mes adresses /compte/adresses
  Aide /aide
    Livraisons et retours /aide/retours
    Contact /contact`,
  },
  {
    id: 'blog',
    label: 'Blog',
    description: 'Articles, catégories et pages éditoriales.',
    text: `Accueil /
  Articles /articles
    Catégories /articles/categories
    Article /articles/article -- gabarit commun
  À propos /a-propos
  Newsletter /newsletter
  Contact /contact`,
  },
]

export const useSitemapStore = defineStore('sitemap', () => {
  const pages = ref<SitemapPage[]>([])
  const selection = ref<string[]>([])
  const editingPageId = ref<string | null>(null)
  const showTextPanel = ref(typeof window !== 'undefined' && window.innerWidth >= 1024)
  const highlightId = ref<string | null>(null)
  const view = ref('tree')
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let clipboard: SitemapPage[] = []

  const schema = computed<SitemapSchema>(() => ({ pages: pages.value }))
  const depthOf = computed(() => depths(pages.value))
  const byId = computed(() => new Map(pages.value.map((p) => [p.id, p])))

  // --- Mise en page : arbre de haut en bas, calculé à partir de la structure seule -------------
  const positions = computed(() => layoutTree(pages.value, { w: PAGE_W, h: PAGE_H }, { x: 30, y: 70 }))

  const nodes = computed<Node[]>(() =>
    pages.value.map((p) => ({
      id: p.id,
      type: 'page',
      position: positions.value.get(p.id) ?? { x: 0, y: 0 },
      data: { page: p, depth: depthOf.value.get(p.id) ?? 0, hasChildren: pages.value.some((c) => c.parentId === p.id) },
      selected: selection.value.includes(p.id),
      draggable: false,
      connectable: false,
    })),
  )
  const edges = computed<Edge[]>(() =>
    pages.value
      .filter((p) => p.parentId && byId.value.has(p.parentId))
      .map((p) => ({ id: `e:${p.id}`, source: p.parentId!, target: p.id, type: 'smoothstep', selectable: false, focusable: false })),
  )

  // --- Actions ---------------------------------------------------------------
  function flash(id: string) {
    clearTimeout(highlightTimer)
    highlightId.value = id
    highlightTimer = setTimeout(() => (highlightId.value = null), 2200)
  }

  /** Ajoute une page sous `parentId` (une racine si absent) et la sélectionne. Elle s'insère après ses sœurs. */
  function addPage(parentId?: string, title = 'Nouvelle page'): SitemapPage {
    const page: SitemapPage = { id: uid(), title, ...(parentId && byId.value.has(parentId) ? { parentId } : {}) }
    const at = parentId ? lastIndexOfSubtree(parentId) + 1 : pages.value.length
    pages.value.splice(at, 0, page)
    selection.value = [page.id]
    return page
  }

  /** Indice de la dernière page du sous-arbre de `id` (les sous-arbres sont contigus dans l'ordre d'affichage, pas du tableau). */
  function lastIndexOfSubtree(id: string): number {
    const ids = subtreeIds(pages.value, id)
    let last = -1
    pages.value.forEach((p, i) => ids.has(p.id) && (last = i))
    return last
  }

  const addSibling = (id: string) => addPage(byId.value.get(id)?.parentId)

  function updatePage(id: string, patch: Partial<Pick<SitemapPage, 'title' | 'url' | 'note'>>) {
    const p = byId.value.get(id)
    if (!p) return
    if (patch.title !== undefined) p.title = patch.title
    for (const k of ['url', 'note'] as const) {
      if (patch[k] === undefined) continue
      const v = patch[k]!.trim()
      if (v) p[k] = v
      else delete p[k]
    }
  }

  /** Décale la page d'un rang parmi ses sœurs (vers la gauche : -1, vers la droite : +1). */
  function movePageBy(id: string, dir: -1 | 1): boolean {
    const next = movePage(pages.value, id, dir)
    if (next) pages.value = next
    return !!next
  }
  const canMove = (id: string | undefined, dir: -1 | 1) => !!id && !!movePage(pages.value, id, dir)

  /** Supprime les pages et tout ce qui est en dessous. */
  function removePages(ids: string[]) {
    const gone = new Set(ids.flatMap((id) => [...subtreeIds(pages.value, id)]))
    pages.value = pages.value.filter((p) => !gone.has(p.id))
    selection.value = selection.value.filter((id) => !gone.has(id))
    if (editingPageId.value && gone.has(editingPageId.value)) editingPageId.value = null
  }

  /** Pages sélectionnées dont aucune mère n'est elle-même sélectionnée (un sous-arbre n'est pris qu'une fois). */
  function topSelected(ids: string[]): string[] {
    const set = new Set(ids)
    const hasSelectedAncestor = (p: SitemapPage) => {
      for (let cur = p.parentId ? byId.value.get(p.parentId) : undefined, n = 0; cur && n < 1000; cur = cur.parentId ? byId.value.get(cur.parentId) : undefined, n++) {
        if (set.has(cur.id)) return true
      }
      return false
    }
    return pages.value.filter((p) => set.has(p.id) && !hasSelectedAncestor(p)).map((p) => p.id)
  }

  /** Copie les sous-arbres sélectionnés (dans l'ordre de l'arbre). */
  function copy(ids: string[]): boolean {
    const tops = topSelected(ids)
    if (!tops.length) return false
    const keep = new Set(tops.flatMap((id) => [...subtreeIds(pages.value, id)]))
    clipboard = pages.value.filter((p) => keep.has(p.id)).map((p) => ({ ...p }))
    return true
  }

  /** Colle sous `parentId` (une racine si absent), avec de nouveaux identifiants. */
  function pasteUnder(parentId: string | undefined): boolean {
    if (!clipboard.length) return false
    const ids = new Set(clipboard.map((p) => p.id))
    const remap = new Map(clipboard.map((p) => [p.id, uid()]))
    const copies = clipboard.map((p) => {
      const { parentId: pp, ...rest } = p
      return { ...rest, id: remap.get(p.id)!, ...(pp && ids.has(pp) ? { parentId: remap.get(pp)! } : parentId ? { parentId } : {}) }
    })
    const at = parentId ? lastIndexOfSubtree(parentId) + 1 : pages.value.length
    pages.value.splice(at, 0, ...copies)
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

  function load(s: SitemapSchema) {
    pages.value = s.pages
    editingPageId.value = null
    const alive = new Set(s.pages.map((p) => p.id))
    selection.value = selection.value.filter((id) => alive.has(id))
  }

  const importSchema = (raw: unknown) => load(sanitizeSitemap(raw, uid))
  const reset = () => load(emptySitemap())
  function loadExample(id: string) {
    const ex = SITEMAP_EXAMPLES.find((e) => e.id === id)
    if (ex) load(parseSitemapText(ex.text, uid).schema)
  }

  // --- Sauvegarde locale et historique ------------------------------------------
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) load(sanitizeSitemap(JSON.parse(raw), uid))
    else loadExample(SITEMAP_EXAMPLES[0].id)
  } catch {
    loadExample(SITEMAP_EXAMPLES[0].id)
  }
  usePersistence(schema, STORAGE_KEY)
  const { undo, redo, canUndo, canRedo } = useHistory({ state: schema, load })

  return {
    pages, selection, editingPageId, showTextPanel, highlightId, view, schema, nodes, edges, byId,
    flash, addPage, addSibling, movePageBy, canMove, updatePage, removePages, copy, paste, pasteUnder, duplicate, load, importSchema, reset, loadExample,
    undo, redo, canUndo, canRedo, childrenOf: (id: string) => childrenOf(pages.value, id),
  }
})
