/* =========================================================================
   optimizers.js — "Corrida de otimizadores" (#optimizers-root)
   SGD, Momentum, RMSProp e Adam descem a mesma superfície de perda 2D,
   com gradientes analíticos. O mapa de calor (escala log + curvas de nível
   antisserrilhadas) é calculado em fatias e guardado em canvas offscreen.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  var root = document.getElementById('optimizers-root');
  if (!RR || !root) return;

  /* ---------- superfícies de perda (todas com mínimo global f = 0) ---------- */
  var SURFACES = [
    {
      id: 'rosenbrock', label: 'Rosenbrock', name: 'Vale de Rosenbrock',
      formula: 'f(x, y) = [(1 − x)² + 100·(y − x²)²] / 20',
      desc: 'Um vale estreito e curvo. Achar o vale é fácil; percorrê-lo até o mínimo em (1, 1) é que separa os otimizadores.',
      center: [0, 1], half: [2.15, 1.65], start: [-1.4, 2.2],
      lr: 0.025, maxSteps: 2000, pace: 165, target: 1e-5, delta: 2e-3,
      marks: [{ x: 1, y: 1, kind: 'min' }],
      f: function (x, y) { var a = 1 - x, b = y - x * x; return (a * a + 100 * b * b) / 20; },
      g: function (x, y, o) { var b = y - x * x; o[0] = (-2 * (1 - x) - 400 * x * b) / 20; o[1] = 10 * b; }
    },
    {
      id: 'himmelblau', label: 'Himmelblau', name: 'Himmelblau (4 mínimos)',
      formula: 'f(x, y) = [(x² + y − 11)² + (x + y² − 7)²] / 40',
      desc: 'Quatro mínimos igualmente bons. Partindo perto do pico, cada otimizador pode escolher um vale diferente.',
      center: [0, 0], half: [4.7, 4.7], start: [-0.3, -0.9],
      lr: 0.02, maxSteps: 1200, pace: 55, target: 1e-4, delta: 2e-2,
      marks: [
        { x: 3, y: 2, kind: 'min' }, { x: -2.805, y: 3.131, kind: 'min' },
        { x: -3.779, y: -3.283, kind: 'min' }, { x: 3.584, y: -1.848, kind: 'min' }
      ],
      f: function (x, y) { var a = x * x + y - 11, b = x + y * y - 7; return (a * a + b * b) / 40; },
      g: function (x, y, o) { var a = x * x + y - 11, b = x + y * y - 7; o[0] = (4 * x * a + 2 * b) / 40; o[1] = (2 * a + 4 * y * b) / 40; }
    },
    {
      id: 'sela', label: 'Sela', name: 'Ponto de sela',
      formula: 'f(x, y) = x²/2 + (y² − 1)²/4',
      desc: 'Largando sobre a crista, o gradiente em y é quase zero: o SGD se arrasta até a sela e é o último a escapar, enquanto o Momentum, que acumula velocidade, escapa primeiro para um dos vales.',
      center: [0, 0], half: [2.9, 1.75], start: [-2.6, 0.001],
      lr: 0.01, maxSteps: 1500, pace: 90, target: 1e-4, delta: 1e-2,
      marks: [{ x: 0, y: 1, kind: 'min' }, { x: 0, y: -1, kind: 'min' }, { x: 0, y: 0, kind: 'saddle' }],
      f: function (x, y) { var b = y * y - 1; return x * x / 2 + b * b / 4; },
      g: function (x, y, o) { o[0] = x; o[1] = y * y * y - y; }
    }
  ];

  /* ---------- otimizadores ---------- */
  var OPTS = [
    { id: 'sgd', name: 'SGD', rule: 'θ ← θ − η·g', token: 'sun', draw: '#ffb38a' },
    { id: 'momentum', name: 'Momentum', rule: 'v ← 0,9v + g ; θ ← θ − η·v', token: 'pink', draw: '#ff7db6' },
    { id: 'rmsprop', name: 'RMSProp', rule: 'θ ← θ − η·g / √E[g²]', token: 'blue', draw: '#86a6ff' },
    { id: 'adam', name: 'Adam', rule: 'θ ← θ − η·m̂ / (√v̂ + ε)', token: 'mint', draw: '#9ef5cf' }
  ];
  var MU = 0.9, RHO = 0.99, B1 = 0.9, B2 = 0.999, EPS = 1e-8;
  var SPEEDS = [{ v: 0.5, label: '½×', aria: 'meia velocidade' }, { v: 1, label: '1×', aria: 'velocidade normal' }, { v: 2, label: '2×', aria: 'velocidade dobrada' }, { v: 4, label: '4×', aria: 'velocidade quádrupla' }];
  var LR_MIN = -3, LR_MAX = -0.5; // log10 do η

  var G = [0, 0];

  function makeRunner(o) {
    return { o: o, x: 0, y: 0, vx: 0, vy: 0, sx: 0, sy: 0, mx: 0, my: 0, ax: 0, ay: 0,
      t: 0, loss: 0, status: 'run', path: new Float32Array(2), n: 0, place: 0 };
  }

  function resetRunner(r, S, sx, sy) {
    var need = (S.maxSteps + 2) * 2;
    if (r.path.length < need) r.path = new Float32Array(need);
    r.x = sx; r.y = sy;
    r.vx = r.vy = r.sx = r.sy = r.mx = r.my = r.ax = r.ay = 0;
    r.t = 0; r.status = 'run'; r.place = 0;
    r.loss = S.f(sx, sy);
    r.path[0] = sx; r.path[1] = sy; r.n = 1;
  }

  /* Um passo de otimização. Devolve true se o corredor terminou agora. */
  function stepRunner(r, S, lr) {
    if (r.status !== 'run') return false;
    var f = S.f(r.x, r.y);
    r.loss = f;
    if (f < S.target) { r.status = 'conv'; return true; }
    if (r.t >= S.maxSteps) { r.status = 'max'; return true; }
    S.g(r.x, r.y, G);
    var gx = G[0], gy = G[1], k;
    switch (r.o.id) {
      case 'sgd':
        r.x -= lr * gx; r.y -= lr * gy;
        break;
      case 'momentum': // heavy-ball: v ← μv + g ; θ ← θ − ηv
        r.vx = MU * r.vx + gx; r.vy = MU * r.vy + gy;
        r.x -= lr * r.vx; r.y -= lr * r.vy;
        break;
      case 'rmsprop': // média móvel de g² por coordenada
        r.sx = RHO * r.sx + (1 - RHO) * gx * gx; r.sy = RHO * r.sy + (1 - RHO) * gy * gy;
        r.x -= lr * gx / (Math.sqrt(r.sx) + EPS); r.y -= lr * gy / (Math.sqrt(r.sy) + EPS);
        break;
      default: // Adam, com correção de viés
        k = r.t + 1;
        r.mx = B1 * r.mx + (1 - B1) * gx; r.my = B1 * r.my + (1 - B1) * gy;
        r.ax = B2 * r.ax + (1 - B2) * gx * gx; r.ay = B2 * r.ay + (1 - B2) * gy * gy;
        var c1 = 1 - Math.pow(B1, k), c2 = 1 - Math.pow(B2, k);
        r.x -= lr * (r.mx / c1) / (Math.sqrt(r.ax / c2) + EPS);
        r.y -= lr * (r.my / c1) / (Math.sqrt(r.ay / c2) + EPS);
    }
    r.t++;
    var far = !isFinite(r.x) || !isFinite(r.y) ||
      Math.abs(r.x - S.center[0]) > S.half[0] * 6 || Math.abs(r.y - S.center[1]) > S.half[1] * 6;
    if (far) {
      // guarda um último ponto (limitado) para a trilha "sair" do mapa
      var lx = isFinite(r.x) ? RR.clamp(r.x, S.center[0] - S.half[0] * 6, S.center[0] + S.half[0] * 6) : r.path[r.n * 2 - 2];
      var ly = isFinite(r.y) ? RR.clamp(r.y, S.center[1] - S.half[1] * 6, S.center[1] + S.half[1] * 6) : r.path[r.n * 2 - 1];
      r.path[r.n * 2] = lx; r.path[r.n * 2 + 1] = ly; r.n++;
      r.status = 'div'; r.loss = Infinity;
      return true;
    }
    r.path[r.n * 2] = r.x; r.path[r.n * 2 + 1] = r.y; r.n++;
    r.loss = S.f(r.x, r.y);
    return false;
  }

  /* ---------- mapa de cores perceptualmente suave (interpolação em OKLab) ---------- */
  function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linToSrgb(c) { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return RR.clamp(Math.round(c * 255), 0, 255); }
  function toOklab(hex) {
    var c = RR.hexToRgb(hex), r = srgbToLin(c[0]), g = srgbToLin(c[1]), b = srgbToLin(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromOklab(L) {
    var l = Math.pow(L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], 3);
    var m = Math.pow(L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], 3);
    var s = Math.pow(L[0] - 0.0894841775 * L[1] - 1.291485548 * L[2], 3);
    return [linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  // escuro → azul → menta → sol (contidos, para as trilhas brilharem por cima)
  var STOPS = [[0, '#04060c'], [0.22, '#0a1430'], [0.45, '#162b6c'], [0.64, '#1a5672'], [0.8, '#2c8676'], [0.93, '#9c9a6c'], [1, '#c98a6c']];
  var LUT = (function () {
    var lut = new Uint8ClampedArray(256 * 3), labs = STOPS.map(function (s) { return toOklab(s[1]); });
    for (var i = 0; i < 256; i++) {
      var t = i / 255, j = 0;
      while (j < STOPS.length - 2 && t > STOPS[j + 1][0]) j++;
      var u = (t - STOPS[j][0]) / (STOPS[j + 1][0] - STOPS[j][0]);
      var a = labs[j], b = labs[j + 1];
      var rgb = fromOklab([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
      lut[i * 3] = rgb[0]; lut[i * 3 + 1] = rgb[1]; lut[i * 3 + 2] = rgb[2];
    }
    return lut;
  })();
  function lutCss(t) { var i = Math.round(RR.clamp(t, 0, 1) * 255) * 3; return 'rgb(' + LUT[i] + ',' + LUT[i + 1] + ',' + LUT[i + 2] + ')'; }

  /* ---------- geometria: domínio que "contém" a região de interesse ---------- */
  function fitDomain(S, W, H) {
    var s = Math.max((2 * S.half[0]) / W, (2 * S.half[1]) / H);
    return { s: s, x0: S.center[0] - (W * s) / 2, y1: S.center[1] + (H * s) / 2, W: W, H: H };
  }

  /* ---------- campo pré-calculado em fatias (≈ 9 ms por quadro) ---------- */
  var LEVELS = 15;
  function FieldJob(S, W, H, dpr) {
    var w = Math.max(1, Math.round(W * dpr)), h = Math.max(1, Math.round(H * dpr));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var cx = cv.getContext('2d');
    var img = cx.createImageData(w, h), d = img.data;
    var dom = fitDomain(S, W, H), sd = dom.s / dpr; // unidades do domínio por pixel físico
    var delta = S.delta;

    // faixa do log(f) por amostragem grossa (percentis robustos)
    var samples = [], gx, gy;
    for (gy = 0; gy < 72; gy++) {
      for (gx = 0; gx < 108; gx++) {
        samples.push(Math.log(S.f(dom.x0 + ((gx + 0.5) / 108) * W * dom.s, dom.y1 - ((gy + 0.5) / 72) * H * dom.s) + delta));
      }
    }
    samples.sort(function (a, b) { return a - b; });
    var lo = Math.log(delta), hi = samples[Math.floor(samples.length * 0.97)];
    var invR = 1 / Math.max(1e-6, hi - lo);
    var lw = 0.85 * dpr; // meia-largura da curva de nível em px físicos
    var gr = [0, 0];

    var job = { canvas: cv, done: false, row: 0, dom: dom, key: '' };
    job.step = function (budget) {
      var t0 = performance.now(), y0 = job.row;
      while (job.row < h) {
        var py = job.row, yy = dom.y1 - (py + 0.5) * sd, p = py * w * 4;
        for (var px = 0; px < w; px++, p += 4) {
          var xx = dom.x0 + (px + 0.5) * sd;
          var f = S.f(xx, yy);
          S.g(xx, yy, gr);
          var fd = f + delta;
          var t = (Math.log(fd) - lo) * invR;
          var tc = t < 0 ? 0 : t > 1 ? 1 : t;
          var li = ((tc * 255) | 0) * 3;
          // curvas de nível: distância (em px) até o nível mais próximo de t·LEVELS
          var v = t * LEVELS, fr = v - Math.floor(v), near = fr < 0.5 ? fr : 1 - fr;
          var gpx = LEVELS * invR * (Math.sqrt(gr[0] * gr[0] + gr[1] * gr[1]) / fd) * sd + 1e-12;
          var dist = near / gpx, a = 1 - dist / lw;
          var spacing = 1 / gpx;
          if (a > 0) {
            a *= spacing < 3 ? 0 : spacing < 7 ? (spacing - 3) / 4 : 1; // some onde as linhas se acumulam
            if (Math.round(v) % 5 === 0) a *= 1.8;
            a *= 0.2;
          } else a = 0;
          // leve sombreamento em faixas (hipsometria)
          var shade = 0.9 + 0.1 * fr;
          d[p] = LUT[li] * shade + (255 - LUT[li] * shade) * a;
          d[p + 1] = LUT[li + 1] * shade + (255 - LUT[li + 1] * shade) * a;
          d[p + 2] = LUT[li + 2] * shade + (255 - LUT[li + 2] * shade) * a;
          d[p + 3] = 255;
        }
        job.row++;
        if (performance.now() - t0 > budget) break;
      }
      cx.putImageData(img, 0, 0, 0, y0, w, job.row - y0);
      if (job.row >= h) { decorate(); job.done = true; }
    };

    // vinheta + grade de eixos + marcadores de mínimos (estáticos, entram no cache)
    function decorate() {
      cx.save();
      cx.scale(dpr, dpr);
      var vg = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(5,7,12,0)');
      vg.addColorStop(1, 'rgba(5,7,12,0.55)');
      cx.fillStyle = vg; cx.fillRect(0, 0, W, H);

      // grade nos inteiros + rótulos
      var stepU = dom.s * W > 9 ? 2 : 1;
      cx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
      cx.textBaseline = 'top';
      cx.lineWidth = 1;
      var x, y, v;
      for (v = Math.ceil(dom.x0 / stepU) * stepU; v <= dom.x0 + W * dom.s; v += stepU) {
        x = Math.round((v - dom.x0) / dom.s) + 0.5;
        cx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)';
        cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, H); cx.stroke();
        if (x > 18 && x < W - 18) { cx.fillStyle = 'rgba(238,241,251,0.42)'; cx.textAlign = 'center'; cx.fillText(fmtTick(v), x, H - 15); }
      }
      cx.textBaseline = 'middle';
      for (v = Math.ceil((dom.y1 - H * dom.s) / stepU) * stepU; v <= dom.y1; v += stepU) {
        y = Math.round((dom.y1 - v) / dom.s) + 0.5;
        cx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)';
        cx.beginPath(); cx.moveTo(0, y); cx.lineTo(W, y); cx.stroke();
        if (y > 40 && y < H - 30) { cx.fillStyle = 'rgba(238,241,251,0.42)'; cx.textAlign = 'left'; cx.fillText(fmtTick(v), 7, y); }
      }

      S.marks.forEach(function (m) {
        var mx = (m.x - dom.x0) / dom.s, my = (dom.y1 - m.y) / dom.s;
        cx.strokeStyle = 'rgba(238,241,251,0.8)';
        cx.fillStyle = 'rgba(238,241,251,0.62)';
        cx.lineWidth = 1.4;
        cx.beginPath();
        if (m.kind === 'min') {
          cx.moveTo(mx - 4, my - 4); cx.lineTo(mx + 4, my + 4); cx.moveTo(mx + 4, my - 4); cx.lineTo(mx - 4, my + 4);
        } else if (m.kind === 'saddle') {
          cx.moveTo(mx, my - 5); cx.lineTo(mx + 5, my); cx.lineTo(mx, my + 5); cx.lineTo(mx - 5, my); cx.closePath();
        } else {
          cx.arc(mx, my, 4, 0, Math.PI * 2);
        }
        cx.stroke();
        cx.textAlign = 'left'; cx.textBaseline = 'middle';
        cx.fillText(m.kind === 'min' ? 'mín.' : m.kind === 'saddle' ? 'sela' : 'pico', mx + 8, my + 0.5);
      });
      cx.restore();
    }
    return job;
  }

  function fmtTick(v) { return (v < 0 ? '−' : '') + Math.abs(Math.round(v * 10) / 10).toString().replace('.', ','); }

  /* formatação da perda: decimal pt-BR ou notação científica com sobrescritos */
  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  function fmtLoss(v) {
    if (!isFinite(v)) return '∞';
    if (v === 0) return '0';
    if (v >= 1000) return RR.fmt(v, 0);
    if (v >= 0.001) return fixed(v, v >= 10 ? 2 : 4);
    var parts = v.toExponential(2).split('e'), m = +parts[0], e = +parts[1];
    return RR.fmt(m, 2) + '·10' + String(e).split('').map(function (c) { return SUP[c] || c; }).join('');
  }
  function fixed(v, d) { return v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtCoord(v) { return (v < 0 ? '−' : '') + RR.fmt(Math.abs(v), 2); }
  function fmtLr(v) { return RR.fmt(v, v < 0.01 ? 4 : 3); }

  /* ---------- ícones ---------- */
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect fill="currentColor" x="6.5" y="5" width="4" height="14" rx="1.2"/><rect fill="currentColor" x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v4.5H8"/></svg>';

  /* =========================================================================
     Montagem: o DOM (leve) é criado já, para não deslocar o layout depois;
     o tamanho vem do ResizeObserver e o trabalho pesado (campo + corrida)
     só roda com o módulo visível.
     ========================================================================= */
  init();

  function init() {
    var el = RR.el;
    var state = {
      S: SURFACES[0], lr: SURFACES[0].lr, speed: 1, running: false, finished: false,
      starts: {}, lrs: {}, acc: 0, conv: 0, hover: null, kbd: null, focused: false, emph: null,
      W: 0, H: 0, dpr: 1, dom: null, field: null, job: null, dirty: true, visible: false, time: 0, announced: false,
      userActed: false   // só anuncia o resultado para leitores de tela se o visitante interagiu
    };
    root.addEventListener('pointerdown', function () { state.userActed = true; }, true);
    root.addEventListener('keydown', function () { state.userActed = true; }, true);
    var runners = OPTS.map(makeRunner);
    var cache = {};

    /* ----- DOM ----- */
    var statusText = el('span', { class: 'opt__status-text', text: 'pronto' });
    var stepText = el('span', { class: 'opt__steps', text: 'passo 0' });
    var statusDot = el('span', { class: 'opt__status-dot', 'aria-hidden': 'true' });
    var bar = el('div', { class: 'opt__bar mono' }, [
      el('span', { class: 'opt__path' }, [
        el('span', { class: 'opt__logo', 'aria-hidden': 'true' }),
        el('span', { text: 'lab' }), el('span', { class: 'opt__sep', 'aria-hidden': 'true', text: '/' }),
        el('span', { class: 'opt__file', text: 'corrida_de_otimizadores.py' })
      ]),
      el('span', { class: 'opt__status' }, [statusDot, statusText, el('span', { class: 'opt__sep', 'aria-hidden': 'true', text: '·' }), stepText])
    ]);

    var surfBtns = SURFACES.map(function (S) {
      return el('button', { type: 'button', 'aria-pressed': S === state.S ? 'true' : 'false', title: S.name, onclick: function () { setSurface(S); } }, S.label);
    });
    var surfGroup = el('div', { class: 'segmented opt__surfaces', role: 'group', 'aria-label': 'Superfície de perda' }, surfBtns);
    var surfName = el('span', { class: 'opt__surf-name' });
    var toolbar = el('div', { class: 'opt__toolbar' }, [surfGroup, surfName]);

    var canvas = el('canvas', {
      class: 'opt__canvas', tabindex: '0', role: 'application',
      'aria-roledescription': 'mapa interativo',
      'aria-describedby': 'opt-kbd-help'
    });
    var formula = el('span', { class: 'opt__hud opt__hud--formula mono' });
    var cbar = el('span', { class: 'opt__colorbar', 'aria-hidden': 'true' });
    var colorbar = el('span', { class: 'opt__hud opt__hud--colorbar mono', 'aria-hidden': 'true' }, [
      el('span', { text: 'loss' }), cbar, el('span', { class: 'opt__cb-tip', text: 'escala log' })
    ]);
    var kbdHint = el('span', { class: 'opt__hud opt__hud--kbd mono', id: 'opt-kbd-help' }, [
      el('kbd', { 'aria-hidden': 'true', text: '←↑↓→' }), el('span', { class: 'sr-only', text: 'Setas' }), ' movem a largada · ',
      el('kbd', { text: 'Enter' }), ' larga'
    ]);
    var stage = el('div', { class: 'opt__stage' }, [canvas, formula, colorbar, kbdHint]);
    var desc = el('p', { class: 'opt__desc' });
    var meta = el('p', { class: 'opt__meta mono' });
    var main = el('div', { class: 'opt__main' }, [toolbar, stage, desc, meta]);

    // legenda / classificação
    var rows = runners.map(function (r) {
      var lossEl = el('span', { class: 'opt__loss mono', text: '—' });
      var stepsEl = el('span', { class: 'opt__rsteps mono', text: '0 passos' });
      var badge = el('span', { class: 'opt__badge mono' });
      var li = el('li', { class: 'opt__row' }, [
        el('span', { class: 'opt__swatch', 'aria-hidden': 'true' }),
        el('span', { class: 'opt__who' }, [
          el('span', { class: 'opt__name', text: r.o.name }),
          el('span', { class: 'opt__rule mono', text: r.o.rule })
        ]),
        el('span', { class: 'opt__nums' }, [lossEl, stepsEl]),
        badge
      ]);
      li.style.setProperty('--c', 'var(--' + r.o.token + ')');
      li.addEventListener('pointerenter', function () { state.emph = r; state.dirty = true; kick(); });
      li.addEventListener('pointerleave', function () { if (state.emph === r) { state.emph = null; state.dirty = true; kick(); } });
      r.ui = { li: li, loss: lossEl, steps: stepsEl, badge: badge, last: '' };
      return li;
    });
    var legend = el('ol', { class: 'opt__legend', 'aria-label': 'Classificação dos otimizadores' }, rows);

    var playBtn = el('button', { type: 'button', class: 'btn btn--primary btn--sm opt__play', onclick: togglePlay });
    var resetBtn = el('button', { type: 'button', class: 'btn btn--ghost btn--sm', html: ICON_RESET + '<span>Reiniciar</span>', onclick: function () { restart(true); } });

    var lrVal = el('span', { class: 'field__value' });
    var lrInput = el('input', { type: 'range', id: 'opt-lr', min: '0', max: '1000', step: '1', 'aria-describedby': 'opt-lr-note' });
    lrInput.addEventListener('input', function () {
      state.lr = Math.pow(10, LR_MIN + (lrInput.value / 1000) * (LR_MAX - LR_MIN));
      state.lrs[state.S.id] = state.lr;
      syncLr(false);
      restartDebounced();
    });
    var lrField = el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'opt-lr' }, [el('span', null, ['Taxa de aprendizado ', el('span', { class: 'mono', text: '(η)' })]), lrVal]),
      lrInput,
      el('p', { class: 'opt__note', id: 'opt-lr-note', text: 'Escala log, mesmo η para os quatro. Alto demais, e o SGD diverge.' })
    ]);

    var speedBtns = SPEEDS.map(function (sp) {
      return el('button', { type: 'button', 'aria-pressed': sp.v === state.speed ? 'true' : 'false', 'aria-label': sp.aria, onclick: function () {
        state.speed = sp.v;
        speedBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', SPEEDS[i] === sp ? 'true' : 'false'); });
      } }, sp.label);
    });
    var speedField = el('div', { class: 'field' }, [
      el('span', { class: 'field__label', id: 'opt-speed-label' }, 'Velocidade'),
      el('div', { class: 'segmented opt__speeds', role: 'group', 'aria-labelledby': 'opt-speed-label' }, speedBtns)
    ]);

    var live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
    var side = el('div', { class: 'opt__side' }, [
      el('p', { class: 'opt__side-title mono', 'aria-hidden': 'true', text: 'classificação' }),
      legend,
      el('div', { class: 'opt__buttons' }, [playBtn, resetBtn]),
      lrField,
      speedField,
      el('p', { class: 'opt__tip' }, [
        el('span', { class: 'opt__tip-icon', 'aria-hidden': 'true', text: '⌖' }),
        el('span', { text: 'Clique ou toque no mapa para escolher outro ponto de largada.' })
      ]),
      live
    ]);

    var app = el('div', { class: 'opt' }, [bar, el('div', { class: 'opt__body' }, [main, side])]);
    root.appendChild(app);

    // gradiente da barra de cores a partir da própria LUT
    cbar.style.background = 'linear-gradient(90deg,' + [0, 0.2, 0.4, 0.6, 0.8, 1].map(function (t) { return lutCss(t) + ' ' + t * 100 + '%'; }).join(',') + ')';

    var ctx = null;
    var glows = {};

    /* ----- tamanho / campo ----- */
    function resize() {
      var W = Math.round(stage.clientWidth);
      if (!W) return;
      var H = Math.round(RR.clamp(W * (W < 560 ? 0.95 : 0.68), 280, 560));
      var dpr = RR.dpr(2);
      if (W === state.W && H === state.H && dpr === state.dpr && ctx) return;
      state.W = W; state.H = H; state.dpr = dpr;
      ctx = RR.setupCanvas(canvas, W, H, 2);
      glows = {};
      loadField();
    }

    function loadField() {
      var S = state.S, key = S.id + ':' + state.W + 'x' + state.H + '@' + state.dpr;
      state.dom = fitDomain(S, state.W, state.H);
      if (cache[key]) { state.field = cache[key]; state.job = cache[key].done ? null : cache[key]; } // retoma cálculo interrompido
      else {
        var job = FieldJob(S, state.W, state.H, state.dpr);
        job.key = key;
        state.job = job;
        state.field = job;
        cache[key] = job;
        var keys = Object.keys(cache);
        if (keys.length > 6) delete cache[keys[0]];
      }
      state.dirty = true;
      kick();
    }

    function glowSprite(col) {
      if (glows[col]) return glows[col];
      var R = 22, dpr = state.dpr, c = document.createElement('canvas');
      c.width = c.height = Math.ceil(R * 2 * dpr);
      var g = c.getContext('2d'), rgb = RR.hexToRgb(col);
      g.scale(dpr, dpr);
      var rg = g.createRadialGradient(R, R, 0, R, R, R);
      rg.addColorStop(0, 'rgba(' + rgb + ',0.75)');
      rg.addColorStop(0.25, 'rgba(' + rgb + ',0.28)');
      rg.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = rg; g.fillRect(0, 0, R * 2, R * 2);
      glows[col] = c;
      return c;
    }

    /* ----- corrida ----- */
    function startPoint() { return state.starts[state.S.id] || state.S.start; }

    function restart(play) {
      var p = startPoint();
      runners.forEach(function (r) { resetRunner(r, state.S, p[0], p[1]); });
      state.acc = 0; state.conv = 0; state.finished = false; state.announced = false;
      live.textContent = '';
      if (RR.reducedMotion) {
        // movimento reduzido: calcula a corrida inteira e mostra o resultado final
        var guard = 0;
        while (!state.finished && guard++ < 10000) advance(1);
        state.running = false;
      } else {
        state.running = play !== false;
      }
      state.dirty = true;
      syncUI(true);
      kick();
    }
    var restartDebounced = RR.debounce(function () { restart(true); }, 160);

    function advance(n) {
      var S = state.S, lr = state.lr;
      for (var k = 0; k < n; k++) {
        var alive = 0, before = state.conv;
        for (var i = 0; i < runners.length; i++) {
          var r = runners[i];
          if (r.status !== 'run') continue;
          stepRunner(r, S, lr);
          if (r.status === 'run') alive++;
          else if (r.status === 'conv') { r.place = before + 1; state.conv++; } // empate se chegam no mesmo passo
        }
        if (!alive) { finish(); break; }
      }
    }

    function finish() {
      state.finished = true; state.running = false;
      var conv = runners.filter(function (r) { return r.status === 'conv'; }).sort(function (a, b) { return a.place - b.place; });
      if (!state.announced) {
        state.announced = true;
        var msg;
        if (conv.length) msg = 'Corrida concluída: ' + conv[0].o.name + ' chegou primeiro, em ' + conv[0].t + ' passos.';
        else msg = 'Corrida concluída: nenhum otimizador atingiu a perda-alvo com esse η.';
        var div = runners.filter(function (r) { return r.status === 'div'; });
        if (div.length) msg += ' Divergiram: ' + div.map(function (r) { return r.o.name; }).join(', ') + '.';
        if (state.userActed) live.textContent = msg;
      }
    }

    function togglePlay() {
      if (state.finished) { restart(true); return; }
      if (RR.reducedMotion) { restart(false); return; }
      state.running = !state.running;
      syncUI(true);
      kick();
    }

    function setStart(x, y, play) {
      var d = state.dom;
      x = RR.clamp(x, d.x0, d.x0 + state.W * d.s);
      y = RR.clamp(y, d.y1 - state.H * d.s, d.y1);
      state.starts[state.S.id] = [x, y];
      syncMeta();
      restart(play);
    }

    function setSurface(S) {
      if (S === state.S) return;
      state.S = S;
      state.lr = state.lrs[S.id] || S.lr;
      state.kbd = null; state.hover = null;
      surfBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', SURFACES[i] === S ? 'true' : 'false'); });
      syncSurface();
      loadField();
      restart(true);
    }

    function syncSurface() {
      var S = state.S;
      surfName.textContent = S.name;
      formula.textContent = S.formula;
      desc.textContent = S.desc;
      syncMeta();
      canvas.setAttribute('aria-label', 'Mapa da superfície de perda “' + S.name + '”, com as trajetórias dos quatro otimizadores. Use as setas para mover o ponto de largada e Enter para largar.');
      syncLr(true);
    }

    function syncMeta() {
      var S = state.S, p = startPoint();
      meta.textContent = ['alvo: loss < ' + fmtLoss(S.target), 'limite: ' + RR.fmt(S.maxSteps, 0) + ' passos', 'largada (' + fmtCoord(p[0]) + '; ' + fmtCoord(p[1]) + ')']
        .map(function (t) { return t.replace(/ /g, '\u00a0'); }).join('  ·  ');
    }

    function syncLr(setInput) {
      var pct = (Math.log10(state.lr) - LR_MIN) / (LR_MAX - LR_MIN);
      if (setInput) lrInput.value = String(Math.round(pct * 1000));
      lrInput.style.setProperty('--pct', (pct * 100).toFixed(1) + '%');
      lrVal.textContent = fmtLr(state.lr);
      lrInput.setAttribute('aria-valuetext', 'η = ' + fmtLr(state.lr));
    }

    /* atualiza textos só quando mudam (evita trabalho de layout a cada quadro) */
    function setText(node, txt) { if (node.textContent !== txt) node.textContent = txt; }
    function syncUI(force) {
      var maxT = 0;
      runners.forEach(function (r) {
        if (r.t > maxT) maxT = r.t;
        setText(r.ui.loss, r.status === 'div' ? '∞' : fmtLoss(r.loss));
        setText(r.ui.steps, r.t === 1 ? '1 passo' : RR.fmt(r.t, 0) + ' passos');
        var key = r.status + r.place;
        if (force || key !== r.ui.last) {
          r.ui.last = key;
          var b = r.ui.badge, li = r.ui.li;
          li.classList.toggle('is-done', r.status === 'conv');
          li.classList.toggle('is-out', r.status === 'div' || r.status === 'max');
          if (r.status === 'conv') { b.textContent = '✓ ' + (r.place ? r.place + 'º' : ''); b.title = 'Atingiu a perda-alvo'; }
          else if (r.status === 'div') { b.textContent = '✕ divergiu'; b.title = 'O passo explodiu: η alto demais para esta região'; }
          else if (r.status === 'max') { b.textContent = '⏱ limite'; b.title = 'Atingiu o limite de passos sem chegar à perda-alvo'; }
          else { b.textContent = ''; b.title = ''; }
        }
      });
      setText(stepText, 'passo ' + RR.fmt(maxT, 0) + ' / ' + RR.fmt(state.S.maxSteps, 0));
      var st = state.finished ? 'concluído' : state.running ? 'correndo' : maxT ? 'pausado' : 'pronto';
      if (force || statusText.textContent !== st) {
        statusText.textContent = st;
        app.setAttribute('data-state', state.finished ? 'done' : state.running ? 'run' : 'idle');
        if (state.finished) playBtn.innerHTML = ICON_RESET + '<span>Repetir</span>';
        else if (state.running) playBtn.innerHTML = ICON_PAUSE + '<span>Pausar</span>';
        else playBtn.innerHTML = ICON_PLAY + '<span>' + (maxT ? 'Continuar' : 'Largar') + '</span>';
      }
    }

    /* ----- desenho ----- */
    function toPx(x, y) { var d = state.dom; return [(x - d.x0) / d.s, (d.y1 - y) / d.s]; }

    function draw() {
      if (!ctx) return;
      var W = state.W, H = state.H, f = state.field;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, W, H);
      if (f) ctx.drawImage(f.canvas, 0, 0, W, H);
      if (f && !f.done) {
        // linha de varredura enquanto o campo é calculado
        var sy = (f.row / f.canvas.height) * H;
        var gr = ctx.createLinearGradient(0, sy - 30, 0, sy);
        gr.addColorStop(0, 'rgba(158,245,207,0)');
        gr.addColorStop(1, 'rgba(158,245,207,0.22)');
        ctx.fillStyle = gr; ctx.fillRect(0, sy - 30, W, 30);
      }

      var p = startPoint(), sp = toPx(p[0], p[1]);
      for (var i = 0; i < runners.length; i++) drawTrail(runners[i]);
      drawStart(sp[0], sp[1]);
      for (i = 0; i < runners.length; i++) drawHead(runners[i]);
      drawPlaces();

      var cur = state.hover || (state.focused ? state.kbd : null);
      if (cur) drawCursor(cur);
    }

    function drawTrail(r) {
      var n = r.n;
      if (n < 2) return;
      var dim = state.emph && state.emph !== r;
      var path = r.path, d = state.dom, CH = 10, per = Math.ceil((n - 1) / CH);
      var JUMP = 46; // segmentos longos (passos que "pulam" o vale) viram tracejado discreto
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (var c = 0; c < CH; c++) {
        var a = c * per, b = Math.min(n - 1, (c + 1) * per);
        if (b <= a) break;
        var alpha = (0.22 + 0.78 * Math.pow((c + 1) / CH, 1.5)) * (dim ? 0.25 : 1);
        var jumps = [];
        ctx.beginPath();
        var lx = (path[a * 2] - d.x0) / d.s, ly = (d.y1 - path[a * 2 + 1]) / d.s;
        ctx.moveTo(lx, ly);
        for (var k = a + 1; k <= b; k++) {
          var x = (path[k * 2] - d.x0) / d.s, y = (d.y1 - path[k * 2 + 1]) / d.s;
          var len = Math.abs(x - lx) + Math.abs(y - ly);
          if (k < b && len < 0.6) continue; // decimação
          if (len > JUMP) { jumps.push(lx, ly, x, y); ctx.moveTo(x, y); }
          else ctx.lineTo(x, y);
          lx = x; ly = y;
        }
        ctx.globalAlpha = alpha * 0.4;
        ctx.strokeStyle = '#03050b';
        ctx.lineWidth = 3.4;
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = r.o.draw;
        ctx.lineWidth = state.emph === r ? 2.6 : 1.8;
        ctx.stroke();
        if (jumps.length) {
          ctx.beginPath();
          for (var j = 0; j < jumps.length; j += 4) { ctx.moveTo(jumps[j], jumps[j + 1]); ctx.lineTo(jumps[j + 2], jumps[j + 3]); }
          ctx.setLineDash([2, 5]);
          ctx.globalAlpha = alpha * 0.45;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;
    }

    function drawHead(r) {
      if (!r.n) return;
      var d = state.dom, k = (r.n - 1) * 2;
      var x = (r.path[k] - d.x0) / d.s, y = (d.y1 - r.path[k + 1]) / d.s;
      if (x < -20 || y < -20 || x > state.W + 20 || y > state.H + 20) return;
      var dim = state.emph && state.emph !== r;
      var pulse = r.status === 'run' && state.running ? 1 + 0.18 * Math.sin(state.time * 6 + r.o.id.length) : 1;
      var g = glowSprite(r.o.draw), R = 22 * pulse;
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(g, x - R, y - R, R * 2, R * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = r.o.draw; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(3,5,11,0.9)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.globalAlpha = 1;
    }

    /* posições de chegada: rótulos agrupados por proximidade, em ordem (1º 2º 3º…) */
    function drawPlaces() {
      var done = runners.filter(function (r) { return r.status === 'conv' && r.place; })
        .sort(function (a, b) { return a.place - b.place || runners.indexOf(a) - runners.indexOf(b); });
      if (!done.length) return;
      var d = state.dom, groups = [];
      done.forEach(function (r) {
        var k = (r.n - 1) * 2, x = (r.path[k] - d.x0) / d.s, y = (d.y1 - r.path[k + 1]) / d.s;
        var g = null;
        for (var i = 0; i < groups.length; i++) if (Math.abs(groups[i].x - x) < 18 && Math.abs(groups[i].y - y) < 18) { g = groups[i]; break; }
        if (!g) { g = { x: x, y: y, items: [] }; groups.push(g); }
        g.items.push(r);
      });
      ctx.save();
      ctx.font = '600 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      groups.forEach(function (g) {
        var widths = g.items.map(function (r) { return ctx.measureText(r.place + 'º').width; });
        var total = widths.reduce(function (a, b) { return a + b; }, 0) + (g.items.length - 1) * 6 + 12;
        var bx = RR.clamp(g.x - total / 2, 4, state.W - total - 4), by = g.y - 32 < 4 ? g.y + 14 : g.y - 32;
        ctx.fillStyle = 'rgba(5,7,15,0.82)';
        roundRect(bx, by, total, 18, 9); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
        var x = bx + 6;
        g.items.forEach(function (r, i) {
          ctx.fillStyle = r.o.draw;
          ctx.fillText(r.place + 'º', x, by + 9.5);
          x += widths[i] + 6;
        });
      });
      ctx.restore();
    }

    function drawStart(x, y) {
      ctx.save();
      ctx.strokeStyle = 'rgba(238,241,251,0.9)';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(238,241,251,0.45)';
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      var right = x < state.W - 70;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(3,5,11,0.8)';
      ctx.strokeText('largada', x + (right ? 17 : -17), y);
      ctx.fillStyle = 'rgba(238,241,251,0.85)';
      ctx.fillText('largada', x + (right ? 17 : -17), y);
      ctx.restore();
    }

    function drawCursor(c) {
      var W = state.W, H = state.H, x = c.px, y = c.py;
      ctx.save();
      ctx.strokeStyle = 'rgba(158,245,207,0.35)';
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(W, Math.round(y) + 0.5);
      ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#9ef5cf';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fillStyle = '#9ef5cf'; ctx.fill();
      var l1 = 'x ' + fmtCoord(c.x) + '  y ' + fmtCoord(c.y) + '  loss ' + fmtLoss(state.S.f(c.x, c.y));
      var l2 = c.kbd ? 'Enter para largar daqui' : 'clique para largar daqui';
      ctx.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      var tw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width), bw = tw + 16, bh = 38;
      var lx = x + 16 + bw > W - 6 ? x - 16 - bw : x + 16;
      var ly = y - bh - 12 < 6 ? y + 12 : y - bh - 12;
      ctx.fillStyle = 'rgba(5,7,15,0.86)';
      roundRect(lx, ly, bw, bh, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(158,245,207,0.3)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(238,241,251,0.92)';
      ctx.fillText(l1, lx + 8, ly + 12.5);
      ctx.fillStyle = '#9ef5cf';
      ctx.fillText(l2, lx + 8, ly + 26.5);
      ctx.restore();
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    /* ----- laço: só roda enquanto visível e com algo a fazer ----- */
    var loop = RR.loop(function (dt, t) {
      state.time = t;
      if (state.job && !state.job.done) { state.job.step(9); state.dirty = true; if (state.job.done) state.job = null; }
      if (state.running) {
        state.acc += dt * state.S.pace * state.speed;
        var n = Math.min(400, Math.floor(state.acc));
        if (n > 0) { state.acc -= n; advance(n); }
        state.dirty = true;
      }
      if (state.dirty) {
        state.dirty = false;
        draw();
        syncUI(false);
      }
      if (!state.running && !state.job && !state.dirty) loop.stop();
    });

    function kick() {
      if (state.visible && !document.hidden && !loop.running) loop.start();
    }

    RR.whenVisible(root, function () { state.visible = true; kick(); }, function () { state.visible = false; loop.stop(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) loop.stop(); else kick(); });

    /* ----- ponteiro: clique/toque define a largada ----- */
    function localPoint(e) {
      var rect = canvas.getBoundingClientRect();
      var px = ((e.clientX - rect.left) / rect.width) * state.W, py = ((e.clientY - rect.top) / rect.height) * state.H;
      var d = state.dom;
      return { px: px, py: py, x: d.x0 + px * d.s, y: d.y1 - py * d.s };
    }
    var down = null;
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    });
    canvas.addEventListener('pointerup', function (e) {
      if (!down || down.id !== e.pointerId) return;
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      var quick = performance.now() - down.t < 700;
      down = null;
      if (moved > 10 || !quick || !state.dom) return;
      var p = localPoint(e);
      state.kbd = { px: p.px, py: p.py, x: p.x, y: p.y, kbd: true };
      setStart(p.x, p.y, true);
    });
    canvas.addEventListener('pointercancel', function () { down = null; });
    canvas.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || !state.dom) return;
      state.hover = localPoint(e);
      state.dirty = true; kick();
    });
    canvas.addEventListener('pointerleave', function () {
      if (!state.hover) return;
      state.hover = null; state.dirty = true; kick();
    });

    /* ----- teclado: setas movem um cursor de largada; Enter larga ----- */
    canvas.addEventListener('focus', function () {
      state.focused = true;
      if (!state.kbd && state.dom) {
        var p = startPoint(), q = toPx(p[0], p[1]);
        state.kbd = { px: q[0], py: q[1], x: p[0], y: p[1], kbd: true };
      }
      state.dirty = true; kick();
    });
    canvas.addEventListener('blur', function () { state.focused = false; state.dirty = true; kick(); });
    canvas.addEventListener('keydown', function (e) {
      if (!state.dom) return;
      var k = e.key, dx = 0, dy = 0, stepPx = e.shiftKey ? 40 : 10;
      if (k === 'ArrowLeft') dx = -1; else if (k === 'ArrowRight') dx = 1;
      else if (k === 'ArrowUp') dy = -1; else if (k === 'ArrowDown') dy = 1;
      else if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        var c = state.kbd;
        if (c) setStart(c.x, c.y, true); else restart(true);
        return;
      } else return;
      e.preventDefault();
      var cur = state.kbd || { px: state.W / 2, py: state.H / 2 };
      var px = RR.clamp(cur.px + dx * stepPx, 0, state.W), py = RR.clamp(cur.py + dy * stepPx, 0, state.H);
      var d = state.dom;
      state.kbd = { px: px, py: py, x: d.x0 + px * d.s, y: d.y1 - py * d.s, kbd: true };
      state.dirty = true; kick();
    });

    /* ----- tamanho responsivo ----- */
    var onResize = RR.debounce(function () {
      var kx = state.kbd;
      resize();
      if (kx && state.dom) { var q = toPx(kx.x, kx.y); state.kbd = { px: q[0], py: q[1], x: kx.x, y: kx.y, kbd: true }; }
      state.dirty = true; kick();
    }, 120);
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(stage);
    else { window.addEventListener('resize', onResize); window.addEventListener('load', onResize); }

    RR.on('reducedmotion', function () { restart(!RR.reducedMotion); });

    syncSurface();
    restart(!RR.reducedMotion);
  }
})();
