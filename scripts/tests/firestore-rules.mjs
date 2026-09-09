import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Only local emulators are contacted. Each run cleans up its own test documents.
const auth = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const db = 'http://127.0.0.1:8080/v1/projects/demo-makeup/databases/(default)/documents'
const accounts = []
const suffix = randomUUID()
const lookPath = `looks/rules-${suffix}`
async function user() {
  const response = await fetch(`${auth}/accounts:signUp?key=demo-api-key`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: `rules-${randomUUID()}@example.test`, password: 'RulesLocal2026!', returnSecureToken: true}),
  })
  assert.equal(response.status, 200, await response.clone().text())
  const value = await response.json(); accounts.push(value); return value
}
function value(input) {
  if (Array.isArray(input)) return {arrayValue: {values: input.map(value)}}
  if (typeof input === 'object') return {mapValue: {fields: fields(input)}}
  if (typeof input === 'number') return {doubleValue: input}
  if (typeof input === 'boolean') return {booleanValue: input}
  return {stringValue: input}
}
function fields(input) { return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, value(v)])) }
async function request(method, path, account, data) {
  return fetch(`${db}/${path}`, {
    method, headers: {'Content-Type':'application/json', ...(account ? {Authorization: `Bearer ${account.idToken}`} : {})},
    ...(data ? {body: JSON.stringify({fields: fields(data)})} : {}),
  })
}
try {
  const alice = await user(), bob = await user()
  const recipe = {ownerUid:alice.localId, title:'Round trip', applied:[], painted:[{
    productId:'dior-999', colorIndex:0, intensity:0.75,
    strokes:[{productId:'dior-999', colorIndex:0, radius:0.02, flow:0.4,
      points:[{u:0.4,v:0.7}, {u:0.6,v:0.7,startsSegment:true}]}],
  }]}
  assert.equal((await request('PATCH',lookPath,alice,recipe)).status,200)
  const own = await request('GET',lookPath,alice)
  assert.deepEqual((await own.json()).fields.painted,value(recipe.painted))
  assert.equal((await request('GET',lookPath,bob)).status,403)
  assert.equal((await request('GET',lookPath,null)).status,403)
  assert.equal((await request('PATCH',lookPath,alice,{...recipe,ownerUid:bob.localId})).status,403)
  assert.equal((await request('PATCH',lookPath,bob,{...recipe,ownerUid:bob.localId})).status,403)
  assert.equal((await request('DELETE',lookPath,bob)).status,403)
  assert.equal((await request('PATCH',`products/rules-${suffix}`,alice,{brand:'Invalid'})).status,403)
  assert.equal((await request('PATCH',lookPath,alice,{...recipe,title:'Updated'})).status,200)
  assert.equal((await request('DELETE',lookPath,alice)).status,200)
  console.log('10 checks passed: recipe round trip, owner isolation, immutable owner, catalog read-only, update and delete.')
} finally {
  if (accounts[0]) await request('DELETE',lookPath,accounts[0])
  for (const account of accounts) await fetch(`${auth}/accounts:delete?key=demo-api-key`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:account.idToken}),
  })
}
