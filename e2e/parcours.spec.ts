import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// Chaque test part d'un projet vide (le localStorage est propre à chaque contexte Playwright).
const tab = (page: Page, v: string) => page.getByRole('tab', { name: new RegExp(`^${v}$`, 'i') })

async function newProject(page: Page) {
  page.on('dialog', (d) => d.accept())
  await page.goto('/')
  await page.getByRole('button', { name: /Réinitialiser/ }).click()
  await expect(page.locator('.vue-flow__node')).toHaveCount(0)
}

test.describe('parcours principaux', () => {
  test('la page se charge avec un exemple et les 4 vues', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.vue-flow__node').first()).toBeVisible()
    for (const v of ['MLD', 'ERD', 'UML', 'MCD']) {
      await tab(page, v).click()
      await expect(tab(page, v)).toHaveAttribute('aria-selected', 'true')
    }
  })

  test('crée une entité puis la renomme', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Entité' }).click()
    const node = page.locator('.vue-flow__node').first()
    await expect(node).toBeVisible()

    await node.dblclick({ position: { x: 3, y: 60 } }) // marge de l'entité (ni titre ni attribut, qui s'éditent sur place) : ouvre la modale
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel("Nom de l'entité").fill('Client')
    await dialog.getByRole('button', { name: /enregistrer/i }).click()
    await expect(page.locator('.vue-flow__node').first()).toContainText('Client')
  })

  test('crée une association entre deux entités et affiche le MLD', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Entité' }).click()
    await page.getByRole('button', { name: 'Entité' }).click()
    await page.getByRole('button', { name: 'Association' }).click()
    await expect(page.locator('.vue-flow__node')).toHaveCount(3)

    await tab(page, 'MLD').click()
    await expect(page.locator('.vue-flow__node').first()).toBeVisible()
  })

  test('le thème personnalisé colore les entités et survit au rechargement', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Couleurs du diagramme' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input[type="color"]').first().fill('#ffe000')
    await dialog.getByRole('button', { name: 'Fermer' }).last().click()

    const bg = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--entity-bg'))
    expect(await bg()).toBe('#ffe000')
    await page.reload()
    expect(await bg()).toBe('#ffe000')
  })

  test('exporte le projet en JSON', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Fichier/ }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Exporter le projet (JSON)').click()])
    expect(download.suggestedFilename()).toBe('mcdraw.json')
    const json = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(json.entities.length).toBeGreaterThan(0)
  })

  test('exporte le diagramme en PNG', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.vue-flow__node').first()).toBeVisible()
    await page.getByRole('button', { name: /Fichier/ }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Image PNG').click()])
    expect(download.suggestedFilename()).toBe('mcd.png')
  })

  test('l’export image (PNG, SVG, PDF) fonctionne pour chaque type et chaque vue', async ({ page }) => {
    test.setTimeout(90_000) // une dizaine de captures : large marge quand toute la suite tourne en parallèle
    const grab = async (menuItem: string) => {
      await page.getByRole('button', { name: /Fichier/ }).click()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByText(menuItem, { exact: true }).click()])
      return { name: download.suggestedFilename(), bytes: await readFile((await download.path())!) }
    }
    await page.goto('/')
    for (const [tab, file] of [['Plan de site', 'tree'], ['Carte mentale', 'map'], ['Séquence', 'diagram'], ['API REST', 'routes']] as const) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await expect(page.locator('.vue-flow__node').first()).toBeVisible()
      const png = await grab('Image PNG')
      expect(png.name).toBe(`${file}.png`)
      expect(png.bytes.subarray(1, 4).toString()).toBe('PNG')
      expect(png.bytes.length).toBeGreaterThan(2000)
      const svg = await grab('Image SVG')
      expect(svg.name).toBe(`${file}.svg`)
      expect(svg.bytes.toString()).toContain('<svg')
    }

    // La seconde vue de l'API (schémas) s'exporte aussi, sous son propre nom.
    await page.getByRole('tab', { name: 'Schémas', exact: true }).click()
    await expect(page.locator('.vue-flow__node').first()).toBeVisible()
    expect((await grab('Image PNG')).name).toBe('schemas.png')

    // PDF : une page d'impression s'ouvre avec l'image du diagramme.
    await page.getByRole('button', { name: /Fichier/ }).click()
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByText('PDF / Imprimer…').click()])
    await expect(popup.locator('img')).toHaveAttribute('src', /^data:image\/png/)
    await popup.close()
  })

  test("le menu de cardinalité reste ouvert quand on y déplace la souris, et propose Droit / Courbe", async ({ page }) => {
    await page.goto('/')
    const label = page.locator('button[title^="Cliquer"]').first()
    await label.click()
    const curved = page.getByRole('button', { name: 'Courbe', exact: true })
    await expect(curved).toBeVisible()
    await curved.hover() // trajet souris du bouton vers le menu : ne doit pas le fermer
    await expect(curved).toBeVisible()
    await curved.click()
    await expect(page.locator('.vue-flow__edge-path[d*=" Q "]')).toHaveCount(1)
  })

  test('déplace le tracé d’une patte avec sa poignée', async ({ page }) => {
    await page.goto('/')
    // poignée dégagée (non recouverte par un nœud)
    const handles = page.locator('.link-handle')
    await expect(handles.first()).toBeAttached()
    const free = await handles.evaluateAll((els) =>
      els.findIndex((el) => {
        const r = el.getBoundingClientRect()
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
      }),
    )
    expect(free).toBeGreaterThanOrEqual(0)
    const handle = handles.nth(free)
    const path = page.locator('.vue-flow__edge-path').nth(free)
    const before = await path.getAttribute('d')
    const box = (await handle.boundingBox())!
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // destination sur du vide (le canevas), pour que la poignée reste atteignable ensuite
    const to = await page.evaluate(({ x, y }) => {
      for (const [dx, dy] of [[60, 60], [-60, 60], [60, -60], [-60, -60], [0, 80], [0, -80], [90, 0], [-90, 0]]) {
        const el = document.elementFromPoint(x + dx, y + dy)
        if (el?.closest('.vue-flow__pane, .vue-flow__transformationpane') && !el.closest('.vue-flow__node')) return { x: x + dx, y: y + dy }
      }
      return null
    }, from)
    expect(to).not.toBeNull()
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to!.x, to!.y, { steps: 8 })
    await page.mouse.up()
    expect(await path.getAttribute('d')).not.toBe(before)
    // double-clic : retour au trait droit
    const moved = (await handle.boundingBox())!
    await page.mouse.dblclick(moved.x + moved.width / 2, moved.y + moved.height / 2)
    expect(await path.getAttribute('d')).toBe(before)
  })

  test('un rectangle tracé sur le fond sélectionne les éléments touchés', async ({ page }) => {
    await newProject(page)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Entité' }).click()
    const nodes = page.locator('.vue-flow__node')
    await expect(nodes).toHaveCount(3)
    await page.getByRole('button', { name: 'Organiser' }).click()
    await page.waitForTimeout(400)

    const boxes = await nodes.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))
    const first = boxes[0]
    // rectangle depuis un point vide proche du premier nœud (hors barres d'outils), jusque dans ce nœud
    const start = await page.evaluate((f) => {
      for (const [dx, dy] of [[f.width + 25, f.height + 25], [-25, f.height + 25], [f.width + 25, -25], [-25, -25]]) {
        const x = f.x + dx
        const y = f.y + dy
        const el = document.elementFromPoint(x, y)
        if (el && el.classList.contains('vue-flow__pane')) return { x, y }
      }
      return null
    }, first)
    expect(start).not.toBeNull()
    await page.mouse.move(start!.x, start!.y)
    await page.mouse.down()
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.vue-flow__node.selected').first()).toBeVisible()
    expect(await page.locator('.vue-flow__node.selected').count()).toBeLessThan(3)

    // un clic sur le fond désélectionne
    await page.mouse.click(start!.x, start!.y)
    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(0)
  })

  test('la molette zoome et un balayage horizontal déplace la vue', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.vue-flow__node').first()).toBeVisible()
    const pane = page.locator('.vue-flow__transformationpane')
    const transform = () => pane.evaluate((el) => (el as HTMLElement).style.transform)
    const scale = async () => Number(/scale\(([\d.]+)\)/.exec(await transform())![1])

    await page.mouse.move(600, 500)
    const z0 = await scale()
    await page.mouse.wheel(0, -300)
    await expect.poll(scale).toBeGreaterThan(z0) // avant : zoom avant
    const z1 = await scale()
    await page.mouse.wheel(0, 600)
    await expect.poll(scale).toBeLessThan(z1) // arrière : dézoom

    const before = await transform()
    const zBefore = await scale()
    await page.mouse.wheel(120, 0)
    await expect.poll(transform).not.toBe(before)
    expect(await scale()).toBeCloseTo(zBefore, 5) // le zoom ne bouge pas pendant le balayage
  })

  test("l'outil Main déplace la vue, l'outil Sélection revient au rectangle", async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.vue-flow__node').first()).toBeVisible()
    const pane = page.locator('.vue-flow__transformationpane')
    const transform = () => pane.evaluate((el) => (el as HTMLElement).style.transform)
    // point vide du fond
    const empty = await page.evaluate(() => {
      for (let y = 420; y < 560; y += 20) for (let x = 60; x < 900; x += 40) {
        const el = document.elementFromPoint(x, y)
        if (el?.classList.contains('vue-flow__pane')) return { x, y }
      }
      return null
    })
    expect(empty).not.toBeNull()

    await page.getByTitle('Main (glisser = déplacer la vue)').click()
    const before = await transform()
    await page.mouse.move(empty!.x, empty!.y)
    await page.mouse.down()
    await page.mouse.move(empty!.x + 40, empty!.y + 30, { steps: 6 })
    await page.mouse.up()
    expect(await transform()).not.toBe(before)

    await page.getByTitle('Sélection (glisser = rectangle)').click()
    const again = await transform()
    await page.mouse.move(empty!.x, empty!.y)
    await page.mouse.down()
    await page.mouse.move(empty!.x + 40, empty!.y + 30, { steps: 6 })
    await page.mouse.up()
    expect(await transform()).toBe(again)
  })

  test.describe('plan de site', () => {
    const nodes = (page: Page) => page.locator('.vue-flow__node')

    test('bascule vers le plan de site, y garde son propre contenu et revient au MCD intact', async ({ page }) => {
      await page.goto('/')
      const mcdCount = await nodes(page).count()
      await page.getByRole('tab', { name: 'Plan de site' }).click()
      await expect(nodes(page).first()).toContainText('Accueil')
      await expect(page.getByRole('button', { name: 'Page', exact: true })).toBeVisible()
      await page.getByRole('tab', { name: 'Base de données' }).click()
      await expect(nodes(page)).toHaveCount(mcdCount)
    })

    test('la saisie texte construit l’arbre en direct, dans l’ordre des lignes', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Plan de site' }).click()
      const text = page.getByLabel('Description textuelle du plan de site')
      await text.fill(['Accueil /', '  Blog /blog', '  Contact /contact'].join('\n'))
      await expect(nodes(page)).toHaveCount(3)

      const box = async (name: string) => (await nodes(page).filter({ hasText: name }).first().boundingBox())!
      expect((await box('Blog')).x).toBeLessThan((await box('Contact')).x)
      expect((await box('Accueil')).y).toBeLessThan((await box('Blog')).y)

      await text.fill(['Accueil /', '/seule'].join('\n'))
      await expect(page.getByText('Titre manquant')).toBeVisible()
      await expect(nodes(page)).toHaveCount(3) // l'arbre garde la dernière version valide
    })

    test('importer un plan de site depuis le MCD propose de basculer de type', async ({ page }) => {
      const asked: string[] = []
      page.on('dialog', (d) => {
        asked.push(d.message())
        d.accept()
      })
      await page.goto('/')
      const payload = JSON.stringify({ pages: [{ id: 'a', title: 'Racine importée', url: '/' }] })
      await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(payload) })
      await expect(page.getByRole('tab', { name: 'Plan de site' })).toHaveAttribute('aria-selected', 'true')
      await expect(nodes(page).filter({ hasText: 'Racine importée' })).toHaveCount(1)
      expect(asked.some((m) => m.includes('Plan de site'))).toBe(true)
    })

    test('sitemap.xml se télécharge avec l’adresse du site saisie', async ({ page }) => {
      page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('https://exemple.fr') : d.accept()))
      await page.goto('/')
      await page.getByRole('tab', { name: 'Plan de site' }).click()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'sitemap.xml' }).click()])
      expect(download.suggestedFilename()).toBe('sitemap.xml')
      const xml = await readFile((await download.path())!, 'utf-8')
      expect(xml).toContain('<urlset')
      expect(xml).toContain('<loc>https://exemple.fr/</loc>')
    })

    test('le lien de partage d’un plan rouvre le même plan dans un nouveau contexte', async ({ page, browser }) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Plan de site' }).click()
      const expected = await nodes(page).count()
      await page.getByRole('button', { name: /Fichier/ }).click()
      await page.getByRole('button', { name: /Partager par lien/ }).click()
      const link = await page.locator('input[readonly]').inputValue()
      expect(link).toContain('#share.sitemap=')

      const other = await browser.newContext()
      const p2 = await other.newPage()
      await p2.goto(link)
      await expect(p2.getByRole('tab', { name: 'Plan de site' })).toHaveAttribute('aria-selected', 'true')
      await expect(nodes(p2)).toHaveCount(expected)
      await other.close()
    })

    test('Avant / Après réordonne les sœurs et le texte suit', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Plan de site' }).click()
      const text = page.getByLabel('Description textuelle du plan de site')
      await text.fill(['Accueil /', '  Blog /blog', '  Contact /contact'].join('\n'))
      const box = async (name: string) => (await nodes(page).filter({ hasText: name }).first().boundingBox())!
      await nodes(page).filter({ hasText: 'Contact' }).first().click()
      await page.getByRole('button', { name: 'Avant', exact: true }).click()
      await expect.poll(async () => (await box('Contact')).x < (await box('Blog')).x).toBe(true)
      await expect(text).toHaveValue(/Contact[^\n]*\n\s+Blog/)
      await expect(page.getByRole('button', { name: 'Avant', exact: true })).toBeDisabled() // déjà la première
    })

    test('le bouton Page ajoute une sous-page, annuler la retire, et Markdown s’exporte', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Plan de site' }).click()
      const before = await nodes(page).count()
      await page.getByRole('button', { name: 'Page', exact: true }).click()
      await expect(nodes(page)).toHaveCount(before + 1)
      await page.keyboard.press('Control+z')
      await expect(nodes(page)).toHaveCount(before)

      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown' }).click()])
      expect(download.suggestedFilename()).toBe('sitemap.md')
      const md = await readFile((await download.path())!, 'utf-8')
      expect(md).toContain('- [Accueil](/)')
    })
  })

  test.describe('carte mentale', () => {
    const nodes = (page: Page) => page.locator('.vue-flow__node')

    test('bascule vers la carte mentale et la saisie texte construit les branches des deux côtés', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Carte mentale' }).click()
      await expect(nodes(page).first()).toContainText('Application web')
      const text = page.getByLabel('Description textuelle de la carte mentale')
      await text.fill(['Centre', '  Haut', '  Bas', '  Gauche'].join('\n'))
      await expect(nodes(page)).toHaveCount(4)

      const box = async (name: string) => (await nodes(page).filter({ hasText: name }).first().boundingBox())!
      expect((await box('Haut')).x).toBeGreaterThan((await box('Centre')).x)
      expect((await box('Gauche')).x).toBeLessThan((await box('Centre')).x)

      await text.fill(['Centre', '  -- seule'].join('\n'))
      await expect(page.getByText('Texte manquant')).toBeVisible()
      await expect(nodes(page)).toHaveCount(4) // la carte garde la dernière version valide
    })

    test('Tab ajoute une sous-idée, Espace replie puis déplie la branche', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Carte mentale' }).click()
      await page.getByLabel('Description textuelle de la carte mentale').fill(['Centre', '  Branche', '    Feuille'].join('\n'))
      await expect(nodes(page)).toHaveCount(3)

      await nodes(page).filter({ hasText: 'Branche' }).first().click()
      await page.keyboard.press('Tab')
      await expect(nodes(page)).toHaveCount(4)

      await nodes(page).filter({ hasText: 'Branche' }).first().click()
      await page.keyboard.press('Space')
      await expect(nodes(page)).toHaveCount(2) // Centre et Branche repliée
      await page.keyboard.press('Space')
      await expect(nodes(page)).toHaveCount(4)
    })

    test('OPML et Markdown s’exportent', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Carte mentale' }).click()
      const [opml] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'OPML' }).click()])
      expect(opml.suggestedFilename()).toBe('carte-mentale.opml')
      const xml = await readFile((await opml.path())!, 'utf-8')
      expect(xml).toContain('<opml version="2.0">')
      expect(xml).toContain('text="Application web"')

      const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown' }).click()])
      expect(md.suggestedFilename()).toBe('carte-mentale.md')
      expect(await readFile((await md.path())!, 'utf-8')).toContain('- Application web')
    })

    test('importer une carte depuis le MCD propose de basculer de type, et le lien de partage la rouvre', async ({ page, browser }) => {
      page.on('dialog', (d) => d.accept())
      await page.goto('/')
      const payload = JSON.stringify({ nodes: [{ id: 'a', text: 'Idée importée' }, { id: 'b', text: 'Fille', parentId: 'a' }] })
      await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'carte.json', mimeType: 'application/json', buffer: Buffer.from(payload) })
      await expect(page.getByRole('tab', { name: 'Carte mentale' })).toHaveAttribute('aria-selected', 'true')
      await expect(nodes(page)).toHaveCount(2)

      await page.getByRole('button', { name: /Fichier/ }).click()
      await page.getByRole('button', { name: /Partager par lien/ }).click()
      const link = await page.locator('input[readonly]').inputValue()
      expect(link).toContain('#share.mindmap=')
      const other = await browser.newContext()
      const p2 = await other.newPage()
      await p2.goto(link)
      await expect(p2.getByRole('tab', { name: 'Carte mentale' })).toHaveAttribute('aria-selected', 'true')
      await expect(nodes(p2).filter({ hasText: 'Idée importée' })).toHaveCount(1)
      await other.close()
    })
  })

  test.describe('API REST', () => {
    const nodes = (page: Page) => page.locator('.vue-flow__node')
    const open = async (page: Page) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'API REST', exact: true }).click()
    }
    const text = (page: Page) => page.getByLabel("Description textuelle de l'API")
    /** Ouvre « Fichier » puis « Importer un OpenAPI… » et renvoie le sélecteur de fichier. */
    const chooseOpenApi = async (page: Page) => {
      await page.getByRole('button', { name: /Fichier/ }).click()
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importer un OpenAPI…' }).click()])
      return chooser
    }
    /** Télécharge via une entrée du menu « Fichier ». */
    const fromFileMenu = async (page: Page, item: string) => {
      await page.getByRole('button', { name: /Fichier/ }).click()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: item, exact: true }).click()])
      return download
    }

    test('bascule vers l’API, affiche l’arbre des routes et revient au MCD intact', async ({ page }) => {
      await page.goto('/')
      const mcdCount = await nodes(page).count()
      await page.getByRole('tab', { name: 'API REST', exact: true }).click()
      await expect(nodes(page)).toHaveCount(5) // racine, /products, /products/{id}, /orders, /orders/{id}
      await expect(nodes(page).filter({ hasText: '/products' }).first()).toContainText('Lister les produits')
      await expect(text(page)).toHaveValue(/@title API Boutique/)
      await page.getByRole('tab', { name: 'Base de données' }).click()
      await expect(nodes(page)).toHaveCount(mcdCount)
    })

    test('la saisie texte construit l’arbre en direct et signale les erreurs par ligne', async ({ page }) => {
      await open(page)
      await text(page).fill(['/users', '  GET Lister -> 200', '  /{id}', '    GET Détail -> 200, 404'].join('\n'))
      await expect(nodes(page)).toHaveCount(3)
      await expect(nodes(page).filter({ hasText: '/{id}' })).toContainText('Détail')

      await text(page).fill(['/users', '  GET Lister -> 999'].join('\n'))
      await expect(page.getByText('Réponse invalide')).toBeVisible()
      await expect(nodes(page)).toHaveCount(3) // le diagramme garde la dernière version valide
    })

    test('description, groupes et obsolescence se saisissent dans la fenêtre et passent dans le texte', async ({ page }) => {
      await open(page)
      await page.getByTitle('Modifier GET /products', { exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Groupes').fill('Catalogue, Public')
      await dialog.getByPlaceholder('Explication plus longue (facultatif)').fill('Tous les produits en vente.')
      await dialog.getByLabel('Obsolète').check()
      await dialog.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(text(page)).toHaveValue(/\[deprecated\]/)
      await expect(text(page)).toHaveValue(/# Catalogue, Public/)
      await expect(text(page)).toHaveValue(/~ Tous les produits en vente\./)
    })

    test('modifier une route dans la fenêtre d’édition met à jour la carte et le texte', async ({ page }) => {
      await open(page)
      await page.getByTitle('Modifier GET /products', { exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByPlaceholder('Lister les utilisateurs').fill('Catalogue complet')
      await dialog.getByRole('button', { name: 'Réponse', exact: true }).click()
      await dialog.getByLabel('Code HTTP').last().fill('500')
      await dialog.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(nodes(page).filter({ hasText: '/products' }).first()).toContainText('Catalogue complet')
      await expect(text(page)).toHaveValue(/GET Catalogue complet \[paginated\] -> 200 Product\[\], 500/)
    })

    test('un code HTTP invalide bloque l’enregistrement', async ({ page }) => {
      await open(page)
      await page.getByTitle('Modifier GET /products', { exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Code HTTP').first().fill('42')
      await expect(dialog.getByRole('alert')).toContainText('Code HTTP invalide')
      await expect(dialog.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
    })

    test('la vue Schémas liste les ressources, et on y ajoute un schéma', async ({ page }) => {
      await open(page)
      await page.getByRole('tab', { name: 'Schémas', exact: true }).click()
      await expect(nodes(page)).toHaveCount(5)
      await expect(nodes(page).filter({ hasText: /^OrderLine/ })).toContainText('Utilisé par 2 schémas')
      await page.getByRole('button', { name: 'Schéma', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Nom du schéma').fill('Invoice')
      await dialog.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(nodes(page)).toHaveCount(6)
      await expect(text(page)).toHaveValue(/schema Invoice/)
    })

    test('le linter signale une erreur de conception et mène à la route concernée', async ({ page }) => {
      await open(page)
      await text(page).fill(['/users', '  GET Lister -> 200 Fantome'].join('\n'))
      const pill = page.getByRole('button', { name: /remarque/ })
      await expect(pill).toContainText('1 erreur')
      await pill.click()
      await page.getByRole('list', { name: "Remarques de conception de l'API" }).getByRole('button', { name: /Fantome/ }).click()
      await expect(nodes(page).filter({ hasText: '/users' }).first()).toHaveClass(/selected/)
    })

    test('Monter / Descendre réordonne les chemins, et la fenêtre d’édition réordonne les méthodes', async ({ page }) => {
      await open(page)
      await text(page).fill(['/a', '  GET', '/b', '  GET', '  POST', '/c', '  GET'].join('\n'))
      await expect(nodes(page)).toHaveCount(4)
      const up = page.getByRole('button', { name: 'Monter', exact: true })
      await expect(up).toBeDisabled() // rien n'est sélectionné

      await nodes(page).filter({ hasText: '/c' }).first().locator('.font-mono').first().click()
      await up.click()
      await up.click()
      await expect(text(page)).toHaveValue(/^\/c\n {2}GET\n\/a\n/)
      await expect(up).toBeDisabled() // déjà le premier
      await page.getByRole('button', { name: 'Descendre', exact: true }).click()
      await expect(text(page)).toHaveValue(/^\/a\n {2}GET\n\/c\n/)

      await page.getByTitle('Modifier POST /b', { exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Monter la route' }).click()
      await expect(dialog.getByRole('button', { name: 'Monter la route' })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(text(page)).toHaveValue(/\/b\n {2}POST\n {2}GET/)
    })

    test('les boutons de survol d’une carte ne figurent pas dans l’image exportée', async ({ page }) => {
      await open(page)
      const card = nodes(page).filter({ hasText: '/products' }).first()
      await card.hover()
      const add = card.getByRole('button', { name: 'Ajouter un sous-chemin' })
      await expect(add).toBeVisible()
      await page.locator('.vue-flow').first().evaluate((el) => el.classList.add('exporting')) // état pendant la capture
      await expect(add).toBeHidden()
    })

    test('importe un fichier OpenAPI (YAML), signale les simplifications, et Ctrl+Z revient à l’API précédente', async ({ page }) => {
      const dialogs: string[] = []
      page.on('dialog', (d) => {
        dialogs.push(d.message())
        d.accept()
      })
      await open(page)
      const before = await text(page).inputValue()
      const yaml = ['openapi: 3.0.0', 'info: { title: Importée, version: "1.0" }', 'paths:', '  /pets/{id}:', '    get:', '      summary: Un animal', '      responses:', '        "200":', '          description: OK', '          content:', '            application/json:', '              schema: { $ref: "#/components/schemas/Pet" }', '        default: { description: Erreur }', 'components:', '  schemas:', '    Pet:', '      type: object', '      required: [id]', '      properties: { id: { type: integer }, name: { type: string } }'].join('\n')
      const chooser = await chooseOpenApi(page)
      await chooser.setFiles({ name: 'pets.yaml', mimeType: 'application/yaml', buffer: Buffer.from(yaml) })

      await expect(nodes(page).filter({ hasText: '/pets' })).toHaveCount(1)
      await expect(text(page)).toHaveValue(/@title Importée/)
      await expect(text(page)).toHaveValue(/schema Pet/)
      await expect(text(page)).toHaveValue(/GET Un animal -> 200 Pet/)
      expect(dialogs.some((m) => m.includes('Remplacer'))).toBe(true)
      expect(dialogs.some((m) => m.includes('« default » ignorée'))).toBe(true)

      await page.keyboard.press('Control+z')
      await expect(text(page)).toHaveValue(before)
    })

    test('un fichier téléchargé en OpenAPI (YAML) se réimporte à l’identique', async ({ page }) => {
      page.on('dialog', (d) => d.accept())
      await open(page)
      const before = await text(page).inputValue()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'OpenAPI', exact: true }).click()])
      const yaml = await readFile((await download.path())!)

      await page.getByRole('button', { name: 'Réinitialiser' }).click()
      await expect(nodes(page)).toHaveCount(0)
      const chooser = await chooseOpenApi(page)
      await chooser.setFiles({ name: 'openapi.yaml', mimeType: 'application/yaml', buffer: yaml })
      await expect(text(page)).toHaveValue(before)
    })

    test('un fichier illisible ou Swagger 2 est refusé avec un message clair', async ({ page }) => {
      const dialogs: string[] = []
      page.on('dialog', (d) => {
        dialogs.push(d.message())
        d.accept()
      })
      await open(page)
      const before = await text(page).inputValue()
      for (const [name, content] of [['v2.json', '{"swagger":"2.0","paths":{}}'], ['mauvais.yaml', 'a: [1, 2\nb: : :']] as const) {
        const chooser = await chooseOpenApi(page)
        await chooser.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) })
      }
      await expect.poll(() => dialogs.length).toBe(2)
      expect(dialogs[0]).toContain('Swagger 2.0')
      expect(dialogs[1]).toContain('ni JSON ni YAML')
      await expect(text(page)).toHaveValue(before) // l'API n'a pas bougé
    })

    test('importer un OpenAPI par le menu Fichier du MCD indique où l’importer', async ({ page }) => {
      const dialogs: string[] = []
      page.on('dialog', (d) => {
        dialogs.push(d.message())
        d.accept()
      })
      await page.goto('/')
      await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'o.json', mimeType: 'application/json', buffer: Buffer.from('{"openapi":"3.0.0","paths":{}}') })
      await expect.poll(() => dialogs.length).toBe(1)
      expect(dialogs[0]).toContain('Importer un OpenAPI')
    })

    test('exporte les types TypeScript et un client fetch', async ({ page }) => {
      await open(page)
      const download = await fromFileMenu(page, 'Client TypeScript')
      expect(download.suggestedFilename()).toBe('api-client.ts')
      const ts = await readFile((await download.path())!, 'utf-8')
      expect(ts).toContain('export interface Product {')
      expect(ts).toContain('export function createClient(')
      expect(ts).toContain('async getProductsById(args: { id: string })')
      expect(ts).toContain('Promise<Paginated<Product[]>>')
    })

    test('la sélection d’une carte n’apparaît pas dans l’image exportée', async ({ page }) => {
      await open(page)
      const card = nodes(page).filter({ hasText: '/products' }).first()
      await card.locator('.font-mono').first().click()
      const shadow = () => card.locator('> div').evaluate((el) => getComputedStyle(el).boxShadow)
      expect(await shadow()).toMatch(/0px 0px 0px 2px/) // anneau de sélection
      await page.locator('.vue-flow').first().evaluate((el) => el.classList.add('exporting')) // état pendant la capture
      expect(await shadow()).not.toMatch(/0px 0px 0px 2px/)
    })

    test('les exports OpenAPI (YAML et JSON), .http et Markdown se téléchargent', async ({ page }) => {
      await open(page)
      const grab = async (name: string, file: string, menu = true) => {
        const download = menu
          ? await fromFileMenu(page, name)
          : (await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()]))[0]
        expect(download.suggestedFilename()).toBe(file)
        return readFile((await download.path())!, 'utf-8')
      }
      const yaml = await grab('OpenAPI', 'openapi.yaml', false) // bouton principal de l'en-tête
      expect(yaml).toContain('openapi: "3.1.0"')
      expect(yaml).toContain('"/products":')
      expect(yaml).toContain('bearerAuth')

      const json = JSON.parse(await grab('OpenAPI en JSON', 'openapi.json'))
      expect(json.openapi).toBe('3.1.0')
      expect(Object.keys(json.paths)).toEqual(['/products', '/products/{id}', '/orders', '/orders/{id}'])

      expect(await grab('Requêtes .http', 'requests.http')).toContain('@baseUrl = https://api.boutique.dev')
      expect(await grab('Documentation Markdown', 'api.md')).toContain('### `GET /products` — Lister les produits')
    })

    test('génère l’API depuis le MCD ouvert, puis Ctrl+Z la remplace par la précédente', async ({ page }) => {
      page.on('dialog', (d) => d.accept())
      await open(page)
      const before = await text(page).inputValue()
      await page.getByRole('button', { name: 'Depuis le MCD' }).click()
      await expect.poll(async () => (await text(page).inputValue()) !== before).toBe(true)
      const generated = await text(page).inputValue()
      expect(generated).toMatch(/schema \w+Input/)
      expect(generated).toMatch(/POST .*\[auth\]/)
      await page.keyboard.press('Control+z')
      await expect(text(page)).toHaveValue(before)
    })

    test('importer une API depuis le MCD propose de basculer, et le lien de partage la rouvre', async ({ page, browser }) => {
      page.on('dialog', (d) => d.accept())
      await page.goto('/')
      const payload = JSON.stringify({ info: { title: 'Importée' }, resources: [], endpoints: [{ id: 'a', method: 'GET', path: '/ping', responses: [{ status: 200 }] }] })
      await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'api.json', mimeType: 'application/json', buffer: Buffer.from(payload) })
      await expect(page.getByRole('tab', { name: 'API REST', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(nodes(page).filter({ hasText: '/ping' })).toHaveCount(1)

      await page.getByRole('button', { name: /Fichier/ }).click()
      await page.getByRole('button', { name: /Partager par lien/ }).click()
      const link = await page.locator('input[readonly]').inputValue()
      expect(link).toContain('#share.api=')
      const other = await browser.newContext()
      const p2 = await other.newPage()
      await p2.goto(link)
      await expect(p2.getByRole('tab', { name: 'API REST', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(nodes(p2).filter({ hasText: '/ping' })).toHaveCount(1)
      await other.close()
    })
  })
  test.describe('Séquence', () => {
    const open = async (page: Page) => {
      await page.goto('/')
      await page.getByRole('tab', { name: 'Séquence', exact: true }).click()
    }
    const text = (page: Page) => page.getByLabel('Description textuelle du diagramme de séquence')
    const diagram = (page: Page) => page.getByRole('img', { name: /Diagramme de séquence/ })
    const item = (page: Page, label: string) => diagram(page).locator('g[data-id]').filter({ hasText: label }).first()

    test('affiche le modèle de départ avec son texte', async ({ page }) => {
      await open(page)
      await expect(diagram(page)).toBeVisible()
      await expect(diagram(page)).toContainText('Saisit e-mail et mot de passe')
      await expect(diagram(page)).toContainText('mot de passe valide')
      await expect(text(page)).toHaveValue(/title Connexion avec jeton/)
    })

    test('la saisie texte dessine le diagramme en direct et garde la dernière version valide en cas d’erreur', async ({ page }) => {
      await open(page)
      await text(page).fill('Client ->> API: Salut')
      await expect(diagram(page)).toContainText('Salut')
      await text(page).fill('Client ->> API: Salut\nalt cas\nAPI -->> Client: Oui')
      await expect(page.getByText('n\'est pas fermé')).toBeVisible()
      await expect(diagram(page)).not.toContainText('Oui')
      await text(page).fill('Client ->> API: Salut\nalt cas\nAPI -->> Client: Oui\nend')
      await expect(diagram(page)).toContainText('Oui')
    })

    test('un diagramme Mermaid collé tel quel est compris', async ({ page }) => {
      await open(page)
      await text(page).fill(
        ['sequenceDiagram', '    participant A as Alice', '    participant B as Bob', '    A->>+B: Salut Bob', '    B-->>-A: Salut Alice', '    Note right of B: réfléchit', '    loop Chaque minute', '        A-)B: ping', '    end'].join('\n'),
      )
      await expect(diagram(page)).toContainText('Salut Alice')
      await expect(diagram(page)).toContainText('Chaque minute')
      await expect(diagram(page)).toContainText('réfléchit')
      await expect(page.getByText('Ligne non reconnue')).toHaveCount(0)
    })

    test('le bouton Message ajoute un message, ouvre la fenêtre, et le texte suit', async ({ page }) => {
      await open(page)
      await page.getByRole('button', { name: 'Message', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Texte du message').fill('Bonjour le monde')
      await dialog.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(diagram(page)).toContainText('Bonjour le monde')
      await expect(text(page)).toHaveValue(/: Bonjour le monde/)
      await page.keyboard.press('Control+z')
      await expect(diagram(page)).not.toContainText('Bonjour le monde')
    })

    test('le bouton Bloc enveloppe les éléments sélectionnés', async ({ page }) => {
      await open(page)
      await text(page).fill('A ->> B: un\nB -->> A: deux')
      await expect(diagram(page)).toContainText('deux')
      await item(page, 'un').click()
      await page.getByRole('button', { name: 'Bloc', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Type de bloc').selectOption('loop')
      await dialog.getByLabel('Libellé de la section 1').fill('chaque jour')
      await dialog.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(text(page)).toHaveValue(/loop chaque jour\n {2}A ->> B: un\nend\nB -->> A: deux/)
    })

    test('Monter réordonne, Suppr supprime', async ({ page }) => {
      await open(page)
      await text(page).fill('A ->> B: un\nB -->> A: deux')
      await expect(diagram(page)).toContainText('deux')
      await item(page, 'deux').click()
      await page.getByRole('button', { name: 'Monter', exact: true }).click()
      await expect(text(page)).toHaveValue(/B -->> A: deux\nA ->> B: un/)
      await page.keyboard.press('Delete')
      await expect(diagram(page)).not.toContainText('deux')
      await expect(diagram(page)).toContainText('un')
    })

    test('renommer un participant met à jour les messages', async ({ page }) => {
      await open(page)
      await diagram(page).locator('g[data-id="p:API"]').first().dblclick()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Nom du participant').fill('Serveur')
      await dialog.getByRole('button', { name: 'Enregistrer' }).click()
      await expect(text(page)).toHaveValue(/Web ->>\+ Serveur: POST \/auth\/login/)
      await expect(text(page)).not.toHaveValue(/\bAPI\b/)
    })

    test('un nom de participant déjà pris est refusé', async ({ page }) => {
      await open(page)
      await diagram(page).locator('g[data-id="p:API"]').first().dblclick()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Nom du participant').fill('Web')
      await expect(dialog.getByRole('alert')).toContainText('existe déjà')
      await expect(dialog.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
    })

    test('les exports Mermaid et PlantUML se téléchargent', async ({ page }) => {
      await open(page)
      const grab = async (name: string, file: string) => {
        const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name, exact: true }).click()])
        expect(download.suggestedFilename()).toBe(file)
        return readFile((await download.path())!, 'utf-8')
      }
      const mermaid = await grab('Mermaid', 'sequence.mmd')
      expect(mermaid).toContain('sequenceDiagram')
      expect(mermaid).toContain('autonumber')
      expect(mermaid).toContain('Web->>+API: POST /auth/login')
      const puml = await grab('PlantUML', 'sequence.puml')
      expect(puml).toContain('@startuml')
      expect(puml).toContain('Web -> API ++ : POST /auth/login')
    })

    test('la sélection n’apparaît pas dans l’image exportée', async ({ page }) => {
      await open(page)
      await item(page, 'POST /auth/login').click()
      const ring = diagram(page).locator('.seq-sel-rect').first()
      await expect(ring).toBeVisible()
      await page.locator('.vue-flow').first().evaluate((el) => el.classList.add('exporting')) // état pendant la capture
      await expect(ring).toBeHidden()
    })
  })
})
