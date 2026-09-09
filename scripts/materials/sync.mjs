import { copyFileSync, readFileSync } from 'node:fs'
const source = new URL('../../shared/materials.json', import.meta.url)
const destinations = [
  new URL('../../web/src/features/render-engine/shaders/materials.json', import.meta.url),
  new URL('../../apple/Packages/MakeUpCore/Sources/MakeUpCore/Resources/materials.json', import.meta.url),
]
for (const target of destinations) {
  if (process.argv.includes('--check')) {
    if (readFileSync(source, 'utf8') !== readFileSync(target, 'utf8')) throw Error(`Material drift: ${target}`)
  } else copyFileSync(source, target)
}
