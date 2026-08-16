import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const packageRoot = new URL('../', import.meta.url)

await Promise.all([
  rm(new URL('lib/', packageRoot), { recursive: true, force: true }),
  rm(new URL('desktop/out/', packageRoot), { recursive: true, force: true }),
])

console.log(`cleaned generated outputs under ${join('packages', 'dsh-pet')}`)
