import { describe, expect, it } from 'vitest'
import {
  absoluteUrl,
  depths,
  layoutTree,
  mergeSitemap,
  parseSitemapText,
  sanitizeSitemap,
  sitemapToMarkdown,
  sitemapToText,
  sitemapToXml,
  subtreeIds,
  walk,
} from '../engine'

const counter = () => {
  let n = 0
  return () => `p${++n}`
}

const TEXT = `Accueil /
  Produits /produits -- le catalogue
    Chaussures /produits/chaussures
  Contact /contact
Mentions légales /mentions`

const parse = (t = TEXT) => parseSitemapText(t, counter())

describe('saisie texte', () => {
  it('construit l’arbre d’après l’indentation, avec adresse et note', () => {
    const { schema, errors } = parse()
    expect(errors).toEqual([])
    const by = Object.fromEntries(schema.pages.map((p) => [p.title, p]))
    expect(schema.pages).toHaveLength(5)
    expect(by['Accueil'].parentId).toBeUndefined()
    expect(by['Produits'].parentId).toBe(by['Accueil'].id)
    expect(by['Chaussures'].parentId).toBe(by['Produits'].id)
    expect(by['Contact'].parentId).toBe(by['Accueil'].id)
    expect(by['Mentions légales'].parentId).toBeUndefined()
    expect(by['Produits']).toMatchObject({ url: '/produits', note: 'le catalogue' })
    expect(by['Mentions légales'].url).toBe('/mentions')
  })

  it('aller-retour texte → arbre → texte', () => {
    expect(sitemapToText(parse().schema)).toBe(TEXT)
  })

  it('accepte les tabulations, les lignes vides et les commentaires', () => {
    const { schema, errors } = parse('// plan\nA\n\tB\n\n\t\tC\n')
    expect(errors).toEqual([])
    expect(depths(schema.pages).get(schema.pages[2].id)).toBe(2)
  })

  it('garde un titre à plusieurs mots et distingue une adresse complète', () => {
    const { schema } = parse('Nos produits phares https://ex.fr/p -- à voir')
    expect(schema.pages[0]).toMatchObject({ title: 'Nos produits phares', url: 'https://ex.fr/p', note: 'à voir' })
  })

  it('« -- » collé à un mot n’est pas un séparateur de note', () => {
    expect(parse('Pré--fixe').schema.pages[0]).toMatchObject({ title: 'Pré--fixe' })
    expect(parse('Pré--fixe').schema.pages[0].note).toBeUndefined()
  })

  it('signale les lignes invalides avec leur numéro', () => {
    expect(parse('  Indentée').errors).toEqual([{ line: 1, message: expect.stringContaining('première page') }])
    expect(parse('A\n/seule').errors).toEqual([{ line: 2, message: expect.stringContaining('Titre manquant') }])
  })

  it('une dé-indentation vers un niveau intermédiaire rattache à la page de niveau inférieur', () => {
    const { schema, errors } = parse('A\n    B\n  C')
    expect(errors).toEqual([])
    expect(schema.pages[2].parentId).toBe(schema.pages[0].id)
  })

  it('remonte de plusieurs niveaux d’un coup', () => {
    const { schema } = parse('A\n  B\n    C\n      D\nE')
    expect(depths(schema.pages).get(schema.pages[4].id)).toBe(0)
    expect(schema.pages[4].parentId).toBeUndefined()
  })
})

describe('mergeSitemap', () => {
  it('conserve les identifiants des pages dont le chemin est inchangé', () => {
    const before = parse().schema
    const after = mergeSitemap(before, parseSitemapText(TEXT.replace('Contact /contact', 'Nous écrire /contact'), () => 'x' + Math.random()).schema)
    const idOf = (s: typeof before, t: string) => s.pages.find((p) => p.title === t)?.id
    for (const t of ['Accueil', 'Produits', 'Chaussures', 'Mentions légales']) expect(idOf(after, t)).toBe(idOf(before, t))
    expect(idOf(after, 'Nous écrire')).not.toBe(idOf(before, 'Contact'))
    expect(after.pages.find((p) => p.title === 'Nous écrire')!.parentId).toBe(idOf(before, 'Accueil'))
  })

  it('apparie les titres identiques dans l’ordre', () => {
    const before = parse('A\nA\nA').schema
    const after = mergeSitemap(before, parseSitemapText('A\nA', () => 'n' + Math.random()).schema)
    expect(after.pages.map((p) => p.id)).toEqual([before.pages[0].id, before.pages[1].id])
  })
})

describe('arbre', () => {
  it('subtreeIds et walk', () => {
    const { schema } = parse()
    const produits = schema.pages.find((p) => p.title === 'Produits')!
    expect([...subtreeIds(schema.pages, produits.id)].sort()).toEqual([produits.id, schema.pages.find((p) => p.title === 'Chaussures')!.id].sort())
    expect(walk(schema.pages).map((x) => `${x.depth}:${x.page.title}`)).toEqual(['0:Accueil', '1:Produits', '2:Chaussures', '1:Contact', '0:Mentions légales'])
  })
})

describe('exports', () => {
  it('Markdown : liste imbriquée avec liens et notes', () => {
    expect(sitemapToMarkdown(parse().schema)).toBe(
      ['- [Accueil](/)', '  - [Produits](/produits) — le catalogue', '    - [Chaussures](/produits/chaussures)', '  - [Contact](/contact)', '- [Mentions légales](/mentions)'].join('\n'),
    )
  })

  it('sitemap.xml : URL absolues, sans doublon, sans page sans adresse, échappé', () => {
    const { schema } = parse('Accueil /\n  Sans adresse\n  Recherche /q?a=1&b=2\n  Doublon /\n  Externe https://autre.fr/x')
    const xml = sitemapToXml(schema, 'https://ex.fr/')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://ex.fr/</loc>')
    expect(xml).toContain('<loc>https://ex.fr/q?a=1&amp;b=2</loc>')
    expect(xml).toContain('<loc>https://autre.fr/x</loc>')
    expect(xml.match(/<url>/g)).toHaveLength(3)
    expect(xml).not.toContain('Sans adresse')
  })

  it('absoluteUrl', () => {
    expect(absoluteUrl('https://ex.fr/', '/a')).toBe('https://ex.fr/a')
    expect(absoluteUrl('https://ex.fr', 'a')).toBe('https://ex.fr/a')
    expect(absoluteUrl('https://ex.fr', 'http://z.fr/a')).toBe('http://z.fr/a')
  })
})

describe('sanitizeSitemap', () => {
  const id = counter()
  it('refuse une structure inutilisable', () => {
    expect(() => sanitizeSitemap(null, id)).toThrow()
    expect(() => sanitizeSitemap({ entities: [] }, id)).toThrow()
  })

  it('complète, déduplique et retire les références cassées', () => {
    const { pages } = sanitizeSitemap({ pages: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B', parentId: 'zzz' }, { title: 12, url: '  /x ' }, 'poubelle'] }, counter())
    expect(pages).toHaveLength(3)
    expect(new Set(pages.map((p) => p.id)).size).toBe(3)
    expect(pages[1].parentId).toBeUndefined()
    expect(pages[2]).toMatchObject({ title: '12', url: '/x' })
  })

  it('coupe les cycles et les auto-références', () => {
    const { pages } = sanitizeSitemap({ pages: [{ id: 'a', title: 'A', parentId: 'b' }, { id: 'b', title: 'B', parentId: 'a' }, { id: 'c', title: 'C', parentId: 'c' }] }, counter())
    expect(pages.filter((p) => !p.parentId).length).toBeGreaterThanOrEqual(2)
    expect(pages.find((p) => p.id === 'c')!.parentId).toBeUndefined()
    expect(walk(pages)).toHaveLength(3)
  })
})

describe('layoutTree', () => {
  const size = { w: 100, h: 40 }
  const gap = { x: 20, y: 60 }
  const pos = (lines: string[]) => {
    const { schema } = parse(lines.join(String.fromCharCode(10)))
    const m = layoutTree(schema.pages, size, gap)
    return Object.fromEntries(schema.pages.map((p) => [p.title, m.get(p.id)!]))
  }

  it('range les sœurs de gauche à droite dans l’ordre du plan', () => {
    const p = pos(['R', '  A', '  B', '  C'])
    expect(p.A.x).toBeLessThan(p.B.x)
    expect(p.B.x).toBeLessThan(p.C.x)
    expect(p.B.x - p.A.x).toBe(size.w + gap.x)
  })

  it('centre la mère au-dessus de ses enfants et descend d’un rang par niveau', () => {
    const p = pos(['R', '  A', '  B', '  C'])
    expect(p.R.x).toBe(p.B.x)
    expect(p.R.y).toBe(0)
    expect(p.A.y).toBe(size.h + gap.y)
  })

  it('ne fait pas se chevaucher deux sous-arbres voisins', () => {
    const p = pos(['R', '  A', '    A1', '    A2', '    A3', '  B', '    B1'])
    expect(p.B1.x).toBeGreaterThanOrEqual(p.A3.x + size.w + gap.x)
  })

  it('place les racines côte à côte', () => {
    const p = pos(['X', 'Y'])
    expect(p.Y.x - p.X.x).toBe(size.w + gap.x)
    expect(p.X.y).toBe(p.Y.y)
  })
})
