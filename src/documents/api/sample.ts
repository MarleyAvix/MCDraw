import { parseTypeExpr, type ApiDocument } from './model'

const SAMPLES: Record<string, unknown> = {
  string: 'exemple',
  int: 1,
  number: 1.5,
  bool: true,
  date: '2024-01-01',
  datetime: '2024-01-01T12:00:00Z',
  uuid: '00000000-0000-4000-8000-000000000000',
  email: 'exemple@exemple.fr',
  url: 'https://exemple.fr',
  any: 'valeur',
}

/** Valeur d'exemple d'un type, pour les corps de requête de la documentation et du fichier `.http`. */
export function sampleOf(type: string, api: ApiDocument, seen: string[] = []): unknown {
  const t = parseTypeExpr(type)
  if (!t) return null
  let one: unknown
  if (t.kind === 'prim') one = SAMPLES[t.name]
  else if (t.kind === 'enum') one = t.values[0]
  else {
    const res = api.resources.find((r) => r.name === t.name)
    // Une référence circulaire (User → Order → User) s'arrête au lieu de boucler.
    one = !res || seen.includes(t.name) ? {} : Object.fromEntries(res.fields.map((f) => [f.name, sampleOf(f.type, api, [...seen, t.name])]))
  }
  return t.array ? [one] : one
}

/** Texte d'une valeur d'exemple dans une URL ou un en-tête. */
export const sampleText = (type: string, api: ApiDocument) => String(sampleOf(type, api))
