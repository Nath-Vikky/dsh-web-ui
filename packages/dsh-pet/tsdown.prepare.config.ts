import { clientBundle } from '../../shared/tsdown.client.ts'

/**
 * Consumer-side bundle face for the `prepare` script. The preceding local
 * tsc build emits declarations from the official npm SDK only; this config
 * then emits both the Host entry and the browser loader artifact. It never
 * reaches into a DeepSeek Harness source checkout.
 */
export default clientBundle('@linxin666/dsh-pet', [
  'src/index.ts',
  'src/invariant.ts',
], {
  libExternal: ['@deepseek-ai/dsh-settings'],
})
