/* =========================================================================
   art/svd.js — "Posto baixo (SVD)"
   Trata o retrato como matriz e calcula a decomposição em valores singulares
   A = U Σ Vᵀ do zero (Jacobi unilateral de Hestenes), fatiada em pedaços de
   ~10 ms para não travar a página e guardada em cache. A reconstrução usa só
   os k primeiros termos: A_k = Σ σᵢ uᵢ vᵢᵀ (a melhor aproximação de posto k).
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  var MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  var WORK_W = 144;        // colunas da matriz (linhas ≈ 209)
  var KEEP = 80;           // componentes guardadas para reconstrução
  var SLICE_MS = 10;       // orçamento por fatia de cálculo
  var MAX_SWEEPS = 14;
  var TOL = 1e-9;

  /* variações do "Aleatorizar": permutação dos canais RGB e duotones (sombra -> luz) */
  var PERMS = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2]];
  var DUOS = [
    [14, 18, 40, 242, 254, 250],    // azul-noite -> branco-menta
    [10, 30, 36, 158, 245, 207],    // menta
    [30, 12, 36, 255, 196, 160],    // pôr do sol
    [12, 16, 60, 150, 180, 255],    // azul elétrico
    [36, 8, 30, 255, 150, 200],     // rosa
    [8, 22, 20, 214, 255, 236]      // fósforo
  ];

  /* agenda a próxima fatia sem o atraso mínimo de setTimeout encadeado */
  var nextTick = (function () {
    if (typeof MessageChannel !== 'function') return function (fn) { setTimeout(fn, 0); };
    var ch = new MessageChannel(), q = [];
    ch.port1.onmessage = function () { var fn = q.shift(); if (fn) fn(); };
    return function (fn) { q.push(fn); ch.port2.postMessage(0); };
  })();

  /* preenche o fundo (alfa 0) por "push-pull" em pirâmide: extensão suave da
     foto para fora da silhueta, assim a SVD não gasta posto desenhando o recorte */
  function pushPull(val, wgt, w, h) {
    if (w <= 1 && h <= 1) return val;
    var cw = Math.ceil(w / 2), chh = Math.ceil(h / 2);
    var cv = new Float64Array(cw * chh), cwt = new Float64Array(cw * chh), x, y;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var i = y * w + x, j = (y >> 1) * cw + (x >> 1);
        cv[j] += val[i] * wgt[i];
        cwt[j] += wgt[i];
      }
    }
    for (var k = 0; k < cv.length; k++) { cv[k] = cwt[k] > 0 ? cv[k] / cwt[k] : 0; cwt[k] = Math.min(1, cwt[k]); }
    var coarse = pushPull(cv, cwt, cw, chh);
    var out = new Float64Array(w * h);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        /* amostragem bilinear do nível grosso */
        var fx = Math.min(cw - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(chh - 1, Math.max(0, (y - 0.5) / 2));
        var x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(cw - 1, x0 + 1), y1 = Math.min(chh - 1, y0 + 1);
        var tx = fx - x0, ty = fy - y0;
        var c = (coarse[y0 * cw + x0] * (1 - tx) + coarse[y0 * cw + x1] * tx) * (1 - ty) +
                (coarse[y1 * cw + x0] * (1 - tx) + coarse[y1 * cw + x1] * tx) * ty;
        var ii = y * w + x;
        out[ii] = wgt[ii] * val[ii] + (1 - wgt[ii]) * c;
      }
    }
    return out;
  }

  /* matriz m×n (linhas × colunas) de um canal: 'y' (luminância), 'r', 'g' ou 'b' */
  function buildMatrix(src, ch) {
    var w = src.width, h = src.height, n = w * h, d = src.data;
    var val = new Float64Array(n), wgt = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      wgt[i] = d[o + 3] / 255;
      val[i] = ch === 'r' ? d[o] / 255 : ch === 'g' ? d[o + 1] / 255 : ch === 'b' ? d[o + 2] / 255
        : (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
    }
    return pushPull(val, wgt, w, h);
  }

  /* ---------- SVD por Jacobi unilateral (Hestenes) ----------
     Ortogonaliza as colunas de A aos pares com rotações de Givens, acumulando
     as rotações em V. No fim, ‖coluna j‖ = σⱼ e coluna/σⱼ = uⱼ. */
  function createJob(src, ch) {
    var m = src.height, n = src.width;
    var A0 = buildMatrix(src, ch);                 // linha a linha
    var C = new Float64Array(m * n);               // colunas contíguas: C[j*m + i]
    var V = new Float64Array(n * n);               // V[j*n + i]
    for (var i = 0; i < m; i++) for (var j = 0; j < n; j++) C[j * m + i] = A0[i * n + j];
    for (j = 0; j < n; j++) V[j * n + j] = 1;
    var norms = new Float64Array(n);

    var job = {
      m: m, n: n, done: false, sweep: 0, progress: 0, off: 1,
      sigma: null, U: null, V: null, energy: null, total: 0,
      waiters: []
    };
    var p = 0, q = 1, rotations = 0, maxOff = 0;
    function colNorms() {
      for (var c = 0; c < n; c++) {
        var s = 0, base = c * m;
        for (var r = 0; r < m; r++) s += C[base + r] * C[base + r];
        norms[c] = s;
      }
    }
    colNorms();

    function finish() {
      colNorms();
      var idx = [];
      for (var c = 0; c < n; c++) idx.push(c);
      idx.sort(function (a, b) { return norms[b] - norms[a]; });
      var keep = Math.min(KEEP, n), sigma = new Float64Array(n), energy = new Float64Array(n + 1), total = 0;
      for (c = 0; c < n; c++) { sigma[c] = Math.sqrt(Math.max(0, norms[idx[c]])); total += norms[idx[c]]; energy[c + 1] = total; }
      var U = new Float32Array(keep * m), VV = new Float32Array(keep * n);
      for (var r = 0; r < keep; r++) {
        var src0 = idx[r], s = sigma[r] || 1;
        for (var ii = 0; ii < m; ii++) U[r * m + ii] = C[src0 * m + ii] / s;
        for (var jj = 0; jj < n; jj++) VV[r * n + jj] = V[src0 * n + jj];
      }
      job.sigma = sigma; job.U = U; job.V = VV; job.keep = keep;
      job.energy = energy; job.total = total;
      job.done = true; job.progress = 1;
      C = V = A0 = null;
      var w = job.waiters; job.waiters = [];
      w.forEach(function (fn) { fn(job); });
    }

    function slice() {
      var t0 = performance.now();
      while (performance.now() - t0 < SLICE_MS) {
        for (var c = 0; c < 48; c++) {
          var bp = p * m, bq = q * m, alpha = norms[p], beta = norms[q], gamma = 0, r;
          for (r = 0; r < m; r++) gamma += C[bp + r] * C[bq + r];
          var lim = Math.sqrt(alpha * beta);
          if (lim > 1e-18 && Math.abs(gamma) > TOL * lim) {
            var off = Math.abs(gamma) / lim;
            if (off > maxOff) maxOff = off;
            var zeta = (beta - alpha) / (2 * gamma);
            var t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
            var cs = 1 / Math.sqrt(1 + t * t), sn = cs * t;
            for (r = 0; r < m; r++) {
              var a = C[bp + r], b = C[bq + r];
              C[bp + r] = cs * a - sn * b;
              C[bq + r] = sn * a + cs * b;
            }
            var vp = p * n, vq = q * n;
            for (r = 0; r < n; r++) {
              var va = V[vp + r], vb = V[vq + r];
              V[vp + r] = cs * va - sn * vb;
              V[vq + r] = sn * va + cs * vb;
            }
            norms[p] = alpha - t * gamma;
            norms[q] = beta + t * gamma;
            rotations++;
          }
          /* próximo par (p, q) da varredura cíclica */
          if (++q >= n) {
            p++; q = p + 1;
            if (p >= n - 1) {
              job.sweep++;
              job.off = maxOff;
              var stop = rotations === 0 || maxOff < 1e-7 || job.sweep >= MAX_SWEEPS;
              p = 0; q = 1; rotations = 0; maxOff = 0;
              colNorms();
              if (stop) { finish(); return; }
            }
          }
        }
      }
      /* progresso estimado: o retrato converge em ~12 varreduras */
      var within = (p * (2 * n - p - 1) / 2 + q) / (n * (n - 1) / 2);
      job.progress = Math.min(0.98, (job.sweep + within) / 12);
      nextTick(slice);
    }
    nextTick(slice);
    return job;
  }

  /* cache: uma decomposição por canal, na resolução de trabalho */
  var jobs = {};
  function getJob(src, ch) {
    var key = src.width + 'x' + src.height + ':' + ch;
    return jobs[key] || (jobs[key] = createJob(src, ch));
  }
  function whenDone(job) {
    return new Promise(function (resolve) { if (job.done) resolve(job); else job.waiters.push(resolve); });
  }

  /* máscara (alfa da foto) e buffer de composição por tamanho, reaproveitados
     entre renders: redesenhar a foto em alta qualidade a cada ajuste de k é caro */
  var masks = [];
  function maskFor(photo, cw, chh) {
    for (var i = 0; i < masks.length; i++) if (masks[i].w === cw && masks[i].h === chh) return masks[i];
    var mask = document.createElement('canvas'), work = document.createElement('canvas');
    mask.width = work.width = cw;
    mask.height = work.height = chh;
    var x = mask.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(photo, 0, 0, cw, chh);
    var entry = { w: cw, h: chh, mask: mask, work: work };
    masks.unshift(entry);
    if (masks.length > 3) { var old = masks.pop(); old.mask.width = old.work.width = 0; }
    return entry;
  }

  /* A_k = Σ_{r<k} σ_r u_r v_rᵀ  (linha a linha, Float32) */
  function reconstruct(job, k, out) {
    var m = job.m, n = job.n, U = job.U, V = job.V, S = job.sigma;
    out.fill(0);
    for (var r = 0; r < k; r++) {
      var s = S[r], ur = r * m, vr = r * n;
      for (var i = 0; i < m; i++) {
        var a = s * U[ur + i];
        if (a === 0) continue;
        var row = i * n;
        for (var j = 0; j < n; j++) out[row + j] += a * V[vr + j];
      }
    }
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* espectro dos valores singulares (escala log) com os k primeiros em menta */
  function drawSpectrum(ctx, W, H, jobsList, k, pal) {
    var s = RR.clamp(W / 420, 0.78, 1.3);
    var bars = Math.min(80, jobsList[0].n), pad = Math.round(9 * s);
    var bw = Math.max(1, Math.round(1.6 * s)), gap = s >= 1 ? 1 : 0.6;
    var plotW = Math.round(bars * (bw + gap)), plotH = Math.round(46 * s);
    var fs = Math.max(8, Math.round(9 * s));
    var cw = plotW + pad * 2, ch = pad * 2 + fs + Math.round(6 * s) + plotH + Math.round(5 * s) + fs;
    var margin = Math.round(12 * s);
    var x0 = Math.round(W - cw - margin), y0 = Math.round(H - ch - margin);

    /* média dos espectros (1 ou 3 canais), em log */
    var vals = new Float64Array(bars), lo = Infinity, hi = -Infinity;
    for (var i = 0; i < bars; i++) {
      var v = 0;
      for (var c = 0; c < jobsList.length; c++) v += jobsList[c].sigma[i];
      v = Math.log(Math.max(1e-6, v / jobsList.length));
      vals[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    ctx.save();
    roundRect(ctx, x0 + 0.5, y0 + 0.5, cw - 1, ch - 1, Math.round(9 * s));
    ctx.fillStyle = 'rgba(7, 9, 18, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textBaseline = 'top';
    ctx.font = '500 ' + fs + 'px ' + MONO;
    ctx.fillStyle = pal.mint;
    ctx.textAlign = 'left';
    ctx.fillText('valores singulares σᵢ', x0 + pad, y0 + pad);
    ctx.textAlign = 'right';
    ctx.fillStyle = pal.muted;
    ctx.fillText('log', x0 + cw - pad, y0 + pad);

    var px = x0 + pad, py = y0 + pad + fs + Math.round(6 * s), span = Math.max(1e-6, hi - lo);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(px, py + plotH, plotW, 1);
    for (i = 0; i < bars; i++) {
      var hgt = Math.max(1, Math.round((0.06 + 0.94 * (vals[i] - lo) / span) * plotH));
      ctx.fillStyle = i < k ? pal.mint : 'rgba(142, 149, 178, 0.38)';
      ctx.fillRect(px + i * (bw + gap), py + plotH - hgt, bw, hgt);
    }
    /* marcador do posto */
    var kx = px + Math.min(bars, k) * (bw + gap) - gap / 2;
    ctx.fillStyle = 'rgba(158, 245, 207, 0.6)';
    ctx.fillRect(Math.round(kx), py - 2, 1, plotH + 4);
    /* rótulos do eixo: "k = …" centrado no marcador, sem colidir com "1" e "80" */
    var ly = py + plotH + Math.round(5 * s), kl = 'k = ' + k;
    ctx.font = '400 ' + Math.max(7, fs - 1) + 'px ' + MONO;
    var w1 = ctx.measureText('1').width, wN = ctx.measureText(String(bars)).width, wk = ctx.measureText(kl).width;
    var kxl = kx - wk / 2, gapL = 5 * s;
    var showFirst = kxl >= px + w1 + gapL, showLast = kxl + wk <= px + plotW - wN - gapL;
    kxl = RR.clamp(kxl, px, px + plotW - wk);
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.muted;
    if (showFirst) ctx.fillText('1', px, ly);
    if (showLast) { ctx.textAlign = 'right'; ctx.fillText(String(bars), px + plotW, ly); ctx.textAlign = 'left'; }
    ctx.fillStyle = pal.mint;
    ctx.fillText(kl, kxl, ly);
    ctx.restore();
  }

  /* tela de "calculando…": foto esmaecida + barra de progresso */
  function drawProgress(ctx, W, H, img, frac, sweep, pal) {
    ctx.fillStyle = pal.artBg;
    ctx.fillRect(0, 0, W, H);
    if (img) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.drawImage(img, 0, 0, W, H);
      ctx.restore();
    }
    var s = RR.clamp(W / 420, 0.78, 1.3);
    var bw = Math.round(W * 0.56), bh = Math.max(3, Math.round(4 * s));
    var x = Math.round((W - bw) / 2), y = Math.round(H * 0.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = pal.mint;
    ctx.fillRect(x, y, Math.round(bw * RR.clamp(frac, 0, 1)), bh);
    ctx.font = '500 ' + Math.max(9, Math.round(11 * s)) + 'px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = pal.text;
    ctx.fillText('calculando A = U Σ Vᵀ…', W / 2, y - Math.round(10 * s));
    ctx.textBaseline = 'top';
    ctx.fillStyle = pal.muted;
    ctx.font = '400 ' + Math.max(8, Math.round(10 * s)) + 'px ' + MONO;
    ctx.fillText('varredura de Jacobi ' + (sweep + 1), W / 2, y + bh + Math.round(10 * s));
  }

  RR.art.register({
    id: 'svd',
    order: 3,
    title: 'Posto baixo (SVD)',
    short: 'SVD',
    algo: 'SVD',
    field: 'Álgebra linear · compressão',
    description: 'A foto vira uma matriz e a decomposição em valores singulares (A = U Σ Vᵀ, calculada aqui do zero) a separa em camadas ordenadas por importância. Somar só as k primeiras dá a melhor aproximação de posto k: guarda quase toda a energia com bem menos números. É a mesma ideia por trás do PCA, da compressão de dados e do LoRA, que ajusta LLMs com matrizes de posto baixo.',
    params: [
      { id: 'k', label: 'Posto (k)', type: 'range', min: 1, max: 80, step: 1, value: 12 },
      { id: 'colorido', label: 'Colorido', type: 'toggle', value: true },
      { id: 'espectro', label: 'Espectro', type: 'toggle', value: true }
    ],
    animated: false,
    render: function (ctx, p, env) {
      var W = env.width, H = env.height, pal = env.palette;
      var k = RR.clamp(Math.round(+p.k || 12), 1, KEEP);
      /* na miniatura, posto bem baixo: a 88 px o k padrão pareceria a foto original */
      if (env.thumb) k = Math.min(k, 5);
      var color = !!p.colorido;
      ctx.fillStyle = pal.artBg;
      ctx.fillRect(0, 0, W, H);

      return Promise.all([env.getSource(WORK_W), RR.loadPortrait()]).then(function (res) {
        if (env.cancelled()) return;
        var src = res[0], photo = res[1];
        var list = color ? [getJob(src, 'r'), getJob(src, 'g'), getJob(src, 'b')] : [getJob(src, 'y')];
        var ready = list.every(function (j) { return j.done; });

        if (!ready) {
          env.setInfo('calculando decomposição…');
          /* palco: mostra o progresso a cada quadro; miniatura: só espera */
          if (!env.thumb) {
            var tick = function () {
              if (env.cancelled() || list.every(function (j) { return j.done; })) return;
              var fr = 0, sw = 0;
              list.forEach(function (j) { fr += j.progress; sw = Math.max(sw, j.done ? 0 : j.sweep); });
              drawProgress(ctx, W, H, photo, fr / list.length, sw, pal);
              env.frame(tick);
            };
            tick();
          }
          return Promise.all(list.map(whenDone)).then(function () {
            if (env.cancelled()) return;
            paint(src, photo, list);
          });
        }
        paint(src, photo, list);
      });

      function paint(src, photo, list) {
        var m = list[0].m, n = list[0].n, i, c;
        var tmp = document.createElement('canvas');
        tmp.width = n; tmp.height = m;
        var tx = tmp.getContext('2d'), img = tx.createImageData(n, m), o = img.data;
        var buf = new Float32Array(m * n);
        /* "Aleatorizar": seed 7 mantém as cores reais; outras seeds trocam os canais
           (colorido) ou o duotone (P&B), como variações de serigrafia */
        var variant = (env.seed | 0) === 7 ? 0 : 1 + Math.abs(env.seed | 0) % 5;
        if (color) {
          var perm = PERMS[variant % PERMS.length];
          for (c = 0; c < 3; c++) {
            reconstruct(list[c], k, buf);
            var oc = perm[c];
            for (i = 0; i < m * n; i++) o[i * 4 + oc] = RR.clamp(buf[i], 0, 1) * 255;
          }
          for (i = 0; i < m * n; i++) o[i * 4 + 3] = 255;
        } else {
          /* duotone: sombras escuras -> luzes claras (curvas por canal) */
          var duo = DUOS[variant % DUOS.length];
          reconstruct(list[0], k, buf);
          for (i = 0; i < m * n; i++) {
            var v = RR.clamp(buf[i], 0, 1), q = i * 4;
            o[q] = duo[0] + (duo[3] - duo[0]) * Math.pow(v, 1.15);
            o[q + 1] = duo[1] + (duo[4] - duo[1]) * Math.pow(v, 1.02);
            o[q + 2] = duo[2] + (duo[5] - duo[2]) * Math.pow(v, 0.92);
            o[q + 3] = 255;
          }
        }
        tx.putImageData(img, 0, 0);

        /* recorte em alta resolução: alfa da foto original + reconstrução ampliada */
        var dpr = env.dpr || 1, cw = Math.max(1, Math.round(W * dpr)), chh = Math.max(1, Math.round(H * dpr));
        var mc = maskFor(photo, cw, chh), mx = mc.work.getContext('2d');
        mx.globalCompositeOperation = 'copy';
        mx.drawImage(mc.mask, 0, 0);
        mx.globalCompositeOperation = 'source-in';
        mx.imageSmoothingEnabled = true;
        mx.imageSmoothingQuality = 'high';
        mx.drawImage(tmp, 0, 0, cw, chh);
        mx.globalCompositeOperation = 'source-over';

        ctx.fillStyle = pal.artBg;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(mc.work, 0, 0, W, H);
        if (p.espectro && !env.thumb) drawSpectrum(ctx, W, H, list, k, pal);

        var tot = 0, kept = 0;
        list.forEach(function (j) { tot += j.total; kept += j.energy[k]; });
        var ratio = (m * n) / (k * (m + n + 1));
        var pct = kept / tot * 100;
        /* perto de 100%, mais casas (sem arredondar para "100%" se ainda falta energia) */
        var pctTxt = pct >= 99.95 ? RR.fmt(Math.min(pct, 99.99), 2) : RR.fmt(pct, 1);
        env.setInfo('posto ' + k + ' · ' + pctTxt + '% da energia · ' +
          (ratio >= 1 ? RR.fmt(ratio, 1) + '× menos dados' : RR.fmt(1 / ratio, 1) + '× mais dados') +
          ' · matriz ' + m + '×' + n + (color ? ' × 3 canais' : ''));
      }
    }
  });
})();
