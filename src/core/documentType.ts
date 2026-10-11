import type { Component, ComputedRef, Ref } from 'vue'

/**
 * Contrat d'un type de document (MCD, sitemap…).
 *
 * Le shell (en-tête, historique, partage, export, raccourcis communs) ne connaît que ces interfaces :
 * tout ce qui est propre à un type — son état, son canvas, ses actions de création — reste de son côté.
 * L'état d'un document est une donnée JSON pure : c'est ce qui permet d'en garder l'historique, de le sauvegarder,
 * de le partager par lien et de l'exporter sans rien savoir de son contenu.
 */

export interface Point {
  x: number
  y: number
}

/** Résultat de recherche ; `nodeId` désigne le nœud à cibler dans le canvas de la vue. */
export interface SearchHit {
  key: string
  nodeId: string
  label: string
  context: string
  kind: 'entity' | 'relation' | 'table' | 'attribute' | 'page'
}

/** Ce que le shell sait faire d'un document, quel que soit son type. Chaque type l'implémente avec son propre store. */
export interface DocumentApi<S = unknown> {
  /** État complet et sérialisable ; observé par l'historique, la sauvegarde et le partage. */
  schema: ComputedRef<S>
  /** Valide puis charge des données externes (fichier, lien, ancienne sauvegarde). Lève une `Error` si elles sont inutilisables. */
  importRaw(raw: unknown): void
  reset(): void
  loadExample(id: string): void
  undo(): void
  redo(): void
  canUndo: Readonly<Ref<boolean>>
  canRedo: Readonly<Ref<boolean>>
  /** Identifiant de la vue affichée (`DocumentView.id`). */
  view: Ref<string>
  selection: Ref<string[]>
  selectAll(): void
  copy(): void
  paste(): void
  duplicate(): void
  /** Fait clignoter un nœud (résultat de recherche). */
  flash(id: string): void
  /** Éléments cherchables dans la vue indiquée. */
  searchIndex(viewId: string): SearchHit[]
}

export interface ActionContext<S = unknown> {
  doc: DocumentApi<S>
  /** Vue actuellement affichée. */
  viewId: string
  /** Point libre au centre de la zone visible, pour y poser un nouvel élément. */
  spawn(): Point
}

export interface DocumentAction<S = unknown> {
  id: string
  label?: string
  title?: string
  icon: Component
  /** Raccourci affiché dans l'info-bulle (la touche elle-même se déclare dans `shortcuts`). */
  hint?: string
  /** Couleur de l'icône (classe CSS). */
  iconClass?: string
  /** Regroupement dans la barre du canvas : création | outils (avec annuler / rétablir) | action destructive. */
  group?: 'create' | 'tools' | 'danger'
  /** Mise en avant (bouton plein). */
  primary?: boolean
  /** Vues où l'action apparaît (toutes si absent). */
  views?: string[]
  run(ctx: ActionContext<S>): void
  /** Bouton enfoncé (bascule d'un panneau). */
  pressed?(ctx: ActionContext<S>): boolean
  disabled?(ctx: ActionContext<S>): boolean
}

/** Touche simple (sans Ctrl) propre au type, ex : N pour une entité. Les raccourcis communs sont dans le shell. */
export interface DocumentShortcut<S = unknown> {
  key: string
  label: string
  run(ctx: ActionContext<S>): void
}

/** Une façon d'afficher le document : le canvas d'édition, ou une vue dérivée (MLD, ERD…). */
export interface DocumentView {
  id: string
  label: string
  title: string
  /** Identifiant de l'instance Vue Flow du canvas : sert à l'export image, au recadrage et à la position d'insertion. */
  flowId: string
  Component: Component
  props?: Record<string, unknown>
  searchPlaceholder?: string
  /** Vue où l'on édite : raccourcis, copier-coller et lien de partage s'y appliquent. */
  editable: boolean
}

export interface DocumentPanel {
  id: string
  /** `canvas` : posé par-dessus le canvas. */
  side: 'left' | 'right' | 'canvas'
  Component: Component
  /** Largeur en pixels des panneaux latéraux. */
  width?: number
  /** Repliable : le shell tient l'état (mémorisé sous `storageKey`) et passe au composant la prop `open` et l'événement `toggle`. */
  collapsible?: { storageKey: string }
  visible(viewId: string): boolean
}

/** Fenêtre modale, affichée tant que `visible()` est vrai. `key` force son recréation quand l'objet édité change. */
export interface DocumentModal {
  id: string
  Component: Component
  visible(): boolean
  key?(): string | null
}

export interface ExampleGroup {
  category: string
  title: string
}

export interface DocumentExample {
  id: string
  label: string
  description?: string
  category: string
}

export interface DocumentType<S = unknown> {
  /** Sert de préfixe au stockage et au lien de partage : ne change jamais. */
  id: string
  label: string
  tagline: string
  icon: Component
  /** Nom du fichier JSON exporté, sans extension. */
  fileName: string

  useDocument(): DocumentApi<S>
  examples: DocumentExample[]
  exampleGroups: ExampleGroup[]

  views: DocumentView[]
  panels: DocumentPanel[]
  modals: DocumentModal[]
  /** Boutons du canvas, hors annuler / rétablir (fournis par le shell). */
  actions: DocumentAction<S>[]
  /** Entrées de l'en-tête propres au type (ex : import / export SQL). */
  headerActions: DocumentAction<S>[]
  shortcuts: DocumentShortcut<S>[]
}

// --- Registre ---------------------------------------------------------------

const registry = new Map<string, DocumentType<any>>()

export function registerDocumentType<S>(type: DocumentType<S>) {
  registry.set(type.id, type)
}

export const documentTypes = (): DocumentType<any>[] => [...registry.values()]
export const getDocumentType = (id: string): DocumentType<any> | undefined => registry.get(id)
