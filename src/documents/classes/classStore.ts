import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useHistory } from '../../composables/useHistory'
import { usePersistence } from '../../composables/usePersistence'
import { layoutClasses } from './layout'
import {
  classKey,
  classOfKey,
  emptyClasses,
  findClass,
  isClassKey,
  relationKeys,
  relationLabel,
  sanitizeClasses,
  type ClassBox,
  type ClassDocument,
  type RelType,
  type Relation,
} from './model'
import { parseClassText } from './text'

const STORAGE_KEY = 'mcdraw:classes:v1'
/** Copie profonde d'une donnée JSON, y compris un objet réactif (`structuredClone` les refuse). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export interface ClassExample {
  id: string
  label: string
  description: string
  text: string
}

export const CLASS_EXAMPLES: ClassExample[] = [
  {
    id: 'formes',
    label: 'Formes géométriques',
    description: 'Interface, classe abstraite, héritage et réalisation.',
    text: `classDiagram
title Formes géométriques
class Dessinable {
  <<interface>>
  +dessiner() void
}
class Forme {
  <<abstract>>
  #couleur: String
  +aire() double
  +deplacer(dx, dy) void
}
class Cercle {
  -rayon: double
  +aire() double
}
class Rectangle {
  -largeur: double
  -hauteur: double
  +aire() double
}
class Dessin {
  +ajouter(f: Forme) void
}
Dessinable <|.. Forme
Forme <|-- Cercle
Forme <|-- Rectangle
Dessin "1" o-- "0..*" Forme : contient`,
  },
  {
    id: 'bibliotheque',
    label: 'Bibliothèque',
    description: 'Associations avec multiplicités, composition, énumération.',
    text: `classDiagram
title Gestion d'une bibliothèque
class Livre {
  -isbn: String
  -titre: String
  +estDisponible() boolean
}
class Auteur {
  -nom: String
}
class Adherent {
  -numero: int
  -nom: String
  +emprunter(l: Livre) void
}
class Emprunt {
  -dateDebut: Date
  -dateRetour: Date
  +prolonger() void
}
class Statut {
  <<enumeration>>
  DISPONIBLE
  EMPRUNTE
  PERDU
}
Auteur "1..*" -- "0..*" Livre : a écrit
Adherent "1" --> "0..*" Emprunt : effectue
Emprunt "0..*" --> "1" Livre : porte sur
Livre ..> Statut
Livre "1" *-- "1..*" Exemplaire : possède
class Exemplaire {
  -code: String
}`,
  },
]

export const useClassStore = defineStore('classes', () => {
  const doc = ref<ClassDocument>(emptyClasses())
  const selection = ref<string[]>([])
  /** Élément en cours d'édition : `c:Nom`, une clé de relation, ou `doc` pour les réglages généraux. */
  const editing = ref<string | null>(null)
  /** Fenêtre « Depuis l'API » ouverte. */
  const showApiModal = ref(false)
  const showTextPanel = ref(typeof window !== 'undefined' && window.innerWidth >= 1024)
  const highlightId = ref<string | null>(null)
  const view = ref('diagram')
  let highlightTimer: ReturnType<typeof setTimeout> | undefined
  let clipboard: ClassBox[] | null = null

  const schema = computed<ClassDocument>(() => doc.value)
  const layout = computed(() => layoutClasses(doc.value))
  const relKeys = computed(() => relationKeys(doc.value.relations))

  const selectedClasses = computed(() => selection.value.filter(isClassKey).map(classOfKey))
  const selectedRelations = computed(() => selection.value.filter((k) => !isClassKey(k)))

  function flash(key: string) {
    clearTimeout(highlightTimer)
    highlightId.value = key
    highlightTimer = setTimeout(() => (highlightId.value = null), 2200)
  }

  function uniqueName(base: string) {
    const taken = new Set(doc.value.classes.map((c) => c.name.toLowerCase()))
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}${n}`
    return name
  }

  // --- Classes ---------------------------------------------------------------------
  function addClass(): ClassBox {
    const c: ClassBox = { name: uniqueName('Classe'), kind: 'class', attributes: [], methods: [] }
    doc.value.classes.push(c)
    selection.value = [classKey(c.name)]
    editing.value = classKey(c.name)
    return c
  }

  /** Modifie une classe ; un renommage met à jour les relations qui la citent. */
  function setClass(oldName: string, next: ClassBox) {
    const i = doc.value.classes.findIndex((c) => c.name === oldName)
    if (i < 0) return
    const old = doc.value.classes[i]
    // La fenêtre d'édition ne connaît pas la position : on garde celle posée à la main.
    doc.value.classes[i] = old.x !== undefined && old.y !== undefined ? { ...next, x: old.x, y: old.y } : next
    if (oldName !== next.name) {
      for (const r of doc.value.relations) {
        if (r.from === oldName) r.from = next.name
        if (r.to === oldName) r.to = next.name
      }
      selection.value = selection.value.map((k) => (k === classKey(oldName) ? classKey(next.name) : k))
    }
  }

  /** Pose des classes à la main (coin haut gauche, jamais en dehors du dessin). */
  function moveClasses(positions: Record<string, { x: number; y: number }>) {
    for (const c of doc.value.classes) {
      const p = positions[c.name]
      if (!p) continue
      c.x = Math.round(Math.max(0, p.x))
      c.y = Math.round(Math.max(0, p.y))
    }
  }

  /** Rend toutes les classes à la disposition automatique. */
  function autoLayout() {
    for (const c of doc.value.classes) {
      delete c.x
      delete c.y
    }
  }

  /** Nombre de relations qui disparaîtraient avec ces classes. */
  function usageOf(names: string[]): number {
    const gone = new Set(names)
    return doc.value.relations.filter((r) => gone.has(r.from) || gone.has(r.to)).length
  }

  function removeClasses(names: string[]) {
    const gone = new Set(names)
    doc.value.classes = doc.value.classes.filter((c) => !gone.has(c.name))
    doc.value.relations = doc.value.relations.filter((r) => !gone.has(r.from) && !gone.has(r.to))
    pruneSelection()
  }

  // --- Relations -------------------------------------------------------------------
  /** Nouvelle relation entre deux classes sélectionnées (la première hérite de la seconde) ; sinon entre les deux premières. */
  function addRelation(type: RelType = 'association'): Relation | null {
    const names = doc.value.classes.map((c) => c.name)
    if (names.length < 2) return null
    const sel = selectedClasses.value
    const from = sel[0] ?? names[0]
    const to = sel[1] ?? names.find((n) => n !== from)!
    const r: Relation = { from, to, type: sel.length >= 2 ? 'inheritance' : type }
    doc.value.relations.push(r)
    const key = relationKeys(doc.value.relations).at(-1)!
    selection.value = [key]
    editing.value = key
    return r
  }

  function setRelation(key: string, next: Relation) {
    const i = relKeys.value.indexOf(key)
    if (i < 0) return
    doc.value.relations[i] = next
    selection.value = selection.value.map((k) => (k === key ? (relationKeys(doc.value.relations)[i] ?? k) : k))
  }

  function removeRelations(keys: string[]) {
    const gone = new Set(keys)
    const all = relKeys.value
    doc.value.relations = doc.value.relations.filter((_, i) => !gone.has(all[i]))
    pruneSelection()
  }

  function setMeta(meta: { title?: string }) {
    const t = meta.title?.trim()
    if (t) doc.value.title = t
    else delete doc.value.title
  }

  function pruneSelection() {
    const alive = new Set([...doc.value.classes.map((c) => classKey(c.name)), ...relationKeys(doc.value.relations)])
    selection.value = selection.value.filter((k) => alive.has(k))
    if (editing.value && editing.value !== 'doc' && !alive.has(editing.value)) editing.value = null
  }

  /** Supprime la sélection : classes (avec leurs relations) et relations. */
  function removeSelection() {
    const names = selectedClasses.value
    const rels = selectedRelations.value
    if (rels.length) removeRelations(rels)
    if (names.length) removeClasses(names)
  }

  // --- Copier / coller / dupliquer (classes) ---------------------------------------
  function copy(): boolean {
    const boxes = selectedClasses.value.map((n) => findClass(doc.value, n)).filter((c): c is ClassBox => !!c)
    clipboard = boxes.length ? boxes.map(clone) : null
    return !!clipboard
  }

  function paste(): boolean {
    if (!clipboard) return false
    // Une copie posée à la main est décalée pour ne pas se superposer à l'original.
    const fresh = clipboard.map((c) => ({ ...clone(c), name: uniqueName(c.name), ...(c.x !== undefined && c.y !== undefined ? { x: c.x + 30, y: c.y + 30 } : {}) }))
    doc.value.classes.push(...fresh)
    selection.value = fresh.map((c) => classKey(c.name))
    return true
  }

  function duplicate() {
    if (copy()) paste()
  }

  function selectAll() {
    selection.value = [...doc.value.classes.map((c) => classKey(c.name)), ...relKeys.value]
  }

  // --- Recherche -------------------------------------------------------------------
  function searchIndex() {
    const out: { key: string; nodeId: string; label: string; context: string; kind: 'class' | 'relation' }[] = []
    for (const c of doc.value.classes) out.push({ key: classKey(c.name), nodeId: classKey(c.name), label: c.name, context: `${c.attributes.length} attribut(s), ${c.methods.length} méthode(s)`, kind: 'class' })
    doc.value.relations.forEach((r, i) => out.push({ key: relKeys.value[i], nodeId: relKeys.value[i], label: relationLabel(r), context: 'Relation', kind: 'relation' }))
    return out
  }

  // --- Chargement ----------------------------------------------------------------
  function load(s: ClassDocument) {
    doc.value = s
    pruneSelection()
  }
  const importSchema = (raw: unknown) => load(sanitizeClasses(raw))
  const reset = () => load(emptyClasses())
  function loadExample(id: string) {
    const ex = CLASS_EXAMPLES.find((e) => e.id === id)
    if (ex) load(parseClassText(ex.text).doc)
  }

  // --- Sauvegarde locale et historique ------------------------------------------
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) load(sanitizeClasses(JSON.parse(raw)))
    else loadExample(CLASS_EXAMPLES[0].id)
  } catch {
    loadExample(CLASS_EXAMPLES[0].id)
  }
  usePersistence(schema, STORAGE_KEY)
  const { undo, redo, canUndo, canRedo } = useHistory({ state: schema, load })

  return {
    doc, selection, editing, showApiModal, showTextPanel, highlightId, view,
    schema, layout, relKeys, selectedClasses, selectedRelations,
    flash, addClass, setClass, moveClasses, autoLayout, usageOf, removeClasses, addRelation, setRelation, removeRelations, setMeta, removeSelection,
    copy, paste, duplicate, selectAll, searchIndex, load, importSchema, reset, loadExample,
    undo, redo, canUndo, canRedo,
  }
})
