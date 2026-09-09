import { blendAtlas, exposureGains, type AtlasInput } from './atlasBlend'
self.onmessage = (event: MessageEvent<AtlasInput>) => {
  try {
    const input = event.data
    const gains = input.gains ?? exposureGains({ ...input, images: input.calibration ?? input.images })
    const data = blendAtlas({ ...input, gains })
    self.postMessage({ data, gains }, { transfer: [data.buffer] })
  } catch (error) { self.postMessage({ error: String(error) }) }
}
