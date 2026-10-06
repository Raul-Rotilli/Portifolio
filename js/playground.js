/* =========================================================================
   playground.js — "Neural Playground": um MLP escrito do zero (Float64Array)
   treinando ao vivo no navegador, inspirado no TensorFlow Playground.
   Núcleo matemático (datasets + MLP) sem DOM, exposto em RR.playground.core
   para testes; a interface monta em #playground-root.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR) return;

  /* =====================================================================
     1. NÚCLEO — datasets e rede neural (sem DOM)
     ===================================================================== */
  var DOMAIN = 6;            // os pontos vivem em [-6, 6]²
  var IN_SCALE = 1 / 3;      // normalização da entrada da rede

  var DATASETS = [
    { id: 'circle', name: 'Círculo' },
    { id: 'xor', name: 'XOR' },
    { id: 'spiral', name: 'Espiral' },
    { id: 'gauss', name: 'Gaussianas' },
    { id: 'moons', name: 'Luas' }
  ];

  function uni(rand, a, b) { return a + (b - a) * rand(); }

  /* Gera n pontos 2D de duas classes (rótulo 1 = classe B, 0 = classe A).
     noise ∈ [0, 0.5]. Mesma semente -> mesmos pontos. */
  function genDataset(id, n, noise, seed) {
    var rand = RR.rng(seed), X = [], Y = [], half = n >> 1, i, r, t, x, y;
    function push(px, py, l) {
      X.push(RR.clamp(px, -DOMAIN + 0.15, DOMAIN - 0.15), RR.clamp(py, -DOMAIN + 0.15, DOMAIN - 0.15));
      Y.push(l);
    }
    if (id === 'circle') {
      var R = 5;
      for (i = 0; i < n; i++) {
        r = i < half ? uni(rand, 0, R * 0.5) : uni(rand, R * 0.7, R);
        t = uni(rand, 0, Math.PI * 2);
        x = r * Math.sin(t); y = r * Math.cos(t);
        // o ruído desloca o ponto usado para decidir o rótulo (como no TF Playground)
        var nx = uni(rand, -R, R) * noise, ny = uni(rand, -R, R) * noise;
        push(x, y, Math.sqrt((x + nx) * (x + nx) + (y + ny) * (y + ny)) < R * 0.5 ? 1 : 0);
      }
    } else if (id === 'xor') {
      for (i = 0; i < n; i++) {
        x = uni(rand, -5, 5); x += x > 0 ? 0.3 : -0.3;
        y = uni(rand, -5, 5); y += y > 0 ? 0.3 : -0.3;
        var ex = uni(rand, -5, 5) * noise, ey = uni(rand, -5, 5) * noise;
        push(x, y, (x + ex) * (y + ey) >= 0 ? 1 : 0);
      }
    } else if (id === 'spiral') {
      for (var k = 0; k < 2; k++) {
        for (i = 0; i < half; i++) {
          r = (i / half) * 5;
          t = 1.75 * (i / half) * 2 * Math.PI + k * Math.PI;
          push(r * Math.sin(t) + uni(rand, -1, 1) * noise * 1.6,
               r * Math.cos(t) + uni(rand, -1, 1) * noise * 1.6, k === 0 ? 1 : 0);
        }
      }
    } else if (id === 'gauss') {
      var sd = Math.sqrt(0.5 + (noise / 0.5) * 3.5);
      for (i = 0; i < n; i++) {
        var c = i < half ? 2 : -2;
        push(c + RR.gauss(rand) * sd, c + RR.gauss(rand) * sd, i < half ? 1 : 0);
      }
    } else { // moons — duas meias-luas entrelaçadas (como make_moons)
      for (i = 0; i < n; i++) {
        var top = i < half;
        t = uni(rand, 0, Math.PI);
        x = top ? Math.cos(t) : 1 - Math.cos(t);
        y = top ? Math.sin(t) : 0.5 - Math.sin(t);
        x += RR.gauss(rand) * noise * 0.6; y += RR.gauss(rand) * noise * 0.6;
        push((x - 0.5) * 3.4, (y - 0.25) * 3.4, top ? 0 : 1);
      }
    }
    // embaralha (Fisher–Yates) para o corte treino/teste ser aleatório
    var m = Y.length;
    for (i = m - 1; i > 0; i--) {
      var j = (rand() * (i + 1)) | 0, ty = Y[i], tx = X[2 * i], tz = X[2 * i + 1];
      Y[i] = Y[j]; X[2 * i] = X[2 * j]; X[2 * i + 1] = X[2 * j + 1];
      Y[j] = ty; X[2 * j] = tx; X[2 * j + 1] = tz;
    }
    return { X: X, Y: Y, n: m };
  }

  /* ---------- MLP: entradas 2 -> camadas ocultas -> 1 saída sigmoide ----------
     act: 0 = tanh · 1 = ReLU · 2 = sigmoide. Perda: entropia cruzada binária.
     Pesos em Float64Array, linha j da matriz W[l] = pesos de entrada do neurônio j. */
  var ACT = { tanh: 0, relu: 1, sigmoid: 2 };

  function sigmoid(s) {
    if (s >= 0) return 1 / (1 + Math.exp(-s));
    var e = Math.exp(s);
    return e / (1 + e);
  }
  /* BCE estável numericamente a partir do logit z */
  function bce(z, y) { return (z > 0 ? z : 0) - y * z + Math.log1p(Math.exp(-Math.abs(z))); }

  function MLP(sizes, act, seed) {
    this.sizes = sizes.slice();
    this.L = sizes.length - 1;
    this.act = act;
    this.W = []; this.b = []; this.gW = []; this.gb = []; this.vW = []; this.vb = [];
    this.z = []; this.d = []; this.a = [new Float64Array(sizes[0])];
    var rand = RR.rng(seed);
    for (var l = 0; l < this.L; l++) {
      var nin = sizes[l], nout = sizes[l + 1], hidden = l < this.L - 1;
      // He para ReLU, Xavier (Glorot normal) para tanh/sigmoide e para a saída
      var std = hidden && act === ACT.relu ? Math.sqrt(2 / nin) : Math.sqrt(2 / (nin + nout));
      var W = new Float64Array(nin * nout), b = new Float64Array(nout);
      for (var k = 0; k < W.length; k++) W[k] = RR.gauss(rand) * std;
      if (hidden && act === ACT.relu) b.fill(0.01);
      this.W.push(W); this.b.push(b);
      this.gW.push(new Float64Array(nin * nout)); this.gb.push(new Float64Array(nout));
      this.vW.push(new Float64Array(nin * nout)); this.vb.push(new Float64Array(nout));
      this.z.push(new Float64Array(nout)); this.d.push(new Float64Array(nout));
      this.a.push(new Float64Array(nout));
    }
  }

  /* forward pass; devolve p = P(classe B | x). Ativações ficam em this.a */
  MLP.prototype.forward = function (x1, x2) {
    var L = this.L, act = this.act, sizes = this.sizes;
    this.a[0][0] = x1; this.a[0][1] = x2;
    for (var l = 0; l < L; l++) {
      var nin = sizes[l], nout = sizes[l + 1], W = this.W[l], b = this.b[l];
      var ain = this.a[l], z = this.z[l], aout = this.a[l + 1], last = l === L - 1;
      for (var j = 0, o = 0; j < nout; j++, o += nin) {
        var s = b[j];
        for (var i = 0; i < nin; i++) s += W[o + i] * ain[i];
        z[j] = s;
        aout[j] = last || act === 2 ? sigmoid(s) : act === 0 ? Math.tanh(s) : (s > 0 ? s : 0);
      }
    }
    return this.a[L][0];
  };

  /* backpropagation do último forward; ACUMULA os gradientes em gW/gb */
  MLP.prototype.backward = function (y) {
    var L = this.L, act = this.act, sizes = this.sizes;
    this.d[L - 1][0] = this.a[L][0] - y; // dBCE/dz da saída sigmoide
    for (var l = L - 1; l >= 0; l--) {
      var nin = sizes[l], nout = sizes[l + 1], W = this.W[l], gW = this.gW[l], gb = this.gb[l];
      var d = this.d[l], ain = this.a[l], i, j, o;
      for (j = 0, o = 0; j < nout; j++, o += nin) {
        var dj = d[j];
        gb[j] += dj;
        for (i = 0; i < nin; i++) gW[o + i] += dj * ain[i];
      }
      if (l === 0) break;
      var dp = this.d[l - 1], zp = this.z[l - 1];
      for (i = 0; i < nin; i++) {
        var s = 0;
        for (j = 0, o = i; j < nout; j++, o += nin) s += W[o] * d[j];
        var ai = ain[i];
        dp[i] = s * (act === 0 ? 1 - ai * ai : act === 1 ? (zp[i] > 0 ? 1 : 0) : ai * (1 - ai));
      }
    }
  };

  /* SGD com momentum (mu) e L2 nos pesos; n = tamanho do lote acumulado */
  MLP.prototype.step = function (n, lr, l2, mu) {
    var inv = 1 / n;
    for (var l = 0; l < this.L; l++) {
      var W = this.W[l], g = this.gW[l], v = this.vW[l], b = this.b[l], gb = this.gb[l], vb = this.vb[l], k;
      for (k = 0; k < W.length; k++) { v[k] = mu * v[k] - lr * (g[k] * inv + l2 * W[k]); W[k] += v[k]; g[k] = 0; }
      for (k = 0; k < b.length; k++) { vb[k] = mu * vb[k] - lr * gb[k] * inv; b[k] += vb[k]; gb[k] = 0; }
    }
  };

  MLP.prototype.predict = function (x, y) { return this.forward(x * IN_SCALE, y * IN_SCALE); };

  /* uma época: embaralha a ordem e percorre em mini-lotes */
  MLP.prototype.trainEpoch = function (X, Y, n, order, rand, o) {
    var i, k;
    for (i = n - 1; i > 0; i--) { var r = (rand() * (i + 1)) | 0, t = order[i]; order[i] = order[r]; order[r] = t; }
    for (var s = 0; s < n; s += o.batch) {
      var e = Math.min(n, s + o.batch);
      for (k = s; k < e; k++) {
        var idx = order[k];
        this.forward(X[2 * idx] * IN_SCALE, X[2 * idx + 1] * IN_SCALE);
        this.backward(Y[idx]);
      }
      this.step(e - s, o.lr, o.l2, o.mu);
    }
  };

  /* perda média (BCE) e acurácia em um conjunto */
  MLP.prototype.evaluate = function (X, Y, n) {
    var loss = 0, hit = 0, zo = this.z[this.L - 1];
    for (var k = 0; k < n; k++) {
      var p = this.forward(X[2 * k] * IN_SCALE, X[2 * k + 1] * IN_SCALE), y = Y[k];
      loss += bce(zo[0], y);
      if ((p >= 0.5 ? 1 : 0) === y) hit++;
    }
    return n ? { loss: loss / n, acc: hit / n } : { loss: NaN, acc: NaN };
  };

  MLP.prototype.isFinite = function () {
    for (var l = 0; l < this.L; l++) {
      var W = this.W[l];
      for (var k = 0; k < W.length; k++) if (!isFinite(W[k])) return false;
    }
    return true;
  };

  RR.playground = { core: { MLP: MLP, ACT: ACT, genDataset: genDataset, bce: bce, DATASETS: DATASETS, DOMAIN: DOMAIN, IN_SCALE: IN_SCALE } };

  /* =====================================================================
     2. INTERFACE
     ===================================================================== */
  if (typeof document === 'undefined' || !document.createElement) return;

  var h = RR.el;
  var LRS = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1];
  var L2S = [0, 0.001, 0.01];
  var MOMS = [0, 0.5, 0.8, 0.9];
  var SPEEDS = [{ v: 1, label: 'lenta' }, { v: 2, label: 'normal' }, { v: 10, label: 'turbo' }];
  var ACTS = [{ v: 'tanh', label: 'Tanh' }, { v: 'relu', label: 'ReLU' }, { v: 'sigmoid', label: 'Sigmoide' }];
  var N_POINTS = 300, TRAIN_FRAC = 0.8, BATCH = 10, GRID = 60, THUMB = 30;
  var MAX_CUSTOM = 150, HIST_MAX = 480, MAX_LAYERS = 3, MAX_NEURONS = 8, BUDGET_MS = 8;
  var DEFAULT_SEED = 37; // com esta semente a espiral converge de forma estável (~350 épocas)

  /* cores das classes: A = sol (pele ao sol), B = azul (camiseta) — as duas da foto */
  var C_A = [255, 179, 138], C_B = [94, 134, 255], C_BG = [11, 14, 26];
  var CSS_A = 'rgb(' + C_A + ')', CSS_B = 'rgb(' + C_B + ')';

  var ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L9.2 4.9A.8.8 0 0 0 8 5.6z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
    step: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6.5v11l8-5.5z" fill="currentColor"/><path d="M18 6v12"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.6h4.6"/></svg>',
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>'
  };

  /* ---------- formatação pt-BR ---------- */
  function fx(n, d) {
    if (!isFinite(n)) return '—';
    var s = Math.abs(n).toFixed(d).replace('.', ',');
    return (n < 0 && +s.replace(',', '.') !== 0 ? '−' : '') + s;
  }
  function pct(n) { return isFinite(n) ? Math.round(n * 100) + '%' : '—'; }
  /* inteiro simples com separador de milhar pt-BR (ex.: 1.024) */
  function epochStr(e) {
    return RR.fmt(Math.min(e, 999999), 0);
  }
  function lrLabel(v) { return String(v).replace('.', ','); }

  /* ---------- LUTs de cor (rgb) ----------
     Mapeiam v ∈ [-1, 1] para o fundo misturado à cor da classe (A < 0 < B).
     LUT_Z: v = logit/Z_MAX; a intensidade cresce com a confiança e satura
     devagar, criando um "brilho" que se afasta da fronteira. */
  var Z_MAX = 8, LUT_N = 512;
  function buildLut(kOf, bg) {
    var lut = new Uint8ClampedArray(LUT_N * 3);
    for (var i = 0; i < LUT_N; i++) {
      var t = i / (LUT_N - 1) * 2 - 1, c = t < 0 ? C_A : C_B, k = kOf(Math.abs(t));
      for (var ch = 0; ch < 3; ch++) lut[i * 3 + ch] = bg[ch] + (c[ch] - bg[ch]) * k;
    }
    return lut;
  }
  var LUT_Z = buildLut(function (t) { return 0.4 * (1 - Math.exp(-t * Z_MAX / 4.5)); }, C_BG);
  var LUT_DIV = buildLut(function (t) { return 0.46 * Math.pow(t, 0.8); }, C_BG);
  var LUT_THUMB = buildLut(function (t) { return 0.82 * Math.pow(t, 0.75); }, [16, 20, 36]);
  function lutIdx(v) { return ((v < -1 ? -1 : v > 1 ? 1 : v) * 0.5 + 0.5) * (LUT_N - 1) | 0; }

  /* ---------- estado ---------- */
  var state = {
    dataset: 'spiral', noise: 0.1, dataSeed: 1, wSeed: DEFAULT_SEED,
    layers: [6, 6], act: 'tanh', lr: 0.03, l2: 0, mu: 0.8, speed: 2,
    addClass: 1, playing: false, diverged: false, epoch: 0
  };
  var net, trainRand, base, custom = { X: [], Y: [] };
  var sets = { trX: null, trY: null, nTr: 0, nTrBase: 0, teX: null, teY: null, nTe: 0, order: null };
  var stats = { trLoss: NaN, teLoss: NaN, trAcc: NaN, teAcc: NaN };
  var hist = { e: [], tr: [], te: [], stride: 1 };
  var visible = false, inited = false, userActed = false;
  var focus = null; // neurônio em destaque {c, k}

  /* ---------- dados ---------- */
  function regenData() {
    base = genDataset(state.dataset, N_POINTS, state.noise, state.dataSeed);
    buildSets();
  }
  function buildSets() {
    var nTrBase = Math.round(base.n * TRAIN_FRAC), nC = custom.Y.length, nTr = nTrBase + nC, nTe = base.n - nTrBase, i;
    var trX = new Float64Array(nTr * 2), trY = new Uint8Array(nTr), teX = new Float64Array(nTe * 2), teY = new Uint8Array(nTe);
    for (i = 0; i < nTrBase; i++) { trX[2 * i] = base.X[2 * i]; trX[2 * i + 1] = base.X[2 * i + 1]; trY[i] = base.Y[i]; }
    for (i = 0; i < nC; i++) { var k = nTrBase + i; trX[2 * k] = custom.X[2 * i]; trX[2 * k + 1] = custom.X[2 * i + 1]; trY[k] = custom.Y[i]; }
    for (i = 0; i < nTe; i++) { var j = nTrBase + i; teX[2 * i] = base.X[2 * j]; teX[2 * i + 1] = base.X[2 * j + 1]; teY[i] = base.Y[j]; }
    var order = new Uint32Array(nTr);
    for (i = 0; i < nTr; i++) order[i] = i;
    sets = { trX: trX, trY: trY, nTr: nTr, nTrBase: nTrBase, teX: teX, teY: teY, nTe: nTe, order: order };
  }

  /* ---------- rede ---------- */
  function resetNet() {
    net = new MLP([2].concat(state.layers, [1]), ACT[state.act], state.wSeed);
    trainRand = RR.rng(state.wSeed * 31 + 7);
    state.epoch = 0; state.diverged = false;
    hist = { e: [], tr: [], te: [], stride: 1 };
    focusValid();
    measure(); record();
    invalidate(true);
    updateArchUI();
  }
  function measure() {
    var tr = net.evaluate(sets.trX, sets.trY, sets.nTr), te = net.evaluate(sets.teX, sets.teY, sets.nTe);
    stats.trLoss = tr.loss; stats.trAcc = tr.acc; stats.teLoss = te.loss; stats.teAcc = te.acc;
    if (!isFinite(tr.loss) || !net.isFinite()) { diverge(false); return; }
    // a BCE estável quase nunca vira infinito: perda ainda acima da inicial depois de 50 épocas = treino instável
    var unstable = state.epoch >= 50 && hist.tr.length && tr.loss > Math.max(0.75, 1.1 * hist.tr[0]);
    if (unstable) diverge(true);
  }
  function record() {
    var n = hist.e.length;
    if (n && state.epoch - hist.e[n - 1] < hist.stride) return;
    if (!isFinite(stats.trLoss)) return;
    hist.e.push(state.epoch); hist.tr.push(stats.trLoss); hist.te.push(stats.teLoss);
    if (hist.e.length > HIST_MAX) { // decima mantendo o primeiro ponto
      ['e', 'tr', 'te'].forEach(function (k) { hist[k] = hist[k].filter(function (_, i) { return i % 2 === 0; }); });
      hist.stride *= 2;
    }
  }
  function trainEpoch() {
    net.trainEpoch(sets.trX, sets.trY, sets.nTr, sets.order, trainRand, { batch: BATCH, lr: state.lr, l2: state.l2, mu: state.mu });
    state.epoch++;
  }
  function diverge(unstable) {
    if (state.diverged) return;
    state.diverged = true;
    pause(true);
    announce(unstable
      ? 'O treino ficou instável: a perda não cai. Reduza a taxa de aprendizado e reinicie.'
      : 'A rede divergiu: a perda virou infinito. Reduza a taxa de aprendizado e reinicie.');
    updateStatus();
  }

  /* ---------- DOM ---------- */
  var root, ui = {};

  function iconBtn(cls, icon, label, onclick, text) {
    return h('button', { class: cls, type: 'button', 'aria-label': label, title: label, onclick: onclick, html: icon + (text != null ? '<span class="pg__btntext">' + text + '</span>' : '') });
  }
  function selectField(id, label, options, value, onchange) {
    var sel = h('select', { id: id, onchange: function () { onchange(sel.value); } },
      options.map(function (o) { return h('option', { value: String(o.v), text: o.label }); }));
    sel.value = String(value);
    return h('div', { class: 'field pg__field' }, [h('label', { class: 'field__label', for: id, text: label }), sel]);
  }
  function zoneHead(idx, title, id, extra) {
    return h('div', { class: 'pg__zhead' }, [
      h('h3', { class: 'pg__ztitle mono', id: id }, [h('span', { class: 'pg__zidx', text: idx }), title]),
      extra || null
    ]);
  }

  function build() {
    root.textContent = '';

    /* barra da janela */
    ui.arch = h('b', { class: 'pg__archname' });
    ui.statusText = h('span', { class: 'pg__statustext', text: 'pausado' });
    var bar = h('div', { class: 'pg__bar mono' }, [
      h('span', { class: 'pg__path' }, [
        h('i', { class: 'pg__logo', 'aria-hidden': 'true' }),
        h('span', { class: 'pg__crumb' }, ['lab', h('span', { class: 'pg__sep', 'aria-hidden': 'true', text: '/' })]),
        h('span', { class: 'pg__crumb' }, ['neural-playground', h('span', { class: 'pg__sep', 'aria-hidden': 'true', text: '/' })]),
        ui.arch
      ]),
      h('span', { class: 'pg__status' }, [h('i', { class: 'pg__led', 'aria-hidden': 'true' }), ui.statusText])
    ]);

    /* barra de transporte + HUD */
    ui.play = h('button', { class: 'btn btn--primary pg__play', type: 'button', onclick: function () { userActed = true; state.playing ? pause() : play(); } });
    ui.step = iconBtn('btn btn--ghost btn--sm pg__tbtn', ICON.step, 'Passo: avançar uma época', function () { userActed = true; stepOnce(); }, 'Passo');
    ui.reset = iconBtn('btn btn--ghost btn--sm pg__tbtn', ICON.reset, 'Reiniciar os pesos com uma nova semente', function () { userActed = true; state.wSeed++; resetNet(); announce('Pesos reiniciados (semente ' + state.wSeed + ').'); }, 'Reiniciar');
    function stat(label, key, title) {
      ui[key] = h('span', { class: 'pg__statval' });
      return h('div', { class: 'pg__stat', title: title || null }, [h('span', { class: 'pg__statlabel', text: label }), ui[key]]);
    }
    var toolbar = h('div', { class: 'pg__toolbar' }, [
      h('div', { class: 'pg__transport' }, [ui.play, ui.step, ui.reset]),
      h('div', { class: 'pg__stats mono', role: 'group', 'aria-label': 'Métricas do treino' }, [
        stat('época', 'sEpoch'), stat('loss treino', 'sTr', 'Entropia cruzada binária no conjunto de treino'),
        stat('loss teste', 'sTe', 'Entropia cruzada binária no conjunto de teste'), stat('acurácia teste', 'sAcc', 'Acerto no conjunto de teste (20% dos pontos)')
      ])
    ]);

    /* ---- zona 1: dados ---- */
    ui.dsBtns = {};
    var dsList = h('div', { class: 'pg__datasets', role: 'group', 'aria-label': 'Dataset' }, DATASETS.map(function (d) {
      var cv = h('canvas', { class: 'pg__dsicon', width: 40, height: 40, 'aria-hidden': 'true' });
      var b = h('button', { class: 'pg__ds', type: 'button', 'aria-pressed': 'false', onclick: function () { userActed = true; setDataset(d.id, true); } },
        [cv, h('span', { class: 'pg__dsname', text: d.name })]);
      b._icon = cv;
      ui.dsBtns[d.id] = b;
      return b;
    }));

    ui.noise = h('input', { type: 'range', id: 'pg-noise', min: 0, max: 50, step: 5, value: Math.round(state.noise * 100) });
    ui.noiseVal = h('span', { class: 'field__value' });
    ui.noise.addEventListener('input', function () {
      userActed = true;
      state.noise = +ui.noise.value / 100;
      updateNoiseUI(); regenData(); resetNet();
    });
    var noiseField = h('div', { class: 'field pg__field' }, [
      h('div', { class: 'field__label' }, [h('label', { for: 'pg-noise', text: 'Ruído' }), ui.noiseVal]), ui.noise
    ]);

    ui.clsA = h('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Classe A', onclick: function () { setAddClass(0); } }, [h('i', { class: 'pg__dot pg__dot--a', 'aria-hidden': 'true' }), 'A']);
    ui.clsB = h('button', { type: 'button', 'aria-pressed': 'true', 'aria-label': 'Classe B', onclick: function () { setAddClass(1); } }, [h('i', { class: 'pg__dot pg__dot--b', 'aria-hidden': 'true' }), 'B']);
    ui.clear = iconBtn('pg__mini pg__mini--icon', ICON.clear, 'Remover os pontos adicionados', function () { clearCustom(); }, '');
    var addBox = h('div', { class: 'pg__add' }, [
      h('p', { class: 'pg__label', id: 'pg-add-label' }, [(RR.isTouch ? 'Toque' : 'Clique') + ' no gráfico para adicionar pontos da classe:']),
      h('div', { class: 'pg__addrow' }, [h('div', { class: 'segmented pg__seg pg__seg--ab', role: 'group', 'aria-labelledby': 'pg-add-label' }, [ui.clsA, ui.clsB]), ui.clear])
    ]);

    ui.regen = iconBtn('pg__mini pg__mini--wide', ICON.dice, 'Sortear novos dados', function () {
      userActed = true; state.dataSeed++; custom = { X: [], Y: [] }; regenData(); resetNet(); updateCustomUI();
      announce('Novos dados sorteados.');
    }, 'Novos dados');
    ui.split = h('p', { class: 'pg__split mono' });

    var zData = h('section', { class: 'pg__zone pg__zone--data', 'aria-labelledby': 'pg-h-data' }, [
      zoneHead('01', 'dados', 'pg-h-data'),
      dsList, noiseField, addBox,
      h('div', { class: 'pg__datafoot' }, [ui.regen, ui.split])
    ]);

    /* ---- zona 2: rede ---- */
    ui.layerCount = h('span', { class: 'pg__layernum mono', 'aria-live': 'off' });
    ui.layerMinus = iconBtn('pg__pm', ICON.minus, 'Remover camada oculta', function () { changeLayers(-1); });
    ui.layerPlus = iconBtn('pg__pm', ICON.plus, 'Adicionar camada oculta', function () { changeLayers(1); });
    var layerCtl = h('div', { class: 'pg__layers' }, [h('span', { class: 'pg__layerlabel', text: 'camadas ocultas' }), ui.layerMinus, ui.layerCount, ui.layerPlus]);

    ui.colheads = h('div', { class: 'pg__colheads' });
    ui.netCanvas = h('canvas', { class: 'pg__netcv', role: 'img' });
    ui.netWrap = h('div', { class: 'pg__netwrap' }, [ui.colheads, h('div', { class: 'pg__netstage' }, [ui.netCanvas])]);
    ui.netHint = h('p', { class: 'pg__hint mono', text: RR.isTouch ? 'toque em um neurônio para ver o que ele aprendeu' : 'passe o mouse sobre um neurônio para ver o que ele aprendeu' });

    ui.speedBtns = SPEEDS.map(function (s) {
      return h('button', { type: 'button', 'aria-pressed': String(state.speed === s.v), onclick: function () { setSpeed(s.v); } }, s.label);
    });
    var hyper = h('div', { class: 'pg__hyper' }, [
      selectField('pg-lr', 'Taxa de aprendizado', LRS.map(function (v) { return { v: v, label: lrLabel(v) }; }), state.lr, function (v) { state.lr = +v; }),
      selectField('pg-act', 'Ativação', ACTS, state.act, function (v) { state.act = v; resetNet(); announce('Ativação ' + ACTS.filter(function (a) { return a.v === v; })[0].label + '. Pesos reiniciados.'); }),
      selectField('pg-l2', 'Regularização L2', L2S.map(function (v) { return { v: v, label: v ? lrLabel(v) : 'nenhuma' }; }), state.l2, function (v) { state.l2 = +v; }),
      selectField('pg-mu', 'Momentum', MOMS.map(function (v) { return { v: v, label: v ? lrLabel(v) : 'sem momentum' }; }), state.mu, function (v) { state.mu = +v; }),
      h('div', { class: 'field pg__field pg__field--wide' }, [
        h('span', { class: 'field__label', id: 'pg-speed-label' }, ['Velocidade', h('span', { class: 'pg__fhint mono', text: SPEEDS.map(function (s) { return s.v; }).join(' · ') + ' épocas/quadro' })]),
        h('div', { class: 'segmented pg__seg pg__seg--fill', role: 'group', 'aria-labelledby': 'pg-speed-label' }, ui.speedBtns)
      ])
    ]);

    var zNet = h('section', { class: 'pg__zone pg__zone--net', 'aria-labelledby': 'pg-h-net' }, [
      zoneHead('02', 'rede', 'pg-h-net', layerCtl),
      h('div', { class: 'pg__netbody' }, [ui.netWrap, ui.netHint]), hyper
    ]);

    /* ---- zona 3: saída ---- */
    ui.plotCanvas = h('canvas', { class: 'pg__plotcv', role: 'img' });
    ui.chipData = h('span', { class: 'pg__chip pg__chip--tl mono' });
    ui.chipRead = h('span', { class: 'pg__chip pg__chip--tr mono', hidden: true });
    ui.chipFocus = h('span', { class: 'pg__chip pg__chip--bl mono', hidden: true });
    ui.chipWarn = h('span', { class: 'pg__chip pg__chip--warn mono', hidden: true, text: 'instável · reduza a taxa e reinicie' });
    ui.plotWrap = h('div', { class: 'pg__plot' }, [ui.plotCanvas, ui.chipData, ui.chipRead, ui.chipFocus, ui.chipWarn]);
    var legend = h('div', { class: 'pg__legend mono', 'aria-hidden': 'true' }, [
      h('span', { class: 'pg__lg' }, [h('i', { class: 'pg__lgdot' }), 'treino']),
      h('span', { class: 'pg__lg' }, [h('i', { class: 'pg__lgring' }), 'teste']),
      h('span', { class: 'pg__lgbar' }, [h('b', { class: 'pg__lga', text: 'A' }), h('i', { class: 'pg__ramp' }), h('b', { class: 'pg__lgb', text: 'B' })])
    ]);
    ui.lossCanvas = h('canvas', { class: 'pg__losscv', role: 'img', 'aria-label': 'Curvas de perda (entropia cruzada) de treino e de teste ao longo das épocas' });
    ui.lossWrap = h('div', { class: 'pg__loss' }, [
      h('div', { class: 'pg__losshead mono', 'aria-hidden': 'true' }, [
        h('span', { text: 'perda × época' }),
        h('span', { class: 'pg__losskeys' }, [h('span', { class: 'pg__key pg__key--tr' }, 'treino'), h('span', { class: 'pg__key pg__key--te' }, 'teste')])
      ]),
      ui.lossCanvas
    ]);
    var zOut = h('section', { class: 'pg__zone pg__zone--out', 'aria-labelledby': 'pg-h-out' }, [
      zoneHead('03', 'saída', 'pg-h-out', h('span', { class: 'pg__zmeta mono', text: 'fronteira de decisão' })),
      ui.plotWrap, legend, ui.lossWrap
    ]);

    ui.live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    root.appendChild(h('div', { class: 'pg' }, [bar, toolbar, h('div', { class: 'pg__grid' }, [zData, zNet, zOut]), ui.live]));

    bindPlot(); bindNet();
    updatePlayUI(); updateNoiseUI(); updateDatasetUI(); updateCustomUI(); updateArchUI(); updateStatus();
  }

  /* ---------- atualizações de UI ---------- */
  function announce(msg) { if (ui.live) { ui.live.textContent = ''; setTimeout(function () { ui.live.textContent = msg; }, 30); } }
  function updatePlayUI() {
    if (!ui.play) return;
    ui.play.innerHTML = (state.playing ? ICON.pause : ICON.play) + '<span>' + (state.playing ? 'Pausar' : 'Treinar') + '</span>';
    ui.play.setAttribute('aria-label', state.playing ? 'Pausar o treino' : 'Treinar a rede');
    ui.play.classList.toggle('is-on', state.playing);
    updateStatus();
  }
  function updateStatus() {
    if (!ui.statusText) return;
    var pg = root.querySelector('.pg');
    var s = state.diverged ? 'instável' : state.playing ? 'treinando' : 'pausado';
    ui.statusText.textContent = s;
    pg.dataset.status = state.diverged ? 'diverged' : state.playing ? 'training' : 'paused';
    ui.chipWarn.hidden = !state.diverged;
  }
  function updateNoiseUI() {
    ui.noiseVal.textContent = Math.round(state.noise * 100) + '%';
    ui.noise.style.setProperty('--pct', (state.noise / 0.5 * 100) + '%');
  }
  function updateDatasetUI() {
    DATASETS.forEach(function (d) { ui.dsBtns[d.id].setAttribute('aria-pressed', String(d.id === state.dataset)); });
    var name = dsName(state.dataset);
    ui.chipData.textContent = name.toLowerCase() + ' · ' + base.n + ' pts';
  }
  function updateCustomUI() {
    var n = custom.Y.length;
    ui.clear.disabled = !n;
    ui.clear.querySelector('.pg__btntext').textContent = n ? String(n) : '';
    var lbl = n ? 'Remover ' + (n > 1 ? 'os ' + n + ' pontos adicionados' : 'o ponto adicionado') : 'Remover os pontos adicionados';
    ui.clear.setAttribute('aria-label', lbl); ui.clear.title = lbl;
    ui.split.textContent = sets.nTr + ' treino · ' + sets.nTe + ' teste';
  }
  function updateArchUI() {
    if (!ui.arch) return;
    var sizes = [2].concat(state.layers, [1]);
    ui.arch.textContent = 'mlp-' + sizes.join('-');
    ui.layerCount.textContent = state.layers.length;
    ui.layerMinus.disabled = state.layers.length <= 1;
    ui.layerPlus.disabled = state.layers.length >= MAX_LAYERS;
    var actName = ACTS.filter(function (a) { return a.v === state.act; })[0].label;
    ui.netCanvas.setAttribute('aria-label', 'Diagrama da rede: 2 entradas (x₁, x₂), ' + state.layers.length +
      (state.layers.length > 1 ? ' camadas ocultas com ' : ' camada oculta com ') + state.layers.join(', ') +
      (state.layers.every(function (n) { return n === 1; }) ? ' neurônio' : ' neurônios') + ' (ativação ' + actName + ') e 1 saída sigmoide. A espessura das conexões é proporcional ao peso; azul = positivo, laranja = negativo.');
    buildColHeads();
  }
  function updateHud() {
    ui.sEpoch.textContent = epochStr(state.epoch);
    ui.sTr.textContent = fx(stats.trLoss, 3);
    ui.sTe.textContent = fx(stats.teLoss, 3);
    ui.sAcc.textContent = pct(stats.teAcc);
    ui.plotCanvas.setAttribute('aria-label', 'Fronteira de decisão da rede sobre o dataset ' + dsName(state.dataset) +
      ': região laranja = classe A, região azul = classe B, linha clara = probabilidade 0,5. Época ' + state.epoch +
      ', acurácia de teste ' + pct(stats.teAcc) + '.');
  }
  function dsName(id) { for (var i = 0; i < DATASETS.length; i++) if (DATASETS[i].id === id) return DATASETS[i].name; return id; }

  /* ---------- ações ---------- */
  function play() {
    if (state.diverged) resetNet();
    state.playing = true; updatePlayUI(); syncLoop();
  }
  function pause(silent) {
    var was = state.playing;
    state.playing = false; updatePlayUI(); syncLoop();
    if (was && !silent) announce('Treino pausado na época ' + state.epoch + '. Acurácia de teste: ' + pct(stats.teAcc) + '.');
  }
  function stepOnce() {
    if (state.playing) pause(true);
    if (state.diverged) return;
    trainEpoch(); measure(); record(); invalidate(true);
  }
  function setDataset(id, fromUser) {
    if (!DATASETS.some(function (d) { return d.id === id; })) return;
    state.dataset = id; custom = { X: [], Y: [] };
    regenData();
    if (ui.play) { updateDatasetUI(); updateCustomUI(); }
    if (net) resetNet();
    if (fromUser !== false) announce('Dataset ' + dsName(id) + ' carregado.');
  }
  function setAddClass(c) {
    state.addClass = c;
    ui.clsA.setAttribute('aria-pressed', String(c === 0));
    ui.clsB.setAttribute('aria-pressed', String(c === 1));
  }
  function setSpeed(v) {
    state.speed = v;
    ui.speedBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', String(SPEEDS[i].v === v)); });
  }
  function changeLayers(d) {
    var n = state.layers.length + d;
    if (n < 1 || n > MAX_LAYERS) return;
    if (d > 0) state.layers.push(Math.min(MAX_NEURONS, state.layers[state.layers.length - 1] || 4));
    else state.layers.pop();
    resetNet();
    announce(n + (n > 1 ? ' camadas ocultas.' : ' camada oculta.'));
  }
  function changeNeurons(li, d) {
    var v = state.layers[li] + d;
    if (v < 1 || v > MAX_NEURONS) return;
    state.layers[li] = v;
    resetNet();
    announce('Camada ' + (li + 1) + ': ' + v + (v > 1 ? ' neurônios.' : ' neurônio.'));
  }
  function addPoint(x, y) {
    if (custom.Y.length >= MAX_CUSTOM) { announce('Limite de ' + MAX_CUSTOM + ' pontos adicionados.'); RR.toast && RR.toast('Limite de ' + MAX_CUSTOM + ' pontos adicionados'); return; }
    custom.X.push(x, y); custom.Y.push(state.addClass);
    buildSets(); measure(); updateCustomUI(); invalidate(false);
  }
  function clearCustom() {
    if (!custom.Y.length) return;
    custom = { X: [], Y: [] };
    buildSets(); measure(); updateCustomUI(); invalidate(false);
    announce('Pontos adicionados removidos.');
  }
  function focusValid() {
    if (!focus) return;
    var cols = [2].concat(state.layers, [1]);
    if (focus.c >= cols.length || focus.k >= cols[focus.c]) setFocus(null);
  }

  /* ---------- loop de treino ---------- */
  var loop = RR.loop(function () {
    var t0 = performance.now(), done = 0;
    while (done < state.speed && !state.diverged) {
      trainEpoch(); done++;
      if (performance.now() - t0 > BUDGET_MS) break;
    }
    lastTrainMs = performance.now() - t0;
    measure(); record();
    // o autoplay (sem interação do visitante) para sozinho quando a rede converge: não gasta CPU à toa
    if (autoRun && !userActed && state.playing && (state.epoch >= 1500 || (stats.teAcc >= 0.99 && state.epoch >= 300))) {
      autoRun = false;
      pause(true);
    }
    dirty.eval = dirty.plot = dirty.net = dirty.loss = dirty.hud = true;
    render(performance.now(), true);
  });
  var lastTrainMs = 0, autoRun = false;
  function syncLoop() {
    var run = state.playing && visible && !document.hidden && inited;
    if (run && !loop.running) loop.start();
    else if (!run && loop.running) { loop.stop(); requestRender(); } // conclui o que o throttle adiou
  }

  /* ---------- renderização (com throttle) ---------- */
  var dirty = { eval: true, plot: true, net: true, loss: true, hud: true, thumbs: true };
  var lastT = { eval: 0, net: 0, loss: 0, hud: 0 };
  var rafPending = 0;
  function invalidate(evalToo) {
    if (evalToo) dirty.eval = true;
    dirty.plot = dirty.net = dirty.loss = dirty.hud = true;
    requestRender();
  }
  function requestRender() {
    if (!inited || rafPending || loop.running) return;
    rafPending = requestAnimationFrame(function () { rafPending = 0; render(performance.now(), false); });
  }
  function render(now, live) {
    if (!sizes.plot) return;
    if (dirty.eval && (!live || lastTrainMs < 4 || now - lastT.eval >= 33)) {
      evalGrid(); dirty.eval = false; dirty.plot = true; dirty.thumbs = true; lastT.eval = now;
    }
    if (dirty.plot && !dirty.eval) { drawPlot(); dirty.plot = false; }
    if (dirty.net && netCtx && (!live || now - lastT.net >= 80)) { drawNet(); dirty.net = false; lastT.net = now; }
    if (dirty.loss && lossCtx && (!live || now - lastT.loss >= 100)) { drawLoss(); dirty.loss = false; lastT.loss = now; }
    if (dirty.hud && (!live || now - lastT.hud >= 100)) { updateHud(); dirty.hud = false; lastT.hud = now; }
  }

  /* ---------- grade de avaliação (fronteira + mapas dos neurônios) ---------- */
  var GG = GRID * GRID;
  var gridZ = new Float32Array(GG); // logit da saída em cada nó
  var gridAct = []; // por camada oculta: Float32Array(neurônios * GG)
  var heatCv = document.createElement('canvas');
  heatCv.width = heatCv.height = GRID;
  var heatCtx = heatCv.getContext('2d');
  var heatImg = heatCtx.createImageData(GRID, GRID);

  function gx(i) { return -DOMAIN + (i / (GRID - 1)) * 2 * DOMAIN; }
  function evalGrid() {
    var L = net.L, hiddenN = state.layers, l, j;
    for (l = 0; l < L - 1; l++) if (!gridAct[l] || gridAct[l].length !== hiddenN[l] * GG) gridAct[l] = new Float32Array(hiddenN[l] * GG);
    gridAct.length = L - 1;
    for (var yi = 0, idx = 0; yi < GRID; yi++) {
      var y = -gx(yi); // linha 0 = topo (x₂ = +6)
      for (var xi = 0; xi < GRID; xi++, idx++) {
        net.predict(gx(xi), y);
        var z = net.z[L - 1][0];
        gridZ[idx] = z === z ? z : 0;
        for (l = 0; l < L - 1; l++) {
          var a = net.a[l + 1], arr = gridAct[l], n = hiddenN[l];
          for (j = 0; j < n; j++) arr[j * GG + idx] = a[j];
        }
      }
    }
  }

  /* valor normalizado [-1, 1] do mapa de um neurônio (c = coluna, k = índice) no ponto idx */
  function mapFn(c, k) {
    var L = net.L;
    if (c === 0) return function (idx) { return k === 0 ? gx(idx % GRID) / DOMAIN : -gx((idx / GRID) | 0) / DOMAIN; };
    if (c === L) return function (idx) { return Math.tanh(gridZ[idx] / 2); }; // = 2p − 1
    var arr = gridAct[c - 1], off = k * GG;
    if (state.act === 'tanh') return function (idx) { return arr[off + idx]; };
    if (state.act === 'sigmoid') return function (idx) { return arr[off + idx] * 2 - 1; };
    var mx = 1e-6;
    for (var i = 0; i < GG; i++) if (arr[off + i] > mx) mx = arr[off + i];
    return function (idx) { return arr[off + idx] / mx; };
  }

  /* ---------- canvas: tamanhos ---------- */
  var sizes = { plot: 0, netW: 0, netH: 0, lossW: 0, lossH: 0 };
  var plotCtx, netCtx, lossCtx;
  function layout() {
    var pw = Math.floor(ui.plotWrap.clientWidth);
    if (pw && pw !== sizes.plot) { sizes.plot = pw; plotCtx = RR.setupCanvas(ui.plotCanvas, pw, pw, 2); dirty.plot = true; }
    var nw = Math.floor(ui.netWrap.clientWidth);
    if (nw && nw !== sizes.netW) {
      sizes.netW = nw;
      var g = netGeom(nw);
      sizes.netH = g.H;
      netCtx = RR.setupCanvas(ui.netCanvas, nw, g.H, 2);
      dirty.net = true; positionColHeads();
    }
    var lw = Math.floor(ui.lossWrap.clientWidth);
    if (lw && lw !== sizes.lossW) { sizes.lossW = lw; sizes.lossH = lw < 360 ? 104 : 120; lossCtx = RR.setupCanvas(ui.lossCanvas, lw, sizes.lossH, 2); dirty.loss = true; }
  }

  /* ---------- gráfico principal ---------- */
  function drawPlot() {
    var ctx = plotCtx, s = sizes.plot, i, d = heatImg.data;
    // 1) mapa de calor na grade, ampliado com suavização bilinear
    var val = focus ? mapFn(focus.c, focus.k) : null;
    var lut = focus ? LUT_DIV : LUT_Z;
    for (i = 0; i < GG; i++) {
      var li = lutIdx(val ? val(i) : gridZ[i] / Z_MAX) * 3;
      d[i * 4] = lut[li]; d[i * 4 + 1] = lut[li + 1]; d[i * 4 + 2] = lut[li + 2]; d[i * 4 + 3] = 255;
    }
    heatCtx.putImageData(heatImg, 0, 0);
    var cell = s / (GRID - 1);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(heatCv, -cell / 2, -cell / 2, s + cell, s + cell);

    // 2) grade de eixos discreta
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    for (var t = -4; t <= 4; t += 2) {
      var q = Math.round((t + DOMAIN) / (2 * DOMAIN) * s) + 0.5;
      ctx.moveTo(q, 0); ctx.lineTo(q, s); ctx.moveTo(0, q); ctx.lineTo(s, q);
    }
    ctx.stroke();

    // 3) curvas de nível (topografia da confiança) + fronteira p = 0,5
    // sem foco: isolinhas no espaço do logit (z = ±2 ≈ 88%, ±4 ≈ 98% de confiança)
    var field = gridZ, lvl = 0, levels = [-4, -2, 2, 4];
    if (focus) { field = scratchField(val); levels = [-0.5, 0.5]; }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(238,241,251,0.13)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i < levels.length; i++) contour(ctx, field, levels[i], cell);
    ctx.stroke();
    ctx.beginPath(); contour(ctx, field, lvl, cell);
    ctx.strokeStyle = 'rgba(7,8,13,0.45)'; ctx.lineWidth = 4.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(246,248,255,0.92)'; ctx.lineWidth = 1.6; ctx.stroke();

    // 4) pontos: treino = discos, teste = anéis, adicionados = disco com aro claro
    drawPoints(ctx, s);
    ctx.restore();
  }
  var fieldBuf = new Float32Array(GG);
  function scratchField(val) { for (var i = 0; i < GG; i++) fieldBuf[i] = val(i); return fieldBuf; }

  function toPx(v, s) { return (v + DOMAIN) / (2 * DOMAIN) * s; }
  function drawPoints(ctx, s) {
    var r = s < 380 ? 3.1 : 3.7, i, c, X, Y;
    X = sets.trX; Y = sets.trY;
    for (c = 0; c < 2; c++) {
      ctx.beginPath();
      for (i = 0; i < sets.nTrBase; i++) if (Y[i] === c) { var px = toPx(X[2 * i], s), py = s - toPx(X[2 * i + 1], s); ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, 6.2832); }
      ctx.fillStyle = c ? CSS_B : CSS_A; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(7,8,13,0.9)'; ctx.stroke();
    }
    // pontos adicionados pelo usuário
    for (i = sets.nTrBase; i < sets.nTr; i++) {
      var ux = toPx(X[2 * i], s), uy = s - toPx(X[2 * i + 1], s);
      ctx.beginPath(); ctx.arc(ux, uy, r + 1, 0, 6.2832);
      ctx.fillStyle = Y[i] ? CSS_B : CSS_A; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    }
    X = sets.teX; Y = sets.teY;
    for (c = 0; c < 2; c++) {
      ctx.beginPath();
      for (i = 0; i < sets.nTe; i++) if (Y[i] === c) { var tx = toPx(X[2 * i], s), ty = s - toPx(X[2 * i + 1], s); ctx.moveTo(tx + r, ty); ctx.arc(tx, ty, r, 0, 6.2832); }
      ctx.lineWidth = 3.6; ctx.strokeStyle = 'rgba(7,8,13,0.85)'; ctx.stroke();
      ctx.lineWidth = 1.7; ctx.strokeStyle = c ? CSS_B : CSS_A; ctx.stroke();
    }
  }

  /* marching squares: adiciona ao path atual os segmentos da isolinha `level`
     (nós da grade em i*cell; caso sela resolvido pela média do centro) */
  function contour(ctx, f, level, cell) {
    var G = GRID;
    for (var y = 0; y < G - 1; y++) {
      for (var x = 0; x < G - 1; x++) {
        var i = y * G + x, a = f[i], b = f[i + 1], c = f[i + G + 1], d = f[i + G];
        var code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (code === 0 || code === 15) continue;
        var x0 = x * cell, y0 = y * cell;
        // pontos nas arestas: T (a-b), R (b-c), B (d-c), L (a-d)
        var Tx = x0 + (level - a) / (b - a) * cell, Ty = y0;
        var Rx = x0 + cell, Ry = y0 + (level - b) / (c - b) * cell;
        var Bx = x0 + (level - d) / (c - d) * cell, By = y0 + cell;
        var Lx = x0, Ly = y0 + (level - a) / (d - a) * cell;
        switch (code) {
          case 1: case 14: seg(ctx, Lx, Ly, Bx, By); break;
          case 2: case 13: seg(ctx, Bx, By, Rx, Ry); break;
          case 3: case 12: seg(ctx, Lx, Ly, Rx, Ry); break;
          case 4: case 11: seg(ctx, Tx, Ty, Rx, Ry); break;
          case 6: case 9: seg(ctx, Tx, Ty, Bx, By); break;
          case 7: case 8: seg(ctx, Lx, Ly, Tx, Ty); break;
          case 5: case 10:
            var up = (a + b + c + d) / 4 > level;
            // 5: b,d acima · 10: a,c acima. Centro acima conecta os cantos acima.
            if ((code === 5) === up) { seg(ctx, Lx, Ly, Tx, Ty); seg(ctx, Rx, Ry, Bx, By); }
            else { seg(ctx, Tx, Ty, Rx, Ry); seg(ctx, Lx, Ly, Bx, By); }
            break;
        }
      }
    }
  }
  function seg(ctx, x1, y1, x2, y2) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }

  /* ---------- diagrama da rede ---------- */
  var thumbs = []; // thumbs[c][k] = canvas THUMB×THUMB
  var thumbImg = null;
  function netGeom(w) {
    var cols = [2].concat(state.layers, [1]), n = cols.length;
    // 2 passos: estima o tamanho do neurônio, depois reserva espaço para os rótulos x₁/x₂ e ŷ
    var S = Math.round(RR.clamp((w - 80) / (n - 1) * 0.42, 22, 38));
    var padL = S / 2 + 26, padR = S / 2 + 20;
    var gap = (w - padL - padR) / (n - 1);
    S = Math.round(RR.clamp(gap * 0.42, 22, 38));
    var pitch = S + (S > 30 ? 10 : 8);
    var H = Math.max(4, Math.max.apply(null, cols)) * pitch + 12;
    var pos = cols.map(function (m, c) {
      var x = padL + c * gap, ys = [];
      for (var k = 0; k < m; k++) ys.push(H / 2 + (k - (m - 1) / 2) * pitch);
      return { x: x, ys: ys };
    });
    return { cols: cols, pos: pos, S: S, H: H, gap: gap };
  }
  function buildThumbs() {
    var cols = [2].concat(state.layers, [1]);
    if (!thumbImg) thumbImg = heatCtx.createImageData(THUMB, THUMB);
    var d = thumbImg.data, step = (GRID - 1) / (THUMB - 1);
    for (var c = 0; c < cols.length; c++) {
      thumbs[c] = thumbs[c] || [];
      for (var k = 0; k < cols[c]; k++) {
        var cv = thumbs[c][k];
        if (!cv) { cv = thumbs[c][k] = document.createElement('canvas'); cv.width = cv.height = THUMB; }
        var f = mapFn(c, k);
        for (var ty = 0, o = 0; ty < THUMB; ty++) {
          var gy = Math.round(ty * step) * GRID;
          for (var tx = 0; tx < THUMB; tx++, o += 4) {
            var li = lutIdx(f(gy + Math.round(tx * step))) * 3;
            d[o] = LUT_THUMB[li]; d[o + 1] = LUT_THUMB[li + 1]; d[o + 2] = LUT_THUMB[li + 2]; d[o + 3] = 255;
          }
        }
        cv.getContext('2d').putImageData(thumbImg, 0, 0);
      }
    }
  }
  function rrect(ctx, x, y, w, hh, r) {
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawNet() {
    var ctx = netCtx, w = sizes.netW, g = netGeom(w), S = g.S, half = S / 2, c, k, i;
    if (g.H !== sizes.netH) { sizes.netH = g.H; netCtx = ctx = RR.setupCanvas(ui.netCanvas, w, g.H, 2); }
    if (dirty.thumbs) { buildThumbs(); dirty.thumbs = false; }
    ctx.clearRect(0, 0, w, g.H);
    ctx.lineCap = 'round';
    // conexões: espessura ∝ |w|, cor pelo sinal
    for (var l = 0; l < net.L; l++) {
      var A = g.pos[l], B = g.pos[l + 1], W = net.W[l], nin = g.cols[l];
      var x1 = A.x + half + 2, x2 = B.x - half - 2, mx = (x1 + x2) / 2;
      for (var j = 0; j < B.ys.length; j++) {
        for (i = 0; i < nin; i++) {
          var wv = W[j * nin + i], aw = Math.abs(wv);
          var on = !focus || (focus.c === l && focus.k === i) || (focus.c === l + 1 && focus.k === j);
          var alpha = RR.clamp(0.18 + aw * 0.38, 0.18, 0.9) * (on ? 1 : 0.18);
          ctx.strokeStyle = 'rgba(' + (wv >= 0 ? C_B : C_A) + ',' + alpha.toFixed(3) + ')';
          ctx.lineWidth = RR.clamp(0.5 + aw * 1.4, 0.5, 4.5);
          ctx.beginPath(); ctx.moveTo(x1, A.ys[i]); ctx.bezierCurveTo(mx, A.ys[i], mx, B.ys[j], x2, B.ys[j]); ctx.stroke();
        }
      }
    }
    // neurônios com a miniatura do que cada um "enxerga"
    for (c = 0; c < g.cols.length; c++) {
      var P = g.pos[c];
      for (k = 0; k < g.cols[c]; k++) {
        var x = P.x - half, y = P.ys[k] - half, isF = focus && focus.c === c && focus.k === k;
        ctx.save();
        ctx.beginPath(); rrect(ctx, x, y, S, S, 7); ctx.clip();
        ctx.imageSmoothingEnabled = true;
        if (thumbs[c] && thumbs[c][k]) ctx.drawImage(thumbs[c][k], x, y, S, S);
        ctx.restore();
        ctx.beginPath(); rrect(ctx, x + 0.5, y + 0.5, S - 1, S - 1, 7);
        ctx.lineWidth = isF ? 2 : 1;
        ctx.strokeStyle = isF ? '#9ef5cf' : c === g.cols.length - 1 ? 'rgba(238,241,251,0.5)' : 'rgba(255,255,255,0.18)';
        ctx.stroke();
      }
    }
    // rótulos x₁, x₂ e ŷ
    ctx.font = '500 ' + (S < 28 ? 11 : 12) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = '#c3c9de'; ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText('x₁', g.pos[0].x - half - 6, g.pos[0].ys[0]);
    ctx.fillText('x₂', g.pos[0].x - half - 6, g.pos[0].ys[1]);
    ctx.textAlign = 'left';
    var out = g.pos[g.pos.length - 1];
    ctx.fillText('ŷ', out.x + half + 6, out.ys[0]);
  }

  /* cabeçalhos HTML sobre as colunas (contagem + botões −/+) */
  function buildColHeads() {
    if (!ui.colheads) return;
    ui.colheads.textContent = '';
    ui.colEls = [];
    var cols = [2].concat(state.layers, [1]);
    cols.forEach(function (m, c) {
      var el;
      if (c === 0) el = h('div', { class: 'pg__colhead pg__colhead--io mono' }, [h('span', { text: 'entrada' })]);
      else if (c === cols.length - 1) el = h('div', { class: 'pg__colhead pg__colhead--io mono' }, [h('span', { text: 'saída' })]);
      else {
        var li = c - 1;
        var minus = iconBtn('pg__pm pg__pm--sm', ICON.minus, 'Remover neurônio da camada ' + c, function () { changeNeurons(li, -1); });
        var plus = iconBtn('pg__pm pg__pm--sm', ICON.plus, 'Adicionar neurônio à camada ' + c, function () { changeNeurons(li, 1); });
        minus.disabled = m <= 1; plus.disabled = m >= MAX_NEURONS;
        el = h('div', { class: 'pg__colhead' }, [
          h('span', { class: 'pg__colcount mono' }, [h('b', { text: m }), h('span', { class: 'pg__colunit', text: m > 1 ? ' neurônios' : ' neurônio' })]),
          h('span', { class: 'pg__colbtns' }, [minus, plus])
        ]);
      }
      ui.colheads.appendChild(el);
      ui.colEls.push(el);
    });
    positionColHeads();
  }
  function positionColHeads() {
    if (!ui.colEls || !sizes.netW) return;
    var g = netGeom(sizes.netW);
    ui.colheads.classList.toggle('is-tight', g.gap < 92);
    ui.colEls.forEach(function (el, c) { el.style.left = g.pos[c].x + 'px'; });
  }

  /* ---------- curva de perda ---------- */
  function drawLoss() {
    var ctx = lossCtx, w = sizes.lossW, hh = sizes.lossH;
    ctx.clearRect(0, 0, w, hh);
    var padL = 38, padR = 10, padT = 10, padB = 20, pw = w - padL - padR, ph = hh - padT - padB;
    var n = hist.e.length, i, maxV = 0.1;
    for (i = 0; i < n; i++) { if (hist.tr[i] > maxV) maxV = hist.tr[i]; if (hist.te[i] > maxV) maxV = hist.te[i]; }
    var yMax = Math.min(Math.ceil(maxV * 10 + 0.0001) / 10, 4);
    var eMax = Math.max(10, n ? hist.e[n - 1] : 0);
    function X(e) { return padL + (e / eMax) * pw; }
    function Y(v) { return padT + ph - Math.min(v, yMax) / yMax * ph; }
    ctx.font = '400 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (i = 0; i <= 2; i++) {
      var v = yMax * i / 2, yy = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = i ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)';
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = '#8e95b2'; ctx.fillText(fx(v, yMax < 1 ? 2 : 1), padL - 6, yy);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText('0', padL, hh - 5);
    ctx.textAlign = 'right'; ctx.fillText(RR.fmt(eMax, 0), w - padR, hh - 5);
    if (n < 1) return;
    // teste (tracejado, rosa) por baixo; treino (menta, com área) por cima
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (i = 0; i < n; i++) i ? ctx.lineTo(X(hist.e[i]), Y(hist.te[i])) : ctx.moveTo(X(hist.e[i]), Y(hist.te[i]));
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ff6fae'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();
    for (i = 0; i < n; i++) i ? ctx.lineTo(X(hist.e[i]), Y(hist.tr[i])) : ctx.moveTo(X(hist.e[i]), Y(hist.tr[i]));
    ctx.strokeStyle = '#9ef5cf'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.lineTo(X(hist.e[n - 1]), Y(0)); ctx.lineTo(X(hist.e[0]), Y(0)); ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
    grad.addColorStop(0, 'rgba(158,245,207,0.20)'); grad.addColorStop(1, 'rgba(158,245,207,0)');
    ctx.fillStyle = grad; ctx.fill();
    // marcador no fim da curva de treino
    var ex = X(hist.e[n - 1]), ey = Y(hist.tr[n - 1]);
    ctx.beginPath(); ctx.arc(ex, ey, 3, 0, 6.2832); ctx.fillStyle = '#9ef5cf'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 6, 0, 6.2832); ctx.fillStyle = 'rgba(158,245,207,0.18)'; ctx.fill();
  }

  /* ---------- interação: gráfico ---------- */
  function bindPlot() {
    var cv = ui.plotCanvas, down = null, readRaf = 0, lastEv = null;
    function domainAt(ev) {
      var r = cv.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
      return { x: (x * 2 - 1) * DOMAIN, y: (1 - y * 2) * DOMAIN, rx: x, ry: y };
    }
    cv.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      down = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    cv.addEventListener('pointerup', function (ev) {
      if (!down || down.id !== ev.pointerId) return;
      var moved = Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y);
      var dt = performance.now() - down.t;
      down = null;
      if (moved > 8 || dt > 700) return;
      var p = domainAt(ev);
      if (Math.abs(p.x) > DOMAIN || Math.abs(p.y) > DOMAIN) return;
      userActed = true;
      addPoint(p.x, p.y);
      ripple(p.rx, p.ry);
    });
    cv.addEventListener('pointercancel', function () { down = null; });
    cv.addEventListener('pointermove', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      lastEv = ev;
      if (readRaf) return;
      readRaf = requestAnimationFrame(function () {
        readRaf = 0;
        if (!lastEv || !net) return;
        var p = domainAt(lastEv), pr = net.predict(p.x, p.y);
        ui.chipRead.hidden = false;
        ui.chipRead.textContent = 'x₁ ' + fx(p.x, 1) + ' · x₂ ' + fx(p.y, 1) + ' · p(B) ' + fx(pr, 2);
      });
    });
    cv.addEventListener('pointerleave', function () { lastEv = null; ui.chipRead.hidden = true; });
  }
  function ripple(rx, ry) {
    if (RR.reducedMotion) return;
    var el = h('span', { class: 'pg__ripple pg__ripple--' + (state.addClass ? 'b' : 'a'), 'aria-hidden': 'true', style: { left: (rx * 100) + '%', top: (ry * 100) + '%' } });
    ui.plotWrap.appendChild(el);
    var kill = function () { el.remove(); };
    el.addEventListener('animationend', kill);
    setTimeout(kill, 900);
  }

  /* ---------- interação: diagrama (destacar neurônio) ---------- */
  function setFocus(f) {
    var same = (!f && !focus) || (f && focus && f.c === focus.c && f.k === focus.k);
    if (same) return;
    focus = f;
    if (ui.chipFocus) {
      ui.chipFocus.hidden = !f;
      if (f) {
        var last = state.layers.length + 1;
        ui.chipFocus.textContent = f.c === 0 ? 'entrada x' + (f.k ? '₂' : '₁') : f.c === last ? 'saída ŷ' : 'camada ' + f.c + ' · neurônio ' + (f.k + 1);
      }
    }
    if (ui.plotWrap) ui.plotWrap.classList.toggle('is-focus', !!f);
    dirty.plot = dirty.net = true;
    requestRender();
  }
  function bindNet() {
    var cv = ui.netCanvas;
    function hit(ev) {
      if (!sizes.netW || !net) return null;
      var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      var g = netGeom(sizes.netW), half = g.S / 2 + 3;
      for (var c = 0; c < g.pos.length; c++) {
        if (Math.abs(x - g.pos[c].x) > half) continue;
        for (var k = 0; k < g.pos[c].ys.length; k++) if (Math.abs(y - g.pos[c].ys[k]) <= half) return { c: c, k: k };
      }
      return null;
    }
    cv.addEventListener('pointermove', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      var f = hit(ev);
      cv.style.cursor = f ? 'pointer' : '';
      setFocus(f);
    });
    cv.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse') setFocus(null); });
    cv.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType === 'mouse') return;
      var f = hit(ev);
      if (f && focus && f.c === focus.c && f.k === focus.k) f = null; // toque de novo desfaz
      setFocus(f);
    });
  }

  /* ---------- miniaturas dos datasets ---------- */
  function drawDatasetIcons() {
    DATASETS.forEach(function (d) {
      var cv = ui.dsBtns[d.id]._icon, ctx = RR.setupCanvas(cv, 40, 40, 2);
      var data = genDataset(d.id, 160, d.id === 'gauss' ? 0 : 0.02, 3);
      ctx.fillStyle = '#0b0e1a'; ctx.fillRect(0, 0, 40, 40);
      for (var c = 0; c < 2; c++) {
        ctx.beginPath();
        for (var i = 0; i < data.n; i++) {
          if (data.Y[i] !== c) continue;
          var x = (data.X[2 * i] + DOMAIN) / (2 * DOMAIN) * 40, y = 40 - (data.X[2 * i + 1] + DOMAIN) / (2 * DOMAIN) * 40;
          ctx.moveTo(x + 1.1, y); ctx.arc(x, y, 1.1, 0, 6.2832);
        }
        ctx.fillStyle = c ? CSS_B : CSS_A; ctx.fill();
      }
    });
  }

  /* ---------- montagem ---------- */
  function init() {
    if (inited) return;
    inited = true;
    drawDatasetIcons();
    layout();
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () { layout(); invalidate(false); });
      [ui.plotWrap, ui.netWrap, ui.lossWrap].forEach(function (el) { ro.observe(el); });
    } else {
      window.addEventListener('resize', RR.debounce(function () { layout(); invalidate(false); }, 120));
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { dirty.net = dirty.loss = true; invalidate(false); });
    invalidate(true);
    syncLoop();
  }

  RR.ready(function () {
    root = document.getElementById('playground-root');
    if (!root) return;
    regenData();
    build();
    resetNet();
    updateDatasetUI(); updateCustomUI(); updateHud();
    layout();   // dimensiona os canvas já no carregamento: sem salto de layout quando o módulo inicia

    RR.whenVisible(root, function () { visible = true; syncLoop(); }, function () { visible = false; syncLoop(); });
    RR.onFirstVisible(root, init);
    // auto-play uma única vez, quando o gráfico estiver de fato na tela
    RR.onFirstVisible(ui.plotWrap, function () {
      if (!RR.reducedMotion && !userActed && !state.playing) { autoRun = true; play(); }
    }, { rootMargin: '0px', threshold: 0.35 });
    document.addEventListener('visibilitychange', syncLoop);
    RR.on('playground:dataset', function (id) { setDataset(id, true); });
  });
})();
