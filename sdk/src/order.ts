import {
  type Address,
  type Hex,
  concatHex,
  decodeAbiParameters,
  encodeAbiParameters,
  getAddress,
  hexToNumber,
  keccak256,
  numberToHex,
  size,
  sliceHex,
} from 'viem'
import { type BackstopConfig, decodeBackstopConfig, encodeBackstopConfig } from './backstop.js'
import { type RangeConfig, decodeConfig, encodeConfig } from './config.js'

export interface Order {
  maker: Address
  traits: bigint
  data: Hex
}

export const USE_AQUA_FLAG = 1n << 254n
export const AQUA_SALT_OPCODE = 20
export const AQUA_EXTRUCTION_OPCODE = 32
export const STABRIX_TICK_OPCODE = 34
export const STABRIX_BACKSTOP_OPCODE = 35

const ORDER_PARAMS = [
  {
    type: 'tuple',
    components: [
      { name: 'maker', type: 'address' },
      { name: 'traits', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
  },
] as const

function instruction(opcode: number, args: Hex): Hex {
  const len = size(args)
  if (len > 255) throw new Error(`instruction args too long: ${len}`)
  return concatHex([numberToHex(opcode, { size: 1 }), numberToHex(len, { size: 1 }), args])
}

export type Venue = { kind: 'native' } | { kind: 'official'; extruction: Address }

function program(opcode: number, args: Hex, venue: Venue, salt: bigint): Hex {
  const pricing =
    venue.kind === 'native'
      ? instruction(opcode, args)
      : instruction(AQUA_EXTRUCTION_OPCODE, concatHex([getAddress(venue.extruction).toLowerCase() as Hex, args]))
  return concatHex([pricing, instruction(AQUA_SALT_OPCODE, numberToHex(salt, { size: 8 }))])
}

export const buildProgram = (config: RangeConfig, venue: Venue, salt: bigint): Hex =>
  program(STABRIX_TICK_OPCODE, encodeConfig(config), venue, salt)

export const buildBackstopProgram = (config: BackstopConfig, venue: Venue, salt: bigint): Hex =>
  program(STABRIX_BACKSTOP_OPCODE, encodeBackstopConfig(config), venue, salt)

export function buildOrder(maker: Address, config: RangeConfig, venue: Venue, salt: bigint): Order {
  return { maker: getAddress(maker), traits: USE_AQUA_FLAG, data: buildProgram(config, venue, salt) }
}

export function buildBackstopOrder(maker: Address, config: BackstopConfig, venue: Venue, salt: bigint): Order {
  return { maker: getAddress(maker), traits: USE_AQUA_FLAG, data: buildBackstopProgram(config, venue, salt) }
}

export const encodeStrategy = (order: Order): Hex => encodeAbiParameters(ORDER_PARAMS, [order])

export const strategyHash = (order: Order): Hex => keccak256(encodeStrategy(order))

export function decodeStrategy(strategy: Hex): Order {
  const [o] = decodeAbiParameters(ORDER_PARAMS, strategy)
  return { maker: getAddress(o.maker), traits: o.traits, data: o.data }
}

export interface ParsedProgram {
  venue: Venue
  config: RangeConfig
  salt: bigint
}

interface RawProgram {
  opcode: number
  args: Hex
  salt: bigint
}

function splitProgram(data: Hex): RawProgram | null {
  if (size(data) < 2) return null
  const opcode = hexToNumber(sliceHex(data, 0, 1))
  const len = hexToNumber(sliceHex(data, 1, 2))
  if (size(data) < 2 + len + 2) return null
  const args = sliceHex(data, 2, 2 + len)
  const rest = sliceHex(data, 2 + len)
  let salt = 0n
  if (size(rest) === 10 && hexToNumber(sliceHex(rest, 0, 1)) === AQUA_SALT_OPCODE) {
    salt = BigInt(sliceHex(rest, 2, 10))
  } else if (size(rest) !== 0) {
    return null
  }
  return { opcode, args, salt }
}

function parseWith<C>(data: Hex, nativeOpcode: number, decode: (a: Hex) => C): { venue: Venue; config: C; salt: bigint } | null {
  const p = splitProgram(data)
  if (!p) return null
  try {
    if (p.opcode === nativeOpcode) return { venue: { kind: 'native' }, config: decode(p.args), salt: p.salt }
    if (p.opcode === AQUA_EXTRUCTION_OPCODE) {
      return {
        venue: { kind: 'official', extruction: getAddress(sliceHex(p.args, 0, 20)) },
        config: decode(sliceHex(p.args, 20)),
        salt: p.salt,
      }
    }
  } catch {
    return null
  }
  return null
}

export const parseProgram = (data: Hex): ParsedProgram | null => parseWith(data, STABRIX_TICK_OPCODE, decodeConfig)

export interface ParsedBackstop {
  venue: Venue
  config: BackstopConfig
  salt: bigint
}

export const parseBackstopProgram = (data: Hex): ParsedBackstop | null =>
  parseWith(data, STABRIX_BACKSTOP_OPCODE, decodeBackstopConfig)
