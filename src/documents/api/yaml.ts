/**
 * Sérialiseur YAML minimal, suffisant pour un document OpenAPI : objets, listes, chaînes, nombres, booléens.
 * Les chaînes ambiguës sont écrites entre guillemets (la notation JSON d'une chaîne est du YAML valide).
 */

const RESERVED = /^(true|false|null|yes|no|on|off|y|n|~)$/i
const PLAIN = /^[A-Za-z_][A-Za-z0-9_ ./-]*$/

function scalar(v: unknown, key = false): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v === null || v === undefined) return 'null'
  const s = String(v)
  const plain = key ? /^[$A-Za-z_][\w$.-]*$/.test(s) : PLAIN.test(s) && !s.endsWith(' ')
  return plain && !RESERVED.test(s) ? s : JSON.stringify(s)
}

const isEmptyContainer = (v: unknown) => (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0)
const inline = (v: unknown) => (Array.isArray(v) ? '[]' : '{}')

function lines(value: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'object' && item !== null && !isEmptyContainer(item)) {
        const inner = lines(item, indent + 2)
        inner[0] = `${pad}- ${inner[0].slice(indent + 2)}`
        return inner
      }
      return [`${pad}- ${isEmptyContainer(item) ? inline(item) : scalar(item)}`]
    })
  }
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .flatMap(([k, v]) => {
      const key = scalar(k, true)
      if (typeof v === 'object' && v !== null) return isEmptyContainer(v) ? [`${pad}${key}: ${inline(v)}`] : [`${pad}${key}:`, ...lines(v, indent + 2)]
      return [`${pad}${key}: ${scalar(v)}`]
    })
}

export function toYaml(value: unknown): string {
  if (typeof value !== 'object' || value === null || isEmptyContainer(value)) return `${typeof value === 'object' && value !== null ? inline(value) : scalar(value)}\n`
  return `${lines(value, 0).join('\n')}\n`
}
