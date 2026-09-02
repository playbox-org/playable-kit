export interface PreviewUtilParams {
  networkId: string
  mraid: boolean
  maxSize: number
  /** Adversarial mraid timing for the boot harness. Default 'happy' (today's
   *  behavior: viewable true right after ready). Hostile modes stress the
   *  defer-boot gate so a fragile loader greys out instead of silently passing:
   *  'neverViewable' (no pulse at all) and 'lostPulse' (a stray viewableChange
   *  pulse the gate must survive). Ignored for molocoV2 (own manual-viewable). */
  mraidMode?: 'happy' | 'neverViewable' | 'lostPulse' | string
}

/**
 * The CTA method the REAL network validator tracks for this network. Our mock
 * tags each 'cta' report with whether the method matches — so the validator
 * shows the TRUTH (did the game reach the network's CTA SDK?) instead of
 * counting a bare window.open() (blocked/untracked in real ad sandboxes) as a
 * success. Keep in sync with the bridges in network-adapters/base.ts.
 */
function expectedCtaMethod(networkId: string, mraid: boolean): string {
  const MAP: Record<string, string> = {
    facebook: 'fbplayable',
    moloco: 'fbplayable',
    molocoV2: 'mraid.open',
    google: 'exitapi',
    mintegral: 'install',
    tiktok: 'playable_sdk',
    pangle: 'playable_sdk',
    vungle: 'vungle_download',
    bigo: 'bgy_mraid',
    mytarget: 'mtrg',
    // Luna's standard Ad Click fires only from Luna.Unity.Playable.InstallFullGame()
    // — a bare window.open() must read as an incorrect CTA, not a success.
    luna: 'luna_install',
  }
  return MAP[networkId] || (mraid ? 'mraid.open' : 'window.open')
}

export function generatePreviewUtil(params: PreviewUtilParams): string {
  const { networkId, mraid } = params
  const parts: string[] = []
  const expectedCta = expectedCtaMethod(networkId, mraid)

  // Phase 1: Reporting
  parts.push(`
(function() {
  var _plbxEvents = [];
  var _plbxExpectedCta = ${JSON.stringify(expectedCta)};
  function report(event, data) {
    // Tag CTA events with whether the call matched the network's REAL CTA SDK
    // method. A bare window.open() on an SDK network is NOT a tracked CTA —
    // marking it correct:false stops the validator showing a false success.
    if (event === 'cta') {
      data = data || {};
      data.expected = _plbxExpectedCta;
      data.correct = data.method === _plbxExpectedCta;
    }
    _plbxEvents.push({ event: event, data: data, time: Date.now() });
    try {
      parent.postMessage({ type: 'plbx:preview', event: event, data: data || {} }, '*');
    } catch(e) {}
  }
  window.__plbxReport = report;
`)

  // Phase 2: Error tracking
  parts.push(`
  var _errors = [];
  window.onerror = function(msg, src, line, col, err) {
    _errors.push({ message: String(msg), source: src, line: line });
    report('error', { message: String(msg), source: src, line: line, col: col });
  };
  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason ? (e.reason.message || String(e.reason)) : 'Unknown rejection';
    _errors.push({ message: msg });
    report('error', { message: msg });
  });
`)

  // Phase 3: Network request tracking + MOLOCO_MACROS fire detection
  parts.push(`
  var _requests = [];
  var _whitelist = [location.hostname, 'localhost', '127.0.0.1', ''];

  function isExternal(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return false;
    try {
      var h = new URL(url, location.href).hostname;
      return _whitelist.indexOf(h) === -1;
    } catch(e) { return false; }
  }

  // ---- MOLOCO_MACROS reverse-lookup ----
  // Built lazily on first fire so we capture the launcher's MOLOCO_MACROS values
  // (DSP substitutes the #...# placeholders before serving). The lookup maps both
  // the raw encoded value and the decoded value back to the macro key — adapter
  // implementations may use either form.
  var _macroLookup = null;
  function _buildMacroLookup() {
    var M = window.MOLOCO_MACROS;
    if (!M) return null;
    var L = {};
    for (var k in M) {
      if (!Object.prototype.hasOwnProperty.call(M, k)) continue;
      var raw = M[k];
      if (!raw || typeof raw !== 'string') continue;
      L[raw] = k;
      try { L[decodeURIComponent(raw)] = k; } catch(e) {}
    }
    return L;
  }
  function _macroKeyForUrl(url) {
    if (!url || typeof url !== 'string') return null;
    if (_macroLookup === null) _macroLookup = _buildMacroLookup();
    if (!_macroLookup) return null;
    if (_macroLookup[url]) return _macroLookup[url];
    try {
      var d = decodeURIComponent(url);
      if (_macroLookup[d]) return _macroLookup[d];
    } catch(e) {}
    // Suffix fallback: browser extensions that re-wrap Image.src (observed:
    // Arc + an inspector.js content script) pass the ABSOLUTIZED url down the
    // setter chain — the '#PLACEHOLDER#' macro value resolves against the page
    // URL and arrives as 'http://host/page#PLACEHOLDER#'. Exact match fails,
    // but the macro value survives as the suffix (ES5: lastIndexOf, no endsWith).
    for (var raw in _macroLookup) {
      if (!Object.prototype.hasOwnProperty.call(_macroLookup, raw)) continue;
      if (raw && url.length > raw.length && url.lastIndexOf(raw) === url.length - raw.length) {
        return _macroLookup[raw];
      }
    }
    return null;
  }
  function _logMacroFire(url, channel) {
    var key = _macroKeyForUrl(url);
    if (!key) return;
    var stack = '';
    try { stack = (new Error()).stack || ''; } catch(e) {}
    report('macro_fire', {
      macroKey: key,
      url: url,
      channel: channel,
      ts: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
      stack: stack.split('\\n').slice(2, 6).join('\\n')
    });
  }

  // Wrap XMLHttpRequest
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var u = String(url);
    _requests.push(u);
    _logMacroFire(u, 'xhr');
    if (isExternal(u)) report('external_request', { url: u });
    return _xhrOpen.apply(this, arguments);
  };

  // Wrap fetch
  if (window.fetch) {
    var _origFetch = window.fetch;
    window.fetch = function(input) {
      var u = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      _requests.push(u);
      _logMacroFire(u, 'fetch');
      if (isExternal(u)) report('external_request', { url: u });
      return _origFetch.apply(this, arguments);
    };
  }

  // Wrap Image.src — guarded against double-patching (preview reload safety)
  if (!window.__plbx_image_patched) {
    window.__plbx_image_patched = true;
    var _imgDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (_imgDesc && _imgDesc.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        set: function(v) {
          _logMacroFire(v, 'image');
          if (isExternal(v)) report('external_request', { url: v, type: 'image' });
          _imgDesc.set.call(this, v);
        },
        get: _imgDesc.get,
        configurable: true
      });
    }
  }
`)

  // Phase 4: SDK mocks (network-specific)

  // Shared state and listener system for MRAID + dapi
  const isMolocoV2 = networkId === 'molocoV2'
  // Adversarial boot harness mode (non-moloco). Unknown → happy (today's behavior).
  const KNOWN_MRAID_MODES = new Set(['happy', 'neverViewable', 'lostPulse'])
  const mraidMode = KNOWN_MRAID_MODES.has(params.mraidMode || '')
    ? (params.mraidMode as string)
    : 'happy'
  // Initial viewability: happy → true (legacy), hostile modes start false so the
  // gate must boot via its render-surface fallback / poll, not a gifted pulse.
  const initialViewable = isMolocoV2 ? false : mraidMode === 'happy'
  if (mraid) {
    parts.push(`
  // Shared SDK state
  var _sdkState = 'loading';
  // MolocoV2 spec: ad container delivers viewableChange(true) only after the
  // creative is actually visible. Start false so production semantics are
  // mirrored — manual "Trigger viewable" button drives the transition.
  var _viewable = ${initialViewable ? 'true' : 'false'};
  var _volume = 100;
  var _listeners = {};

  function _fire(name, data) {
    var arr = _listeners[name] || [];
    for (var i = 0; i < arr.length; i++) { try { arr[i](data); } catch(e) { console.warn('[plbx] Listener error:', e); } }
  }

  function _addListener(name, cb) {
    if (typeof cb !== 'function') return;
    _listeners[name] = _listeners[name] || [];
    if (_listeners[name].indexOf(cb) === -1) {
      _listeners[name].push(cb);
      // Tell the validator UI when payload registers viewableChange — without
      // that listener mraid_viewable never fires in production.
      report('mraid_listener_added', { event: name });
    }
    if (name === 'ready' && _sdkState !== 'loading') { setTimeout(function() { try { cb(); } catch(e) {} }, 0); }
  }

  function _removeListener(name, cb) {
    if (!_listeners[name]) return;
    if (!cb) { _listeners[name] = []; return; }
    _listeners[name] = _listeners[name].filter(function(f) { return f !== cb; });
  }

  function _getSize() { return { width: window.innerWidth || 320, height: window.innerHeight || 480 }; }

  // MRAID mock (2.0 + 3.0). Manual-trigger helpers (_fire*) exposed so the
  // validator UI can drive lifecycle transitions from the parent window.
  window.mraid = window.mraid || {
    getVersion: function() { return '3.0'; },
    getState: function() { return _sdkState; },
    isViewable: function() { return _viewable; },
    getAudioVolumePercentage: function() { return _volume; },
    getAudioVolume: function() { return _volume; },
    getMaxSize: function() { return _getSize(); },
    getScreenSize: function() { return _getSize(); },
    getCurrentPosition: function() { var s = _getSize(); return { x: 0, y: 0, width: s.width, height: s.height }; },
    getDefaultPosition: function() { var s = _getSize(); return { x: 0, y: 0, width: s.width, height: s.height }; },
    getPlacementType: function() { return 'interstitial'; },
    supports: function() { return true; },
    addEventListener: _addListener,
    removeEventListener: _removeListener,
    open: function(url) { report('cta', { url: url, method: 'mraid.open' }); },
    close: function() {},
    useCustomClose: function() {},
    setOrientationProperties: function() {},
    expand: function() {},
    _fireViewableChange: function(v) {
      _viewable = !!v;
      _fire('viewableChange', _viewable);
      report('mraid_viewable_change', { viewable: _viewable });
    },
    _fireExposureChange: function(exposed) {
      _fire('exposureChange', exposed ? 100 : 0);
    },
    _setState: function(s) {
      _sdkState = String(s);
      _fire('stateChange', _sdkState);
    },
    // Drive MRAID audioVolumeChange in isolation (no force-pause of audio
    // engine). Lets the validator verify the GAME reacts to live mute on its
    // own via plbx.on_mute_change, not the preview forcing silence.
    _setAudioVolume: function(v) {
      _volume = Number(v);
      _fire('audioVolumeChange', _volume);
      report('audio_volume', { volume: _volume });
    }
  };

  // dapi mock (IronSource/Unity Ads) — shares listeners with mraid
  window.dapi = window.dapi || {
    isDemoDapi: true,
    isReady: function() { return _sdkState !== 'loading'; },
    getAudioVolume: function() { return _volume; },
    getScreenSize: function() { return _getSize(); },
    isViewable: function() { return _viewable; },
    addEventListener: _addListener,
    removeEventListener: _removeListener,
    openStoreUrl: function(url) { report('cta', { url: url, method: 'dapi.openStoreUrl' }); }
  };

  // AudioContext tracking — patch BEFORE game creates any contexts
  window.__plbx_audioContexts = [];
  var _OrigAC = window.AudioContext || window.webkitAudioContext;
  if (_OrigAC) {
    var _PatchedAC = function AudioContext() {
      var ctx = new _OrigAC();
      window.__plbx_audioContexts.push(ctx);
      return ctx;
    };
    _PatchedAC.prototype = _OrigAC.prototype;
    window.AudioContext = _PatchedAC;
    if (window.webkitAudioContext) window.webkitAudioContext = _PatchedAC;
  }

  // Audio mute control via postMessage (reliable cross-iframe transport)
  function _handleMute(muted) {
    try {
      _volume = muted ? 0 : 100;
      report('audio_volume', { volume: _volume });
      _fire('audioVolumeChange', _volume);

      // Force suspend/resume all tracked AudioContexts
      (window.__plbx_audioContexts || []).forEach(function(ctx) {
        try { muted ? ctx.suspend() : ctx.resume(); } catch(err) {}
      });

      // Mute all <audio> and <video> elements
      var mediaEls = document.querySelectorAll('audio, video');
      for (var i = 0; i < mediaEls.length; i++) { mediaEls[i].muted = muted; }

      // Try to find Cocos audio engine and mute it directly
      if (window.cc && window.cc.audioEngine) {
        try {
          if (muted) { window.cc.audioEngine.pauseAll(); }
          else { window.cc.audioEngine.resumeAll(); }
        } catch(err) {}
      }
    } catch(err) { console.warn('[plbx] Audio mute error:', err); }
  }

  // Listen for postMessage from parent (primary transport)
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'plbx:audio-control') {
      _handleMute(!!e.data.muted);
    }
  });

  // Also listen for CustomEvent (legacy/playable-hosting compat)
  window.addEventListener('playable-audio-mute', function(e) {
    _handleMute(!!(e.detail && e.detail.muted));
  });

  // Viewable control from parent
  window.addEventListener('playable-screen-lock', function(e) {
    try {
      var locked = !!(e.detail && e.detail.locked);
      _viewable = !locked;
      _fire('viewableChange', _viewable);
    } catch(err) {}
  });

  // Initialize SDK after small delay.
  // For molocoV2: only flip state to 'default' (so getState() != 'loading')
  // and fire 'ready'. Viewable stays false until manual trigger — production
  // mraid behavior where viewableChange(true) arrives separately.
  setTimeout(function() {
    _sdkState = 'default';
    _fire('ready');
    ${
      isMolocoV2
        ? '// viewable stays false — wait for manual trigger'
        : mraidMode === 'neverViewable'
          ? '// neverViewable: isViewable() stays false forever, no viewableChange(true). A fragile gate hangs; a robust gate boots via its render-surface fallback.'
          : mraidMode === 'lostPulse'
            ? "var _PLBX_LOST_PULSE = true; _fire('viewableChange', true); // pulse fires while the gate listener is (in a real build) not yet attached → lost; _viewable stays false so isViewable() at gate time is false. Robust gate recovers via poll/render-surface."
            : "_fire('viewableChange', true);"
    }
    report('mraid_ready', {});
  }, ${isMolocoV2 ? 100 : 50});
`)
  }

  // AppLovin Axon Events tracking
  if (networkId === 'applovin') {
    parts.push(`
  // ALPlayableAnalytics mock — intercept Axon Events
  window.ALPlayableAnalytics = window.ALPlayableAnalytics || {
    trackEvent: function(name) {
      report('axon_event', {
        name: name,
        ts: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
      });
    }
  };
`)
  }

  if (networkId === 'mintegral') {
    parts.push(`
  // Mintegral mock: CTA via window.install()
  window.install = function() { report('cta', { method: 'install' }); };

`)
  }

  if (networkId === 'google') {
    parts.push(`
  // Google Ads mock
  window.ExitApi = { exit: function() { report('cta', { method: 'exitapi' }); } };
`)
  }

  if (networkId === 'facebook' || networkId === 'moloco') {
    parts.push(`
  // Facebook/Moloco mock — both use FbPlayableAd API
  window.FbPlayableAd = { onCTAClick: function() { report('cta', { method: 'fbplayable' }); } };
`)
  }

  if (networkId === 'molocoV2') {
    parts.push(`
  // ---- MolocoV2 validator extensions ----
  //
  // Manual-trigger postMessage protocol — the validator UI dispatches these to
  // drive lifecycle from outside the iframe. Distinct namespace from existing
  // plbx:audio-control etc. messages so we never cross signals.
  window.addEventListener('message', function(e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object' || d.type !== 'plbx:molocov2') return;
    var action = d.action;
    try {
      switch (action) {
        case 'viewable':
          if (window.mraid && window.mraid._fireViewableChange) {
            window.mraid._fireViewableChange(d.value !== false);
          }
          break;
        case 'pause':
          if (window.mraid && window.mraid._setState) window.mraid._setState('hidden');
          break;
        case 'resume':
          if (window.mraid && window.mraid._setState) window.mraid._setState('default');
          if (window.mraid && window.mraid._fireViewableChange) window.mraid._fireViewableChange(true);
          break;
        case 'game-end':
          if (window.plbx_html && typeof window.plbx_html.game_end === 'function') {
            window.plbx_html.game_end();
          }
          break;
        case 'simulate-taps':
          var n = parseInt(d.count, 10);
          if (!isFinite(n) || n < 1) n = 1;
          for (var i = 0; i < n; i++) {
            if (window.plbx_html && typeof window.plbx_html.tap === 'function') {
              window.plbx_html.tap();
            }
          }
          break;
        case 'cta':
          if (window.plbx_html && typeof window.plbx_html.download === 'function') {
            window.plbx_html.download();
          }
          break;
        case 'mute':
          if (window.mraid && window.mraid._setAudioVolume) window.mraid._setAudioVolume(0);
          break;
        case 'unmute':
          if (window.mraid && window.mraid._setAudioVolume) window.mraid._setAudioVolume(100);
          break;
        default:
          break;
      }
    } catch(err) {
      report('error', { message: 'molocov2 trigger ' + action + ': ' + (err && err.message) });
    }
  });

  // Snapshot start_muted contract on load — UI surfaces the static
  // is_muted() value alongside the macro to verify the adapter reads it.
  setTimeout(function() {
    try {
      var raw = (window.MOLOCO_MACROS && window.MOLOCO_MACROS.start_muted) || '';
      var expected = (raw === '1' || raw === 'true');
      var actual = (window.plbx_html && typeof window.plbx_html.is_muted === 'function')
        ? !!window.plbx_html.is_muted()
        : null;
      report('molocov2_start_muted', { macro: raw, expected: expected, actual: actual });
    } catch(e) {}
  }, 200);

  // Track final_url usage in CTA path. mraid.open() intercept already reports
  // 'cta' — augment with whether the URL matches MOLOCO_MACROS.final_url.
  if (window.mraid && !window.mraid.__plbx_open_wrapped) {
    window.mraid.__plbx_open_wrapped = true;
    var _origOpen = window.mraid.open.bind(window.mraid);
    window.mraid.open = function(url) {
      var finalRaw = (window.MOLOCO_MACROS && window.MOLOCO_MACROS.final_url) || '';
      var finalDecoded = finalRaw;
      try { finalDecoded = decodeURIComponent(finalRaw); } catch(e) {}
      var match = !!url && (url === finalRaw || url === finalDecoded);
      report('molocov2_cta', { url: url, match: match });
      return _origOpen(url);
    };
  }
`)
  }

  if (networkId === 'luna') {
    parts.push(`
  // ---- Luna / Unity Playworks mock ----
  //
  // Luna is an authoring platform: its SDK (window.Luna + window.pi) and its
  // standard events are injected by the EXPORTER, so nothing of it exists in a
  // local preview. The mock stands in for the host — it owns the boot, counts
  // every custom event against Luna's caps (32 per name / 256 per session) and
  // simulates the standard events at the moments Luna fires them, so their
  // PRECONDITIONS can be validated before upload.
  var _lunaCounts = {}, _lunaTotal = 0, _lunaStarted = false;

  // Every report carries the per-name count, the session total, the
  // before-startGame flag and the value check — the panel computes the caps
  // verdicts from these numbers alone.
  //
  // The session total counts CUSTOM events only. Luna's 256-per-session budget
  // is spent by the events the game authors; the six standard ones are Luna's
  // own and are simulated here purely because the real ones are injected at
  // export. Charging them to the budget inflated both the caps verdict and the
  // panel footer by up to six against what Luna actually counts. Per-name
  // counts stay on every event — the standard rows still show their fires.
  function _lunaEvent(name, value, kind) {
    _lunaCounts[name] = (_lunaCounts[name] || 0) + 1;
    if (kind === 'custom') _lunaTotal++;
    report('luna_event', {
      name: name, value: value, kind: kind,
      count: _lunaCounts[name], total: _lunaTotal,
      beforeStart: !_lunaStarted,
      // Luna silently drops a string-named event without an INTEGER value, and
      // this test must be the same one the static gate applies (isIntegerish in
      // validation/luna-events.ts) — two validators disagreeing about the same
      // call is worse than either being strict: a preview that green-lights
      // logCustomEvent('frac', 1.5) tells the author their creative is fine
      // right up until packaging refuses it. Hence the integer test, not merely
      // isFinite.
      //
      // The mock only ever sees what reaches window.pi, so it cannot tell a
      // direct pi.logCustomEvent from a bridged plbx_html.log_event — and it
      // does not need to: the bridge coerces on its own side (value | 0, with a
      // missing value becoming 1 — see lunaBridge in base.ts), so every
      // bridged call arrives here already integer. A value that arrives
      // fractional, non-numeric or missing therefore came from a DIRECT call,
      // which is exactly the shape isIntegerish rejects. Reporting it is honest;
      // the value-less bridge call the static gate forgives never gets here.
      valueOk: (kind !== 'custom') ||
        (typeof value === 'number' && isFinite(value) && Math.floor(value) === value),
    });
  }

  window.pi = window.pi || { logCustomEvent: function (name, value) { _lunaEvent(name, value, 'custom'); } };

  window.Luna = window.Luna || {
    Unity: {
      Playable: { InstallFullGame: function () {
        // Luna's standard Ad Click fires from InstallFullGame and nowhere else.
        report('cta', { url: (window.plbx_html || {}).google_play_url || '', method: 'luna_install' });
        _lunaEvent('adClick', 1, 'standard');
      } },
      LifeCycle: { GameEnded: function () { report('game_end', { source: 'luna' }); } },
      // Returning the caller's default is what Luna's own reference archive does
      // before Playground fields are authored.
      Playground: { get: function (section, key, def) { return def; } },
    },
  };

  // Luna's host calls startGame(); with window.Luna present the creative must
  // NOT self-start, so calling it here exercises the real gate instead of the
  // dev fallback.
  //
  // This is a POLL, not a single sample, and that is load-bearing. The packaged
  // bridge defines window.startGame inside __plbx_pre_boot, which the runtime
  // loader runs only AFTER it has unpacked the inlined ZIP — that lands well
  // after 'load' and takes as long as the machine takes. A one-shot probe that
  // fired before the unpack finished (the original 50ms setTimeout) left the
  // preview stuck on the splash FOREVER — the mock has defined window.Luna, so
  // the creative's "no Luna host -> start myself" fallback is disabled by
  // design and nothing else would ever boot it — and it reported a start_game
  // failure for a perfectly good artifact. Bounded retries are the house
  // pattern for exactly this (runtime loader's pollDl, mraidDeferBootGate, the
  // adImpression canvas fallback below).
  var LUNA_START_POLL_MS = 50;
  // 15s: the wait has to cover a JSZip unpack of a fully-inlined artifact plus
  // Cocos engine init on a cold, throttled machine. Erring long is cheap (a
  // genuinely dead creative is reported a few seconds later); erring short is
  // the bug above.
  var LUNA_START_TIMEOUT_MS = 15000;
  function _lunaStartGame(source) {
    if (_lunaStarted) return true;
    if (typeof window.startGame !== 'function') return false;
    _lunaStarted = true;
    report('luna_lifecycle', { name: 'startGame', source: source });
    try { window.startGame(); }
    catch (err) { report('error', { message: 'luna: startGame() threw: ' + (err && err.message) }); }
    return true;
  }

  _lunaEvent('adLoading', 1, 'standard');
  window.addEventListener('load', function () {
    _lunaEvent('adReady', 1, 'standard');
    _lunaEvent('adStarting', 1, 'standard');
    var waited = 0;
    (function pollStartGame() {
      if (_lunaStartGame('host')) return;   // boot on the first tick that sees it
      waited += LUNA_START_POLL_MS;
      if (waited >= LUNA_START_TIMEOUT_MS) {
        // Only now is it a real finding: the creative never defined startGame,
        // so Luna's host would have nothing to call.
        report('error', { message: 'luna: startGame() was never defined (waited ' + (LUNA_START_TIMEOUT_MS / 1000) + 's)' });
        return;
      }
      setTimeout(pollStartGame, LUNA_START_POLL_MS);
    })();
  });

  // adEngagement = first pointer input, whatever flavour the device sends.
  //
  // ONE handler shared by all three types, plus a fired flag. Registering a
  // separate closure per type (the obvious forEach) is a bug: each closure can
  // only unregister ITSELF, and a single tap synthesises pointerdown + mousedown
  // (plus touchstart on a touch screen), so adEngagement got reported 2-3x for
  // one tap. Luna's real Ad Engagement fires once per session, and the panel
  // reads that per-name count to validate first-interaction.
  (function () {
    var INPUT_TYPES = ['pointerdown', 'touchstart', 'mousedown'];
    var _lunaEngaged = false;
    function _lunaFirstInput() {
      if (_lunaEngaged) return;   // a sibling event of the same tap already counted it
      _lunaEngaged = true;
      INPUT_TYPES.forEach(function (t) { window.removeEventListener(t, _lunaFirstInput, true); });
      _lunaEvent('adEngagement', 1, 'standard');
    }
    INPUT_TYPES.forEach(function (t) { window.addEventListener(t, _lunaFirstInput, true); });
  })();

  // adImpression = the first rendered frame. The build already computes that
  // moment for the splash (splash.ts FIRST_FRAME_HOOK_JS calls
  // window.__plbx_splash_hide on cc.director's EVENT_END_FRAME), so decorate
  // that assignment rather than re-implementing the Cocos frame probe. A build
  // packaged with the splash off never assigns it — hence the render-surface
  // fallback, which stays silent if no canvas ever appears (a missed impression
  // is a finding, not something to fake).
  var _lunaImpressed = false;
  function _lunaImpression() {
    if (_lunaImpressed) return;
    _lunaImpressed = true;
    _lunaEvent('adImpression', 1, 'standard');
  }
  (function () {
    var _splashHide;
    try {
      Object.defineProperty(window, '__plbx_splash_hide', {
        configurable: true,
        get: function () { return _splashHide; },
        set: function (fn) {
          _splashHide = (typeof fn === 'function') ? function () {
            _lunaImpression();
            return fn.apply(this, arguments);
          } : fn;
        }
      });
    } catch (e) {}
    var tries = 0;
    var iv = setInterval(function () {
      if (_lunaImpressed) { clearInterval(iv); return; }
      if (document.querySelector('canvas')) {
        clearInterval(iv);
        requestAnimationFrame(function () { requestAnimationFrame(_lunaImpression); });
        return;
      }
      if (++tries >= 100) clearInterval(iv);   // ~10s, then give up quietly
    }, 100);
  })();

  // Manual-trigger protocol (mirrors plbx:molocov2) — the validator UI drives
  // Luna's container lifecycle from outside the iframe.
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object' || d.type !== 'plbx:luna') return;
    var evt = { build: 'luna:build', pause: 'luna:pause', resume: 'luna:resume', mute: 'luna:mute', unmute: 'luna:unmute' }[d.action];
    try {
      if (evt) { window.dispatchEvent(new Event(evt)); report('luna_lifecycle', { name: evt }); return; }
      if (d.action === 'start-game') {
        // Same one-shot boot path as the auto poll — a manual trigger after the
        // poll already booted must not start the game twice.
        if (!_lunaStartGame('manual') && !_lunaStarted) {
          report('error', { message: 'luna: start-game trigger, but startGame() is not defined (yet)' });
        }
        return;
      }
      if (d.action === 'game-end' && window.plbx_html && window.plbx_html.game_end) { window.plbx_html.game_end(); return; }
      if (d.action === 'cta' && window.plbx_html && window.plbx_html.download) { window.plbx_html.download(); return; }
    } catch (err) {
      report('error', { message: 'luna trigger ' + d.action + ': ' + (err && err.message) });
    }
  });
`)
  }

  if (networkId === 'tiktok' || networkId === 'pangle') {
    parts.push(`
  // TikTok/Pangle playable SDK — WRAP the real SDK, don't replace it, so the
  // validator tests the honest build. The build's external playable-sdk.js
  // loads normally (all ~44 real methods stay live); we only decorate the 3
  // observable calls so the checklist sees CTA + lifecycle, then delegate to
  // the real method. The real SDK assigns window.playableSDK as a plain,
  // configurable data property, so an accessor trap installed here (before the
  // SDK <script> runs) catches the assignment. Idempotent per-method decoration
  // + a bounded poll cover late attachment / reassignment; if the SDK never
  // loads (offline / CDN blocked) an install-once mock keeps preview working.
  (function() {
    var BEACON = {
      openAppStore:    function() { report('cta', { method: 'playable_sdk' }); },
      reportGameReady: function() { report('game_ready', { method: 'playableSDK.reportGameReady' }); },
      reportGameClose: function() { report('game_end', { method: 'playableSDK.reportGameClose' }); }
    };
    function decorate(sdk) {
      if (!sdk) return sdk;
      Object.keys(BEACON).forEach(function(name) {
        var cur = sdk[name];
        if (cur && cur.__plbxBeacon) return; // already our wrapper
        var orig = typeof cur === 'function' ? cur.bind(sdk) : null;
        var beacon = BEACON[name];
        var wrapped = function() {
          try { beacon(); } catch(e) {}
          if (orig) { try { return orig.apply(null, arguments); } catch(e) {} }
        };
        wrapped.__plbxBeacon = true;
        sdk[name] = wrapped;
      });
      return sdk;
    }
    function mock() {
      return decorate({
        // real SDK's common query methods, no-op'd so off-contract games survive offline
        isViewable: function() { return true; }, isReady: function() { return true; },
        isMuted: function() { return false; }, isPangle: function() { return ${networkId === 'pangle'}; },
        addEventListener: function() {}, removeEventListener: function() {}
      });
    }
    var backing;
    Object.defineProperty(window, 'playableSDK', {
      configurable: true,
      get: function() { return backing; },
      set: function(v) { backing = decorate(v); }
    });
    var tries = 0;
    var iv = setInterval(function() {
      if (backing) decorate(backing);        // re-wrap late-attached / reassigned methods
      if (++tries >= 30) {                    // ~3s at 100ms
        clearInterval(iv);
        if (!backing) backing = mock();       // no real SDK arrived → offline fallback
      }
    }, 100);
  })();
  // Some builds call the bare global directly.
  window.openAppStore = function() { report('cta', { method: 'openAppStore' }); };
`)
  }

  if (networkId === 'bigo') {
    parts.push(`
  // Bigo MRAID SDK mock
  window.BGY_MRAID = { open: function(url) { report('cta', { url: url, method: 'bgy_mraid' }); } };
`)
  }

  if (networkId === 'vungle') {
    parts.push(`
  // Vungle Adaptive Creative mock — CTA via parent.postMessage
  var _origPostMessage = window.parent.postMessage.bind(window.parent);
  window.parent.postMessage = function(msg, origin) {
    if (msg === 'download') { report('cta', { method: 'vungle_download' }); }
    if (msg === 'complete') { report('game_end', { method: 'vungle_complete' }); }
    return _origPostMessage(msg, origin);
  };
`)
  }

  if (networkId === 'mytarget') {
    parts.push(`
  // myTarget (VK Ads) mock
  window.MTRG = { onCTAClick: function() { report('cta', { method: 'mtrg' }); } };
`)
  }

  if (networkId === 'yandex') {
    parts.push(`
  // Yandex mock
  window.yandexHTML5BannerApi = { getClickURLNum: function(n) { report('cta', { method: 'yandex', num: n }); } };
`)
  }

  // Audio control for non-MRAID networks (MRAID networks handle this in the SDK block above)
  if (!mraid) {
    parts.push(`
  // AudioContext tracking
  window.__plbx_audioContexts = [];
  var _OrigAC = window.AudioContext || window.webkitAudioContext;
  if (_OrigAC) {
    var _PatchedAC = function AudioContext() {
      var ctx = new _OrigAC();
      window.__plbx_audioContexts.push(ctx);
      return ctx;
    };
    _PatchedAC.prototype = _OrigAC.prototype;
    window.AudioContext = _PatchedAC;
    if (window.webkitAudioContext) window.webkitAudioContext = _PatchedAC;
  }

  // Audio mute via postMessage
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'plbx:audio-control') {
      var muted = !!e.data.muted;
      try {
        (window.__plbx_audioContexts || []).forEach(function(ctx) {
          try { muted ? ctx.suspend() : ctx.resume(); } catch(err) {}
        });
        var mediaEls = document.querySelectorAll('audio, video');
        for (var i = 0; i < mediaEls.length; i++) { mediaEls[i].muted = muted; }
        if (window.cc && window.cc.audioEngine) {
          try { muted ? window.cc.audioEngine.pauseAll() : window.cc.audioEngine.resumeAll(); } catch(err) {}
        }
      } catch(err) { console.warn('[plbx] Audio mute error:', err); }
    }
  });
`)
  }

  // Generic CTA fallback: wrap window.open
  parts.push(`
  // Generic CTA: wrap window.open
  var _origOpen = window.open;
  window.open = function(url, target) {
    report('cta', { url: url, method: 'window.open' });
    // Don't actually navigate in preview
    return null;
  };
`)

  // Phase 5: Lifecycle tracking
  parts.push(`
  // Lifecycle tracking.
  //
  // Direction matters and the names do not carry it. gameReady/gameEnd are
  // defined HERE (container side) and called by the creative. gameStart and
  // gameClose are the opposite: the creative defines them, the container calls
  // them (PlayTurbo §5, §7 — "we will automatically call this function").
  //
  // This mock used to ASSIGN window.gameStart/gameClose to its own reporters,
  // which is the container overwriting the creative's hooks. Whichever script
  // ran last won: the checklist went green off the mock's own report while the
  // creative's start/close logic never ran, or the creative's assignment
  // silenced the report and the row stayed red for a correct build. Look the
  // function up at call time instead, so injection order stops mattering.
  function callCreativeHook(name, event) {
    report(event, {});
    var fn = window[name];
    if (typeof fn === 'function') { try { fn(); } catch (e) {} }
  }
  window.gameReady = function() {
    report('game_ready', {});
    // Simulate SDK behavior: call gameStart() after gameReady, like real validators do
    setTimeout(function() { callCreativeHook('gameStart', 'game_start'); }, 100);
  };
  window.gameRetry = function() { report('game_retry', {}); };
  window.gameEnd = function() {${
    networkId === 'vungle'
      ? `
    // Vungle hears about completion only through the bridge — plbx_html.game_end()
    // posts parent.postMessage('complete', '*'), which the mock above reports as
    // vungle_complete. Reporting game_end directly here would turn the checklist
    // green while production never signals the container at all.
    if (window.plbx_html && typeof window.plbx_html.game_end === 'function') {
      try { window.plbx_html.game_end(); return; } catch (e) {}
    }
    report('game_end', { method: 'window.gameEnd', warning: 'plbx_html bridge missing — Vungle would never receive complete' });
  `
      : ` report('game_end', {}); `
  }
    // The container runs its close sequence once the playable reports the end,
    // which is when the real one calls the creative's gameClose (§7).
    setTimeout(function() { callCreativeHook('gameClose', 'game_close'); }, 100);
  };

  // Signal load complete
  report('preview_loaded', { networkId: '${networkId}' });
`)

  parts.push(`
})();
`)

  return parts.join('')
}
