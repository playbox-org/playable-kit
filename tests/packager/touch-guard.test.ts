// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { TOUCH_GUARD_SCRIPT } from '../../src/packager/touch-guard'

function touch(type: string, target: Element): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('touch guard', () => {
  beforeAll(() => {
    document.body.innerHTML =
      '<canvas id="game"></canvas><input id="field">' +
      '<div id="list" style="overflow-y:auto"><p id="row">row</p></div>'
    const list = document.getElementById('list')!
    Object.defineProperty(list, 'scrollHeight', { value: 500 })
    Object.defineProperty(list, 'clientHeight', { value: 100 })
    new Function(TOUCH_GUARD_SCRIPT)()
  })

  it('keeps a drag on the game canvas from panning the host page', () => {
    expect(touch('touchmove', document.getElementById('game')!).defaultPrevented).toBe(true)
  })

  it('leaves touchstart alone so taps still produce click', () => {
    expect(touch('touchstart', document.getElementById('game')!).defaultPrevented).toBe(false)
  })

  it('lets form fields and scrollable blocks handle their own touch', () => {
    expect(touch('touchmove', document.getElementById('field')!).defaultPrevented).toBe(false)
    expect(touch('touchmove', document.getElementById('row')!).defaultPrevented).toBe(false)
  })
})
