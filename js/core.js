/* =========================================================================
   core.js — utilitários compartilhados por todos os módulos (namespace RR)
   Carregado logo depois de portrait-data.js e antes de qualquer módulo.
   ========================================================================= */
(function () {
  'use strict';

  var RR = (window.RR = window.RR || {});

  /* ---------- matemática ---------- */
  RR.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  RR.lerp = function (a, b, t) { return a + (b - a) * t; };
  RR.smoothstep = function (a, b, v) {
    var t = RR.clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  /* RNG determinístico (mulberry32): RR.rng(42)() -> [0,1) */
  RR.rng = function (seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  /* amostra normal padrão (Box–Muller) a partir de um gerador uniforme */
  RR.gauss = function (rand) {
    rand = rand || Math.random;
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /* ---------- ambiente ---------- */
  var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  RR.reducedMotion = !!(mqReduce && mqReduce.matches);
  if (mqReduce && mqReduce.addEventListener) {
    mqReduce.addEventListener('change', function (e) {
      RR.reducedMotion = e.matches;
      RR.emit('reducedmotion', e.matches);
    });
  }
  RR.isTouch = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
  RR.dpr = function (max) { return Math.min(window.devicePixelRatio || 1, max || 2); };

  RR.ready = function (fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  };

  /* ---------- barramento de eventos ----------
     Eventos conhecidos:
       'hero:renoise'            -> refaz a "difusão" do retrato do hero
       'gallery:select' (id)     -> abre uma obra da galeria pelo id
       'playground:dataset' (id) -> troca o dataset do playground
       'palette:open'            -> abre a paleta de comandos
       'konami'                  -> easter egg
       'reducedmotion' (bool)    -> preferência do sistema mudou            */
  var handlers = {};
  RR.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); return function () { RR.off(name, fn); }; };
  RR.off = function (name, fn) { var l = handlers[name]; if (l) handlers[name] = l.filter(function (f) { return f !== fn; }); };
  RR.emit = function (name, data) {
    (handlers[name] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (err) { console.error('[RR] handler de "' + name + '" falhou:', err); }
    });
  };

  /* ---------- DOM ----------
     RR.el('button', {class: 'btn', type: 'button', onclick: fn, 'aria-label': 'x'}, ['texto', outroNo]) */
  RR.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  };

  /* Lê um token de cor do :root, ex. RR.cssVar('--mint') -> '#9ef5cf' */
  RR.cssVar = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };
  /* Paleta pronta para canvas (strings CSS) */
  RR.palette = function () {
    return {
      bg: RR.cssVar('--bg') || '#07080d',
      artBg: RR.cssVar('--art-bg') || '#0b0e1a',
      surface: RR.cssVar('--surface') || '#0e1222',
      text: RR.cssVar('--text') || '#eef1fb',
      muted: RR.cssVar('--muted') || '#8e95b2',
      line: RR.cssVar('--line') || 'rgba(255,255,255,.08)',
      mint: RR.cssVar('--mint') || '#9ef5cf',
      blue: RR.cssVar('--blue') || '#4f7bff',
      sun: RR.cssVar('--sun') || '#ffb38a',
      pink: RR.cssVar('--pink') || '#ff6fae'
    };
  };
  RR.hexToRgb = function (hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /* ---------- canvas ----------
     Ajusta o canvas para o tamanho CSS pedido * devicePixelRatio e devolve
     o contexto já escalado (desenhe em unidades CSS). */
  RR.setupCanvas = function (canvas, cssW, cssH, maxDpr, ctxOpts) {
    var dpr = RR.dpr(maxDpr || 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    var ctx = canvas.getContext('2d', ctxOpts);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  };

  RR.downloadCanvas = function (canvas, filename) {
    var name = filename || 'raul-rotilli-arte.png';
    var done = function (url, revoke) {
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      if (revoke) setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    };
    if (canvas.toBlob) canvas.toBlob(function (blob) { if (blob) done(URL.createObjectURL(blob), true); }, 'image/png');
    else done(canvas.toDataURL('image/png'), false);
  };

  /* ---------- visibilidade ----------
     Chama onEnter/onLeave quando o elemento entra/sai da viewport.
     Use para pausar animações fora da tela. Devolve função de cleanup. */
  RR.whenVisible = function (el, onEnter, onLeave, opts) {
    if (!('IntersectionObserver' in window)) { onEnter && onEnter(); return function () {}; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) onEnter && onEnter(e);
        else onLeave && onLeave(e);
      });
    }, Object.assign({ rootMargin: '120px 0px', threshold: 0 }, opts || {}));
    io.observe(el);
    return function () { io.disconnect(); };
  };
  /* Executa fn uma única vez, quando el ficar visível pela primeira vez */
  RR.onFirstVisible = function (el, fn, opts) {
    var fired = false, stop;
    stop = RR.whenVisible(el, function () {
      if (fired) return; fired = true;
      if (stop) stop();
      fn();
    }, null, opts);
    return stop;
  };

  /* ---------- retrato ----------
     RR.loadPortrait() -> Promise<HTMLImageElement> (491×712, fundo transparente)
     RR.getPortraitPixels(maxW[, maxH]) -> Promise<{width, height, data}>
       data é RGBA (Uint8ClampedArray), retrato escalado para caber em maxW×maxH
       preservando a proporção. Pixels de fundo têm alpha 0. Resultado em cache
       (NÃO modifique data in-place; copie se precisar). */
  var portraitPromise = null;
  RR.PORTRAIT_FALLBACK = 'assets/raul-ai.webp';
  RR.PORTRAIT_SIZE = { width: 491, height: 712 };
  RR.loadPortrait = function () {
    if (portraitPromise) return portraitPromise;
    portraitPromise = new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        if (img.src.indexOf('data:') === 0) { img.src = RR.PORTRAIT_FALLBACK; }
        else reject(new Error('Falha ao carregar o retrato'));
      };
      img.src = RR.PORTRAIT_SRC || RR.PORTRAIT_FALLBACK;
    });
    return portraitPromise;
  };
  var pixelCache = {};
  RR.getPortraitPixels = function (maxW, maxH) {
    var key = maxW + 'x' + (maxH || 0);
    if (pixelCache[key]) return pixelCache[key];
    pixelCache[key] = RR.loadPortrait().then(function (img) {
      var iw = img.naturalWidth, ih = img.naturalHeight;
      var s = Math.min(maxW / iw, maxH ? maxH / ih : Infinity);
      var w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var cx = c.getContext('2d', { willReadFrequently: true });
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, w, h);
      var id = cx.getImageData(0, 0, w, h);
      return { width: w, height: h, data: id.data };
    });
    return pixelCache[key];
  };
  /* Luminância perceptual 0..1 por pixel (Float32Array) a partir de getPortraitPixels */
  RR.luminance = function (src) {
    var n = src.width * src.height, out = new Float32Array(n), d = src.data;
    for (var i = 0; i < n; i++) {
      out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    }
    return out;
  };

  /* ---------- loop de animação com pausa automática ----------
     var loop = RR.loop(function (dt, t) {...}); loop.start(); loop.stop();
     dt em segundos (limitado a 0.05). */
  RR.loop = function (tick) {
    var raf = 0, last = 0, running = false;
    function frame(t) {
      if (!running) return;
      var dt = last ? Math.min((t - last) / 1000, 0.05) : 0.016;
      last = t;
      tick(dt, t / 1000);
      raf = requestAnimationFrame(frame);
    }
    return {
      start: function () { if (running) return; running = true; last = 0; raf = requestAnimationFrame(frame); },
      stop: function () { running = false; cancelAnimationFrame(raf); },
      get running() { return running; }
    };
  };

  /* Debounce simples */
  RR.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  /* Formatação pt-BR */
  RR.fmt = function (n, digits) {
    return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: digits == null ? 2 : digits, minimumFractionDigits: 0 });
  };

  /* Registro das obras da galeria (ver js/gallery.js) */
  RR.art = RR.art || {
    pieces: [],
    register: function (piece) {
      RR.art.pieces.push(piece);
      RR.art.pieces.sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
      RR.emit('art:registered', piece);
    }
  };
})();
