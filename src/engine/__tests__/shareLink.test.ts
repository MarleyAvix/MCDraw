import { describe, expect, it } from 'vitest'
import { buildShareUrl, decodeShare, encodeShare, readShare, readShareHash } from '../shareLink'

const schema = {
  entities: [{ id: 'a', name: 'Cliente é à ü', attributes: [{ id: 'x', name: 'nom' }], x: 1, y: 2 }],
  relations: [],
  links: [],
}

describe('shareLink', () => {
  it('fait un aller-retour sans perte (accents inclus)', async () => {
    expect(await decodeShare(await encodeShare(schema))).toEqual(schema)
  })

  it("produit une URL dont le fragment est relu par readShareHash", async () => {
    const url = new URL(await buildShareUrl(schema, 'https://mcdraw.example/app?x=1'))
    const payload = readShareHash(url.hash)
    expect(payload).not.toBeNull()
    expect(await decodeShare(payload!)).toEqual(schema)
  })

  it('rejette un contenu invalide', async () => {
    await expect(decodeShare('pas-un-lien')).rejects.toThrow(/invalide/)
  })

  it('ignore les fragments sans paramètre share', () => {
    expect(readShareHash('')).toBeNull()
    expect(readShareHash('#autre=1')).toBeNull()
  })

  it('refuse une bombe de décompression', async () => {
    const big = await encodeShare({ pad: 'a'.repeat(6 * 1024 * 1024) })
    await expect(decodeShare(big)).rejects.toThrow(/invalide/)
  })

  it('le MCD garde le fragment historique ; un autre type est préfixé', async () => {
    const mcd = await buildShareUrl(schema, 'http://x/')
    const sitemap = await buildShareUrl(schema, 'http://x/', 'sitemap')
    expect(new URL(mcd).hash).toMatch(/^#share=/)
    expect(new URL(sitemap).hash).toMatch(/^#share\.sitemap=/)
    expect(readShare(new URL(mcd).hash)?.type).toBe('mcd')
    expect(readShare(new URL(sitemap).hash)?.type).toBe('sitemap')
    expect(readShare(new URL(sitemap).hash)?.payload).toBe(readShare(new URL(mcd).hash)?.payload)
  })

  it('readShare refuse les fragments mal formés', () => {
    for (const h of ['', '#', '#share', '#share=', '#share.=abc', '#share.Sitemap=abc', '#autre=abc', '#share=a b']) expect(readShare(h)).toBeNull()
    expect(readShareHash('#share.sitemap=abc')).toBeNull() // l'ancienne lecture ne confond pas les types
  })
})
