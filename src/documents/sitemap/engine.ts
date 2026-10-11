/**
 * Moteur du sitemap : un arbre de pages. L'ordre du tableau est l'ordre des pages sœurs.
 * Tout ici est pur (pas de Vue, pas de DOM) : saisie texte, export Markdown / sitemap.xml, validation.
 */

export interface SitemapPage {
  id: string
  title: string
  /** Page mère ; absent pour une racine. */
  parentId?: string
  /** Chemin (`/produits`) ou adresse complète. */
  url?: string
  note?: string
}

export interface SitemapSchema {
  pages: SitemapPage[]
}

export interface ParseError {
  line: number
  message: string
}

export const emptySitemap = (): SitemapSchema => ({ pages: [] })

// --- Arbre -----------------------------------------------------------------

export const childrenOf = (pages: SitemapPage[], id: string | undefined) => pages.filter((p) => p.parentId === id)

/** Les racines : pages sans mère (ou dont la mère n'existe pas). */
export function rootsOf(pages: SitemapPage[]) {
  const ids = new Set(pages.map((p) => p.id))
  return pages.filter((p) => !p.parentId || !ids.has(p.parentId))
}

/** Page et toutes ses descendantes. */
export function subtreeIds(pages: SitemapPage[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of pages) {
      if (p.parentId && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id)
        grew = true
      }
    }
  }
  return out
}

/** Profondeur de chaque page (racine = 0). */
export function depths(pages: SitemapPage[]): Map<string, number> {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const out = new Map<string, number>()
  const depthOf = (p: SitemapPage, seen = new Set<string>()): number => {
    const known = out.get(p.id)
    if (known !== undefined) return known
    const parent = p.parentId ? byId.get(p.parentId) : undefined
    const d = parent && !seen.has(parent.id) ? depthOf(parent, seen.add(p.id)) + 1 : 0
    out.set(p.id, d)
    return d
  }
  for (const p of pages) depthOf(p)
  return out
}

/**
 * Échange la page avec sa sœur précédente (`dir` -1) ou suivante (+1). L'ordre des sœurs est celui du tableau :
 * échanger les deux entrées suffit, les sous-pages suivent leur mère. Renvoie `null` s'il n'y a pas de sœur de ce côté.
 */
export function movePage(pages: SitemapPage[], id: string, dir: -1 | 1): SitemapPage[] | null {
  const page = pages.find((p) => p.id === id)
  if (!page) return null
  const sibs = pages.filter((p) => (p.parentId ?? undefined) === (page.parentId ?? undefined))
  const other = sibs[sibs.indexOf(page) + dir]
  if (!other) return null
  const next = [...pages]
  const [i, j] = [pages.indexOf(page), pages.indexOf(other)]
  next[i] = other
  next[j] = page
  return next
}

/** Parcours en profondeur dans l'ordre d'affichage. */
export function walk(pages: SitemapPage[]): { page: SitemapPage; depth: number }[] {
  const out: { page: SitemapPage; depth: number }[] = []
  const visit = (p: SitemapPage, depth: number) => {
    out.push({ page: p, depth })
    for (const c of childrenOf(pages, p.id)) visit(c, depth + 1)
  }
  for (const r of rootsOf(pages)) visit(r, 0)
  return out
}

/**
 * Mise en page en arbre, de haut en bas : les sœurs se suivent de gauche à droite dans l'ordre du plan, et chaque page
 * est centrée au-dessus de ses enfants. Déterministe, contrairement à un placement générique qui peut réordonner les sœurs.
 */
export function layoutTree(pages: SitemapPage[], size: { w: number; h: number }, gap: { x: number; y: number }): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  let cursor = 0
  const place = (p: SitemapPage, depth: number): number => {
    if (out.has(p.id)) return out.get(p.id)!.x // garde-fou contre un cycle
    out.set(p.id, { x: 0, y: depth * (size.h + gap.y) })
    const kids = childrenOf(pages, p.id)
    let x: number
    if (!kids.length) {
      x = cursor
      cursor += size.w + gap.x
    } else {
      const xs = kids.map((k) => place(k, depth + 1))
      x = (xs[0] + xs[xs.length - 1]) / 2
    }
    out.get(p.id)!.x = x
    return x
  }
  for (const r of rootsOf(pages)) place(r, 0)
  return out
}

// --- Texte indenté -----------------------------------------------------------
//
//   Accueil /
//     Produits /produits -- le catalogue
//       Chaussures /produits/chaussures
//     Contact /contact
//
// Une page par ligne ; l'indentation donne la hiérarchie. Après le titre : l'adresse (dernier mot commençant par « / »
// ou « http »), puis « -- » et une note. Commentaires : « // » en début de ligne.

const NOTE_SEP = ' -- '
const isUrl = (w: string) => w.startsWith('/') || /^https?:\/\//i.test(w)

export function sitemapToText(schema: SitemapSchema): string {
  return walk(schema.pages)
    .map(({ page, depth }) => `${'  '.repeat(depth)}${page.title}${page.url ? ` ${page.url}` : ''}${page.note ? `${NOTE_SEP}${page.note}` : ''}`)
    .join('\n')
}

/** Largeur d'indentation d'une ligne (une tabulation compte pour deux espaces). */
const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, '  ').length

export function parseSitemapText(text: string, makeId: () => string): { schema: SitemapSchema; errors: ParseError[] } {
  const pages: SitemapPage[] = []
  const errors: ParseError[] = []
  const stack: { indent: number; id: string }[] = []

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    if (!raw.trim() || raw.trim().startsWith('//')) return
    const indent = indentOf(raw)

    let body = raw.trim()
    let note: string | undefined
    const sep = /\s--(\s|$)/.exec(body)
    if (sep) {
      note = body.slice(sep.index + sep[0].length).trim() || undefined
      body = body.slice(0, sep.index).trim()
    }
    const words = body.split(/\s+/)
    let url: string | undefined
    if (words.length > 1 && isUrl(words[words.length - 1])) url = words.pop()
    else if (words.length === 1 && isUrl(words[0])) {
      errors.push({ line, message: 'Titre manquant avant l’adresse.' })
      return
    }
    const title = words.join(' ')

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (!stack.length && indent > 0 && pages.length === 0) {
      errors.push({ line, message: 'La première page ne doit pas être indentée.' })
      return
    }
    const parent = stack[stack.length - 1]
    const id = makeId()
    pages.push({ id, title, ...(parent ? { parentId: parent.id } : {}), ...(url ? { url } : {}), ...(note ? { note } : {}) })
    stack.push({ indent, id })
  })

  return { schema: { pages }, errors }
}

/**
 * Réapplique un texte sur un arbre existant : une page garde son identifiant (donc sa sélection) quand son chemin
 * de titres est inchangé. Les titres identiques sous une même mère sont appariés dans l'ordre.
 */
export function mergeSitemap(existing: SitemapSchema, fresh: SitemapSchema): SitemapSchema {
  const keyOf = (pages: SitemapPage[]) => {
    const byId = new Map(pages.map((p) => [p.id, p]))
    const seen = new Map<string, number>()
    const out = new Map<string, string>()
    const path = (p: SitemapPage): string => (p.parentId && byId.has(p.parentId) ? `${path(byId.get(p.parentId)!)}/` : '') + p.title
    for (const p of pages) {
      const base = path(p)
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      out.set(p.id, `${base}#${n}`)
    }
    return out
  }
  const old = new Map([...keyOf(existing.pages)].map(([id, k]) => [k, id]))
  const keys = keyOf(fresh.pages)
  const remap = new Map<string, string>()
  for (const p of fresh.pages) remap.set(p.id, old.get(keys.get(p.id)!) ?? p.id)
  return { pages: fresh.pages.map((p) => ({ ...p, id: remap.get(p.id)!, ...(p.parentId ? { parentId: remap.get(p.parentId)! } : {}) })) }
}

// --- Exports -----------------------------------------------------------------

export function sitemapToMarkdown(schema: SitemapSchema): string {
  return walk(schema.pages)
    .map(({ page, depth }) => {
      const label = page.url ? `[${page.title}](${page.url})` : page.title
      return `${'  '.repeat(depth)}- ${label}${page.note ? ` — ${page.note}` : ''}`
    })
    .join('\n')
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Adresse absolue d'une page : `/a` est rattaché au site, une adresse complète est gardée telle quelle. */
export function absoluteUrl(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
}

/** `sitemap.xml` au format sitemaps.org ; les pages sans adresse ne sont pas des URL et sont omises. */
export function sitemapToXml(schema: SitemapSchema, baseUrl: string): string {
  const seen = new Set<string>()
  const locs = walk(schema.pages)
    .flatMap(({ page }) => (page.url ? [absoluteUrl(baseUrl, page.url)] : []))
    .filter((u) => (seen.has(u) ? false : (seen.add(u), true)))
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n')
}

// --- Validation d'une source externe -------------------------------------------

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/**
 * Valide un schéma venu de l'extérieur (fichier, lien, sauvegarde) : champs complétés, identifiants manquants ou en double
 * régénérés, mère inconnue retirée, cycles coupés. Lève une Error si la structure est inutilisable.
 */
export function sanitizeSitemap(raw: unknown, makeId: () => string): SitemapSchema {
  const list = typeof raw === 'object' && raw !== null ? (raw as { pages?: unknown }).pages : undefined
  if (!Array.isArray(list)) throw new Error('Fichier invalide : liste de pages manquante.')

  const used = new Set<string>()
  const pages: SitemapPage[] = list
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r))
    .map((r) => {
      let id = typeof r.id === 'string' && r.id && !used.has(r.id) ? r.id : makeId()
      while (used.has(id)) id = makeId()
      used.add(id)
      const url = str(r.url).trim()
      const note = str(r.note).trim()
      return {
        id,
        title: str(r.title),
        ...(typeof r.parentId === 'string' && r.parentId ? { parentId: r.parentId } : {}),
        ...(url ? { url } : {}),
        ...(note ? { note } : {}),
      }
    })

  const ids = new Set(pages.map((p) => p.id))
  const byId = new Map(pages.map((p) => [p.id, p]))
  for (const p of pages) {
    if (p.parentId && (!ids.has(p.parentId) || p.parentId === p.id)) delete p.parentId
  }
  // Coupe les cycles : en remontant depuis chaque page, on détache celle qui boucle.
  for (const p of pages) {
    const seen = new Set<string>([p.id])
    let cur = p
    while (cur.parentId) {
      if (seen.has(cur.parentId)) {
        delete cur.parentId
        break
      }
      seen.add(cur.parentId)
      cur = byId.get(cur.parentId)!
    }
  }
  return { pages }
}
