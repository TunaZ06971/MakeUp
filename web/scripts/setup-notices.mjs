import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'public/licenses')
await mkdir(target, {recursive:true})
await copyFile(resolve(root,'../THIRD_PARTY.md'),resolve(target,'NOTICE.txt'))
await copyFile(resolve(root,'node_modules/heic-to/LICENSE'),resolve(target,'heic-to-LICENSE.txt'))
for (const [name, file] of [['three','LICENSE'],['fflate','LICENSE'],['@mediapipe/tasks-vision','README.md']]) {
  await copyFile(resolve(root,'node_modules',name,file),resolve(target,`${name.replaceAll('/','-')}-${file}.txt`))
}
// Source/build pointers stay accessible in the distributed site.
const heic = JSON.parse(await readFile(resolve(root,'node_modules/heic-to/package.json'),'utf8'))
await writeFile(resolve(target,'HEIC-SOURCE.txt'), `heic-to ${heic.version}\nLGPL-3.0-or-later\nUnmodified decoder, separately loaded chunk.\nSource and build instructions:\nhttps://github.com/hoppergee/heic-to/tree/f37af866f9aa6212ddc84b67a279c9f2386aba4f\nBundled libheif upstream:\nhttps://github.com/strukturag/libheif\nYou may replace/rebuild this decoder under its upstream license.\n`)

await copyFile(resolve(root, '../LICENSES/Apache-2.0.txt'), resolve(target, 'Apache-2.0.txt'))
await copyFile(resolve(root, '../LICENSE'), resolve(target, 'MakeUp-MIT.txt'))
