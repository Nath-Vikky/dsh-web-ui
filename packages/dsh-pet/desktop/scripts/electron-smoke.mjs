import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const artifactDirectory = join(appRoot, '.smoke-artifacts')
const userDataDirectory = await mkdtemp(join(tmpdir(), 'dsh-pet-desktop-'))
const localModelDirectory = join(appRoot, 'pixelmodel')
const fixtureDirectories = [
  join(localModelDirectory, `smoke-lian-${process.pid}`),
  join(localModelDirectory, `smoke-hachiware-${process.pid}`),
]
await mkdir(artifactDirectory, { recursive: true })
await mkdir(localModelDirectory, { recursive: true })

async function writePixelModelFixture(directory, id, displayName) {
  await mkdir(directory)
  await copyFile(
    join(appRoot, 'src', 'renderer', 'assets', 'spritesheet.webp'),
    join(directory, 'spritesheet.webp'),
  )
  await writeFile(join(directory, 'pet.json'), `${JSON.stringify({
    id,
    displayName,
    description: 'Smoke-test PetDex model',
    spritesheetPath: 'spritesheet.webp',
  }, null, 2)}\n`, 'utf8')
}

await writePixelModelFixture(fixtureDirectories[0], 'smoke-lian', 'Lian Smoke')
await writePixelModelFixture(fixtureDirectories[1], 'smoke-hachiware', '小八 Smoke')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForDesktopState(page, predicate, label) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.petDesktop.getState())
    if (predicate(state)) return state
    await page.waitForTimeout(25)
  }
  throw new Error(`timed out waiting for desktop state: ${label}`)
}

const electronApp = await electron.launch({
  executablePath: electronPath,
  // Playwright's Windows process job prevents Chromium from launching the
  // renderer sandbox in this isolated runner (launch-failed, exit 49). This
  // switch is smoke-only; production still creates the window with sandbox:
  // true and never receives this command-line argument.
  args: [
    join(appRoot, 'out/main/index.js'),
    `--user-data-dir=${userDataDirectory}`,
    '--no-sandbox',
  ],
  cwd: appRoot,
})

try {
  const page = await electronApp.firstWindow()
  const rendererMessages = []
  page.on('console', message => rendererMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', error => rendererMessages.push(`pageerror: ${error.message}`))
  await page.waitForLoadState('domcontentloaded')
  try {
    await page.locator('.pet-button').waitFor({ state: 'visible', timeout: 10_000 })
  } catch (error) {
    console.error(JSON.stringify({
      url: page.url(),
      title: await page.title(),
      body: await page.locator('body').innerText().catch(() => ''),
      html: (await page.content()).slice(0, 2_000),
      rendererMessages,
    }, null, 2))
    throw error
  }

  const security = await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return window?.webContents.getLastWebPreferences()
  })
  assert(security?.contextIsolation === true, 'context isolation must stay enabled')
  assert(security?.nodeIntegration === false, 'node integration must stay disabled')
  assert(security?.sandbox === true, 'renderer sandbox must stay enabled')
  const trayIconValid = await electronApp.evaluate(
    ({ nativeImage }, path) => !nativeImage.createFromPath(path).isEmpty(),
    join(appRoot, 'resources', 'tray-icon.png'),
  )
  assert(trayIconValid, 'tray icon PNG must decode into a non-empty NativeImage')

  await page.waitForTimeout(400)
  const initial = await page.evaluate(() => window.petDesktop.getState())
  assert(initial.visible, 'desktop window should be visible after startup')
  const initialViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert(initialViewport.width >= 224 && initialViewport.width <= 232, `desktop content should start collapsed: ${JSON.stringify(initialViewport)}`)
  assert(initialViewport.height >= 300 && initialViewport.height <= 308, `desktop content should expose the interaction panel: ${JSON.stringify(initialViewport)}`)
  const backgroundImage = await page.locator('.sprite').evaluate(element => getComputedStyle(element).backgroundImage)
  assert(backgroundImage.includes('spritesheet-'), 'pixel sprite asset must be painted')
  const hiddenPanelOpacity = await page.locator('.interaction-panel').evaluate(element => getComputedStyle(element).opacity)
  assert(hiddenPanelOpacity === '0', 'status and interaction panel should be hidden by default')
  await page.locator('.pet-button').hover()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.interaction-panel')).opacity === '1')
  await page.getByRole('button', { name: '摸头' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '喂食' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '改名' }).waitFor({ state: 'visible' })
  assert(await page.getByText('拖动移动，点击展开').count() === 0, 'obsolete drag hint must be removed')
  await page.locator('.pet-summary strong').getByText('鲸鱼娘', { exact: true }).waitFor({ state: 'visible' })
  const pixelModels = await page.evaluate(() => window.petDesktop.getPixelModels())
  assert(pixelModels.some(model => model.id === 'builtin:whale'), 'built-in pixel model must stay available')
  assert(pixelModels.some(model => model.id === 'local:smoke-lian'), 'local PetDex Lian fixture must be discovered')
  assert(pixelModels.some(model => model.id === 'local:smoke-hachiware'), 'local PetDex Hachiware fixture must be discovered')
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('listbox', { name: '像素模型' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '导入 PetDex 模型文件夹' }).waitFor({ state: 'visible' })
  await page.screenshot({
    path: join(artifactDirectory, 'desktop-model-list.png'),
    omitBackground: true,
  })
  await page.getByRole('option', { name: /小八 Smoke/ }).click()
  let hachiwareState = await waitForDesktopState(page, state => state.pixelModelId === 'local:smoke-hachiware', 'Hachiware pixel model selected')
  await page.waitForFunction(() => document.querySelector('.sprite')?.getAttribute('data-model-id') === 'local:smoke-hachiware')
  await page.locator('.pet-summary strong').getByText('小八 Smoke', { exact: true }).waitFor({ state: 'visible' })
  await page.screenshot({
    path: join(artifactDirectory, 'desktop-pixel-hachiware.png'),
    omitBackground: true,
  })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '改名' }).click()
  const nameInput = page.getByRole('textbox', { name: '新的桌宠名字' })
  await nameInput.fill('八仔')
  await page.locator('.rename-form').getByRole('button', { name: '保存' }).click()
  hachiwareState = await waitForDesktopState(
    page,
    state => state.pixelModelNames['local:smoke-hachiware'] === '八仔',
    'Hachiware custom name saved',
  )
  assert(hachiwareState.pixelModelNames['local:smoke-hachiware'] === '八仔', 'custom model name must persist in desktop state')
  await page.locator('.pet-summary strong').getByText('八仔', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('option', { name: /Lian Smoke/ }).click()
  const selectedPixelModel = await waitForDesktopState(page, state => state.pixelModelId === 'local:smoke-lian', 'pixel model selected')
  assert(selectedPixelModel.pixelModelId === 'local:smoke-lian', 'selected pixel model must persist in desktop state')
  await page.locator('.pet-summary strong').getByText('Lian Smoke', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('option', { name: /八仔/ }).click()
  await waitForDesktopState(page, state => state.pixelModelId === 'local:smoke-hachiware', 'custom-named model restored')
  await page.locator('.pet-summary strong').getByText('八仔', { exact: true }).waitFor({ state: 'visible' })
  await page.locator('.pet-button').hover()
  await page.getByRole('button', { name: '模型列表' }).click()
  await page.getByRole('option', { name: /Lian Smoke/ }).click()
  await waitForDesktopState(page, state => state.pixelModelId === 'local:smoke-lian', 'Lian pixel model restored')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.sprite')).backgroundImage.includes('dsh-pet-pixel'))
  const spriteRowBeforeDrawer = await page.locator('.sprite').evaluate(element => getComputedStyle(element).backgroundPositionY)

  await page.evaluate(() => window.petDesktop.beginDrag())
  const clickSession = await page.evaluate(() => window.petDesktop.endDrag())
  assert(!clickSession.moved, 'a stationary pointer must remain a click')
  const dragged = await page.evaluate(({ x, y }) => window.petDesktop.moveTo({ x: x - 60, y: y - 32 }), initial.bounds)
  assert(dragged.bounds.x < initial.bounds.x - 30 && dragged.bounds.y < initial.bounds.y - 10, 'drag target should move in screen space')
  assert(!dragged.drawerOpen, 'dragging the pet must not toggle the drawer')

  await page.locator('.pet-button').click()
  const expanded = await waitForDesktopState(page, state => state.drawerOpen, 'drawer open')
  const expandedViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const spriteRowAfterDrawer = await page.locator('.sprite').evaluate(element => getComputedStyle(element).backgroundPositionY)
  assert(expandedViewport.width >= 528 && expandedViewport.width <= 536, 'drawer should expand the content area')
  assert(spriteRowAfterDrawer === spriteRowBeforeDrawer, 'opening the drawer must not switch animation rows')
  assert(
    Math.abs(expanded.bounds.x + expanded.bounds.width - dragged.bounds.x - dragged.bounds.width) <= 2,
    `opening the drawer after a drag must preserve the pet right edge: ${JSON.stringify({ dragged: dragged.bounds, expanded: expanded.bounds })}`,
  )
  await page.screenshot({
    path: join(artifactDirectory, 'desktop-drawer-open.png'),
    omitBackground: true,
  })

  await page.getByRole('button', { name: '地址' }).click()
  const connectionForm = page.locator('.connection-form')
  const connectionInput = page.getByRole('textbox', { name: 'Web DSH 地址' })
  await connectionInput.fill('https://example.com')
  await connectionForm.getByRole('button', { name: '保存' }).click()
  await page.getByText('仅支持本机 Web DSH 的 http/https 根地址').waitFor({ state: 'visible' })
  await connectionInput.fill('http://localhost:3080/')
  await connectionForm.getByRole('button', { name: '保存' }).click()
  await connectionForm.waitFor({ state: 'hidden' })
  const configured = await page.evaluate(() => window.petDesktop.getState())
  assert(configured.webDshUrl === 'http://localhost:3080', 'Web DSH origin should normalize and persist')

  const rightEdges = [dragged.bounds.x + dragged.bounds.width, expanded.bounds.x + expanded.bounds.width]
  for (let index = 0; index < 3; index += 1) {
    const collapsedCycle = await page.evaluate(() => window.petDesktop.setDrawerOpen(false))
    rightEdges.push(collapsedCycle.bounds.x + collapsedCycle.bounds.width)
    const expandedCycle = await page.evaluate(() => window.petDesktop.setDrawerOpen(true))
    rightEdges.push(expandedCycle.bounds.x + expandedCycle.bounds.width)
  }
  assert(Math.max(...rightEdges) - Math.min(...rightEdges) <= 2, `drawer cycles must not drift: ${rightEdges.join(',')}`)

  await page.getByRole('button', { name: '锁定当前位置' }).click()
  const locked = await waitForDesktopState(page, state => state.locked, 'position locked')
  const lockedMove = await page.evaluate(({ x, y }) => window.petDesktop.moveTo({ x: x - 40, y }), locked.bounds)
  assert(lockedMove.bounds.x === locked.bounds.x, 'locked window must reject move requests')

  await page.getByRole('button', { name: '解除位置锁定' }).click()
  const unlocked = await waitForDesktopState(page, state => !state.locked, 'position unlocked')
  const moved = await page.evaluate(({ x, y }) => window.petDesktop.moveTo({ x: x - 40, y }), unlocked.bounds)
  assert(moved.bounds.x < unlocked.bounds.x, 'unlocked window should accept a safe move request')

  await page.getByRole('button', { name: '隐藏到托盘' }).click()
  await waitForDesktopState(page, state => !state.visible, 'window hidden')
  const hidden = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
  assert(hidden === false, 'hide action should keep the process alive with its window hidden')
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.showInactive())
  await waitForDesktopState(page, state => state.visible, 'window restored')

  console.log(JSON.stringify({
    title: await page.title(),
    initialContentWidth: initialViewport.width,
    expandedContentWidth: expandedViewport.width,
    spritePainted: true,
    trayIconPainted: true,
    pixelModelsDiscovered: pixelModels.map(model => model.id),
    pixelModelSelectionPersisted: true,
    perModelNamePersisted: true,
    modelNameFollowsSelection: true,
    pixelModelMenuVisible: true,
    obsoleteDragHintRemoved: true,
    interactionPanelVisible: true,
    interactionPanelHoverOnly: true,
    dragSessionStable: true,
    drawerAnchoredAfterDrag: true,
    drawerDoesNotSwitchAnimation: true,
    connectionAddressValidated: true,
    lockGuardedMove: true,
    hideAndRestore: true,
    screenshot: join(artifactDirectory, 'desktop-drawer-open.png'),
  }, null, 2))
} finally {
  await electronApp.close()
  await Promise.all(fixtureDirectories.map(directory => rm(directory, { recursive: true, force: true })))
  await rm(userDataDirectory, { recursive: true, force: true })
}
