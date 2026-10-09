import type { GraphNode } from '@vue-flow/core'

export interface Pt {
  x: number
  y: number
}

interface Shape {
  center: Pt
  w: number
  h: number
  ellipse: boolean
  /** Losange (association n-aire UML). */
  diamond?: boolean
}

/** Forme d'un nœud du MCD : ovale pour une association sans propriété, rectangle sinon. */
export function shapeOf(node: GraphNode): Shape {
  const { x, y } = node.computedPosition
  const w = node.dimensions?.width || 140
  const h = node.dimensions?.height || 60
  const attrs = (node.data as { attributes?: unknown[] } | undefined)?.attributes
  return { center: { x: x + w / 2, y: y + h / 2 }, w, h, ellipse: node.type === 'relation' && !attrs?.length, diamond: node.type === 'umlDiamond' }
}

/** Point où le rayon P→Q quitte la forme (P est à l'intérieur de la forme). */
function exitPoint(s: Shape, p: Pt, q: Pt): Pt {
  const dx = q.x - p.x
  const dy = q.y - p.y
  if (!dx && !dy) return p
  const hw = s.w / 2
  const hh = s.h / 2
  let t: number
  if (s.diamond) {
    // |ox + t·dx| / hw + |oy + t·dy| / hh = 1 : fonction croissante de t depuis l'intérieur, recherche par dichotomie
    const ox = p.x - s.center.x
    const oy = p.y - s.center.y
    const f = (u: number) => Math.abs(ox + u * dx) / hw + Math.abs(oy + u * dy) / hh
    let lo = 0
    let hi = 1
    while (f(hi) < 1 && hi < 1e6) hi *= 2
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (f(mid) < 1) lo = mid
      else hi = mid
    }
    t = lo
  } else if (s.ellipse) {
    // |((p + t·d) − c) / (a, b)|² = 1, racine positive
    const ox = p.x - s.center.x
    const oy = p.y - s.center.y
    const a = (dx / hw) ** 2 + (dy / hh) ** 2
    const b = 2 * ((ox * dx) / hw ** 2 + (oy * dy) / hh ** 2)
    const c = (ox / hw) ** 2 + (oy / hh) ** 2 - 1
    t = (-b + Math.sqrt(Math.max(b * b - 4 * a * c, 0))) / (2 * a)
  } else {
    const tx = dx ? (Math.sign(dx) * hw - (p.x - s.center.x)) / dx : Infinity
    const ty = dy ? (Math.sign(dy) * hh - (p.y - s.center.y)) / dy : Infinity
    t = Math.min(tx, ty)
  }
  return { x: p.x + dx * Math.max(t, 0), y: p.y + dy * Math.max(t, 0) }
}

export interface FloatingLine {
  source: Pt
  target: Pt
  /** Vecteur unitaire de la source vers la cible. */
  dir: Pt
  /** Normale unitaire, orientée vers le haut (ou la droite pour un trait vertical). */
  normal: Pt
}

/**
 * Extrémités d'un trait « flottant » : il rejoint le bord de chaque forme sur la droite des centres,
 * au lieu d'un point d'accroche fixe. `shift` décale la droite perpendiculairement (traits parallèles
 * d'une association réflexive).
 */
export function floatingLine(a: GraphNode, b: GraphNode, shift = 0): FloatingLine {
  const sa = shapeOf(a)
  const sb = shapeOf(b)
  const len = Math.hypot(sb.center.x - sa.center.x, sb.center.y - sa.center.y) || 1
  const dir = { x: (sb.center.x - sa.center.x) / len, y: (sb.center.y - sa.center.y) / len }
  let normal = { x: -dir.y, y: dir.x }
  if (normal.y > 0 || (normal.y === 0 && normal.x < 0)) normal = { x: -normal.x, y: -normal.y }
  const off = (c: Pt): Pt => ({ x: c.x + normal.x * shift, y: c.y + normal.y * shift })
  const pa = off(sa.center)
  const pb = off(sb.center)
  return { source: exitPoint(sa, pa, pb), target: exitPoint(sb, pb, pa), dir, normal }
}

/** Point du bord d'un nœud sur la droite qui joint son centre au point `q`. */
export function exitToward(node: GraphNode, q: Pt): Pt {
  const s = shapeOf(node)
  return exitPoint(s, s.center, q)
}

export interface LinkPath extends FloatingLine {
  path: string
  /** Point de saisie du tracé (milieu visible). */
  handle: Pt
}

/**
 * Tracé d'une patte. Sans `bend` : trait droit entre les formes. Avec `bend` : le tracé passe par le milieu
 * des centres décalé de `bend` — en deux segments (droit) ou en courbe lissée (`curved`) ; la patte se raccorde
 * alors au bord de chaque forme en direction de ce point. `curved` seul donne une courbe par défaut.
 */
export function linkPath(a: GraphNode, b: GraphNode, shift: number, curved: boolean, bend?: Pt): LinkPath {
  const base = floatingLine(a, b, shift)
  const ca = shapeOf(a).center
  const cb = shapeOf(b).center
  const off = bend ?? (curved ? { x: base.normal.x * 40, y: base.normal.y * 40 } : undefined)
  const M = { x: (ca.x + cb.x) / 2 + base.normal.x * shift, y: (ca.y + cb.y) / 2 + base.normal.y * shift }
  if (!off || (!off.x && !off.y)) {
    const { source: s, target: t } = base
    return { ...base, path: `M ${s.x},${s.y} L ${t.x},${t.y}`, handle: { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 } }
  }
  const V = { x: M.x + off.x, y: M.y + off.y }
  // Point de contrôle quadratique : la courbe passe par V en son milieu.
  const aim = curved ? { x: 2 * V.x - M.x, y: 2 * V.y - M.y } : V
  const s = exitToward(a, aim)
  const t = exitToward(b, aim)
  const len = Math.hypot(t.x - aim.x, t.y - aim.y) || 1
  const dir = { x: (t.x - aim.x) / len, y: (t.y - aim.y) / len }
  let normal = { x: -dir.y, y: dir.x }
  if (normal.y > 0 || (normal.y === 0 && normal.x < 0)) normal = { x: -normal.x, y: -normal.y }
  if (!curved) return { source: s, target: t, dir, normal, path: `M ${s.x},${s.y} L ${V.x},${V.y} L ${t.x},${t.y}`, handle: V }
  return {
    source: s,
    target: t,
    dir,
    normal,
    path: `M ${s.x},${s.y} Q ${aim.x},${aim.y} ${t.x},${t.y}`,
    handle: { x: 0.25 * s.x + 0.5 * aim.x + 0.25 * t.x, y: 0.25 * s.y + 0.5 * aim.y + 0.25 * t.y },
  }
}
