import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

// Full UI flow against local emulators; no production services or accounts.
test('zoomed brush, undo/redo, saved recipe and local photo reload, mobile layout', async ({page, request}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(15000)
  const email = `studio-${randomUUID()}@example.test`, password = 'StudioLocal2026!'
  const signup = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key', {data:{email,password,returnSecureToken:true}})
  expect(signup.ok()).toBe(true)
  const account = await signup.json()
  try {
    await page.addInitScript(() => localStorage.setItem('makeup.language','en'))
    await page.goto('/')
    await page.getByLabel('Email', {exact:true}).fill(email)
    await page.getByLabel('Password', {exact:true}).fill(password)
    await page.getByRole('button',{name:'Sign in',exact:true}).click()
    await page.getByRole('button',{name:'Photo tools (legacy)',exact:true}).click()
    await page.locator('input[type=file]').setInputFiles('public/dev/face2.jpg')
    await expect(page.getByRole('button',{name:'Add an angle',exact:true})).toBeEnabled({timeout:30000})
    const canvas = page.locator('.preview__canvas')
    await expect(canvas).toBeVisible()
    const image = () => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())
    await expect.poll(async()=> (await image()).length).toBeGreaterThan(10000)
    const bare = await image()
    await page.getByRole('button',{name:'Paint by hand',exact:true}).click()
    await page.getByRole('searchbox').fill('999')
    await page.getByRole('button',{name:/Dior 999/}).click()
    await page.getByRole('button',{name:'Zoom in',exact:true}).click()
    await page.getByRole('button',{name:'Zoom in',exact:true}).click()
    const rect = (await canvas.boundingBox())!
    // Lip location in this fixed local fixture; input is deliberately zoomed.
    await page.mouse.move(rect.x+rect.width*0.475, rect.y+rect.height*0.56)
    await page.mouse.down()
    await page.mouse.move(rect.x+rect.width*0.53, rect.y+rect.height*0.56, {steps:8})
    await expect.poll(image).not.toBe(bare) // must update before mouse-up
    await page.mouse.up()
    await expect(page.getByRole('button',{name:'Undo stroke',exact:true})).toBeEnabled()
    const painted = await image()
    await page.getByRole('button',{name:'Undo stroke',exact:true}).click()
    await expect.poll(image).toBe(bare)
    await page.getByRole('button',{name:'Redo stroke',exact:true}).click()
    await expect.poll(image).toBe(painted)
    await page.getByRole('button',{name:'Saved looks',exact:true}).click()
    await page.getByPlaceholder('Name this look').fill('Brush round trip')
    await page.getByRole('button',{name:'Save',exact:true}).click()
    await expect(page.getByRole('button',{name:'Brush round trip',exact:true})).toBeVisible()
    await page.reload()
    await page.getByRole('button',{name:'Photo tools (legacy)',exact:true}).click()
    await expect(canvas).toBeVisible({timeout:30000})
    await page.getByRole('button',{name:'Saved looks',exact:true}).click()
    await page.getByRole('button',{name:'Brush round trip',exact:true}).click()
    await expect.poll(image).toBe(painted)
    await page.setViewportSize({width:390,height:844})
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path:'../.artifacts/web/mobile-studio.png',fullPage:true})
    await page.getByRole('button',{name:'Sign out',exact:true}).click()
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible()
  } finally {
    const base = 'http://127.0.0.1:8080/v1/projects/demo-makeup/databases/(default)/documents'
    const headers = {'Content-Type':'application/json', Authorization:`Bearer ${account.idToken}`}
    const response = await fetch(`${base}:runQuery`, {method:'POST', headers, body:JSON.stringify({structuredQuery:{
      from:[{collectionId:'looks'}], where:{fieldFilter:{field:{fieldPath:'ownerUid'},op:'EQUAL',value:{stringValue:account.localId}}},
    }})})
    if (response.ok) {
      for (const row of await response.json()) if (row.document) {
        await fetch(`http://127.0.0.1:8080/v1/${row.document.name}`,{method:'DELETE',headers})
      }
    }
    await fetch(`${base}/users/${account.localId}`,{method:'DELETE',headers})
    await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:delete?key=demo-api-key', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({idToken:account.idToken})})
  }
})
