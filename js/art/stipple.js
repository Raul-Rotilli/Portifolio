/* =========================================================================
   art/stipple.js — "Pontilhismo de Voronoi"
   Pontilhismo por Voronoi ponderado (Secord, 2002): os pontos nascem por
   amostragem de rejeição sobre o brilho e o algoritmo de Lloyd os relaxa —
   cada pixel vai para o ponto mais próximo (grade uniforme de baldes) e cada
   ponto vai para o centro de massa ponderado da sua célula. Tinta escura sobre
   papel: a densidade segue a escuridão. As iterações são fatiadas entre
   quadros e a transição entre elas é interpolada.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  var ASPECT = 712 / 491;
  var PAPER = '#f0e9dc';               // papel quente: tinta escura lê melhor olhos, barba e cabelo
  var INK = '#191a24';
  var FLOOR = 0.02;                    // densidade mínima dentro do retrato
  var GAMMA = 1.25;                    // contraste da densidade
  var RIM = 0.42;                      // densidade na borda da silhueta
  var SLICE_MS = 7;                    // orçamento de cálculo por quadro (sobra tempo para desenhar)
  var SLICE_RM = 11;                   // sem animação: só cálculo
  var HOLD_MS = 320;                   // tempo mostrando a nuvem inicial
  var TAU = Math.PI * 2;

  function fmtInt(v) { return RR.fmt(v); }

  /* desfoque de caixa separável de raio r: src -> out (tmp é auxiliar) */
  function boxBlur(src, tmp, out, w, h, r) {
    var x, y, i, s, norm = 1 / (2 * r + 1);
    for (y = 0; y < h; y++) {
      var row = y * w;
      s = 0;
      for (x = -r; x <= r; x++) s += src[row + RR.clamp(x, 0, w - 1)];
      for (x = 0; x < w; x++) {
        tmp[row + x] = s * norm;
        s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      s = 0;
      for (y = -r; y <= r; y++) s += tmp[RR.clamp(y, 0, h - 1) * w + x];
      for (y = 0; y < h; y++) {
        i = y * w + x;
        out[i] = s * norm;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }

  RR.art.register({
    id: 'stipple',
    order: 6,
    title: 'Pontilhismo de Voronoi',
    short: 'Voronoi',
    algo: 'Lloyd / Voronoi ponderado',
    field: 'Clustering geométrico',
    description: 'Milhares de pontos nascem sorteados conforme os tons escuros da foto e são relaxados pelo algoritmo de Lloyd: cada pixel vai para o ponto mais próximo, formando um diagrama de Voronoi, e cada ponto se move para o centro de massa da sua célula. É literalmente o k-means no espaço da imagem — os pontos são os centroides e cada iteração reduz a mesma função de custo, até tudo se acomodar num pontilhismo uniforme.',
    params: [
      { id: 'pontos', label: 'Pontos', type: 'range', min: 800, max: 7000, step: 100, value: 3200, format: fmtInt },
      { id: 'iteracoes', label: 'Iterações', type: 'range', min: 1, max: 40, step: 1, value: 18, format: fmtInt },
      { id: 'colorido', label: 'Colorido', type: 'toggle', value: false }
    ],
    animated: true,
    render: function (ctx, p, env) {
      var W = env.width, H = env.height, thumb = !!env.thumb;
      var N = thumb ? RR.clamp(Math.round(p.pontos * 0.2), 450, 900) : RR.clamp(Math.round(p.pontos) || 3200, 100, 9000);
      var iters = thumb ? 3 : RR.clamp(Math.round(p.iteracoes) || 18, 1, 60);
      var colour = !!p.colorido;
      var rand = RR.rng((env.seed >>> 0) * 1597334677 + 7);

      /* papel com vinheta suave (gradiente criado uma vez) */
      var vignette = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      vignette.addColorStop(0, 'rgba(255,252,245,0.35)');
      vignette.addColorStop(1, 'rgba(120,96,64,0.16)');
      function clear() {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      clear();

      /* raster de trabalho: ~28 pixels por ponto (centroides precisos), entre ½ e 1× o palco */
      var rw = thumb ? 120 : RR.clamp(Math.round(Math.sqrt(N * 28 / 0.58 / ASPECT)), Math.round(W * 0.5), Math.min(491, Math.round(W)));
      return env.getSource(rw).then(function (src) {
        if (env.cancelled()) return;
        var w = src.width, h = src.height, n = w * h, data = src.data, i, x, y;
        var scx = W / w, scy = H / h;

        /* brilho normalizado pelos percentis 2–98 dos pixels opacos */
        var lum = new Float32Array(n), hist = new Uint32Array(256), opaque = 0;
        for (i = 0; i < n; i++) {
          var o = i * 4;
          var l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
          lum[i] = l;
          if (data[o + 3] > 127) { hist[Math.min(255, (l * 255) | 0)]++; opaque++; }
        }
        var lo = 0, hi = 1, acc = 0;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= opaque * 0.02) { lo = i / 255; break; } }
        acc = 0;
        for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= opaque * 0.02) { hi = i / 255; break; } }
        if (hi - lo < 0.05) { lo = 0; hi = 1; }

        /* tom: brilho normalizado + máscara de nitidez (realça olhos, sobrancelhas e barba);
           o fundo transparente conta como papel (claro) */
        var tone = new Float32Array(n), soft = new Float32Array(n), tmp = new Float32Array(n), R = thumb ? 2 : 7;
        for (i = 0; i < n; i++) tone[i] = data[i * 4 + 3] > 5 ? RR.clamp((lum[i] - lo) / (hi - lo), 0, 1) : 1;
        boxBlur(tone, tmp, soft, w, h, R);
        /* densidade = escuridão^1,25 (tinta sobre papel), suavizada (picos estreitos viram "estrelas" no Lloyd) */
        var raw = new Float32Array(n);
        for (i = 0; i < n; i++) {
          var a = data[i * 4 + 3] / 255;
          if (a < 0.02) continue;
          var t = 1 - RR.clamp(tone[i] + 1.15 * (tone[i] - soft[i]), 0, 1);
          raw[i] = (FLOOR + (1 - FLOOR) * t * Math.pow(t, GAMMA - 1)) * a;
        }
        /* contorno: uma linha de pontos desenha a silhueta (a pele clara não se perde no papel) */
        for (y = 1; y < h - 1; y++) {
          for (x = 1; x < w - 1; x++) {
            i = y * w + x;
            if (data[i * 4 + 3] < 128) continue;
            var ex = data[(i + 1) * 4 + 3] + data[(i - 1) * 4 + 3] + data[(i + w) * 4 + 3] + data[(i - w) * 4 + 3];
            if (ex < 4 * 250) raw[i] = Math.max(raw[i], RIM);
          }
        }
        var den = new Float32Array(n), dmax = 0;
        boxBlur(raw, tmp, den, w, h, thumb ? 1 : 2);
        for (i = 0; i < n; i++) {
          if (raw[i] <= 0) den[i] = 0;
          else if (den[i] > dmax) dmax = den[i];
        }
        var cnt = 0, M = 0;
        for (i = 0; i < n; i++) if (den[i] > 1e-4) cnt++;
        if (!cnt) return;
        var pix = new Int32Array(cnt), pw = new Float32Array(cnt), c = 0;
        for (i = 0; i < n; i++) if (den[i] > 1e-4) { pix[c] = i; pw[c] = den[i]; M += den[i]; c++; }

        /* inicialização: amostragem de rejeição sobre a densidade */
        var X = new Float32Array(2 * N);
        for (var k = 0; k < N; k++) {
          for (var tries = 0; tries < 400; tries++) {
            var j = (rand() * cnt) | 0;
            if (rand() * dmax <= pw[j] || tries === 399) {
              X[2 * k] = (pix[j] % w) + rand();
              X[2 * k + 1] = ((pix[j] / w) | 0) + rand();
              break;
            }
          }
        }

        /* grade uniforme de baldes para a busca do ponto mais próximo */
        var cs = Math.max(1.5, Math.sqrt(cnt / N) * 0.9), ics = 1 / cs;
        var gw = Math.ceil(w * ics) + 1, gh = Math.ceil(h * ics) + 1, G = gw * gh;
        var cellStart = new Int32Array(G + 1), fillPos = new Int32Array(G), cellItems = new Int32Array(N), cellOf = new Int32Array(N);
        var accX = new Float64Array(N), accY = new Float64Array(N), accW = new Float64Array(N);
        function buildGrid() {
          cellStart.fill(0);
          for (var q = 0; q < N; q++) {
            var cx = (X[2 * q] * ics) | 0, cy = (X[2 * q + 1] * ics) | 0;
            var cc = cy * gw + cx;
            cellOf[q] = cc; cellStart[cc + 1]++;
          }
          for (var g = 0; g < G; g++) cellStart[g + 1] += cellStart[g];
          fillPos.set(cellStart.subarray(0, G));
          for (q = 0; q < N; q++) cellItems[fillPos[cellOf[q]]++] = q;
          accX.fill(0); accY.fill(0); accW.fill(0);
        }
        /* atribui os pixels [from, to) ao ponto mais próximo e acumula os centroides */
        var maxRing = Math.max(gw, gh);
        function assign(from, to) {
          for (var q = from; q < to; q++) {
            var idx = pix[q], wt = pw[q];
            var py = (idx / w) | 0, px = idx - py * w;
            var fx = px + 0.5, fy = py + 0.5;
            var cx = (fx * ics) | 0, cy = (fy * ics) | 0;
            var best = 1e18, bi = -1;
            for (var ring = 0; ring < maxRing; ring++) {
              var y0 = cy - ring, y1 = cy + ring, x0 = cx - ring, x1 = cx + ring;
              for (var gy = y0; gy <= y1; gy++) {
                if (gy < 0 || gy >= gh) continue;
                var stepX = (gy === y0 || gy === y1) ? 1 : (x1 - x0) || 1;
                for (var gx = x0; gx <= x1; gx += stepX) {
                  if (gx < 0 || gx >= gw) continue;
                  var cc = gy * gw + gx;
                  for (var e = cellStart[cc], end = cellStart[cc + 1]; e < end; e++) {
                    var jj = cellItems[e];
                    var ddx = X[2 * jj] - fx, ddy = X[2 * jj + 1] - fy, d2 = ddx * ddx + ddy * ddy;
                    if (d2 < best) { best = d2; bi = jj; }
                  }
                }
              }
              if (bi >= 0) { var lim = ring * cs; if (best <= lim * lim) break; }
            }
            accX[bi] += wt * fx; accY[bi] += wt * fy; accW[bi] += wt;
          }
        }
        /* fecha a iteração: cada ponto vai ao centroide ponderado da sua célula */
        function moveToCentroids() {
          var moved = 0;
          for (var q = 0; q < N; q++) {
            if (accW[q] <= 0) continue;
            var nx = accX[q] / accW[q], ny = accY[q] / accW[q];
            var ddx = nx - X[2 * q], ddy = ny - X[2 * q + 1];
            moved += Math.sqrt(ddx * ddx * scx * scx + ddy * ddy * scy * scy);
            X[2 * q] = RR.clamp(nx, 0, w - 0.001);
            X[2 * q + 1] = RR.clamp(ny, 0, h - 0.001);
          }
          return moved / N;
        }

        /* raio do ponto: cobertura cresce com a densidade local (cerca de 55% nas sombras) */
        var r0 = Math.sqrt(0.44 * (M / (N * dmax)) / Math.PI) * (scx + scy) / 2;
        var rMin = thumb ? 0.28 : 0.42;
        function radiusAt(fx, fy) {
          var d = den[(Math.min(h - 1, fy | 0)) * w + Math.min(w - 1, fx | 0)] / dmax;
          var r = r0 * (0.32 + 0.85 * Math.pow(d, 0.6));
          return r < rMin ? rMin : r;
        }
        /* cor da foto, com teto de claridade para continuar visível no papel */
        var bucketOf = new Int32Array(N), bucketCount = new Int32Array(513), bucketItems = new Int32Array(N), bucketFill = new Int32Array(512);
        var bucketCss = [];
        for (i = 0; i < 512; i++) bucketCss.push('rgb(' + (((i >> 6) & 7) * 32 + 16) + ',' + (((i >> 3) & 7) * 32 + 16) + ',' + ((i & 7) * 32 + 16) + ')');
        function colourBucket(fx, fy) {
          var o = ((Math.min(h - 1, fy | 0)) * w + Math.min(w - 1, fx | 0)) * 4;
          var r = data[o], g = data[o + 1], b = data[o + 2], mx = Math.max(r, g, b, 1);
          var f = Math.min(1, 205 / mx), m = (r + g + b) / 3;
          r = RR.clamp((m + (r - m) * 1.2) * f, 0, 255); g = RR.clamp((m + (g - m) * 1.2) * f, 0, 255); b = RR.clamp((m + (b - m) * 1.2) * f, 0, 255);
          return ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        }
        function draw(P) {
          clear();
          var q, fx, fy, r;
          if (!colour) {
            ctx.fillStyle = INK;
            ctx.beginPath();
            for (q = 0; q < N; q++) {
              fx = P[2 * q]; fy = P[2 * q + 1]; r = radiusAt(fx, fy);
              var x0 = fx * scx, y0 = fy * scy;
              ctx.moveTo(x0 + r, y0);
              ctx.arc(x0, y0, r, 0, TAU);
            }
            ctx.fill();
            return;
          }
          /* colorido: agrupa por cor quantizada (512 baldes) para poucos fill() */
          bucketCount.fill(0);
          for (q = 0; q < N; q++) { var bq = colourBucket(P[2 * q], P[2 * q + 1]); bucketOf[q] = bq; bucketCount[bq + 1]++; }
          for (q = 0; q < 512; q++) bucketCount[q + 1] += bucketCount[q];
          bucketFill.set(bucketCount.subarray(0, 512));
          for (q = 0; q < N; q++) bucketItems[bucketFill[bucketOf[q]]++] = q;
          for (var b = 0; b < 512; b++) {
            var s0 = bucketCount[b], s1 = bucketCount[b + 1];
            if (s0 === s1) continue;
            ctx.fillStyle = bucketCss[b];
            ctx.beginPath();
            for (var e = s0; e < s1; e++) {
              q = bucketItems[e];
              fx = P[2 * q]; fy = P[2 * q + 1]; r = radiusAt(fx, fy);
              ctx.moveTo(fx * scx + r, fy * scy);
              ctx.arc(fx * scx, fy * scy, r, 0, TAU);
            }
            ctx.fill();
          }
        }
        function info(it, disp) {
          env.setInfo('iteração ' + it + '/' + iters + ' · ' + RR.fmt(N) + ' pontos · ' +
            (it === 0 ? 'amostragem inicial' : 'deslocamento médio ' + disp.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' px'));
        }

        /* estado das iterações (fatiadas) */
        var iter = 0, pos = 0, lastDisp = 0;
        function compute(budget, stopAfterOne) {
          var t0 = performance.now();
          while (iter < iters) {
            if (pos === 0) buildGrid();
            var end = Math.min(cnt, pos + 1500);
            assign(pos, end);
            pos = end;
            if (pos >= cnt) {
              lastDisp = moveToCentroids();
              iter++; pos = 0;
              if (stopAfterOne) return true;
            }
            if (performance.now() - t0 > budget) return false;
          }
          return false;
        }

        if (thumb) {
          while (iter < iters) compute(1e9, false);
          draw(X);
          return;
        }

        info(0, 0);
        if (RR.reducedMotion) {
          /* sem animação: calcula fatiado e desenha só o resultado final */
          var rmFrame = function () {
            if (env.cancelled()) return;
            compute(SLICE_RM, false);
            if (iter < iters) { env.frame(rmFrame); return; }
            draw(X);
            info(iters, lastDisp);
          };
          env.frame(rmFrame);
          return;
        }

        /* animação: snapshots por iteração; a tela interpola linearmente entre eles */
        draw(X);
        var from = new Float32Array(X), to = from, disp = new Float32Array(2 * N);
        var queue = [], tStart = -1, dur = HOLD_MS, shownIter = 0, drawMs = 4;
        var stepMs = RR.clamp(1500 / iters, 55, 170);
        function frame(ts) {
          if (env.cancelled()) return;
          if (tStart < 0) tStart = ts;
          if (ts - tStart >= dur && queue.length) {
            var nx = queue.shift();
            from = to; to = nx.P; tStart = ts; dur = stepMs;
            shownIter = nx.it;
            info(nx.it, nx.d);
          }
          /* calcula a próxima iteração enquanto a fila tem espaço */
          if (iter < iters && queue.length < 2 && compute(RR.clamp(11 - drawMs, 3, SLICE_MS), true)) {
            queue.push({ P: new Float32Array(X), it: iter, d: lastDisp });
          }
          var k = Math.min(1, (ts - tStart) / dur);
          if (from !== to) {
            for (var q = 0; q < 2 * N; q++) disp[q] = from[q] + (to[q] - from[q]) * k;
            var td = performance.now();
            draw(k >= 1 ? to : disp);
            drawMs = performance.now() - td;
            if (k >= 1) from = to;
          }
          if (iter < iters || queue.length || shownIter < iters || from !== to) env.frame(frame);
        }
        env.frame(frame);
      });
    }
  });
})();
