import type { SearchHit } from '../../core/documentType'
import type { useSchemaStore } from '../../stores/schemaStore'

/** Tout ce qui est cherchable dans la vue indiquée du MCD (les vues ERD et UML cherchent comme le MCD). */
export function mcdSearchIndex(store: ReturnType<typeof useSchemaStore>, viewId: string): SearchHit[] {
  if (viewId === 'mld') {
    return store.mld.tables.flatMap((t) => [
      { key: `t:${t.name}`, nodeId: t.name, label: t.name, context: t.origin === 'entity' ? 'Table' : 'Table d’association', kind: 'table' as const },
      ...t.columns.map((c) => ({ key: `c:${t.name}.${c.name}`, nodeId: t.name, label: c.name, context: `colonne de ${t.name}`, kind: 'attribute' as const })),
    ])
  }
  return [
    ...store.entities.map((e) => ({ key: e.id, nodeId: e.id, label: e.name, context: 'Entité', kind: 'entity' as const })),
    ...store.relations.map((r) => ({ key: r.id, nodeId: r.id, label: r.name, context: 'Association', kind: 'relation' as const })),
    ...store.entities.flatMap((e) =>
      e.attributes.map((a) => ({ key: a.id, nodeId: e.id, label: a.name, context: `attribut de ${e.name}`, kind: 'attribute' as const })),
    ),
    ...store.relations.flatMap((r) =>
      r.attributes.map((a) => ({ key: a.id, nodeId: r.id, label: a.name, context: `propriété de ${r.name}`, kind: 'attribute' as const })),
    ),
  ]
}
