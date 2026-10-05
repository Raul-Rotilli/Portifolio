/* =========================================================================
   hero.js — abertura: retrato que "nasce do ruído" + subtítulo em streaming
   - Partículas amostradas do retrato por importância (bordas + parcela uniforme)
   - Processo reverso estilo DDIM com cronograma cosseno: t = 1000 → 0
     posição = √ᾱ·x₀ + √(1−ᾱ)·ε (ε gaussiano fixo por partícula, com giro)
   - Ponteiro perturba as partículas (re-ruído local) e uma mola as devolve
   - Clique / Enter / Espaço / RR.emit('hero:renoise') → nova amostra (nova seed)
   - Subtítulo revelado token a token, como um LLM (texto integral para leitores de tela)
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR) return;

  /* ---------- cronograma de ruído cosseno (Nichol & Dhariwal, 2021) ---------- */
  var T = 1000, S_COS = 0.008;
  var F0 = Math.cos(S_COS / (1 + S_COS) * Math.PI / 2);
  function alphaBar(t) {
    var f = Math.cos((t / T + S_COS) / (1 + S_COS) * Math.PI / 2);
    var v = (f * f) / (F0 * F0);
    return v > 1 ? 1 : v < 0 ? 0 : v;
  }
  var LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

  var STYLES = ['partículas', 'pontilhado', 'varredura'];
  var PHASE_LABEL = { fwd: 'adicionando ruído', rev: 'denoising', idle: 'amostra gerada ✓' };

  RR.ready(function () {
    var stream = document.getElementById('hero-stream');
    var stage = document.getElementById('hero-stage');
    var hud = document.getElementById('hero-hud');
    if (stream) initStream(stream);
    if (stage && hud) initPortrait(stage, hud);
  });

  /* =====================================================================
     1) Retrato por difusão
     ===================================================================== */
  function initPortrait(stage, hud) {
    var canvas = document.createElement('canvas');
    if (!canvas.getContext || !window.Uint32Array) return;
    var probe = canvas.getContext('2d');
    if (!probe || !probe.createImageData) return;

    var coarse = RR.isTouch;

    /* ---------- parâmetros visuais ---------- */
    var NOISE_K = 0.5;      // desvio do ruído de posição (coords normalizadas do palco)
    var COLOR_K = 0.7;      // desvio do ruído de cor
    var SWIRL = 1.9;        // giro (rad) do ruído quando σ = 1
    var JITTER = 2.2;       // agitação estocástica (px) quando σ = 1 — "Langevin"
    var FWD_DUR = 0.85;     // processo direto (adicionar ruído), s
    var REV_DUR = 3.5;      // processo reverso (denoising), s
    var IDLE_WINDOW = 7;    // s de "respiração" depois da última atividade
    var BREATH = 0.55;      // amplitude da respiração (px)
    var SPRING_K = 110, SPRING_C = 13;

    /* ---------- estado ---------- */
    var N = 0;
    var ux, uy, sz, szd, cr, cg, cb, ca, ph, rot;        // alvo e atributos (szd: px do dispositivo)
    var ex, ey, er, eg, eb;                               // ruído atual
    var nx, ny, nr, ng, nb;                               // próximo ruído (renoise)
    var dx, dy, vx, vy;                                   // perturbação (mola)
    var jit = new Float32Array(4096);
    for (var j = 0; j < jit.length; j++) jit[j] = RR.gauss() * 0.5;

    var W = 0, H = 0, B = 0, CW = 0, CH = 0, DW = 0, DH = 0, rs = 1, maxDpr = 2;
    var ctx = null, img = null, buf = null, discs = [];
    var rect = [0, 0, 0, 0];        // retângulo sujo do quadro anterior (px do dispositivo)
    var phase = 'idle', t = 0, tFrom = 0, prog = 0, mixing = false;
    var fwdDur = FWD_DUR, revDur = REV_DUR, swirlMul = 1;
    var time = 0, lastAct = 0, idleAmp = 0;
    var styleW = [1, 0, 0], styleTarget = 0;
    var seed = 2026, sample = 427;
    var visible = true, ready = false, painted = false, userRun = false;
    var pointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, lastMove: 0, lastT: 0, type: 'mouse' };
    var physics = false, R = 60;
    var perf = { avg: 0, frames: 0, checked: false };
    var hudCache = {};

    /* ---------- DOM ---------- */
    var glow = RR.el('canvas', { class: 'hero__glow', width: 123, height: 178, 'aria-hidden': 'true' });
    var brush = RR.el('span', { class: 'hero__brush', 'aria-hidden': 'true' });
    canvas.className = 'hero__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    stage.insertBefore(glow, stage.firstChild);
    stage.appendChild(canvas);
    stage.appendChild(brush);

    var ui = buildHud();
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('aria-describedby', 'hero-stage-help');

    /* ---------- carga + amostragem ---------- */
    RR.getPortraitPixels(491).then(function (src) {
      setup(src);
    }).catch(function () { /* mantém a imagem de fallback */ });

    function setup(src) {
      if (!measure()) {
        // palco ainda sem tamanho (ex.: layout atrasado): tenta no próximo quadro
        requestAnimationFrame(function () { setup(src); });
        return;
      }
      var area = W * H;
      N = coarse
        ? Math.round(RR.clamp(area / 44, 3000, 4200))
        : Math.round(RR.clamp(area / 33, 6000, 10000));
      allocate(N);
      sampleParticles(src, RR.rng(7));
      fillNoise(ex, ey, er, eg, eb, seed);
      computeDeviceSizes();
      paintGlow();
      ready = true;
      ui.count.textContent = RR.fmt(N) + ' partículas';
      updateMeta();
      hud.classList.add('is-ready');

      if (RR.reducedMotion) {
        phase = 'idle'; t = 0;
      } else {
        // começa igual à foto, aplica o processo direto (ruído) e depois o reverso
        phase = 'fwd'; t = 0; tFrom = 0; prog = 0; mixing = false; fwdDur = FWD_DUR;
      }
      bindEvents();
      renderFrame(0.016);
      wake();
    }

    function allocate(n) {
      var F = Float32Array;
      ux = new F(n); uy = new F(n); sz = new F(n); cr = new F(n); cg = new F(n); cb = new F(n);
      ca = new F(n); ph = new F(n); rot = new F(n);
      ex = new F(n); ey = new F(n); er = new F(n); eg = new F(n); eb = new F(n);
      nx = new F(n); ny = new F(n); nr = new F(n); ng = new F(n); nb = new F(n);
      dx = new F(n); dy = new F(n); vx = new F(n); vy = new F(n);
      szd = new F(n);
    }

    /* Amostragem em duas partes:
       - parcela uniforme em grade com jitter (estratificada): pele e camiseta cheias, sem buracos;
       - parcela por importância em |∇L| (Sobel): olhos, sobrancelhas, barba, cabelo e contornos. */
    function sampleParticles(src, rand) {
      var w = src.width, h = src.height, d = src.data, L = RR.luminance(src);
      var n = w * h, grad = new Float32Array(n), opaque = 0, gsum = 0, CAP = 0.9;
      var x, y, i, k = 0;
      for (y = 1; y < h - 1; y++) {
        for (x = 1; x < w - 1; x++) {
          i = y * w + x;
          if (d[i * 4 + 3] <= 128) continue;
          var gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
          var gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
          var g = Math.pow(gx * gx + gy * gy, 0.45);
          if (g > CAP) g = CAP;                       // contorno da silhueta não domina
          grad[i] = g + 1e-4;
          opaque++; gsum += g + 1e-4;
        }
      }
      if (!opaque) return;
      var toCss = W / w;                              // px da imagem → px CSS do palco

      // 1) grade estratificada
      var nu = Math.round(N * 0.68);
      var cell = Math.sqrt(opaque / nu);
      var uSize = cell * toCss * 0.56;
      for (var gyc = 0; gyc * cell < h && k < N; gyc++) {
        for (var gxc = 0; gxc * cell < w && k < N; gxc++) {
          for (var tries = 0; tries < 3; tries++) {
            x = Math.min(w - 1, ((gxc + rand()) * cell) | 0);
            y = Math.min(h - 1, ((gyc + rand()) * cell) | 0);
            i = y * w + x;
            if (grad[i] > 0) { place(k++, x, y, i, uSize * (0.85 + rand() * 0.25)); break; }
          }
        }
      }
      // 2) importância nas bordas para o restante
      var cdf = new Float64Array(n), acc = 0, gRef = 2.4 * gsum / opaque;
      for (i = 0; i < n; i++) { acc += grad[i]; cdf[i] = acc; }
      var eSize = Math.max(1.05, uSize * 0.55);
      while (k < N) {
        var r = rand() * acc, lo = 0, hi = n - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
        var edge = Math.min(1, grad[lo] / gRef);
        place(k++, lo % w, (lo / w) | 0, lo, eSize * (1.25 - 0.4 * edge) * (0.85 + rand() * 0.3));
      }

      function place(k, px, py, idx, size) {
        ux[k] = (px + rand()) / w;
        uy[k] = (py + rand()) / h;
        var o = idx * 4;
        var R0 = d[o] / 255, G0 = d[o + 1] / 255, B0 = d[o + 2] / 255;
        var lum = 0.2126 * R0 + 0.7152 * G0 + 0.0722 * B0;
        // curva em S leve (contraste) + sombras puxadas para o azul da paleta
        R0 = scurve(R0); G0 = scurve(G0); B0 = scurve(B0);
        var sh = (1 - lum) * (1 - lum) * 0.42;
        R0 = (R0 * (1 - sh) + 0.17 * sh) * 1.08;
        G0 = (G0 * (1 - sh) + 0.21 * sh) * 1.06;
        B0 = (B0 * (1 - sh) + 0.4 * sh) * 1.06;
        cr[k] = RR.clamp(R0, 0, 1) * 2 - 1;
        cg[k] = RR.clamp(G0, 0, 1) * 2 - 1;
        cb[k] = RR.clamp(B0, 0, 1) * 2 - 1;
        ca[k] = d[o + 3] / 255;
        // meio-tom: áreas claras ganham pontos maiores (o rosto "acende")
        sz[k] = size * (0.42 + 1.05 * Math.pow(lum, 0.85));
        ph[k] = rand() * Math.PI * 2;
        rot[k] = (rand() - 0.5) * 1.2;
      }
    }

    function scurve(v) { var c = v - 0.5; return RR.clamp(0.5 + c * 1.18 - c * c * c * 0.6, 0, 1); }

    function fillNoise(ax, ay, ar, ag, ab, s) {
      var rand = RR.rng(s);
      for (var i = 0; i < N; i++) {
        ax[i] = RR.gauss(rand); ay[i] = RR.gauss(rand);
        ar[i] = RR.gauss(rand); ag[i] = RR.gauss(rand); ab[i] = RR.gauss(rand);
      }
    }

    function computeDeviceSizes() {
      if (!szd) return;
      for (var i = 0; i < N; i++) szd[i] = sz[i] * rs;
    }

    /* Brilho de fundo: retrato minúsculo, ampliado e desfocado via CSS (custo ~0) */
    function paintGlow() {
      RR.loadPortrait().then(function (im) {
        var g = glow.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(im, 0, 0, glow.width, glow.height);
      }).catch(function () {});
    }

    /* ---------- tamanho do palco / canvas ---------- */
    function measure() {
      var r = stage.getBoundingClientRect();
      var w = Math.round(r.width), h = Math.round(r.height);
      if (w < 10 || h < 10) return false;
      if (w === W && h === H && ctx) return true;
      W = w; H = h;
      B = Math.round(RR.clamp(W * 0.06, 12, 32));       // sangria: o ruído pode passar da moldura
      CW = W + 2 * B; CH = H + 2 * B;
      ctx = RR.setupCanvas(canvas, CW, CH, maxDpr);
      canvas.style.left = canvas.style.top = -B + 'px';
      stage.style.setProperty('--bleed', B + 'px');
      DW = canvas.width; DH = canvas.height; rs = DW / CW;
      img = ctx.createImageData(DW, DH);
      buf = new Uint32Array(img.data.buffer);
      rect = [0, 0, DW, DH];
      discs = buildDiscs(DW);
      R = RR.clamp(W * 0.15, 46, 82);
      brush.style.width = brush.style.height = (R * 2) + 'px';
      computeDeviceSizes();
      return true;
    }

    /* Máscaras de disco (offsets lineares no buffer) para pontos de 3 a 12 px */
    function buildDiscs(stride) {
      var out = [];
      for (var s = 3; s <= 12; s++) {
        var c = (s - 1) / 2, r2 = (s / 2) * (s / 2) * 0.82, list = [];
        for (var yy = 0; yy < s; yy++) {
          for (var xx = 0; xx < s; xx++) {
            if ((xx - c) * (xx - c) + (yy - c) * (yy - c) <= r2) list.push(yy * stride + xx);
          }
        }
        out[s] = new Int32Array(list);
      }
      return out;
    }

    /* ---------- HUD ---------- */
    function buildHud() {
      var o = {};
      o.buttons = STYLES.map(function (label, k) {
        return RR.el('button', {
          type: 'button', 'aria-pressed': k === 0 ? 'true' : 'false',
          onclick: function () { setStyle(k); }
        }, label);
      });
      var seg = RR.el('div', {
        class: 'segmented hero__styles', role: 'group', 'aria-label': 'Estilo de renderização do retrato'
      }, o.buttons);
      o.dot = RR.el('i', { class: 'hero__dot' });
      o.status = RR.el('span', { class: 'hero__status' }, PHASE_LABEL.fwd);
      o.t = RR.el('b', { class: 'hero__num' }, '0');
      o.meter = RR.el('i');
      o.sigma = RR.el('b', { class: 'hero__num hero__num--s' }, '0,00');
      var chips = RR.el('div', { class: 'hero__chips', 'aria-hidden': 'true' }, [
        RR.el('span', { class: 'hero__chip hero__chip--status' }, [o.dot, o.status]),
        RR.el('span', { class: 'hero__chip hero__chip--t' }, ['t = ', o.t]),
        RR.el('span', { class: 'hero__chip hero__chip--sigma' }, [
          RR.el('span', { class: 'hero__sym' }, 'σ'),
          RR.el('span', { class: 'hero__meter' }, o.meter),
          o.sigma
        ])
      ]);
      var hint = RR.el('p', { class: 'hero__hint', 'aria-hidden': 'true' }, [
        RR.el('span', {
          class: 'hero__hint-ico',
          html: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>'
        }),
        RR.el('span', { class: 'hero__hint-long' }, (coarse ? 'toque' : 'clique') + ' no retrato para gerar outra amostra'),
        RR.el('span', { class: 'hero__hint-short' }, (coarse ? 'toque' : 'clique') + ' para gerar outra amostra')
      ]);
      o.sample = RR.el('span', { class: 'hero__sample' }, '');
      o.count = RR.el('span', { class: 'hero__count' }, '');
      o.live = RR.el('span', { class: 'sr-only', 'aria-live': 'polite' });
      var help = RR.el('span', { id: 'hero-stage-help', class: 'sr-only' },
        'Pressione Enter ou Espaço para gerar outra amostra.');
      hud.appendChild(RR.el('div', { class: 'hero__hud-top' }, seg));
      hud.appendChild(RR.el('div', { class: 'hero__hud-bottom' }, [chips, hint]));
      hud.appendChild(RR.el('div', { class: 'hero__meta', 'aria-hidden': 'true' }, [o.sample, o.count]));
      hud.appendChild(help);
      hud.appendChild(o.live);
      return o;
    }

    function setText(key, node, value) {
      if (hudCache[key] === value) return;
      hudCache[key] = value;
      node.textContent = value;
    }

    function updateMeta() {
      ui.sample.textContent = 'amostra #' + String(sample).padStart(4, '0') + ' · seed ' + seed;
    }

    function updateHud(b) {
      setText('t', ui.t, String(Math.round(t)));
      setText('s', ui.sigma, b.toFixed(2).replace('.', ','));
      var m = b.toFixed(3);
      if (hudCache.m !== m) { hudCache.m = m; ui.meter.style.transform = 'scaleX(' + m + ')'; }
      if (hudCache.phase !== phase) {
        hudCache.phase = phase;
        ui.status.textContent = PHASE_LABEL[phase];
        hud.setAttribute('data-phase', phase);
      }
    }

    function setStyle(k) {
      styleTarget = k;
      ui.buttons.forEach(function (btn, i) { btn.setAttribute('aria-pressed', i === k ? 'true' : 'false'); });
      stage.setAttribute('data-style', STYLES[k]);
      if (RR.reducedMotion) styleW = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
      lastAct = time;
      wake();
    }

    /* ---------- nova amostra ---------- */
    function renoise(user) {
      if (!ready) return;
      userRun = !!user;
      sample++;
      seed = 1000 + Math.floor(Math.random() * 9000);
      updateMeta();
      if (mixing) commitMix(prog);           // congela o ruído efetivo atual (continuidade)
      fillNoise(nx, ny, nr, ng, nb, seed);
      lastAct = time;
      if (RR.reducedMotion) {
        // versão breve: troca o ruído e faz um reverso curto, sem giro
        swap();
        mixing = false; phase = 'rev'; tFrom = 260; t = 260; prog = 0; revDur = 0.6; swirlMul = 0;
      } else {
        swirlMul = 1; revDur = REV_DUR;
        mixing = true; prog = 0; tFrom = t; phase = 'fwd';
        fwdDur = Math.max(0.35, FWD_DUR * (1 - t / T) + 0.15);
      }
      wake();
    }
    // ε ← cos(θ)·ε + sin(θ)·ε' preserva a distribuição N(0, I) (rotação no espaço do ruído)
    function commitMix(u) {
      var c = Math.cos(u * Math.PI / 2), s = Math.sin(u * Math.PI / 2);
      for (var i = 0; i < N; i++) {
        ex[i] = c * ex[i] + s * nx[i]; ey[i] = c * ey[i] + s * ny[i];
        er[i] = c * er[i] + s * nr[i]; eg[i] = c * eg[i] + s * ng[i]; eb[i] = c * eb[i] + s * nb[i];
      }
    }
    function swap() {
      var tmp;
      tmp = ex; ex = nx; nx = tmp; tmp = ey; ey = ny; ny = tmp;
      tmp = er; er = nr; nr = tmp; tmp = eg; eg = ng; ng = tmp; tmp = eb; eb = nb; nb = tmp;
    }

    /* ---------- relógio da difusão ---------- */
    function advance(dt) {
      if (phase === 'fwd') {
        prog = Math.min(1, prog + dt / fwdDur);
        var e = prog * prog;                                   // acelera ao espalhar
        t = tFrom + (T - tFrom) * e;
        if (prog >= 1) {
          if (mixing) { swap(); mixing = false; }
          phase = 'rev'; t = T; tFrom = T; prog = 0;
        }
      } else if (phase === 'rev') {
        prog = Math.min(1, prog + dt / revDur);
        t = tFrom * Math.pow(1 - prog, 1.7);                    // pousa suavemente
        if (prog >= 1) { t = 0; phase = 'idle'; prog = 0; onDone(); }
      }
    }

    function onDone() {
      lastAct = time;
      swirlMul = 1; revDur = REV_DUR;
      if (userRun) {
        ui.live.textContent = 'Amostra #' + String(sample).padStart(4, '0') + ' gerada.';
        userRun = false;
      }
    }

    /* ---------- render ---------- */
    function renderFrame(dt) {
      if (!ready || !buf) return;
      var t0 = performance.now();
      var reduced = RR.reducedMotion;

      // estilos (mistura suave)
      var styleMoving = false;
      for (var s = 0; s < 3; s++) {
        var goal = s === styleTarget ? 1 : 0, cur = styleW[s];
        if (cur !== goal) {
          cur += (goal - cur) * Math.min(1, dt * 7);
          if (Math.abs(goal - cur) < 0.004) cur = goal; else styleMoving = true;
          styleW[s] = cur;
        }
      }
      var w1 = styleW[1], w2 = styleW[2];         // pesos de "pontilhado" e "varredura"

      // respiração ociosa
      var since = time - lastAct;
      var ampGoal = (!reduced && phase === 'idle' && since < IDLE_WINDOW) ? 1 : 0;
      idleAmp += (ampGoal - idleAmp) * Math.min(1, dt * (ampGoal ? 1.4 : 1.6));
      if (!ampGoal && idleAmp < 0.003) idleAmp = 0;

      var ab = alphaBar(t), a = Math.sqrt(ab), b = Math.sqrt(1 - ab);
      var abc = alphaBar(t * 0.8), ac = Math.sqrt(abc), bc = Math.sqrt(1 - abc);
      var cu = 1, su = 0;
      if (mixing) { cu = Math.cos(prog * Math.PI / 2); su = Math.sin(prog * Math.PI / 2); }
      var hw = W / 2, hh = H / 2, cx = B + hw, cy = B + hh;
      var kx = NOISE_K * hw, ky = NOISE_K * hh;
      var swirl = SWIRL * swirlMul, jitA = JITTER * swirlMul * b;
      var jo = (Math.random() * 4096) | 0, jo2 = (Math.random() * 4096) | 0;
      var noisy = b > 0.0004;

      // ponteiro (coords do canvas)
      var pIn = pointer.inside, px = pointer.x + B, py = pointer.y + B;
      var pvx = pointer.vx, pvy = pointer.vy, R2 = R * R;
      var FORCE = 5200, DRAG = 5.5;
      var stepDt = dt > 0.033 ? 0.033 : dt;
      var simulate = physics || pIn;
      var anyMotion = false, maxV = 0;

      var breath = idleAmp * BREATH, shimmer = idleAmp * 0.16, tm = time;
      var gap = 3 * rs;                    // espaçamento das linhas de varredura
      var wMul = 1 + 1.5 * w2, hMul = 1 - 0.6 * w2;

      // limpa só as linhas tocadas no quadro anterior
      buf.fill(0, rect[1] * DW, Math.min(DH, rect[3]) * DW);
      var minX = DW, minY = DH, maxX = 0, maxY = 0;
      var LE = LITTLE_ENDIAN;

      for (var i = 0; i < N; i++) {
        var X0 = ux[i] * 2 - 1, Y0 = uy[i] * 2 - 1;
        var x = cx + a * X0 * hw, y = cy + a * Y0 * hh;
        var qr = er[i], qg = eg[i], qb = eb[i];
        if (noisy) {
          var ex_ = ex[i], ey_ = ey[i];
          if (mixing) {
            ex_ = cu * ex_ + su * nx[i]; ey_ = cu * ey_ + su * ny[i];
            qr = cu * qr + su * nr[i]; qg = cu * qg + su * ng[i]; qb = cu * qb + su * nb[i];
          }
          var th = b * (swirl + rot[i] * swirlMul), co = Math.cos(th), si = Math.sin(th);
          x += b * kx * (ex_ * co - ey_ * si) + jitA * jit[(i + jo) & 4095];
          y += b * ky * (ex_ * si + ey_ * co) + jitA * jit[(i * 3 + jo2) & 4095];
        } else if (mixing) {
          qr = cu * qr + su * nr[i]; qg = cu * qg + su * ng[i]; qb = cu * qb + su * nb[i];
        }

        // perturbação pelo ponteiro + mola
        var ddx = dx[i], ddy = dy[i];
        if (simulate) {
          var ax = -SPRING_K * ddx - SPRING_C * vx[i], ay = -SPRING_K * ddy - SPRING_C * vy[i];
          if (pIn) {
            var qx = x + ddx - px, qy = y + ddy - py, q2 = qx * qx + qy * qy;
            if (q2 < R2) {
              var q = Math.sqrt(q2) + 0.01, f = 1 - q / R;
              f *= f;
              ax += (qx / q) * f * FORCE + pvx * f * DRAG;
              ay += (qy / q) * f * FORCE + pvy * f * DRAG;
            }
          }
          var nvx = vx[i] + ax * stepDt, nvy = vy[i] + ay * stepDt;
          ddx += nvx * stepDt; ddy += nvy * stepDt;
          var mv = (nvx < 0 ? -nvx : nvx) + (nvy < 0 ? -nvy : nvy);
          if (mv > maxV) maxV = mv;
          if (mv + (ddx < 0 ? -ddx : ddx) + (ddy < 0 ? -ddy : ddy) < 0.04) {
            ddx = ddy = nvx = nvy = 0;
          } else anyMotion = true;
          dx[i] = ddx; dy[i] = ddy; vx[i] = nvx; vy[i] = nvy;
        }
        x += ddx; y += ddy;

        var alpha = 1;
        if (breath > 0) {
          var phs = ph[i];
          x += breath * Math.sin(tm * 1.3 + phs);
          y += breath * Math.cos(tm * 1.05 + phs * 1.7);
          alpha = 1 - shimmer * (0.5 + 0.5 * Math.sin(tm * 2.1 + phs * 3));
        }

        // cor: √ᾱ·c₀ + √(1−ᾱ)·ε (com re-ruído local onde o ponteiro mexeu)
        var bb = bc, aa = ac;
        if (ddx !== 0 || ddy !== 0) {
          var rho = ((ddx < 0 ? -ddx : ddx) + (ddy < 0 ? -ddy : ddy)) * 0.03;
          if (rho > bb) { bb = rho > 0.85 ? 0.85 : rho; aa = Math.sqrt(1 - bb * bb); }
        }
        var ck = bb * COLOR_K;
        var r = (aa * cr[i] + ck * qr) * 127.5 + 127.5;
        var g = (aa * cg[i] + ck * qg) * 127.5 + 127.5;
        var bl = (aa * cb[i] + ck * qb) * 127.5 + 127.5;
        var sizeMul = 1;
        if (w1 > 0) {
          // pontilhado: tinta menta monocromática, tamanho ∝ luminância
          var ln = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
          ln = ln < 0 ? 0 : ln > 1 ? 1 : ln;
          r = r * (1 - w1) + (30 + 205 * ln) * w1;
          g = g * (1 - w1) + (58 + 197 * ln) * w1;
          bl = bl * (1 - w1) + (70 + 172 * ln) * w1;
          sizeMul = 1 - w1 + w1 * (0.35 + 1.25 * ln);
        }
        if (w2 > 0) {
          // varredura: linhas horizontais, cor um pouco mais viva
          r = r * (1 + 0.12 * w2); bl = bl * (1 + 0.1 * w2) + 10 * w2;
        }
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        bl = bl < 0 ? 0 : bl > 255 ? 255 : bl;
        var A = (0.45 + 0.55 * aa) * ca[i] * alpha * 255;

        // escrita no buffer
        var sd = szd[i] * sizeMul;
        var sw = (sd * wMul + 0.5) | 0, sh = (sd * hMul + 0.5) | 0;
        if (sw < 1) sw = 1;
        if (sh < 1) sh = 1;
        var Xd = x * rs - sw * 0.5, Yd = y * rs - sh * 0.5;
        if (w2 > 0) Yd += (Math.round(Yd / gap) * gap - Yd) * w2;
        var X = Xd | 0, Y = Yd | 0;
        if (X < 0 || Y < 0 || X + sw > DW || Y + sh > DH) continue;
        var col = LE
          ? (((A | 0) << 24) | ((bl | 0) << 16) | ((g | 0) << 8) | (r | 0))
          : (((r | 0) << 24) | ((g | 0) << 16) | ((bl | 0) << 8) | (A | 0));
        var off = Y * DW + X;
        if (sw === 1 && sh === 1) buf[off] = col;
        else if (sw === sh && sw >= 3 && sw <= 12) {
          var dm = discs[sw];
          for (var q2i = 0, ql = dm.length; q2i < ql; q2i++) buf[off + dm[q2i]] = col;
        } else {
          for (var yy = 0; yy < sh; yy++, off += DW) {
            for (var xx = 0; xx < sw; xx++) buf[off + xx] = col;
          }
        }
        if (X < minX) minX = X;
        if (Y < minY) minY = Y;
        if (X + sw > maxX) maxX = X + sw;
        if (Y + sh > maxY) maxY = Y + sh;
      }
      physics = anyMotion;

      // envia só a união dos retângulos sujos (quadro anterior + atual)
      if (maxX <= minX) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
      var ux0 = Math.min(rect[0], minX), uy0 = Math.min(rect[1], minY);
      var ux1 = Math.max(rect[2], maxX), uy1 = Math.max(rect[3], maxY);
      if (ux1 > ux0 && uy1 > uy0) ctx.putImageData(img, 0, 0, ux0, uy0, ux1 - ux0, uy1 - uy0);
      rect = [minX, minY, maxX, maxY];

      // brilho de fundo segue o termo de sinal √ᾱ·x₀
      var go = (0.4 * ab * ab * (1 - 0.7 * w1)).toFixed(3);
      var gs = (0.3 + 0.7 * a).toFixed(4);
      if (hudCache.go !== go) { hudCache.go = go; glow.style.opacity = go; }
      if (hudCache.gs !== gs) { hudCache.gs = gs; glow.style.transform = 'scale(' + gs + ')'; }

      if (pIn && pointer.type === 'mouse') {
        brush.style.transform = 'translate3d(' + (pointer.x - R).toFixed(1) + 'px,' + (pointer.y - R).toFixed(1) + 'px,0)';
      }
      // velocidade do ponteiro decai entre eventos
      pointer.vx *= 0.82; pointer.vy *= 0.82;

      updateHud(b);

      if (!painted) {
        painted = true;
        stage.classList.add('is-live');
      }

      // orçamento: se o quadro estiver pesado, reduz a resolução do buffer uma vez
      var ms = performance.now() - t0;
      perf.avg = perf.avg ? perf.avg * 0.9 + ms * 0.1 : ms;
      perf.frames++;
      if (!perf.checked && perf.frames > 40) {
        perf.checked = true;
        if (perf.avg > 9 && rs > 1.01) {
          maxDpr = Math.max(1, rs * 0.7);
          W = 0; measure();
        }
      }

      return phase !== 'idle' || anyMotion && (!pIn || maxV > 2 || time - pointer.lastMove < 0.6) ||
        idleAmp > 0 || styleMoving || (pIn && time - pointer.lastMove < 0.6);
    }

    /* ---------- loop com pausa automática ---------- */
    var loop = RR.loop(function (dt) {
      time += dt;
      advance(dt);
      var more = renderFrame(dt);
      if (!more) loop.stop();
    });
    function wake() {
      if (!ready || !visible || document.hidden) return;
      loop.start();
    }

    /* ---------- eventos ---------- */
    function bindEvents() {
      RR.whenVisible(stage, function () { visible = true; wake(); }, function () { visible = false; loop.stop(); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) loop.stop(); else wake();
      });

      function local(e) {
        var r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }
      stage.addEventListener('pointermove', function (e) {
        var p = local(e), now = performance.now();
        var dtm = Math.max(8, now - (pointer.lastT || now - 16)) / 1000;
        if (pointer.inside) {
          pointer.vx = RR.clamp(pointer.vx * 0.4 + ((p.x - pointer.x) / dtm) * 0.6, -1800, 1800);
          pointer.vy = RR.clamp(pointer.vy * 0.4 + ((p.y - pointer.y) / dtm) * 0.6, -1800, 1800);
        }
        pointer.x = p.x; pointer.y = p.y; pointer.lastT = now; pointer.type = e.pointerType || 'mouse';
        pointer.inside = true; pointer.lastMove = time; lastAct = time;
        stage.classList.toggle('is-hover', pointer.type === 'mouse');
        wake();
      });
      stage.addEventListener('pointerdown', function (e) {
        var p = local(e);
        pointer.x = p.x; pointer.y = p.y; pointer.vx = pointer.vy = 0; pointer.lastT = performance.now();
        pointer.type = e.pointerType || 'mouse';
        pointer.inside = true; pointer.lastMove = time; lastAct = time;
        wake();
      });
      function leave() {
        pointer.inside = false; pointer.vx = pointer.vy = 0;
        stage.classList.remove('is-hover');
        physics = true; lastAct = time;
        wake();
      }
      stage.addEventListener('pointerleave', leave);
      stage.addEventListener('pointercancel', leave);
      stage.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') leave(); });

      stage.addEventListener('click', function () { renoise(true); });
      stage.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (!e.repeat) renoise(true);
        }
      });
      RR.on('hero:renoise', function () { renoise(true); });
      RR.on('reducedmotion', function (on) {
        if (on && phase !== 'idle') {
          if (mixing) swap();
          mixing = false; phase = 'idle'; t = 0; prog = 0; onDone();
        }
        lastAct = time; wake();
      });

      var onResize = RR.debounce(function () {
        if (measure()) { lastAct = time; renderFrame(0.016); wake(); }
      }, 120);
      if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(stage);
      else window.addEventListener('resize', onResize);
    }

    // API pública mínima (paleta de comandos, testes)
    RR.hero = {
      renoise: function () { renoise(true); },
      setStyle: function (k) { if (k >= 0 && k < STYLES.length) setStyle(k); },
      get state() { return { phase: phase, t: Math.round(t), particles: N, seed: seed, sample: sample, msPerFrame: +perf.avg.toFixed(2), dpr: +rs.toFixed(2), running: loop.running }; }
    };
  }

  /* =====================================================================
     2) Streaming de tokens no subtítulo
     ===================================================================== */
  var WORD = /^[0-9A-Za-zÀ-ÖØ-öø-ÿ]+$/;

  /* "Tokenizador" de brincadeira, no estilo BPE: pontuação separada e palavras longas
     quebradas em sub-palavras. Devolve grupos {ws, toks}: os tokens de uma mesma palavra
     ficam juntos (sem quebra de linha no meio, ex.: "back-end"), e o espaço antes do
     grupo continua sendo um ponto de quebra. */
  function tokenize(text) {
    var parts = text.match(/\s+|[0-9A-Za-zÀ-ÖØ-öø-ÿ]+|[^\s0-9A-Za-zÀ-ÖØ-öø-ÿ]/g) || [];
    var groups = [], cur = null, ws = '';
    parts.forEach(function (p) {
      if (/^\s+$/.test(p)) { ws += p; cur = null; return; }
      if (!cur) { cur = { ws: ws, toks: [] }; groups.push(cur); ws = ''; }
      if (WORD.test(p) && p.length > 7) {
        var cut = p.length - Math.max(3, Math.floor(p.length * 0.4));
        cur.toks.push(p.slice(0, cut), p.slice(cut));
      } else cur.toks.push(p);
    });
    if (ws) groups.push({ ws: ws, toks: [] });
    return groups;
  }

  function initStream(p) {
    if (p.querySelector('.hero__tokens')) return;
    var tokens = [];
    var vis = RR.el('span', { class: 'hero__tokens', 'aria-hidden': 'true' });
    (function walk(src, dst) {
      Array.prototype.forEach.call(src.childNodes, function (n) {
        if (n.nodeType === 3) {
          tokenize(n.nodeValue).forEach(function (g) {
            if (g.ws) dst.appendChild(document.createTextNode(' '));
            if (!g.toks.length) return;
            var word = RR.el('span', { class: 'hero__w' });
            g.toks.forEach(function (tk) {
              var s = RR.el('span', { class: 'hero__tok hero__tok--' + (tokens.length % 3) }, tk);
              word.appendChild(s);
              tokens.push(s);
            });
            dst.appendChild(word);
          });
        } else if (n.nodeType === 1) {
          var c = n.cloneNode(false);
          dst.appendChild(c);
          walk(n, c);
        }
      });
    })(p, vis);
    if (!tokens.length) return;

    // cópia integral (e semântica) só para leitores de tela
    var sr = RR.el('span', { class: 'sr-only' });
    while (p.firstChild) sr.appendChild(p.firstChild);
    var stats = RR.el('span', { class: 'hero__stats', 'aria-hidden': 'true' }, tokens.length + ' tokens');
    p.appendChild(sr);
    p.appendChild(vis);
    p.appendChild(stats);

    if (RR.reducedMotion) { p.classList.add('is-done'); return; }

    var caret = RR.el('span', { class: 'hero__caret', 'aria-hidden': 'true' });
    vis.insertBefore(caret, vis.firstChild);
    p.classList.add('is-streaming');

    var k = 0, started = 0;
    function step() {
      if (RR.reducedMotion) { finish(); return; }
      if (!started) started = performance.now();
      var tok = tokens[k++];
      tok.classList.add('is-on');
      tok.parentNode.insertBefore(caret, tok.nextSibling);
      if (k >= tokens.length) { finish(); return; }
      var delay = 30 + Math.random() * 16;
      if (/[,.;:]\s*$/.test(tok.textContent)) delay += 110;
      setTimeout(step, delay);
    }
    function finish() {
      tokens.forEach(function (s) { s.classList.add('is-on'); });
      var secs = started ? (performance.now() - started) / 1000 : 0;
      stats.textContent = tokens.length + ' tokens · ' + RR.fmt(secs, 1) + ' s · ' +
        RR.fmt(secs ? tokens.length / secs : 0, 0) + ' tokens/s';
      p.classList.remove('is-streaming');
      p.classList.add('is-done');
      caret.classList.add('is-idle');
      setTimeout(function () { caret.classList.add('is-gone'); }, 3600);
      setTimeout(function () { if (caret.parentNode) caret.parentNode.removeChild(caret); }, 4400);
    }
    setTimeout(step, 600);
  }
})();
