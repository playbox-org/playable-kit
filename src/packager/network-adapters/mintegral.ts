import { HtmlBuilder } from '../html-builder'
import { NetworkConfig, PackageConfig } from '../../types'
import { BaseAdapter, mintegralBridge } from './base'

const MINTEGRAL_VIEWPORT =
  'width=device-width,user-scalable=no,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0'

/**
 * Mintegral's two container-called hooks, wired to plbx_html subscribers.
 *
 * PlayTurbo calls window.gameStart() at the start of the playable and
 * window.gameClose() at the end (§5, §7). Both used to be guarded no-op stubs,
 * so the container's call reached nothing and a game had no way in — the spec's
 * own use cases (start the countdown/BGM, stop the BGM) were unreachable.
 *
 * Runs right after the bridge and long before the loader, whose own
 * `if (typeof window.gameStart !== 'function')` stubs then no-op. That ordering
 * is what lets these dispatchers own the globals; the loader stubs stay as the
 * fallback for networks without a lifecycle adapter.
 *
 * A subscriber registering after the container already fired is called
 * immediately: Cocos boots asynchronously, so a scene that subscribes in
 * onLoad can easily be later than gameStart, and silently missing the start
 * signal is exactly the bug this replaces.
 *
 * A pre-existing window.gameStart/gameClose (a game that assigns the global
 * itself, the pattern the spec shows) is kept and called first, so this is
 * additive rather than a hijack.
 */
function mintegralLifecycle(): string {
  return `(function () {
  var started = false, closed = false;
  var startSubs = [], closeSubs = [];
  function run(subs) {
    for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) {} }
  }
  function subscribe(subs, fired, cb) {
    if (typeof cb !== 'function') return;
    subs.push(cb);
    if (fired) { try { cb(); } catch (e) {} }
  }
  window.plbx_html = window.plbx_html || {};
  window.plbx_html.on_game_start = function (cb) { subscribe(startSubs, started, cb); };
  window.plbx_html.on_game_close = function (cb) { subscribe(closeSubs, closed, cb); };
  window.plbx_html.is_game_started = function () { return started; };
  var priorStart = typeof window.gameStart === 'function' ? window.gameStart : null;
  var priorClose = typeof window.gameClose === 'function' ? window.gameClose : null;
  window.gameStart = function () {
    started = true;
    if (priorStart) { try { priorStart(); } catch (e) {} }
    run(startSubs);
  };
  window.gameClose = function () {
    closed = true;
    if (priorClose) { try { priorClose(); } catch (e) {} }
    run(closeSubs);
  };
})();`
}

/**
 * Mintegral adapter.
 * - Renames JS bundle to creative.js (handled via networkConfig.jsBundle)
 * - Injects custom viewport meta
 * - Injects Mintegral-specific bridge (install-based CTA)
 * - Injects the gameStart/gameClose dispatchers the container calls into
 */
export class MintegralAdapter extends BaseAdapter {
  constructor(networkId: string, networkConfig: NetworkConfig) {
    super(networkId, networkConfig)
  }

  protected getPlbxBridge(_config: PackageConfig): string {
    return mintegralBridge()
  }

  transform(builder: HtmlBuilder, config: PackageConfig): void {
    super.transform(builder, config)
    builder.injectMeta('viewport', MINTEGRAL_VIEWPORT)
    builder.injectBodyScript(mintegralLifecycle())
  }

}
