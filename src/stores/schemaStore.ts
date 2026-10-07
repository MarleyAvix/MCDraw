import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Edge, Node } from '@vue-flow/core'
import { meriseToMld } from '../engine/meriseToMld'
import { mldToSql, type SqlDialect } from '../engine/mldToSql'
import type { Attribute, Cardinality, DataType, Entity, Link, MeriseSchema, Relation } from '../types/schema'

const STORAGE_KEY = 'mcdraw:schema:v1'
const uid = () => Math.random().toString(36).slice(2, 10)

export const newAttribute = (over: Partial<Attribute> = {}): Attribute => ({
  id: uid(),
  name: '',
  type: 'VARCHAR',
  isPrimaryKey: false,
  ...over,
})

type AttrSeed = [name: string, type?: DataType, pk?: boolean, size?: string]
const attrs = (seeds: AttrSeed[]): Attribute[] =>
  seeds.map(([name, type = 'VARCHAR', pk = false, size]) => newAttribute({ name, type, isPrimaryKey: pk, size }))

export interface ExampleDef {
  id: string
  label: string
  build: () => MeriseSchema
}

const link = (relationId: string, entityId: string, cardinality: Cardinality, handles: [string, string]): Link => ({
  id: uid(),
  relationId,
  entityId,
  cardinality,
  relationHandle: handles[0],
  entityHandle: handles[1],
})

export const EXAMPLES: ExampleDef[] = [
  {
    id: 'commandes',
    label: 'Boutique (clients, commandes, produits)',
    build() {
      const client: Entity = { id: uid(), name: 'Client', x: 40, y: 60, attributes: attrs([['id_client', 'INT', true], ['nom'], ['email']]) }
      const commande: Entity = { id: uid(), name: 'Commande', x: 480, y: 60, attributes: attrs([['id_commande', 'INT', true], ['date_commande', 'DATE']]) }
      const produit: Entity = { id: uid(), name: 'Produit', x: 480, y: 340, attributes: attrs([['id_produit', 'INT', true], ['libelle'], ['prix', 'DECIMAL', false, '8,2']]) }
      const passer: Relation = { id: uid(), name: 'Passer', x: 270, y: 90, attributes: [] }
      const contenir: Relation = { id: uid(), name: 'Contenir', x: 270, y: 370, attributes: attrs([['quantite', 'INT']]) }
      return {
        entities: [client, commande, produit],
        relations: [passer, contenir],
        links: [
          link(passer.id, client.id, '0,n', ['l', 'r']),
          link(passer.id, commande.id, '1,1', ['r', 'l']),
          link(contenir.id, commande.id, '1,n', ['t', 'b']),
          link(contenir.id, produit.id, '0,n', ['r', 'l']),
        ],
      }
    },
  },
  {
    id: 'bibliotheque',
    label: 'Bibliothèque (adhérents, livres, auteurs)',
    build() {
      const adherent: Entity = { id: uid(), name: 'Adhérent', x: 40, y: 200, attributes: attrs([['id_adherent', 'INT', true], ['nom'], ['prenom']]) }
      const livre: Entity = { id: uid(), name: 'Livre', x: 480, y: 200, attributes: attrs([['isbn', 'VARCHAR', true, '13'], ['titre']]) }
      const auteur: Entity = { id: uid(), name: 'Auteur', x: 900, y: 200, attributes: attrs([['id_auteur', 'INT', true], ['nom']]) }
      const emprunter: Relation = { id: uid(), name: 'Emprunter', x: 270, y: 230, attributes: attrs([['date_emprunt', 'DATE']]) }
      const ecrire: Relation = { id: uid(), name: 'Écrire', x: 700, y: 230, attributes: [] }
      return {
        entities: [adherent, livre, auteur],
        relations: [emprunter, ecrire],
        links: [
          link(emprunter.id, adherent.id, '0,n', ['l', 'r']),
          link(emprunter.id, livre.id, '0,n', ['r', 'l']),
          link(ecrire.id, livre.id, '1,n', ['l', 'r']),
          link(ecrire.id, auteur.id, '0,n', ['r', 'l']),
        ],
      }
    },
  },
  {
    id: 'employes',
    label: 'Employés (association réflexive)',
    build() {
      const employe: Entity = { id: uid(), name: 'Employé', x: 100, y: 180, attributes: attrs([['id_employe', 'INT', true], ['nom']]) }
      const diriger: Relation = { id: uid(), name: 'Diriger', x: 420, y: 190, attributes: [] }
      return {
        entities: [employe],
        relations: [diriger],
        links: [
          { ...link(diriger.id, employe.id, '0,n', ['l', 'r']), role: 'manager' },
          { ...link(diriger.id, employe.id, '0,1', ['b', 'b']), role: 'subordonne' },
        ],
      }
    },
  },
]

export const useSchemaStore = defineStore('schema', () => {
  const entities = ref<Entity[]>([])
  const relations = ref<Relation[]>([])
  const links = ref<Link[]>([])

  const editingEntityId = ref<string | null>(null)
  const editingRelationId = ref<string | null>(null)
  const showSqlModal = ref(false)
  const selection = ref<string[]>([])
  let clipboard: MeriseSchema | null = null
  let pasteCount = 0
  const sqlOptions = ref<{ dialect: SqlDialect; autoIncrement: boolean }>({ dialect: 'mysql', autoIncrement: true })

  // --- Dérivés ---------------------------------------------------------
  const schema = computed<MeriseSchema>(() => ({
    entities: entities.value,
    relations: relations.value,
    links: links.value,
  }))
  /** Problèmes de conception par nœud, affichés directement sur le canvas. */
  const issues = computed(() => {
    const out: Record<string, string[]> = {}
    const add = (id: string, msg: string) => (out[id] ??= []).push(msg)
    const names = new Map<string, number>()
    for (const n of [...entities.value, ...relations.value]) {
      const k = n.name.trim().toLowerCase()
      names.set(k, (names.get(k) ?? 0) + 1)
    }
    const ids = new Set(entities.value.map((e) => e.id))
    for (const e of entities.value) {
      if (!e.attributes.some((a) => a.isPrimaryKey)) add(e.id, 'Aucun identifiant (clé primaire)')
      if (!e.name.trim()) add(e.id, 'Nom manquant')
      if ((names.get(e.name.trim().toLowerCase()) ?? 0) > 1) add(e.id, 'Nom en double')
      if (e.attributes.some((a) => !a.name.trim())) add(e.id, 'Attribut sans nom')
    }
    for (const r of relations.value) {
      const n = links.value.filter((l) => l.relationId === r.id && ids.has(l.entityId)).length
      if (n < 2) add(r.id, n ? 'Une seule patte : reliez au moins deux entités' : 'Association non reliée')
      if (!r.name.trim()) add(r.id, 'Nom manquant')
      if ((names.get(r.name.trim().toLowerCase()) ?? 0) > 1) add(r.id, 'Nom en double')
    }
    return out
  })
  const mld = computed(() => meriseToMld(schema.value))
  const sql = computed(() => mldToSql(mld.value, sqlOptions.value))

  // --- Synchronisation avec Vue Flow ---------------------------------
  const nodes = computed<Node[]>(() => [
    ...entities.value.map((e) => ({ id: e.id, type: 'entity', position: { x: e.x, y: e.y }, data: e, selected: selection.value.includes(e.id) })),
    ...relations.value.map((r) => ({ id: r.id, type: 'relation', position: { x: r.x, y: r.y }, data: r, selected: selection.value.includes(r.id) })),
  ])
  const edges = computed<Edge[]>(() =>
    links.value.map((l) => ({
      id: l.id,
      source: l.relationId,
      target: l.entityId,
      sourceHandle: l.relationHandle,
      targetHandle: l.entityHandle,
      type: 'link',
      data: { linkId: l.id, cardinality: l.cardinality, role: l.role },
    })),
  )

  // --- Actions ---------------------------------------------------------
  function addEntity(x: number, y: number): Entity {
    const n = entities.value.length + 1
    const entity: Entity = {
      id: uid(),
      name: `Entite${n}`,
      x,
      y,
      attributes: [newAttribute({ name: `id_entite${n}`, type: 'INT', isPrimaryKey: true })],
    }
    entities.value.push(entity)
    return entity
  }

  function addRelation(x: number, y: number): Relation {
    const relation: Relation = { id: uid(), name: `Association${relations.value.length + 1}`, x, y, attributes: [] }
    relations.value.push(relation)
    return relation
  }

  /** Crée une association entre deux entités (ou une association réflexive) avec deux pattes 0,n. */
  function addRelationBetween(sourceId: string, targetId: string, handles: { source?: string; target?: string } = {}) {
    const a = entities.value.find((e) => e.id === sourceId)
    const b = entities.value.find((e) => e.id === targetId)
    if (!a || !b) return
    // Tailles approximatives des nœuds pour viser leur centre.
    const cx = (e: Entity) => e.x + 90
    const cy = (e: Entity) => e.y + 50
    const reflexive = a.id === b.id
    const x = reflexive ? cx(a) + 220 : (cx(a) + cx(b)) / 2 - 65
    const y = reflexive ? cy(a) - 32 : (cy(a) + cy(b)) / 2 - 32
    const relation = addRelation(x, y)
    const handleToward = (from: Entity, to: Entity) =>
      Math.abs(cx(to) - cx(from)) >= Math.abs(cy(to) - cy(from)) ? (cx(to) >= cx(from) ? 'r' : 'l') : cy(to) >= cy(from) ? 'b' : 't'
    const relHandleToward = (rel: Relation, to: Entity) => {
      const dx = cx(to) - (rel.x + 65)
      const dy = cy(to) - (rel.y + 32)
      return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'r' : 'l') : dy >= 0 ? 'b' : 't'
    }
    if (reflexive) {
      links.value.push(
        { id: uid(), relationId: relation.id, entityId: a.id, cardinality: '0,n', relationHandle: 't', entityHandle: 'r' },
        { id: uid(), relationId: relation.id, entityId: a.id, cardinality: '0,n', relationHandle: 'b', entityHandle: 'b' },
      )
    } else {
      links.value.push(
        { id: uid(), relationId: relation.id, entityId: a.id, cardinality: '0,n', relationHandle: relHandleToward(relation, a), entityHandle: handles.source ?? handleToward(a, b) },
        { id: uid(), relationId: relation.id, entityId: b.id, cardinality: '0,n', relationHandle: relHandleToward(relation, b), entityHandle: handles.target ?? handleToward(b, a) },
      )
    }
    editingRelationId.value = relation.id
  }

  function updateEntity(id: string, patch: Partial<Pick<Entity, 'name' | 'attributes'>>) {
    const e = entities.value.find((x) => x.id === id)
    if (e) Object.assign(e, patch)
  }

  function updateRelation(id: string, patch: Partial<Pick<Relation, 'name' | 'attributes'>>) {
    const r = relations.value.find((x) => x.id === id)
    if (r) Object.assign(r, patch)
  }

  function removeNode(id: string) {
    entities.value = entities.value.filter((e) => e.id !== id)
    relations.value = relations.value.filter((r) => r.id !== id)
    links.value = links.value.filter((l) => l.entityId !== id && l.relationId !== id)
    if (editingEntityId.value === id) editingEntityId.value = null
    if (editingRelationId.value === id) editingRelationId.value = null
  }

  function moveNode(id: string, x: number, y: number) {
    const n = entities.value.find((e) => e.id === id) ?? relations.value.find((r) => r.id === id)
    if (n) {
      n.x = x
      n.y = y
    }
  }

  /** Copie les nœuds donnés et les pattes dont les deux extrémités sont copiées. */
  function copyNodes(ids: string[]): boolean {
    const set = new Set(ids)
    const snap: MeriseSchema = {
      entities: entities.value.filter((e) => set.has(e.id)),
      relations: relations.value.filter((r) => set.has(r.id)),
      links: links.value.filter((l) => set.has(l.entityId) && set.has(l.relationId)),
    }
    if (!snap.entities.length && !snap.relations.length) return false
    clipboard = JSON.parse(JSON.stringify(snap))
    pasteCount = 0
    return true
  }

  /** Colle le presse-papiers interne, décalé, et sélectionne les copies. */
  function paste(): boolean {
    if (!clipboard) return false
    const copy: MeriseSchema = JSON.parse(JSON.stringify(clipboard))
    const shift = 40 * ++pasteCount
    const idMap = new Map<string, string>()
    const fresh = <T extends { id: string; x: number; y: number }>(n: T): T => {
      const id = uid()
      idMap.set(n.id, id)
      return { ...n, id, x: n.x + shift, y: n.y + shift }
    }
    const newEntities = copy.entities.map((e) => ({ ...fresh(e), attributes: e.attributes.map((a) => ({ ...a, id: uid() })) }))
    const newRelations = copy.relations.map((r) => ({ ...fresh(r), attributes: r.attributes.map((a) => ({ ...a, id: uid() })) }))
    entities.value.push(...newEntities)
    relations.value.push(...newRelations)
    links.value.push(
      ...copy.links.map((l) => ({ ...l, id: uid(), entityId: idMap.get(l.entityId)!, relationId: idMap.get(l.relationId)! })),
    )
    selection.value = [...newEntities, ...newRelations].map((n) => n.id)
    return true
  }

  function duplicateNodes(ids: string[]) {
    if (copyNodes(ids)) paste()
  }

  function moveNodes(positions: Record<string, { x: number; y: number }>) {
    for (const [id, p] of Object.entries(positions)) moveNode(id, p.x, p.y)
  }

  /** Réattribue les points d'accroche des pattes selon la position relative des centres (après une mise en page). */
  function rerouteLinks(centers: Record<string, { x: number; y: number }>) {
    const side = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const dx = to.x - from.x
      const dy = to.y - from.y
      return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'r' : 'l') : dy >= 0 ? 'b' : 't'
    }
    for (const l of links.value) {
      const e = centers[l.entityId]
      const r = centers[l.relationId]
      if (!e || !r) continue
      l.entityHandle = side(e, r)
      l.relationHandle = side(r, e)
    }
  }

  function addLink(relationId: string, entityId: string, handles: { relation?: string; entity?: string } = {}) {
    links.value.push({
      id: uid(),
      relationId,
      entityId,
      cardinality: '0,n',
      relationHandle: handles.relation,
      entityHandle: handles.entity,
    })
  }

  function updateLink(id: string, patch: Partial<Pick<Link, 'cardinality' | 'role'>>) {
    const l = links.value.find((x) => x.id === id)
    if (l) Object.assign(l, patch)
  }

  function removeLink(id: string) {
    links.value = links.value.filter((l) => l.id !== id)
  }

  function load(s: MeriseSchema) {
    entities.value = s.entities
    relations.value = s.relations
    links.value = s.links
    editingEntityId.value = editingRelationId.value = null
  }

  /** Importe un schéma JSON (validation minimale de la structure). Lève une Error si invalide. */
  function importSchema(raw: unknown) {
    const s = raw as Partial<MeriseSchema> | null
    if (!s || !Array.isArray(s.entities) || !Array.isArray(s.relations) || !Array.isArray(s.links)) {
      throw new Error('Fichier invalide : entités, associations ou pattes manquantes.')
    }
    const ids = new Set([...s.entities, ...s.relations].map((n) => n.id))
    load({
      entities: s.entities.map((e) => ({ ...e, attributes: e.attributes ?? [], x: Number(e.x) || 0, y: Number(e.y) || 0 })),
      relations: s.relations.map((r) => ({ ...r, attributes: r.attributes ?? [], x: Number(r.x) || 0, y: Number(r.y) || 0 })),
      links: s.links.filter((l) => ids.has(l.relationId) && ids.has(l.entityId)),
    })
  }

  const reset = () => load({ entities: [], relations: [], links: [] })
  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)
    if (ex) load(ex.build())
  }

  // --- Persistance locale ---------------------------------------------
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as MeriseSchema
      if (Array.isArray(s.entities) && Array.isArray(s.relations) && Array.isArray(s.links)) load(s)
    } else {
      load(EXAMPLES[0].build())
    }
  } catch {
    load(EXAMPLES[0].build())
  }

  // --- Historique (annuler / rétablir) par instantanés JSON -----------
  const HISTORY_MAX = 100
  const past = ref<string[]>([])
  const future = ref<string[]>([])
  let present = JSON.stringify(schema.value)
  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  watch(
    schema,
    (s) => {
      const snap = JSON.stringify(s)
      try {
        localStorage.setItem(STORAGE_KEY, snap)
      } catch {
        /* stockage indisponible : on ignore */
      }
      if (snap === present) return
      past.value.push(present)
      if (past.value.length > HISTORY_MAX) past.value.shift()
      future.value = []
      present = snap
    },
    { deep: true },
  )

  function undo() {
    const prev = past.value.pop()
    if (prev === undefined) return
    future.value.push(present)
    present = prev
    load(JSON.parse(prev))
  }

  function redo() {
    const next = future.value.pop()
    if (next === undefined) return
    past.value.push(present)
    present = next
    load(JSON.parse(next))
  }

  return {
    entities, relations, links,
    editingEntityId, editingRelationId, showSqlModal, selection, copyNodes, paste, duplicateNodes, sqlOptions, canUndo, canRedo,
    schema, issues, mld, sql, nodes, edges,
    addEntity, addRelation, addRelationBetween, updateEntity, updateRelation, removeNode, moveNode, moveNodes, rerouteLinks,
    addLink, updateLink, removeLink, reset, loadExample, importSchema, undo, redo,
  }
})

