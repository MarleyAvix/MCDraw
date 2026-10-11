import { registerDocumentType } from '../core/documentType'
import { mcdDocument } from './mcd'
import { sitemapDocument } from './sitemap'

/** Types de document disponibles ; le premier est celui d'ouverture par défaut. */
export function registerDocuments() {
  registerDocumentType(mcdDocument)
  registerDocumentType(sitemapDocument)
}
