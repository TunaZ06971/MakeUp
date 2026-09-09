import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

test('real-photo GPU output, masks, finishes, brush replay and zoom coordinates', async ({ page }) => {
  test.setTimeout(120000)
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error' && /Shader|WebGL|GL_INVALID/.test(message.text())) errors.push(message.text())})
  await page.goto('/tests/render-harness.html')
  await page.waitForFunction(()=>typeof (window as any).runRendererTests === 'function')
  const result = await page.evaluate(()=>(window as any).runRendererTests())
  const directory=resolve('../.artifacts/web')
  mkdirSync(directory,{recursive:true})
  for(const [name,url] of Object.entries(result.shots)) writeFileSync(resolve(directory,`${name}.png`),Buffer.from((url as string).split(',')[1],'base64'))
  delete result.shots
  writeFileSync(resolve(directory,'metrics.json'),JSON.stringify(result,null,2))
  expect(errors).toEqual([])
  expect(result.noMakeupError).toBeLessThanOrEqual(1)
  expect(result.changedOutside).toBe(0)
  expect(result.changedInside/result.totalInside).toBeGreaterThan(0.97)
  expect(result.glossyPeak).toBeGreaterThan(result.mattePeak+12)
  expect(result.finishDelta).toBeGreaterThan(8)
  expect(result.zeroIdentical).toBe(true)
  expect(result.gapValue).toBe(0)
  expect(result.cancelExact && result.replayExact && result.zoomAnchorExact && result.fitPanZero).toBe(true)
})


test('iPhone HEIC imports and detects a face entirely on-device', async ({page}) => {
  test.setTimeout(120000)
  const external: string[] = []
  page.on('request',request=>{if(/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173')) external.push(request.url())})
  await page.goto('/tests/render-harness.html')
  await page.waitForFunction(()=>typeof (window as any).testHEIC === 'function')
  const result = await page.evaluate(()=>(window as any).testHEIC())
  expect(result.width).toBeGreaterThan(1000)
  expect(result.height).toBeGreaterThan(1000)
  expect(result.detected).toBe(true)
  expect(external).toEqual([])
})
