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
})
