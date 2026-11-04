// build.mjs — 用 overlay-studio node_modules 內的 esbuild 打包 ?export 頁
// 用 JS API 呼叫，避開 shell 引號問題；nodePaths 對應 NODE_PATH。
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const esbuild = require('C:/ai/overlay-studio/node_modules/esbuild/lib/main.js')

await esbuild.build({
  entryPoints: [join(here, 'src/main.tsx')],
  bundle: true,
  outfile: join(here, 'bundle.js'),
  loader: { '.json': 'json' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: ['C:/ai/overlay-studio/node_modules'],
  logLevel: 'info',
})
console.log('[build] bundle.js / bundle.css 完成')
