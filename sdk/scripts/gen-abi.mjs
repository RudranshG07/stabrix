import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'out')
const targets = [
  ['stabrixRouterAbi', 'StabrixRouter.sol/StabrixRouter.json'],
  ['stabrixBatchTakerAbi', 'StabrixBatchTaker.sol/StabrixBatchTaker.json'],
  ['stabrixExtructionAbi', 'StabrixExtruction.sol/StabrixExtruction.json'],
  ['stabrixLensAbi', 'StabrixLens.sol/StabrixLens.json'],
  ['depegSentinelAbi', 'DepegSentinel.sol/DepegSentinel.json'],
  ['aquaAbi', 'Aqua.sol/Aqua.json'],
  ['mockStablecoinAbi', 'MockStablecoin.sol/MockStablecoin.json'],
]
const errorSources = ['StabrixMath.sol/StabrixMath.json', 'StabrixPricing.sol/StabrixPricing.json', 'StabrixConfig.sol/StabrixConfig.json']

const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'))
const libErrors = errorSources.flatMap((p) => read(p).abi.filter((x) => x.type === 'error'))

const out = targets.map(([name, path]) => {
  let abi = read(path).abi
  if (name === 'stabrixRouterAbi' || name === 'stabrixBatchTakerAbi') {
    const seen = new Set(abi.filter((x) => x.type === 'error').map((x) => x.name))
    abi = [...abi, ...libErrors.filter((e) => !seen.has(e.name) && seen.add(e.name))]
  }
  return `export const ${name} = ${JSON.stringify(abi)} as const\n`
})
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'abi.ts'), out.join('\n'))
console.log(`wrote ${targets.length} abis`)
