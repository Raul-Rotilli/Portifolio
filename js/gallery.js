/* =========================================================================
   gallery.js — "Galeria neural": palco + painel + filmstrip das obras
   Cada obra (js/art/*.js) se registra com RR.art.register(piece). Aqui ficam
   a UI, os controles gerados a partir de piece.params e o pipeline de render:
   token por render, buffer próprio por render (renders antigos nunca sujam
   o palco), pausa fora da tela e isolamento de erros por obra.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  var root = document.getElementById('gallery-root');
  if (!RR || !root) return;

  var h = RR.el;
  var ASPECT = 712 / 491;
  var THUMB_W = 88, THUMB_H = 128;
  var DEFAULT_SEED = 7;

  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICON = {
    prev: SVG + '<path d="M15 6l-6 6 6 6"/></svg>',
    next: SVG + '<path d="M9 6l6 6-6 6"/></svg>',
    compare: SVG + '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 2v20"/><path d="M7 9l-2 3 2 3M17 9l2 3-2 3"/></svg>',
    shuffle: SVG + '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    download: SVG + '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    reset: SVG + '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    alert: SVG + '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/></svg>'
  };

  /* ---------- estado ---------- */
  var pieces = [];          // obras válidas, em ordem
  var cur = -1;             // índice da obra no palco
  var params = {};          // id -> {param: valor}
  var seeds = {};           // id -> seed
  var items = {};           // id -> {btn, canvas, num}
  var dom = {};
  var pal = null;
  var inited = false, visible = false, userActed = false;

  var token = 0;            // token do render atual
  var buf = null;           // {canvas, ctx} do render atual
  var W = 0, H = 0, DPR = 1;
  var paused = [];          // callbacks de frame retidos enquanto fora da tela
  var outstanding = 0;      // frames agendados (ou retidos) do render atual
  var pending = false, finished = true, failed = false;
  var t0 = 0, infoSet = false, lastInfo = '';
  var waiters = [];
  var busyTimer = 0, blitTimer = 0, blitRaf = 0, paramTimer = 0, announceTimer = 0;
  var freshFx = false;

  var firstDone = false, thumbsStarted = false, thumbBusy = false;
  var thumbState = {};
  var portraitImg = null, origKey = '', comparing = false;
  var pendingId = null;

  var idle = window.requestIdleCallback
    ? function (fn) { window.requestIdleCallback(fn, { timeout: 700 }); }
    : function (fn) { setTimeout(fn, 40); };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtMs(ms) { return ms < 1000 ? Math.max(1, Math.round(ms)) + ' ms' : RR.fmt(ms / 1000, 1) + ' s'; }
  function indexOf(id) { for (var i = 0; i < pieces.length; i++) if (pieces[i].id === id) return i; return -1; }

  /* ---------- obras e parâmetros ---------- */
  function collect() {
    var seen = {}, out = [];
    ((RR.art && RR.art.pieces) || []).forEach(function (p) {
      if (!p || typeof p.id !== 'string' || typeof p.render !== 'function' || seen[p.id]) return;
      seen[p.id] = true;
      out.push(p);
    });
    return out;
  }
  function defs(p) { return (Array.isArray(p.params) ? p.params : []).filter(function (d) { return d && d.id; }); }
  function coerce(d, v) {
    if (d.type === 'range') {
      var n = Number(v);
      return isFinite(n) ? n : (Number(d.min) || 0);
    }
    if (d.type === 'toggle') return !!v;
    if (d.type === 'select') {
      var opts = d.options || [];
      for (var i = 0; i < opts.length; i++) if (String(opts[i].value) === String(v)) return opts[i].value;
      return opts.length ? opts[0].value : v;
    }
    return v;
  }
  function defaults(p) {
    var o = {};
    defs(p).forEach(function (d) { o[d.id] = coerce(d, d.value); });
    return o;
  }
  function fmtParam(d, v) {
    if (typeof d.format === 'function') {
      try { var s = d.format(v); if (s != null) return String(s); } catch (e) { /* usa o padrão */ }
    }
    return typeof v === 'number' ? RR.fmt(v) : String(v);
  }
  function getSource(maxW) { return RR.getPortraitPixels(Math.max(8, Math.round(maxW || 160))); }

  /* ---------- DOM ---------- */
  function iconBtn(icon, label, onClick, extra) {
    return h('button', { class: 'btn btn--ghost btn--icon gallery__iconbtn' + (extra ? ' ' + extra : ''), type: 'button', 'aria-label': label, title: label, html: ICON[icon], onclick: onClick });
  }

  function build() {
    root.textContent = '';
    pal = RR.palette();

    dom.live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

    /* barra de "janela" */
    dom.file = h('span', { class: 'gallery__file' });
    var bar = h('div', { class: 'gallery__bar mono' }, [
      h('span', { class: 'gallery__path' }, [
        h('span', { class: 'gallery__dot', 'aria-hidden': 'true' }),
        h('span', null, 'galeria_neural'),
        h('span', { class: 'gallery__sep', 'aria-hidden': 'true' }, '/'),
        dom.file
      ]),
      h('span', { class: 'gallery__runtime' }, [
        h('span', { class: 'pulse-dot', 'aria-hidden': 'true' }), 'processado no seu navegador',
        dom.time = h('span', { class: 'gallery__time' })
      ])
    ]);

    /* palco */
    dom.canvas = h('canvas', { class: 'gallery__canvas', role: 'img', 'aria-label': 'Retrato do Raul' });
    dom.orig = h('canvas', { class: 'gallery__orig', 'aria-hidden': 'true' });
    dom.code = h('span', { class: 'gallery__chip gallery__code' });
    dom.origTag = h('span', { class: 'gallery__chip gallery__origtag' }, 'original · raul.webp');
    dom.status = h('span', { class: 'gallery__chip gallery__status' });
    dom.err = h('div', { class: 'gallery__error', hidden: true, role: 'alert' });
    dom.empty = h('div', { class: 'gallery__empty', hidden: true }, [
      h('p', null, 'Nenhuma obra foi carregada.'),
      h('p', { class: 'mono' }, 'RR.art.pieces = []')
    ]);
    dom.frame = h('div', { class: 'gallery__frame', title: 'Segure para ver a foto original' }, [
      dom.canvas, dom.orig,
      h('span', { class: 'gallery__scan', 'aria-hidden': 'true' }),
      h('div', { class: 'gallery__hud', 'aria-hidden': 'true' }, [dom.code, dom.origTag, dom.status]),
      dom.err, dom.empty
    ]);
    dom.stage = h('div', { class: 'gallery__stage' }, [
      h('span', { class: 'gallery__mark gallery__mark--tl', 'aria-hidden': 'true' }),
      h('span', { class: 'gallery__mark gallery__mark--tr', 'aria-hidden': 'true' }),
      h('span', { class: 'gallery__mark gallery__mark--bl', 'aria-hidden': 'true' }),
      h('span', { class: 'gallery__mark gallery__mark--br', 'aria-hidden': 'true' }),
      dom.frame
    ]);

    dom.prev = iconBtn('prev', 'Obra anterior', function () { userActed = true; select(cur - 1, { user: true }); });
    dom.next = iconBtn('next', 'Próxima obra', function () { userActed = true; select(cur + 1, { user: true }); });
    dom.count = h('span', { class: 'gallery__count mono', 'aria-hidden': 'true' });
    dom.compare = h('button', {
      class: 'btn btn--ghost btn--sm gallery__compare', type: 'button', 'aria-pressed': 'false',
      'aria-label': 'Comparar com a foto original (segure)', html: ICON.compare + '<span>Comparar</span>'
    });
    var nav = h('div', { class: 'gallery__nav' }, [
      h('div', { class: 'gallery__navgroup' }, [dom.prev, dom.count, dom.next]),
      dom.compare
    ]);
    dom.view = h('div', { class: 'gallery__view' }, [dom.stage, nav]);

    /* painel */
    dom.index = h('p', { class: 'gallery__index mono' });
    dom.title = h('h3', { class: 'gallery__title' });
    dom.tags = h('div', { class: 'gallery__tags' });
    dom.desc = h('p', { class: 'gallery__desc' });
    dom.meta = h('div', { class: 'gallery__meta' }, [dom.index, dom.title, dom.tags, dom.desc]);
    dom.reset = h('button', {
      class: 'gallery__reset', type: 'button', 'aria-label': 'Restaurar parâmetros padrão',
      html: ICON.reset + '<span>Restaurar</span>', onclick: resetParams
    });
    dom.controls = h('div', { class: 'gallery__controls' });
    dom.shuffle = h('button', { class: 'btn btn--ghost btn--sm gallery__shuffle', type: 'button', html: ICON.shuffle + '<span>Aleatorizar</span>', onclick: shuffle });
    dom.download = h('button', { class: 'btn btn--primary btn--sm gallery__download', type: 'button', html: ICON.download + '<span>Baixar PNG</span>', onclick: download });
    dom.seed = h('span', { class: 'gallery__seed mono' });
    dom.info = h('p', { class: 'gallery__info mono' });
    dom.panel = h('div', { class: 'gallery__panel' }, [
      dom.meta,
      h('div', { class: 'gallery__subhead mono' }, [h('span', null, 'parâmetros'), dom.reset]),
      dom.controls,
      h('div', { class: 'gallery__actions' }, [dom.shuffle, dom.download, dom.seed]),
      dom.info,
      h('p', { class: 'gallery__keys' }, [
        h('kbd', null, '←'), ' ', h('kbd', null, '→'), ' trocam a obra · segure a imagem ou ',
        h('kbd', null, 'Espaço'), ' em Comparar para ver o original'
      ])
    ]);

    /* filmstrip */
    dom.list = h('div', { class: 'gallery__list', role: 'group', 'aria-label': 'Obras da galeria' });
    dom.strip = h('div', { class: 'gallery__strip' }, [dom.list]);

    dom.app = h('div', { class: 'gallery__app' }, [
      bar,
      h('div', { class: 'gallery__body' }, [dom.view, dom.panel]),
      dom.strip
    ]);
    root.appendChild(dom.app);
    root.appendChild(dom.live);
    root.classList.add('is-ready');

    bindCompare();
    bindStagePointer();
    root.addEventListener('keydown', onKey);
  }

  function makeItem(p) {
    var c = h('canvas', { class: 'gallery__tcanvas', width: THUMB_W, height: THUMB_H, 'aria-hidden': 'true' });
    var num = h('span', { class: 'gallery__tnum' });
    var b = h('button', { class: 'gallery__thumb', type: 'button', 'aria-pressed': 'false' }, [
      h('span', { class: 'gallery__tpic' }, [c]),
      h('span', { class: 'gallery__tlabel' }, [num, h('span', { class: 'gallery__tname' }, String(p.short || p.algo || p.title || p.id))])
    ]);
    b.addEventListener('click', function () {
      var i = indexOf(p.id);
      userActed = true;
      if (i >= 0) select(i, { user: true });
    });
    return { btn: b, canvas: c, num: num };
  }

  function syncStrip() {
    pieces.forEach(function (p, i) {
      if (!items[p.id]) items[p.id] = makeItem(p);
      var it = items[p.id];
      it.num.textContent = pad2(i + 1);
      it.btn.setAttribute('aria-label', 'Obra ' + pad2(i + 1) + ': ' + (p.title || p.id));
      dom.list.appendChild(it.btn);
    });
    dom.strip.hidden = pieces.length < 2;
  }

  /* ---------- seleção ---------- */
  function select(i, opts) {
    opts = opts || {};
    var n = pieces.length;
    if (!n) return;
    i = ((i % n) + n) % n;
    if (i === cur && !opts.force) return;
    cur = i;
    var p = pieces[i];
    if (!params[p.id]) params[p.id] = defaults(p);
    if (seeds[p.id] == null) seeds[p.id] = DEFAULT_SEED;

    setCompare(false);
    updateMeta(p);
    buildControls(p);
    Object.keys(items).forEach(function (id) { items[id].btn.setAttribute('aria-pressed', id === p.id ? 'true' : 'false'); });
    revealItem(items[p.id], opts.focus);
    if (opts.user) updateHash(p.id);
    freshFx = true;
    dom.info.textContent = 'processando…';
    render();
  }

  function updateCounters() {
    var p = pieces[cur];
    if (!p) return;
    var n = pieces.length;
    dom.count.textContent = pad2(cur + 1) + ' / ' + pad2(n);
    dom.index.innerHTML = '';
    dom.index.appendChild(h('b', null, 'obra ' + pad2(cur + 1)));
    dom.index.appendChild(document.createTextNode(' / ' + pad2(n)));
    dom.prev.disabled = dom.next.disabled = n < 2;
  }

  function updateMeta(p) {
    updateCounters();
    dom.file.textContent = p.id + '.js';
    dom.title.textContent = p.title || p.id;
    dom.tags.textContent = '';
    if (p.algo) dom.tags.appendChild(h('span', { class: 'tag' }, String(p.algo)));
    if (p.field) dom.tags.appendChild(h('span', { class: 'tag tag--blue' }, String(p.field)));
    dom.desc.textContent = p.description || '';
    dom.canvas.setAttribute('aria-label', 'Retrato do Raul gerado por ' + (p.title || p.id));
    updateCode();
    updateSeed();
    dom.meta.classList.remove('is-in');
    void dom.meta.offsetWidth;
    dom.meta.classList.add('is-in');
  }

  /* rótulo estilo código: out = kmeans(raul.webp, k=5, layout="single") */
  function updateCode() {
    var p = pieces[cur];
    if (!p) return;
    var vals = params[p.id] || {}, args = ['raul.webp'];
    var list = defs(p);
    list.slice(0, 2).forEach(function (d) {
      var v = vals[d.id], s;
      if (typeof v === 'boolean') s = v ? 'True' : 'False';
      else if (typeof v === 'number') s = String(Math.round(v * 1000) / 1000);
      else s = '"' + v + '"';
      args.push(d.id + '=' + s);
    });
    if (list.length > 2) args.push('…');
    dom.code.textContent = '';
    dom.code.appendChild(document.createTextNode('out = '));
    dom.code.appendChild(h('b', null, p.id));
    dom.code.appendChild(document.createTextNode('(' + args.join(', ') + ')'));
  }
  function updateSeed() {
    var p = pieces[cur];
    if (p) dom.seed.textContent = 'seed ' + seeds[p.id];
  }

  function revealItem(it, focus) {
    if (!it) return;
    var list = dom.list, b = it.btn;
    if (list.scrollWidth > list.clientWidth + 2) {
      var left = b.offsetLeft - (list.clientWidth - b.offsetWidth) / 2;
      try { list.scrollTo({ left: left, behavior: RR.reducedMotion ? 'auto' : 'smooth' }); } catch (e) { list.scrollLeft = left; }
    }
    if (focus) b.focus({ preventScroll: true });
  }

  function updateHash(id) {
    if (!window.history || !history.replaceState) return;
    try { history.replaceState(history.state, '', '#galeria/' + id); } catch (e) { /* file:// em alguns navegadores */ }
  }

  /* ---------- controles automáticos ---------- */
  function buildControls(p) {
    var box = dom.controls, vals = params[p.id], list = defs(p);
    box.textContent = '';
    dom.reset.hidden = !list.length;
    if (!list.length) {
      box.appendChild(h('p', { class: 'gallery__noparams' }, 'Esta obra não tem parâmetros ajustáveis. Use Aleatorizar para gerar variações.'));
      return;
    }
    list.forEach(function (d) {
      var uid = 'gallery-' + p.id + '-' + d.id;
      var label = String(d.label || d.id);
      if (d.type === 'range') box.appendChild(rangeField(d, uid, label, vals));
      else if (d.type === 'select') box.appendChild(selectField(d, uid, label, vals));
      else if (d.type === 'toggle') box.appendChild(toggleField(d, label, vals));
    });
  }

  function rangeField(d, uid, label, vals) {
    var min = isFinite(Number(d.min)) ? Number(d.min) : 0;
    var max = isFinite(Number(d.max)) ? Number(d.max) : 100;
    var step = Number(d.step) > 0 ? Number(d.step) : 1;
    var out = h('span', { class: 'field__value', 'aria-hidden': 'true' });
    var input = h('input', { type: 'range', id: uid, min: String(min), max: String(max), step: String(step), value: String(vals[d.id]) });
    function sync(v) {
      var txt = fmtParam(d, v);
      out.textContent = txt;
      input.setAttribute('aria-valuetext', txt);
      input.style.setProperty('--pct', RR.clamp((v - min) / ((max - min) || 1) * 100, 0, 100) + '%');
    }
    input.addEventListener('input', function () {
      var v = Number(input.value);
      vals[d.id] = v;
      sync(v);
      paramChanged(60);
    });
    sync(vals[d.id]);
    return h('div', { class: 'field gallery__field' }, [
      h('div', { class: 'field__label' }, [h('label', { for: uid }, label), out]),
      input
    ]);
  }

  function selectField(d, uid, label, vals) {
    var sel = h('select', { id: uid });
    (d.options || []).forEach(function (o) {
      var opt = h('option', { value: String(o.value) }, String(o.label != null ? o.label : o.value));
      if (String(o.value) === String(vals[d.id])) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      vals[d.id] = coerce(d, sel.value);
      paramChanged(0);
    });
    return h('div', { class: 'field gallery__field' }, [
      h('div', { class: 'field__label' }, [h('label', { for: uid }, label)]),
      sel
    ]);
  }

  function toggleField(d, label, vals) {
    var b = h('button', { class: 'gallery__switch', type: 'button', 'aria-pressed': vals[d.id] ? 'true' : 'false' }, [
      h('span', { class: 'gallery__switchlabel' }, label),
      h('span', { class: 'gallery__track', 'aria-hidden': 'true' })
    ]);
    b.addEventListener('click', function () {
      vals[d.id] = !vals[d.id];
      b.setAttribute('aria-pressed', vals[d.id] ? 'true' : 'false');
      paramChanged(0);
    });
    return h('div', { class: 'field gallery__field gallery__field--toggle' }, [b]);
  }

  function paramChanged(ms) {
    userActed = true;
    updateCode();
    clearTimeout(paramTimer);
    if (ms) paramTimer = setTimeout(render, ms);
    else render();
  }

  function resetParams() {
    var p = pieces[cur];
    if (!p) return;
    userActed = true;
    params[p.id] = defaults(p);
    seeds[p.id] = DEFAULT_SEED;
    buildControls(p);
    updateCode();
    updateSeed();
    render();
  }

  function shuffle() {
    var p = pieces[cur];
    if (!p) return;
    userActed = true;
    var s = seeds[p.id];
    while (s === seeds[p.id]) s = 1 + Math.floor(Math.random() * 9998);
    seeds[p.id] = s;
    updateSeed();
    dom.shuffle.classList.remove('is-spin');
    void dom.shuffle.offsetWidth;
    dom.shuffle.classList.add('is-spin');
    render();
  }

  /* ---------- pipeline de render ---------- */
  function measure() {
    var s = dom.stage, cs = getComputedStyle(s);
    var avail = s.getBoundingClientRect().width -
      (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) -
      (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
    W = Math.max(160, Math.floor(avail));
    H = Math.round(W * ASPECT);
    DPR = RR.dpr(2);
    dom.frame.style.width = W + 'px';
    /* antes do 1º blit, já reserva a altura certa (evita salto de layout) */
    if (!dom.ctx && !dom.canvas.dataset.sized) {
      dom.canvas.width = Math.round(W * DPR);
      dom.canvas.height = Math.round(H * DPR);
      dom.canvas.dataset.sized = '1';
    }
  }

  function releaseBuffer() {
    if (!buf) return;
    buf.canvas.width = 0;   // libera memória (iOS) — renders antigos passam a desenhar no vazio
    buf.canvas.height = 0;
    buf = null;
  }

  function render() {
    var p = pieces[cur];
    if (!p) return;
    clearTimeout(paramTimer);
    var tok = ++token;
    measure();
    releaseBuffer();
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * DPR));
    c.height = Math.max(1, Math.round(H * DPR));
    var ctx = c.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buf = { canvas: c, ctx: ctx };

    paused = []; outstanding = 0;
    pending = false; finished = false; failed = false; infoSet = false;
    t0 = performance.now();
    hideError();
    clearTimeout(busyTimer); clearTimeout(blitTimer);
    busyTimer = setTimeout(function () {
      if (tok !== token || finished) return;
      dom.stage.classList.add('is-busy');
      dom.stage.classList.toggle('is-self-animated', !!p.animated);
      dom.status.textContent = 'processando…';
      dom.time.textContent = ' · …';
    }, 140);

    var env = {
      width: W, height: H, dpr: DPR, thumb: false,
      seed: seeds[p.id], palette: Object.assign({}, pal),
      getSource: getSource,
      cancelled: function () { return tok !== token; },
      frame: function (cb) { scheduleFrame(tok, cb); },
      setInfo: function (txt) {
        if (tok !== token) return;
        infoSet = true;
        lastInfo = String(txt);
        dom.info.textContent = lastInfo;
      }
    };

    var res;
    try { res = p.render(ctx, Object.assign({}, params[p.id]), env); } catch (err) { fail(tok, p, err); return; }
    if (res && typeof res.then === 'function') {
      pending = true;
      /* não mostra o buffer "só com fundo" enquanto a obra carrega a fonte */
      blitTimer = setTimeout(function () { if (tok === token) requestBlit(); }, 150);
      res.then(function () {
        if (tok !== token) return;
        pending = false;
        requestBlit();
        checkDone(tok);
      }, function (err) { fail(tok, p, err); });
    } else {
      requestBlit();
      checkDone(tok);
    }
  }

  function scheduleFrame(tok, cb) {
    if (tok !== token || typeof cb !== 'function') return;
    outstanding++;
    queueFrame(tok, cb);
  }
  function queueFrame(tok, cb) {
    if (!visible) { paused.push({ tok: tok, cb: cb }); return; }
    requestAnimationFrame(function (ts) { runFrame(tok, cb, ts); });
  }
  function runFrame(tok, cb, ts) {
    if (tok !== token) return;
    if (!visible) { paused.push({ tok: tok, cb: cb }); return; }
    outstanding--;
    try { cb(ts); } catch (err) { fail(tok, pieces[cur], err); return; }
    if (tok !== token) return;
    blitNow();
    checkDone(tok);
  }
  function resumeFrames() {
    var q = paused;
    paused = [];
    q.forEach(function (e) { if (e.tok === token) queueFrame(e.tok, e.cb); });
  }

  function requestBlit() {
    if (blitRaf) return;
    blitRaf = requestAnimationFrame(function () { blitRaf = 0; blitNow(); });
  }
  function blitNow() {
    if (blitRaf) { cancelAnimationFrame(blitRaf); blitRaf = 0; }
    clearTimeout(blitTimer);
    if (!buf || !buf.canvas.width) return;
    var c = dom.canvas, b = buf.canvas;
    if (c.width !== b.width || c.height !== b.height) { c.width = b.width; c.height = b.height; dom.ctx = null; }
    var x = dom.ctx || (dom.ctx = c.getContext('2d'));
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'copy';
    x.drawImage(b, 0, 0);
    x.globalCompositeOperation = 'source-over';
    if (freshFx) {
      freshFx = false;
      c.classList.remove('is-fresh');
      void c.offsetWidth;
      c.classList.add('is-fresh');
    }
  }

  function checkDone(tok) {
    if (tok !== token || finished || pending || outstanding > 0) return;
    finished = true;
    var p = pieces[cur];
    var ms = performance.now() - t0;
    clearTimeout(busyTimer);
    dom.stage.classList.remove('is-busy');
    dom.status.textContent = '';
    dom.time.textContent = ' · ' + fmtMs(ms);
    if (!infoSet) dom.info.textContent = 'renderizado em ' + fmtMs(ms);
    announce(p);
    flushWaiters(true);
    if (!firstDone) onFirstRender();
  }

  function fail(tok, p, err) {
    if (tok !== token) return;
    token++;                         // encerra frames e awaits dessa execução
    console.error('[galeria] A obra "' + (p && p.id) + '" falhou ao renderizar:', err);
    failed = true; finished = true; pending = false; outstanding = 0; paused = [];
    clearTimeout(busyTimer); clearTimeout(blitTimer);
    dom.stage.classList.remove('is-busy');
    dom.status.textContent = 'erro';
    dom.time.textContent = '';
    var c = dom.canvas, x = dom.ctx || (dom.ctx = c.getContext('2d'));
    if (!c.width) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); x = dom.ctx = c.getContext('2d'); }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.fillStyle = pal.artBg;
    x.fillRect(0, 0, c.width, c.height);
    showError(err);
    flushWaiters(false);
    if (!firstDone) onFirstRender();
  }

  function showError(err) {
    var msg = err && err.message ? String(err.message) : String(err || '');
    dom.err.textContent = '';
    dom.err.appendChild(h('span', { class: 'gallery__erricon', html: ICON.alert }));
    dom.err.appendChild(h('p', { class: 'gallery__errtitle' }, 'Ops, esta obra não renderizou.'));
    dom.err.appendChild(h('p', { class: 'gallery__errtext' }, 'O resto da galeria segue funcionando. Tente de novo ou escolha outra obra.'));
    if (msg) dom.err.appendChild(h('code', { class: 'gallery__errcode' }, msg.slice(0, 140)));
    dom.err.appendChild(h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () { userActed = true; render(); } }, 'Tentar de novo'));
    dom.err.hidden = false;
    dom.info.textContent = 'erro ao renderizar · detalhes no console';
  }
  function hideError() { if (!dom.err.hidden) { dom.err.hidden = true; dom.err.textContent = ''; } }

  function flushWaiters(ok) {
    var w = waiters;
    waiters = [];
    w.forEach(function (fn) { fn(ok); });
  }
  function whenDone(maxMs) {
    return new Promise(function (resolve) {
      if (finished) { resolve(!failed); return; }
      var t = setTimeout(function () { resolve(!failed); }, maxMs);
      waiters.push(function (ok) { clearTimeout(t); resolve(ok); });
    });
  }

  function announce(p) {
    if (!userActed || !p) return;
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      dom.live.textContent = (p.title || p.id) + (infoSet ? ': ' + lastInfo : ': pronto');
    }, 700);
  }

  function onFirstRender() {
    firstDone = true;
    startThumbs();
    idle(function () { if (!origKey) drawOrig(); });
  }

  /* ---------- miniaturas (uma por vez, em tempo ocioso) ---------- */
  function startThumbs() {
    if (thumbsStarted) return;
    thumbsStarted = true;
    pumpThumbs();
  }
  function pumpThumbs() {
    var next = null;
    for (var i = 0; i < pieces.length; i++) if (!thumbState[pieces[i].id]) { next = pieces[i]; break; }
    if (!next) { thumbBusy = false; return; }
    thumbBusy = true;
    thumbState[next.id] = 'running';
    idle(function () { renderThumb(next).then(pumpThumbs, pumpThumbs); });
  }
  function renderThumb(p) {
    var it = items[p.id];
    if (!it) return Promise.resolve();
    var ctx = RR.setupCanvas(it.canvas, THUMB_W, THUMB_H, 2);
    it.canvas.style.width = it.canvas.style.height = '';   // tamanho visual fica com o CSS
    var alive = true, frames = 0;
    function ok() { if (thumbState[p.id] === 'running') { thumbState[p.id] = 'done'; it.btn.classList.add('is-ready'); } }
    function bad(err) {
      if (!alive) return;
      alive = false;
      thumbState[p.id] = 'error';
      console.error('[galeria] Miniatura da obra "' + p.id + '" falhou:', err);
      try {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = pal.artBg;
        ctx.fillRect(0, 0, it.canvas.width, it.canvas.height);
      } catch (e) { /* nada */ }
      it.btn.classList.add('is-ready', 'is-error');
    }
    var env = {
      width: THUMB_W, height: THUMB_H, dpr: RR.dpr(2), thumb: true,
      seed: DEFAULT_SEED, palette: Object.assign({}, pal),
      getSource: getSource,
      cancelled: function () { return !alive; },
      setInfo: function () {},
      frame: function (cb) {
        if (!alive || typeof cb !== 'function' || ++frames > 240) return;
        requestAnimationFrame(function (ts) { if (!alive) return; try { cb(ts); } catch (e) { bad(e); } });
      }
    };
    var res;
    try { res = p.render(ctx, defaults(p), env); } catch (err) { bad(err); return Promise.resolve(); }
    if (res && typeof res.then === 'function') {
      var timeout = new Promise(function (r) { setTimeout(r, 4000); });
      return Promise.race([res.then(ok, bad), timeout]).then(ok);
    }
    ok();
    return Promise.resolve();
  }

  /* ---------- comparar com o original ---------- */
  function drawOrig() {
    var draw = function (img) {
      portraitImg = img;
      var c = dom.orig;
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
      var x = c.getContext('2d');
      x.setTransform(DPR, 0, 0, DPR, 0, 0);
      x.fillStyle = pal.artBg;
      x.fillRect(0, 0, W, H);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, W, H);
      origKey = W + 'x' + DPR;
    };
    if (portraitImg) draw(portraitImg);
    else RR.loadPortrait().then(draw, function () { /* sem foto: o overlay fica só com o fundo */ });
  }
  function setCompare(on) {
    if (on === comparing) return;
    comparing = on;
    if (on && origKey !== W + 'x' + DPR) drawOrig();
    dom.stage.classList.toggle('is-comparing', on);
    dom.compare.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function bindCompare() {
    var b = dom.compare, downAt = 0, hold = 0;
    function on() { clearTimeout(hold); downAt = performance.now(); setCompare(true); }
    function off() {
      clearTimeout(hold);
      if (!comparing) return;
      /* toque rápido: mostra o original por um instante, para quem não segurou */
      if (performance.now() - downAt < 220) hold = setTimeout(function () { setCompare(false); }, 900);
      else setCompare(false);
    }
    b.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      userActed = true;
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
      on();
    });
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('keydown', function (e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (!e.repeat) { userActed = true; on(); }
    });
    b.addEventListener('keyup', function (e) {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(hold);
      setCompare(false);
    });
    b.addEventListener('blur', function () { clearTimeout(hold); setCompare(false); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* palco: segurar = comparar; deslizar (toque) = trocar de obra */
  function bindStagePointer() {
    var f = dom.frame, press = null;
    f.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !pieces.length || e.target.closest('button')) return;
      var pr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType, held: false };
      pr.timer = setTimeout(function () { pr.held = true; userActed = true; setCompare(true); }, e.pointerType === 'mouse' ? 140 : 320);
      press = pr;
    });
    f.addEventListener('pointermove', function (e) {
      if (!press || e.pointerId !== press.id || press.held) return;
      if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 12) clearTimeout(press.timer);
    });
    function end(e) {
      if (!press || e.pointerId !== press.id) return;
      clearTimeout(press.timer);
      if (press.held) setCompare(false);
      else if (e.type === 'pointerup' && press.type !== 'mouse') {
        var dx = e.clientX - press.x, dy = e.clientY - press.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > 1.6 * Math.abs(dy) && performance.now() - press.t < 800) {
          userActed = true;
          select(cur + (dx < 0 ? 1 : -1), { user: true });
        }
      }
      press = null;
    }
    f.addEventListener('pointerup', end);
    f.addEventListener('pointercancel', end);
    f.addEventListener('pointerleave', end);
    f.addEventListener('contextmenu', function (e) { if (comparing) e.preventDefault(); });
  }

  /* ---------- teclado ---------- */
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !pieces.length) return;
    var t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    var inStrip = !!(t && t.classList && t.classList.contains('gallery__thumb'));
    var to = null;
    if (e.key === 'ArrowLeft') to = cur - 1;
    else if (e.key === 'ArrowRight') to = cur + 1;
    else if (inStrip && e.key === 'Home') to = 0;
    else if (inStrip && e.key === 'End') to = pieces.length - 1;
    if (to === null) return;
    e.preventDefault();
    userActed = true;
    select(to, { user: true, focus: inStrip });
  }

  /* ---------- baixar PNG (resolução real do buffer do palco) ---------- */
  function download() {
    var p = pieces[cur], b = dom.download;
    if (!p || b.getAttribute('aria-busy') === 'true') return;
    userActed = true;
    var label = b.querySelector('span');
    b.setAttribute('aria-busy', 'true');
    label.textContent = 'Preparando…';
    whenDone(8000).then(function (ok) {
      b.removeAttribute('aria-busy');
      label.textContent = 'Baixar PNG';
      if (!ok || !buf || pieces[cur] !== p) {
        if (RR.toast) RR.toast('Não foi possível gerar o PNG desta obra.');
        return;
      }
      var name = 'raul-rotilli-' + p.id + '.png';
      RR.downloadCanvas(buf.canvas, name);
      if (RR.toast) RR.toast('PNG gerado: ' + name);
    });
  }

  /* ---------- ciclo de vida ---------- */
  function onResize() {
    if (!inited || !pieces.length) return;
    var oldW = W, oldD = DPR;
    measure();
    if (W !== oldW || DPR !== oldD) { origKey = ''; render(); }
  }

  var refresh = RR.debounce(function () {
    if (!inited) return;
    var curId = pieces[cur] && pieces[cur].id;
    pieces = collect();
    syncStrip();
    cur = curId ? indexOf(curId) : -1;
    if (cur < 0 && pieces.length) {
      dom.empty.hidden = true;
      var want = pendingId ? indexOf(pendingId) : -1;
      pendingId = null;
      select(want >= 0 ? want : 0);
    } else {
      updateCounters();
    }
    if (thumbsStarted && !thumbBusy) pumpThumbs();
  }, 30);

  function init() {
    if (inited) return;
    inited = true;
    build();
    pieces = collect();
    syncStrip();

    RR.whenVisible(root, function () { visible = true; resumeFrames(); }, function () { visible = false; });
    visible = true;   // init roda quando a galeria aparece (ou por pedido explícito)

    if ('ResizeObserver' in window) new ResizeObserver(RR.debounce(onResize, 140)).observe(dom.stage);
    window.addEventListener('resize', RR.debounce(onResize, 160));
    RR.on('art:registered', refresh);
    RR.loadPortrait().then(function (img) { portraitImg = img; }, function () {});

    if (!pieces.length) {
      measure();
      dom.empty.hidden = false;
      dom.panel.hidden = true;
      dom.compare.disabled = dom.prev.disabled = dom.next.disabled = true;
      return;
    }
    var start = pendingId ? indexOf(pendingId) : -1;
    pendingId = null;
    select(start >= 0 ? start : 0);
  }

  function scrollToGallery() {
    var target = document.getElementById('galeria') || root;
    var r = root.getBoundingClientRect();
    if (r.top >= 0 && r.top < window.innerHeight * 0.35) return;
    target.scrollIntoView({ behavior: RR.reducedMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function requestPiece(id, scroll) {
    if (!inited) { pendingId = id || null; init(); }
    else if (id) {
      var i = indexOf(id);
      if (i >= 0) { userActed = true; select(i, { user: true }); } else pendingId = id;
    }
    if (scroll) scrollToGallery();
  }

  /* RR.emit('gallery:select', 'kmeans') ou {id: 'kmeans', scroll: false} */
  RR.on('gallery:select', function (data) {
    var id = typeof data === 'string' ? data : data && data.id;
    requestPiece(id, !(data && typeof data === 'object' && data.scroll === false));
  });

  function readHash() {
    var m = /^#galeria\/([\w-]+)/.exec(window.location.hash || '');
    return m ? m[1] : null;
  }
  window.addEventListener('hashchange', function () {
    var id = readHash();
    if (id) requestPiece(id, true);
  });

  RR.ready(function () {
    var id = readHash();
    if (id) requestPiece(id, true);
    else RR.onFirstVisible(root, init, { rootMargin: '300px 0px' });
  });
})();
