// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { TOUCH_GUARD_SCRIPT } from '../../src/packager/touch-guard'

function touch(type: string, id: string): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true })
  document.getElementById(id)!.dispatchEvent(event)
  return event.defaultPrevented
}

function size(id: string, box: Partial<Record<'scrollHeight' | 'clientHeight' | 'scrollWidth' | 'clientWidth', number>>) {
  const el = id === 'html' ? document.documentElement : document.getElementById(id)!
  for (const [key, value] of Object.entries(box)) Object.defineProperty(el, key, { value, configurable: true })
}

describe('touch guard', () => {
  beforeAll(() => {
    document.documentElement.style.overflowY = 'auto'
    document.body.innerHTML =
      '<canvas id="game"></canvas><input id="field"><p contenteditable="false" id="label">x</p>' +
      '<div id="list" style="overflow-y:auto"><p id="row">row</p></div>' +
      '<div id="carousel" style="overflow-x:auto"><p id="card">card</p></div>' +
      '<div id="app" style="overflow-y:auto"><canvas id="wrapped"></canvas></div>' +
      '<div data-touch-native><p id="opt-out">x</p></div>'
    size('html', { scrollHeight: 2000, clientHeight: 800 })
    size('list', { scrollHeight: 500, clientHeight: 100 })
    size('carousel', { scrollWidth: 900, clientWidth: 300 })
    size('app', { scrollHeight: 804, clientHeight: 800 })
    new Function(TOUCH_GUARD_SCRIPT)()
  })

  it('keeps a drag on the game canvas from panning the host page, even when the page scrolls', () => {
    expect(touch('touchmove', 'game')).toBe(true)
  })

  it('guards a canvas inside a wrapper with a few pixels of overflow', () => {
    expect(touch('touchmove', 'wrapped')).toBe(true)
  })

  it('leaves touchstart alone so taps still produce click', () => {
    expect(touch('touchstart', 'game')).toBe(false)
  })

  it('lets form fields, opted-out blocks and scrollable blocks handle their own touch', () => {
    expect(touch('touchmove', 'field')).toBe(false)
    expect(touch('touchmove', 'opt-out')).toBe(false)
    expect(touch('touchmove', 'row')).toBe(false)
    expect(touch('touchmove', 'card')).toBe(false)
  })

  it('does not treat contenteditable="false" as a text field', () => {
    expect(touch('touchmove', 'label')).toBe(true)
  })
})
