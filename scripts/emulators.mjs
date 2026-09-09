import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const data = '.firebase/emulator-data'
const args = ['emulators:start', '--only', 'auth,firestore', '--project', 'demo-makeup', '--export-on-exit', data]
if (existsSync(`${data}/firebase-export-metadata.json`)) args.push('--import', data)
const child = spawn('node_modules/.bin/firebase', args, {stdio:'inherit'})
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 0 })
