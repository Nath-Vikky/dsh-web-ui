import { describe, expect, it } from 'vitest'

import {
  BASE_PET_STAGE_HEIGHT,
  BASE_PET_STAGE_WIDTH,
  DRAWER_WIDTH,
  petWindowContentSize,
} from './window-layout.ts'

describe('pet window layout', () => {
  it('keeps the hover settings panel footprint for small pets', () => {
    expect(petWindowContentSize(0.5, false)).toEqual({
      width: BASE_PET_STAGE_WIDTH,
      height: BASE_PET_STAGE_HEIGHT,
    })
  })

  it('grows the stage for large pets and adds a fixed drawer width', () => {
    expect(petWindowContentSize(1.5, false)).toEqual({ width: 336, height: 450 })
    expect(petWindowContentSize(1.5, true)).toEqual({ width: 336 + DRAWER_WIDTH, height: 450 })
  })
})
