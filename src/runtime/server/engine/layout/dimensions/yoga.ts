import { loadYoga as loadYogaModule, type Yoga } from 'yoga-layout/load'
import type { YogaInstance } from '../types'

// The WASM module compiles once per process: compiling it for every render
// adds an event listener each time. Each layout gets its own config.
let module: Promise<Yoga> | undefined

/**
 * The yoga node factory of one layout. A point scale factor of 0 turns off
 * yoga's rounding to device pixels, so boxes keep the exact sizes in points.
 */
export const loadYoga = async (): Promise<YogaInstance> => {
  const yoga = await (module ??= loadYogaModule())
  const config = yoga.Config.create()
  config.setPointScaleFactor(0)
  return { node: { create: () => yoga.Node.createWithConfig(config) } }
}
