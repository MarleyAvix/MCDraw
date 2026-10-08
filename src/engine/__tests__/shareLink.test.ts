import { describe, expect, it } from 'vitest'
import { buildShareUrl, decodeShare, encodeShare, readShareHash } from '../shareLink'

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
})
