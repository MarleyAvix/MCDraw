import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Edge, Node } from '@vue-flow/core'
import { meriseToMld, normalizeSize, slug, sqlServerCascadeWarnings } from '../engine/meriseToMld'
import { mldToSql, type SqlDialect } from '../engine/mldToSql'
import { rootOf } from '../engine/inheritance'
import { sanitizeSchema } from '../engine/sanitize'
import { buildTemplate, TEMPLATE_DEFS } from '../engine/templates'
import type { Attribute, Cardinality, DataType, Entity, InheritanceStrategy, Link, MeriseSchema, Relation } from '../types/schema'

const STORAGE_KEY = 'mcdraw:schema:v1'
const uid = () => Math.random().toString(36).slice(2, 10)

type Pt = { x: number; y: number }
/** Côté (t, r, b, l) de `from` qui fait face à `to`. */
const sideToward = (from: Pt, to: Pt) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'r' : 'l') : dy >= 0 ? 'b' : 't'
}

/** Problèmes propres à une liste d'attributs : nom manquant, doublons (même nom SQL), taille invalide. */
function attributeIssues(list: Attribute[]): string[] {
  const out: string[] = []
  if (list.some((a) => !a.name.trim())) out.push('Attribut sans nom')
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const a of list) {
    if (!a.name.trim()) continue
    const k = slug(a.name)
    if (seen.has(k)) dup.add(a.name.trim())
    seen.add(k)
  }
  if (dup.size) out.push(`Attribut en double : ${[...dup].join(', ')}`)
  for (const a of list) {
    if (normalizeSize(a) === null) out.push(`Taille invalide pour « ${a.name || '…'} » : ${a.size} (ex : ${a.type === 'DECIMAL' ? '10,2' : '255'})`)
  }
  return out
}

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
  /** Regroupement dans le menu : petits exemples pédagogiques ou modèles de départ complets. */
  category: 'exemple' | 'modele'
  description?: string
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

const BASIC_EXAMPLES: Omit<ExampleDef, 'category'>[] = [
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
    id: 'cif',
    label: 'Commande et lignes (entité faible, CIF)',
    build() {
      const client: Entity = { id: uid(), name: 'Client', x: 40, y: 60, attributes: attrs([['id_client', 'INT', true], ['nom']]) }
      const commande: Entity = { id: uid(), name: 'Commande', x: 480, y: 60, attributes: attrs([['id_commande', 'INT', true], ['date_commande', 'DATE']]) }
      const ligne: Entity = { id: uid(), name: 'Ligne', x: 480, y: 340, attributes: attrs([['no_ligne', 'INT', true], ['quantite', 'INT']]) }
      const passer: Relation = { id: uid(), name: 'Passer', x: 270, y: 90, attributes: [] }
      const contenir: Relation = { id: uid(), name: 'Contenir', x: 500, y: 215, attributes: [] }
      return {
        entities: [client, commande, ligne],
        relations: [passer, contenir],
        links: [
          link(passer.id, client.id, '0,n', ['l', 'r']),
          link(passer.id, commande.id, '1,1', ['r', 'l']),
          link(contenir.id, commande.id, '0,n', ['t', 'b']),
          { ...link(contenir.id, ligne.id, '1,1', ['b', 't']), identifying: true },
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
  {
    id: 'heritage',
    label: 'Véhicules (héritage « est un »)',
    build() {
      const vehicule: Entity = { id: uid(), name: 'Vehicule', x: 260, y: 40, inheritance: 'class', attributes: attrs([['id_vehicule', 'INT', true], ['immatriculation', 'VARCHAR', false, '15'], ['marque']]) }
      const voiture: Entity = { id: uid(), name: 'Voiture', x: 40, y: 330, parentId: vehicule.id, attributes: attrs([['nb_portes', 'INT']]) }
      const camion: Entity = { id: uid(), name: 'Camion', x: 480, y: 330, parentId: vehicule.id, attributes: attrs([['charge_max', 'DECIMAL', false, '8,2']]) }
      return { entities: [vehicule, voiture, camion], relations: [], links: [] }
    },
  },
]

export const EXAMPLES: ExampleDef[] = [
  ...BASIC_EXAMPLES.map((e) => ({ ...e, category: 'exemple' as const })),
  ...TEMPLATE_DEFS.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    category: 'modele' as const,
    build: () => buildTemplate(t, uid),
  })),
]

/** Vues : MCD (édition) et vues dérivées MLD, ERD (pattes de corbeau), UML (diagramme de classes). */
export type ViewMode = 'mcd' | 'mld' | 'erd' | 'uml'

export const useSchemaStore = defineStore('schema', () => {
  const entities = ref<Entity[]>([])
  const relations = ref<Relation[]>([])
  const links = ref<Link[]>([])

  const editingEntityId = ref<string | null>(null)
  const editingRelationId = ref<string | null>(null)
  const showSqlModal = ref(false)
  const showSqlImportModal = ref(false)
  const showShareModal = ref(false)
  const showTextPanel = ref(false)
  const selection = ref<string[]>([])
  const view = ref<ViewMode>('mcd')
  const highlightId = ref<string | null>(null)
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  const mldRelayout = ref(0)
  let clipboard: MeriseSchema | null = null
  let pasteCount = 0
  const sqlOptions = ref<{ dialect: SqlDialect; autoIncrement: boolean }>({ dialect: 'mysql', autoIncrement: true })

  // --- Dérivés ---------------------------------------------------------
  const schema = computed<MeriseSchema>(() => ({
    entities: entities.value,
    relations: relations.value,
    links: links.value,
  }))
  const entityById = computed(() => new Map(entities.value.map((e) => [e.id, e])))
  /** Entités faibles : identifiées relativement à une autre entité (patte 1,1 marquée CIF). */
  const weakEntityIds = computed(
    () => new Set(links.value.filter((l) => l.identifying && l.cardinality === '1,1').map((l) => l.entityId)),
  )
  /** Problèmes de conception par nœud, affichés directement sur le canvas. */
  const issues = computed(() => {
    const out: Record<string, string[]> = {}
    const add = (id: string, msg: string) => (out[id] ??= []).push(msg)
    const names = new Map<string, number>()
    for (const n of [...entities.value, ...relations.value]) {
      const k = n.name.trim().toLowerCase()
      names.set(k, (names.get(k) ?? 0) + 1)
    }
    const byId = entityById.value
    for (const e of entities.value) {
      const pks = e.attributes.filter((a) => a.isPrimaryKey).length
      const inherited = !!e.parentId && byId.has(e.parentId)
      if (pks === 0 && !inherited && !weakEntityIds.value.has(e.id)) add(e.id, 'Aucun identifiant : soulignez un attribut')
      if (inherited && pks > 0) add(e.id, "L'identifiant est hérité de la classe mère : retirez celui-ci")
      if (e.parentId && rootOf(e.id, byId) === null) add(e.id, 'Héritage circulaire')
      if (pks > 1) add(e.id, 'Plusieurs identifiants : un seul est permis par entité')
      if (!e.name.trim()) add(e.id, 'Nom manquant')
      if ((names.get(e.name.trim().toLowerCase()) ?? 0) > 1) add(e.id, 'Nom en double')
      for (const msg of attributeIssues(e.attributes)) add(e.id, msg)
    }
    for (const r of relations.value) {
      for (const msg of attributeIssues(r.attributes)) add(r.id, msg)
      const n = links.value.filter((l) => l.relationId === r.id && byId.has(l.entityId)).length
      if (n < 2) add(r.id, n ? 'Une seule patte : reliez au moins deux entités' : 'Association non reliée')
      const cif = links.value.filter((l) => l.relationId === r.id && l.identifying)
      if (cif.length && n !== 2) add(r.id, 'Identifiant relatif (CIF) : réservé aux associations binaires')
      if (cif.length && new Set(links.value.filter((l) => l.relationId === r.id).map((l) => l.entityId)).size < 2) {
        add(r.id, 'Identifiant relatif (CIF) impossible sur une association réflexive')
      }
      if (!r.name.trim()) add(r.id, 'Nom manquant')
      if ((names.get(r.name.trim().toLowerCase()) ?? 0) > 1) add(r.id, 'Nom en double')
    }
    return out
  })
  const mld = computed(() => meriseToMld(schema.value))
  const sql = computed(() => mldToSql(mld.value, sqlOptions.value))
  /** Cascades que SQL Server refuserait : signalées seulement quand c'est le dialecte choisi. */
  const dialectWarnings = computed(() => (sqlOptions.value.dialect === 'sqlserver' ? sqlServerCascadeWarnings(mld.value.tables) : []))
  /** Avertissements du MLD, plus ceux du dialecte choisi. */
  const mldWarnings = computed(() => [...mld.value.warnings, ...dialectWarnings.value])

  /** Classe racine de la hiérarchie « est un » d'une entité. */
  const inheritanceRoot = (id: string): Entity | undefined => {
    const r = rootOf(id, entityById.value)
    return r ? entityById.value.get(r) : undefined
  }
  const childrenOfEntity = (id: string) => entities.value.filter((e) => e.parentId === id)

  // --- Synchronisation avec Vue Flow ---------------------------------
  const nodes = computed<Node[]>(() => [
    ...entities.value.map((e) => ({ id: e.id, type: 'entity', position: { x: e.x, y: e.y }, data: e, selected: selection.value.includes(e.id) })),
    ...relations.value.map((r) => ({ id: r.id, type: 'relation', position: { x: r.x, y: r.y }, data: r, selected: selection.value.includes(r.id) })),
  ])
  const isaEdges = computed<Edge[]>(() =>
    entities.value.flatMap((e) => {
      const p = e.parentId ? entityById.value.get(e.parentId) : undefined
      if (!p || p.id === e.id) return []
      return [{
        id: `isa:${e.id}`,
        source: e.id,
        target: p.id,
        // côté d'accroche selon la position relative des nœuds (tailles approximatives)
        sourceHandle: sideToward(e, p),
        targetHandle: sideToward(p, e),
        type: 'isa',
        data: { strategy: inheritanceRoot(e.id)?.inheritance ?? 'class' },
      }]
    }),
  )
  const edges = computed<Edge[]>(() => [
    ...isaEdges.value,
    ...links.value.map((l) => {
      // Traits parallèles quand une même entité est reliée plusieurs fois à la même association (réflexive).
      const twins = links.value.filter((o) => o.relationId === l.relationId && o.entityId === l.entityId)
      return {
      id: l.id,
      source: l.relationId,
      target: l.entityId,
      sourceHandle: l.relationHandle,
      targetHandle: l.entityHandle,
      type: 'link',
      data: { linkId: l.id, cardinality: l.cardinality, role: l.role, identifying: !!l.identifying, index: twins.indexOf(l), count: twins.length },
    }}),
  ])

  // --- Actions ---------------------------------------------------------
  /** Fait clignoter un nœud (résultat de recherche) pendant un court instant. */
  function flash(id: string) {
    clearTimeout(highlightTimer)
    highlightId.value = id
    highlightTimer = setTimeout(() => (highlightId.value = null), 2200)
  }

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
    const center = (e: Entity) => ({ x: e.x + 90, y: e.y + 50 })
    const reflexive = a.id === b.id
    const x = reflexive ? center(a).x + 220 : (center(a).x + center(b).x) / 2 - 65
    const y = reflexive ? center(a).y - 32 : (center(a).y + center(b).y) / 2 - 32
    const relation = addRelation(x, y)
    const relCenter = { x: relation.x + 65, y: relation.y + 32 }
    const handleToward = (from: Entity, to: Entity) => sideToward(center(from), center(to))
    if (reflexive) {
      links.value.push(
        { id: uid(), relationId: relation.id, entityId: a.id, cardinality: '0,n', relationHandle: 't', entityHandle: 'r' },
        { id: uid(), relationId: relation.id, entityId: a.id, cardinality: '0,n', relationHandle: 'b', entityHandle: 'b' },
      )
    } else {
      links.value.push(
        { id: uid(), relationId: relation.id, entityId: a.id, cardinality: '0,n', relationHandle: sideToward(relCenter, center(a)), entityHandle: handles.source ?? handleToward(a, b) },
        { id: uid(), relationId: relation.id, entityId: b.id, cardinality: '0,n', relationHandle: sideToward(relCenter, center(b)), entityHandle: handles.target ?? handleToward(b, a) },
      )
    }
    editingRelationId.value = relation.id
  }

  function updateEntity(id: string, patch: Partial<Pick<Entity, 'name' | 'attributes'>>) {
    const e = entities.value.find((x) => x.id === id)
    if (e) Object.assign(e, patch)
  }

  /** Définit l'entité mère (« est un ») ; refuse une boucle (soi-même ou un descendant). */
  function setParent(id: string, parentId: string | undefined): boolean {
    const e = entities.value.find((x) => x.id === id)
    if (!e) return false
    if (parentId) {
      const byId = new Map(entities.value.map((x) => [x.id, x]))
      if (!byId.has(parentId)) return false
      for (let cur = byId.get(parentId); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
        if (cur.id === id) return false
      }
    }
    e.parentId = parentId || undefined
    return true
  }

  function setInheritance(id: string, strategy: InheritanceStrategy) {
    const e = entities.value.find((x) => x.id === id)
    if (e) e.inheritance = strategy
  }

  function updateRelation(id: string, patch: Partial<Pick<Relation, 'name' | 'attributes' | 'tableName'>>) {
    const r = relations.value.find((x) => x.id === id)
    if (r) Object.assign(r, patch)
  }

  // --- Édition rapide des attributs (depuis le nœud) -----------------
  const attributesOf = (nodeId: string): Attribute[] | undefined =>
    (entities.value.find((e) => e.id === nodeId) ?? relations.value.find((r) => r.id === nodeId))?.attributes

  function addAttribute(nodeId: string): Attribute | undefined {
    const list = attributesOf(nodeId)
    if (!list) return
    // Nom par défaut non vide : l'ajout reste visible même si l'utilisateur ne tape rien.
    let n = list.length + 1
    while (list.some((a) => a.name === `attribut_${n}`)) n++
    const attr = newAttribute({ name: `attribut_${n}` })
    list.push(attr)
    return attr
  }

  function updateAttribute(nodeId: string, attrId: string, patch: Partial<Omit<Attribute, 'id'>>) {
    const list = attributesOf(nodeId)
    const a = list?.find((x) => x.id === attrId)
    if (!a) return
    // Un seul identifiant par entité : activer une clé retire les autres.
    if (patch.isPrimaryKey && entities.value.some((e) => e.id === nodeId)) {
      for (const other of list!) if (other !== a) other.isPrimaryKey = false
    }
    Object.assign(a, patch)
  }

  function removeAttribute(nodeId: string, attrId: string) {
    const list = attributesOf(nodeId)
    const i = list?.findIndex((x) => x.id === attrId) ?? -1
    if (list && i >= 0) list.splice(i, 1)
  }

  function moveAttribute(nodeId: string, from: number, to: number) {
    const list = attributesOf(nodeId)
    if (!list || from === to || from < 0 || from >= list.length) return
    const [a] = list.splice(from, 1)
    list.splice(Math.max(0, Math.min(to, list.length)), 0, a)
  }

  function removeNode(id: string) {
    // Les filles d'une entité supprimée remontent d'un cran (elles héritent de l'éventuelle grand-mère).
    const gone = entities.value.find((e) => e.id === id)
    for (const e of entities.value) {
      if (e.parentId !== id) continue
      e.parentId = gone?.parentId
      if (!gone?.parentId) e.inheritance = gone?.inheritance // devenue racine, elle reprend la stratégie
    }
    entities.value = entities.value.filter((e) => e.id !== id)
    relations.value = relations.value.filter((r) => r.id !== id)
    links.value = links.value.filter((l) => l.entityId !== id && l.relationId !== id)
    selection.value = selection.value.filter((s) => s !== id)
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
    // « est un » : conservé si la mère est copiée aussi, sinon la copie devient une entité indépendante.
    for (const e of newEntities) {
      const old = copy.entities.find((o) => idMap.get(o.id) === e.id)
      e.parentId = old?.parentId ? idMap.get(old.parentId) : undefined
    }
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
  function rerouteLinks(centers: Record<string, Pt>) {
    for (const l of links.value) {
      const e = centers[l.entityId]
      const r = centers[l.relationId]
      if (!e || !r) continue
      l.entityHandle = sideToward(e, r)
      l.relationHandle = sideToward(r, e)
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

  function updateLink(id: string, patch: Partial<Pick<Link, 'cardinality' | 'role' | 'identifying' | 'onDelete' | 'onUpdate'>>) {
    const l = links.value.find((x) => x.id === id)
    if (!l) return
    Object.assign(l, patch)
    // L'identifiant relatif n'a de sens que sur une patte 1,1, et une seule par association.
    if (l.cardinality !== '1,1') l.identifying = false
    if (l.identifying) {
      for (const o of links.value) if (o.relationId === l.relationId && o !== l) o.identifying = false
    }
  }

  function removeLink(id: string) {
    links.value = links.value.filter((l) => l.id !== id)
  }

  function load(s: MeriseSchema) {
    entities.value = s.entities
    relations.value = s.relations
    links.value = s.links
    editingEntityId.value = editingRelationId.value = null
    const alive = new Set([...s.entities, ...s.relations].map((n) => n.id))
    selection.value = selection.value.filter((id) => alive.has(id))
  }

  /** Importe un schéma JSON, validé et normalisé. Lève une Error si la structure est inutilisable. */
  function importSchema(raw: unknown) {
    load(sanitizeSchema(raw, uid))
  }

  const reset = () => load({ entities: [], relations: [], links: [] })
  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id)
    if (ex) load(ex.build())
  }

  // --- Persistance locale ---------------------------------------------
  try {
    // Une sauvegarde d'une version antérieure (ou abîmée) passe par la même validation qu'un import.
    const raw = localStorage.getItem(STORAGE_KEY)
    load(raw ? sanitizeSchema(JSON.parse(raw), uid) : EXAMPLES[0].build())
  } catch {
    load(EXAMPLES[0].build())
  }

  // --- Historique (annuler / rétablir) par instantanés JSON -----------
  const HISTORY_MAX = 100
  const past = ref<string[]>([])
  const future = ref<string[]>([])
  const COALESCE_MS = 600
  let lastChange = 0
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
      // Les modifications rapprochées (saisie au clavier…) ne forment qu'une seule étape.
      const now = Date.now()
      const grouped = past.value.length > 0 && now - lastChange < COALESCE_MS
      lastChange = now
      if (!grouped) {
        past.value.push(present)
        if (past.value.length > HISTORY_MAX) past.value.shift()
      }
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
    lastChange = 0
    load(JSON.parse(prev))
  }

  function redo() {
    const next = future.value.pop()
    if (next === undefined) return
    past.value.push(present)
    present = next
    lastChange = 0
    load(JSON.parse(next))
  }

  return {
    entities, relations, links,
    editingEntityId, editingRelationId, showSqlModal, showSqlImportModal, showShareModal, showTextPanel, selection, view, mldRelayout, highlightId, flash, copyNodes, paste, duplicateNodes, sqlOptions, canUndo, canRedo,
    schema, issues, weakEntityIds, mld, sql, dialectWarnings, mldWarnings, nodes, edges,
    addEntity, addRelation, addRelationBetween, updateEntity, setParent, setInheritance, inheritanceRoot, childrenOfEntity, updateRelation, addAttribute, updateAttribute, removeAttribute, moveAttribute, removeNode, moveNode, moveNodes, rerouteLinks,
    addLink, updateLink, removeLink, reset, loadExample, importSchema, undo, redo,
  }
})

