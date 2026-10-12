/** Éléments communs aux exports C# : types, échappements, identifiants. */

/** Type C# de chaque type primitif de l'API. */
export const CS_PRIMITIVE: Record<string, string> = { string: 'string', email: 'string', url: 'string', uuid: 'Guid', int: 'int', number: 'double', bool: 'bool', date: 'DateOnly', datetime: 'DateTime', any: 'string' }

/** Texte sûr dans un commentaire XML (`/// <summary>`). */
export const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Littéral de chaîne C# entre guillemets. */
export const csString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const KEYWORDS = new Set(
  'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while'.split(' '),
)

/** `user-id` → `userId`, `filter[status]` → `filterStatus`, `class` → `@class` : un identifiant de variable valable. */
export function camelIdent(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  let id = parts.map((p, i) => (i === 0 ? p[0].toLowerCase() + p.slice(1) : p[0].toUpperCase() + p.slice(1))).join('')
  if (!id) id = 'value'
  if (/^\d/.test(id)) id = `_${id}`
  return KEYWORDS.has(id) ? `@${id}` : id
}
