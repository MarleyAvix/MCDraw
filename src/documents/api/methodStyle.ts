import type { HttpMethod } from './model'

/** Couleur de chaque méthode HTTP (teintes moyennes, lisibles en thème clair comme sombre). */
export const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: '#10b981',
  POST: '#3b82f6',
  PUT: '#f59e0b',
  PATCH: '#8b5cf6',
  DELETE: '#ef4444',
}

export const methodBadgeStyle = (m: HttpMethod) => ({ color: METHOD_COLOR[m], background: `color-mix(in srgb, ${METHOD_COLOR[m]} 16%, transparent)` })
