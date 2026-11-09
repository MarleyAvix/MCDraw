/**
 * Passerelle API → classes : les ressources (schémas) décrites dans l'onglet « API REST » deviennent des classes.
 * - un champ simple devient un attribut ;
 * - un champ qui cite une autre ressource devient une association (multiplicité selon `[]` et `optional`) ;
 * - une énumération en ligne (`enum(draft|paid)`) devient une classe « énumération » et une dépendance.
 */
import { parseTypeExpr, type ApiDocument, type ApiField, type ApiResource } from '../api/model'
import { isValidName, nameFrom, type ClassBox, type ClassDocument, type Relation } from './model'

export interface FromApiOptions {
  /** Noms des ressources à représenter ; absent : toutes. */
  only?: string[]
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Nom de classe valide pour une ressource, ou `''` si rien n'est exploitable. */
const classNameOf = (r: ApiResource) => (isValidName(r.name) ? r.name : nameFrom(r.name))

export function classesFromApi(api: ApiDocument, options: FromApiOptions = {}): ClassDocument {
  const wanted = options.only ? new Set(options.only) : null
  const resources = api.resources.filter((r) => (!wanted || wanted.has(r.name)) && classNameOf(r))
  const names = new Map(resources.map((r) => [r.name, classNameOf(r)]))
  const taken = new Set(names.values())

  const doc: ClassDocument = { classes: [], relations: [] }
  if (api.info.title) doc.title = oneLine(api.info.title).slice(0, 120)

  const uniqueEnum = (base: string) => {
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`
    taken.add(name)
    return name
  }

  for (const r of resources) {
    const box: ClassBox = { name: names.get(r.name)!, kind: 'class', attributes: [], methods: [] }
    const enums: ClassBox[] = []
    const relations: Relation[] = []

    const attribute = (f: ApiField, type: string) => box.attributes.push(`+${oneLine(f.name)}: ${type}${f.optional ? ' [0..1]' : ''}`)

    for (const f of r.fields) {
      const t = parseTypeExpr(f.type)
      if (!t) {
        attribute(f, oneLine(f.type) || 'any')
      } else if (t.kind === 'ref' && names.has(t.name)) {
        // Association vers l'autre ressource : une liste en fait 0..*, un champ facultatif 0..1, sinon exactement 1.
        relations.push({ from: box.name, to: names.get(t.name)!, type: 'association', label: oneLine(f.name), toMult: t.array ? '0..*' : f.optional ? '0..1' : '1' })
      } else if (t.kind === 'enum') {
        const en: ClassBox = { name: uniqueEnum(`${box.name}${capitalize(nameFrom(f.name) || 'Valeur')}`), kind: 'enum', attributes: t.values.slice(), methods: [] }
        enums.push(en)
        attribute(f, `${en.name}${t.array ? '[]' : ''}`)
        relations.push({ from: box.name, to: en.name, type: 'dependency' })
      } else {
        attribute(f, `${t.name}${t.array ? '[]' : ''}`)
      }
    }
    doc.classes.push(box, ...enums)
    doc.relations.push(...relations)
  }
  return doc
}
