/**
 * Partage par lien : le schéma est sérialisé en JSON, compressé (deflate) puis encodé en base64url
 * dans le fragment de l'URL (`#share=…`). Le fragment n'est jamais envoyé au serveur : aucun
 * backend ni stockage n'est nécessaire, le lien contient tout le diagramme.
 */
export const SHARE_PARAM = 'share'
/** Au-delà, certains navigateurs / messageries tronquent ou refusent l'URL. */
export const SHARE_SOFT_LIMIT = 8000
/** Garde-fou contre une « bombe de décompression » dans un lien malveillant. */
const MAX_DECODED_BYTES = 5 * 1024 * 1024

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity) {
  const writer = stream.writable.getWriter()
  // Les erreurs d'écriture remontent aussi via la lecture : on évite un rejet non géré.
  writer.write(data as BufferSource).catch(() => {})
  writer.close().catch(() => {})
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error('Lien de partage trop volumineux.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export async function encodeShare(schema: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(schema))
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
}

/** Lève une Error si le contenu n'est pas un lien de partage lisible. */
export async function decodeShare(payload: string): Promise<unknown> {
  try {
    const raw = await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES)
    return JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new Error('Ce lien de partage est invalide ou corrompu.')
  }
}

export async function buildShareUrl(schema: unknown, base: string): Promise<string> {
  const u = new URL(base)
  u.hash = `${SHARE_PARAM}=${await encodeShare(schema)}`
  return u.toString()
}

/** Extrait la charge utile d'un fragment d'URL (`#share=…`), ou null s'il n'y en a pas. */
export function readShareHash(hash: string): string | null {
  const m = new RegExp(`^#${SHARE_PARAM}=([A-Za-z0-9_-]+)$`).exec(hash)
  return m ? m[1] : null
}
