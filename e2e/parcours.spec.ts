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
})
