import { registerDocumentType } from '../core/documentType'
import { mcdDocument } from './mcd'
import { sitemapDocument } from './sitemap'
import { mindmapDocument } from './mindmap'
import { apiDocument } from './api'
import { sequenceDocument } from './sequence'

/** Types de document disponibles ; le premier est celui d'ouverture par défaut. */
export function registerDocuments() {
  registerDocumentType(mcdDocument)
  registerDocumentType(sitemapDocument)
  registerDocumentType(mindmapDocument)
  registerDocumentType(apiDocument)
  registerDocumentType(sequenceDocument)
}
