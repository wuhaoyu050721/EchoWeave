import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

async function collectFiles(directory, predicate = () => true) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectFiles(absolutePath, predicate)
    return predicate(absolutePath) ? [absolutePath] : []
  }))
  return files.flat()
}

function objectBody(source, propertyName) {
  const propertyMatch = new RegExp(`\\b${propertyName}\\s*(?::|=)`).exec(source)
  assert.ok(propertyMatch, `Missing ${propertyName} object`)
  const start = source.indexOf('{', propertyMatch.index + propertyMatch[0].length)
  assert.notEqual(start, -1, `Missing opening brace for ${propertyName}`)

  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start + 1, index)
  }
  assert.fail(`Missing closing brace for ${propertyName}`)
}

function componentNames(source) {
  return objectBody(source, 'components')
    .split(',')
    .map(entry => entry.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1])
    .filter(Boolean)
}

function importSpecifiers(source) {
  const specifiers = []
  for (const pattern of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s+['"]([^'"]+)['"]/g]) {
    let match
    while ((match = pattern.exec(source))) specifiers.push(match[1])
  }
  return specifiers
}

function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function resolveLocalImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null
  const basePath = path.resolve(path.dirname(importer), specifier)
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.vue`,
    `${basePath}.css`,
    path.join(basePath, 'index.js')
  ]
  return candidates.find(candidate => (
    candidate.startsWith(projectRoot) && existsSync(candidate) && statSync(candidate).isFile()
  )) || null
}

test('every rendered Vue component is registered and every registration is used', async () => {
  const vueFiles = [
    ...(await collectFiles(path.join(projectRoot, 'pages'), file => file.endsWith('.vue'))),
    ...(await collectFiles(path.join(projectRoot, 'src'), file => file.endsWith('.vue')))
  ]

  for (const file of vueFiles) {
    const source = await readFile(file, 'utf8')
    const templateStart = source.indexOf('<template>')
    const scriptStart = source.indexOf('<script', templateStart)
    const templateEnd = source.lastIndexOf('</template>', scriptStart)
    const template = templateStart >= 0 && templateEnd > templateStart
      ? source.slice(templateStart + '<template>'.length, templateEnd)
      : ''
    const used = [...new Set([...template.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map(match => match[1]))].sort()
    if (!used.length) continue
    const registered = [...new Set(componentNames(source))].sort()
    assert.deepEqual(registered, used, path.relative(projectRoot, file))
  }
})

test('production dependencies are referenced and source imports are declared', async () => {
  const packageManifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
  const sourceFiles = [
    path.join(projectRoot, 'main.js'),
    path.join(projectRoot, 'App.vue'),
    path.join(projectRoot, 'vite.browser.config.js'),
    ...(await collectFiles(path.join(projectRoot, 'preview'), file => /\.(?:js|vue)$/.test(file))),
    ...(await collectFiles(path.join(projectRoot, 'pages'), file => /\.(?:js|vue)$/.test(file))),
    ...(await collectFiles(path.join(projectRoot, 'src'), file => /\.(?:js|vue)$/.test(file)))
  ]
  const importedPackages = new Set()
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    for (const specifier of importSpecifiers(source)) {
      const importedPackage = packageName(specifier)
      if (importedPackage) importedPackages.add(importedPackage)
    }
  }

  const declaredPackages = new Set([
    ...Object.keys(packageManifest.dependencies || {}),
    ...Object.keys(packageManifest.devDependencies || {})
  ])
  for (const importedPackage of importedPackages) {
    assert.ok(declaredPackages.has(importedPackage), `Undeclared import: ${importedPackage}`)
  }
  for (const dependency of Object.keys(packageManifest.dependencies || {})) {
    assert.ok(importedPackages.has(dependency), `Unused production dependency: ${dependency}`)
  }
})

test('every source module is reachable from an application or build entry', async () => {
  const sourceFiles = await collectFiles(path.join(projectRoot, 'src'), file => /\.(?:js|vue|css)$/.test(file))
  const roots = [
    path.join(projectRoot, 'main.js'),
    path.join(projectRoot, 'App.vue'),
    path.join(projectRoot, 'pages/index/index.vue'),
    path.join(projectRoot, 'pages/android-diagnostics/index.vue'),
    path.join(projectRoot, 'preview/main.js'),
    path.join(projectRoot, 'vite.browser.config.js')
  ]
  const reachable = new Set()

  async function visit(file) {
    if (!file || reachable.has(file)) return
    await access(file)
    reachable.add(file)
    const source = await readFile(file, 'utf8')
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveLocalImport(file, specifier)
      if (resolved) await visit(resolved)
    }
  }

  for (const root of roots) await visit(root)
  const unreachable = sourceFiles
    .filter(file => !reachable.has(file))
    .map(file => path.relative(projectRoot, file))
    .sort()
  assert.deepEqual(unreachable, [])
})

test('page declarations, static assets, and UTS APIs are wired into the package', async () => {
  const pagesSource = await readFile(path.join(projectRoot, 'pages.json'), 'utf8')
  const pagePaths = [...pagesSource.matchAll(/"path"\s*:\s*"([^"]+)"/g)].map(match => match[1])
  assert.ok(pagePaths.length > 0)
  for (const pagePath of pagePaths) await access(path.join(projectRoot, `${pagePath}.vue`))

  const assetSources = [
    await readFile(path.join(projectRoot, 'pages/index/index.vue'), 'utf8'),
    await readFile(path.join(projectRoot, 'src/components/character-contacts.vue'), 'utf8'),
    await readFile(path.join(projectRoot, 'src/ui-state.js'), 'utf8')
  ].join('\n')
  const staticAssets = [...new Set([...assetSources.matchAll(/\/static\/([A-Za-z0-9_./-]+)/g)].map(match => match[1]))]
  for (const asset of staticAssets) await access(path.join(projectRoot, 'static', asset))

  const mainSource = await readFile(path.join(projectRoot, 'main.js'), 'utf8')
  const registeredApis = new Set(
    objectBody(mainSource, '__aiChatNativeApis')
      .split(',')
      .map(entry => entry.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1])
      .filter(Boolean)
  )
  const pluginDirectories = await readdir(path.join(projectRoot, 'uni_modules'), { withFileTypes: true })
  for (const plugin of pluginDirectories.filter(entry => entry.isDirectory())) {
    const pluginRoot = path.join(projectRoot, 'uni_modules', plugin.name)
    const pluginManifest = JSON.parse(await readFile(path.join(pluginRoot, 'package.json'), 'utf8'))
    const interfaceSource = await readFile(path.join(pluginRoot, 'utssdk/interface.uts'), 'utf8')
    const androidSource = await readFile(path.join(pluginRoot, 'utssdk/app-android/index.uts'), 'utf8')
    const apis = Object.keys(pluginManifest.uni_modules?.['uni-ext-api']?.uni || {})
    assert.ok(apis.length > 0, `${plugin.name} has no exported APIs`)
    assert.match(mainSource, new RegExp(`uni_modules/${plugin.name}`))
    for (const api of apis) {
      assert.match(interfaceSource, new RegExp(`\\b${api}\\b`))
      assert.match(androidSource, new RegExp(`\\b${api}\\b`))
      assert.ok(registeredApis.has(api), `${plugin.name}.${api} is not registered in main.js`)
    }
  }
})
