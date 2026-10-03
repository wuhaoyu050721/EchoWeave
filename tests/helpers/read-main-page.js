import { readFile } from 'node:fs/promises'

export async function readMainPageSource() {
  let source = await readFile(new URL('../../pages/index/index.vue', import.meta.url), 'utf8')
  for (const [symbol, file] of [
    ['composerMethods', 'chat-composer-methods'],
    ['cloudSettingsMethods', 'cloud-settings-methods']
  ]) {
    const module = await readFile(new URL(`../../src/app/${file}.js`, import.meta.url), 'utf8')
    const marker = `export const ${symbol} = {\n`
    const methods = module.slice(module.indexOf(marker) + marker.length, module.lastIndexOf('}'))
    source = source.replace(`\t\t\t...${symbol},`, methods)
  }
  return source
}
