/* =========================================================================
   art/kmeans.js — "Pop art por K-Means"
   Agrupa os pixels opacos do retrato em k cores no espaço Oklab: inicialização
   k-means++ (com a seed) e iterações de Lloyd animadas em baixa resolução;
   ao convergir, refina a atribuição em alta resolução para bordas nítidas.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  var MAX_ITER = 25;
  var STEP_MS = 95;          // intervalo entre iterações na animação
  var WORK_W = 160;          // resolução de trabalho do agrupamento
  var PORTRAIT_AR = 712 / 491;
  var MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

  /* sRGB 0..255 -> linear (tabela) */
  var LIN = new Float32Array(256);
  for (var li = 0; li < 256; li++) {
    var cl = li / 255;
    LIN[li] = cl <= 0.04045 ? cl / 12.92 : Math.pow((cl + 0.055) / 1.055, 2.4);
  }

  /* sRGB -> Oklab (×100, para a inércia ficar em unidades legíveis) */
  function oklab(r, g, b, out, o) {
    var lr = LIN[r], lg = LIN[g], lb = LIN[b];
    var l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    var m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    var s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    out[o] = (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s) * 100;
    out[o + 1] = (1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s) * 100;
    out[o + 2] = (0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s) * 100;
  }

  /* Warhol 2×2: cada quadro tem fundo chapado e uma rampa (escuro -> claro)
     para onde os clusters são remapeados por luminância */
  var POP = [
    { bg: '#ffb38a', ramp: ['#0a1f3d', '#0f6b5a', '#2fd3a0', '#9ef5cf', '#f2fff9'] },  // menta sobre sol
    { bg: '#9ef5cf', ramp: ['#0b0a2e', '#2a2fb8', '#4f7bff', '#a9c0ff', '#f1f5ff'] },  // azul sobre menta
    { bg: '#4f7bff', ramp: ['#2a0520', '#a3125a', '#ff4f9a', '#ffaccf', '#fff2f7'] },  // rosa sobre azul
    { bg: '#ff6fae', ramp: ['#2a0f05', '#b4400f', '#ff8a3d', '#ffc79f', '#fff6ec'] }   // sol sobre rosa
  ];

  var prepCache = typeof WeakMap === 'function' ? new WeakMap() : null;

  /* pontos = pixels opacos (alpha >= 128) em Oklab + RGB original */
  function prepare(src) {
    var hit = prepCache && prepCache.get(src);
    if (hit) return hit;
    var n = src.width * src.height, d = src.data, m = 0;
    var pts = new Float32Array(n * 3), rgb = new Uint8Array(n * 3), pix = new Uint32Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      if (d[o + 3] < 128) continue;
      oklab(d[o], d[o + 1], d[o + 2], pts, m * 3);
      rgb[m * 3] = d[o]; rgb[m * 3 + 1] = d[o + 1]; rgb[m * 3 + 2] = d[o + 2];
      pix[m] = i;
      m++;
    }
    var P = { w: src.width, h: src.height, m: m, pts: pts, rgb: rgb, pix: pix };
    if (prepCache) prepCache.set(src, P);
    return P;
  }

  /* k-means++: cada novo centroide é sorteado com probabilidade ∝ D² */
  function seedCenters(P, k, rand) {
    var m = P.m, pts = P.pts, C = new Float32Array(k * 3), D = new Float64Array(m), i, sum = 0;
    var f = Math.floor(rand() * m) * 3;
    C[0] = pts[f]; C[1] = pts[f + 1]; C[2] = pts[f + 2];
    for (i = 0; i < m; i++) {
      var a = pts[i * 3] - C[0], b = pts[i * 3 + 1] - C[1], c = pts[i * 3 + 2] - C[2];
      D[i] = a * a + b * b + c * c;
      sum += D[i];
    }
    for (var k2 = 1; k2 < k; k2++) {
      var pick = m - 1;
      if (sum > 0) {
        var r = rand() * sum, acc = 0;
        for (i = 0; i < m; i++) { acc += D[i]; if (acc >= r) { pick = i; break; } }
      } else pick = Math.floor(rand() * m);
      var q = k2 * 3, p3 = pick * 3;
      C[q] = pts[p3]; C[q + 1] = pts[p3 + 1]; C[q + 2] = pts[p3 + 2];
      sum = 0;
      for (i = 0; i < m; i++) {
        var x = pts[i * 3] - C[q], y = pts[i * 3 + 1] - C[q + 1], z = pts[i * 3 + 2] - C[q + 2];
        var d2 = x * x + y * y + z * z;
        if (d2 < D[i]) D[i] = d2;
        sum += D[i];
      }
    }
    return C;
  }

  /* um passo de Lloyd: atribui ao centroide mais próximo e move para a média */
  function lloyd(P, C, k, labels) {
    var m = P.m, pts = P.pts, rgb = P.rgb;
    var S = new Float64Array(k * 3), R = new Float64Array(k * 3), N = new Uint32Array(k);
    var changed = 0, inertia = 0, far = 0, farD = -1, i, c, q;
    for (i = 0; i < m; i++) {
      var o = i * 3, l = pts[o], a = pts[o + 1], b = pts[o + 2], best = 0, bd = Infinity;
      for (c = 0; c < k; c++) {
        q = c * 3;
        var dl = l - C[q], da = a - C[q + 1], db = b - C[q + 2];
        var d2 = dl * dl + da * da + db * db;
        if (d2 < bd) { bd = d2; best = c; }
      }
      if (labels[i] !== best) { changed++; labels[i] = best; }
      inertia += bd;
      if (bd > farD) { farD = bd; far = i; }
      q = best * 3;
      S[q] += l; S[q + 1] += a; S[q + 2] += b;
      R[q] += rgb[o]; R[q + 1] += rgb[o + 1]; R[q + 2] += rgb[o + 2];
      N[best]++;
    }
    var cols = new Array(k);
    for (c = 0; c < k; c++) {
      q = c * 3;
      if (N[c]) {
        C[q] = S[q] / N[c]; C[q + 1] = S[q + 1] / N[c]; C[q + 2] = S[q + 2] / N[c];
        cols[c] = [Math.round(R[q] / N[c]), Math.round(R[q + 1] / N[c]), Math.round(R[q + 2] / N[c])];
      } else {
        /* cluster vazio renasce no pixel mais distante */
        var f = far * 3;
        C[q] = pts[f]; C[q + 1] = pts[f + 1]; C[q + 2] = pts[f + 2];
        cols[c] = [rgb[f], rgb[f + 1], rgb[f + 2]];
        changed++;
      }
    }
    return { changed: changed, inertia: inertia, counts: N, cols: cols };
  }

  /* ---------- cores ---------- */
  function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function hex(c) {
    return '#' + c.map(function (v) { var s = v.toString(16); return s.length < 2 ? '0' + s : s; }).join('').toUpperCase();
  }
  function sampleRamp(ramp, t) {
    var x = RR.clamp(t, 0, 1) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
    var a = RR.hexToRgb(ramp[i]), b = RR.hexToRgb(ramp[i + 1]);
    return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
  }
  /* rank de luminância de cada cluster (0 = mais escuro) */
  function ranks(cols) {
    var idx = cols.map(function (c, i) { return i; });
    idx.sort(function (a, b) { return lum(cols[a]) - lum(cols[b]); });
    var r = new Array(cols.length);
    idx.forEach(function (c, i) { r[c] = i; });
    return r;
  }
  /* cores por quadro: única = cores reais; Warhol = rampas pop */
  function tileColors(cols, tiles) {
    if (!tiles) return [cols];
    var r = ranks(cols), k = cols.length;
    return tiles.map(function (t) {
      return cols.map(function (c, i) { return sampleRamp(t.ramp, k > 1 ? r[i] / (k - 1) : 0.5); });
    });
  }

  /* ---------- geometria ---------- */
  function layoutGeo(W, H, tiles) {
    if (!tiles) return [{ x: 0, y: 0, w: W, h: H, bg: null }];
    var g = Math.max(4, Math.round(W * 0.022)), tw = (W - g * 3) / 2, th = (H - g * 3) / 2;
    return tiles.map(function (t, i) {
      return { x: g + (i % 2) * (tw + g), y: g + Math.floor(i / 2) * (th + g), w: tw, h: th, bg: t.bg };
    });
  }
  function fit(tile) {
    var w = tile.w, h = w * PORTRAIT_AR;
    if (h > tile.h) { h = tile.h; w = h / PORTRAIT_AR; }
    return { x: tile.x + (tile.w - w) / 2, y: tile.y + tile.h - h, w: w, h: h };
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

  /* imagem (canvas) de um quadro a partir dos rótulos */
  function labelImage(w, h, labels, pix, alpha, colors, cache) {
    var c = cache.canvas || (cache.canvas = document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; cache.img = null; }
    var x = cache.ctx || (cache.ctx = c.getContext('2d'));
    var img = cache.img || (cache.img = x.createImageData(w, h));
    var d = img.data;
    d.fill(0);
    var n = labels.length;
    for (var i = 0; i < n; i++) {
      var lb = labels[i];
      if (lb === 255) continue;
      var o = (pix ? pix[i] : i) * 4, col = colors[lb];
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
      d[o + 3] = alpha ? alpha[o + 3] : 255;
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  /* desenha fundo + quadros + (opcional) faixa da paleta */
  function compose(ctx, env, geo, imgs, smooth, strip) {
    var W = env.width, H = env.height;
    ctx.save();
    ctx.fillStyle = env.palette.artBg;
    ctx.fillRect(0, 0, W, H);
    geo.forEach(function (t, i) {
      var r = fit(t);
      ctx.save();
      if (t.bg) {
        roundRect(ctx, t.x, t.y, t.w, t.h, Math.max(3, W * 0.012));
        ctx.fillStyle = t.bg;
        ctx.fill();
        ctx.clip();
      }
      ctx.imageSmoothingEnabled = smooth;
      if (smooth) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgs[i], r.x, r.y, r.w, r.h);
      ctx.restore();
    });
    if (strip) drawStrip(ctx, env, strip);
    ctx.restore();
  }

  /* faixa com os centroides (cores reais) e códigos hex */
  function drawStrip(ctx, env, s) {
    var W = env.width, H = env.height, cols = s.cols, k = cols.length;
    var order = cols.map(function (c, i) { return i; }).sort(function (a, b) { return lum(cols[a]) - lum(cols[b]); });
    var pad = Math.max(10, Math.round(W * 0.032)), gap = Math.max(3, Math.round(W * 0.009));
    var sw = (W - pad * 2 - gap * (k - 1)) / k;
    var vertical = sw < 56;
    var fs = W < 320 ? 9 : 10;
    var titleH = fs + 9, swH = vertical ? Math.round(fs * 6.2) : Math.round(fs * 2.6), labelH = vertical ? 0 : fs + 8;
    var bandH = pad + titleH + swH + labelH + pad * 0.8;
    var y0 = H - bandH;
    var total = 0;
    for (var t = 0; t < k; t++) total += s.counts[t];

    var grad = ctx.createLinearGradient(0, y0 - 24, 0, y0 + 10);
    grad.addColorStop(0, 'rgba(7,8,13,0)');
    grad.addColorStop(1, 'rgba(7,8,13,0.86)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0 - 24, W, 34);
    ctx.fillStyle = 'rgba(7,8,13,0.86)';
    ctx.fillRect(0, y0 + 10, W, bandH - 10);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(pad, y0 + 2, W - pad * 2, 1);

    ctx.font = '500 ' + fs + 'px ' + MONO;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ef5cf';
    ctx.fillText('paleta aprendida', pad, y0 + pad * 0.7);
    ctx.fillStyle = 'rgba(195,201,222,0.75)';
    ctx.textAlign = 'right';
    ctx.fillText('k = ' + k + ' centroides', W - pad, y0 + pad * 0.7);

    var y = y0 + pad * 0.7 + titleH;
    order.forEach(function (ci, j) {
      var x = pad + j * (sw + gap), col = cols[ci], hx = hex(col);
      roundRect(ctx, x, y, sw, swH, Math.min(6, sw * 0.18));
      ctx.fillStyle = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();
      var light = lum(col) > 140;
      if (vertical) {
        ctx.save();
        ctx.translate(x + sw / 2, y + swH - 6);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = light ? 'rgba(7,8,13,0.82)' : 'rgba(238,241,251,0.9)';
        ctx.fillText(hx, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(238,241,251,0.88)';
        ctx.fillText(hx, x + sw / 2, y + swH + 6);
        ctx.textBaseline = 'middle';
        ctx.fillStyle = light ? 'rgba(7,8,13,0.7)' : 'rgba(238,241,251,0.72)';
        ctx.fillText(Math.round(s.counts[ci] / total * 100) + '%', x + sw / 2, y + swH / 2);
      }
    });
  }

  /* 3,2·10⁶ */
  var SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  function sci(v) {
    if (!isFinite(v)) return '—';
    if (v < 1e4) return RR.fmt(v, 0);
    var e = Math.floor(Math.log(v) / Math.LN10), mant = v / Math.pow(10, e);
    if (mant >= 9.995) { mant /= 10; e++; }
    return RR.fmt(mant, 2) + '·10' + String(e).split('').map(function (ch) { return SUP[+ch]; }).join('');
  }

  RR.art.register({
    id: 'kmeans',
    order: 1,
    title: 'Pop art por K-Means',
    short: 'K-Means',
    algo: 'K-Means',
    field: 'Aprendizado não supervisionado',
    description: 'O K-Means agrupa os milhares de pixels da foto em k cores, sem nenhum rótulo: a cada iteração, cada pixel vai para o centroide mais próximo e cada centroide se move para a média do seu grupo. É aprendizado não supervisionado na prática, e foi assim que a paleta deste site saiu da minha foto.',
    params: [
      { id: 'k', label: 'Clusters (k)', type: 'range', min: 2, max: 12, step: 1, value: 5, format: function (v) { return 'k = ' + v; } },
      { id: 'layout', label: 'Layout', type: 'select', options: [{ value: 'single', label: 'Único' }, { value: 'warhol', label: 'Warhol 2×2' }], value: 'single' },
      { id: 'palette', label: 'Mostrar paleta', type: 'toggle', value: true }
    ],
    animated: true,
    render: function (ctx, p, env) {
      var k = RR.clamp(Math.round(p.k) || 5, 2, 12);
      var warhol = p.layout === 'warhol' && !env.thumb;
      var W = env.width, H = env.height;
      ctx.fillStyle = env.palette.artBg;
      ctx.fillRect(0, 0, W, H);

      var workW = env.thumb ? Math.min(200, Math.round(W * env.dpr)) : WORK_W;
      return env.getSource(workW).then(function (src) {
        if (env.cancelled()) return;
        var P = prepare(src);
        if (P.m < k) return;
        var rand = RR.rng(((env.seed >>> 0) * 2654435761 + k * 97) >>> 0);
        var tiles = null;
        if (warhol) {
          var off = ((env.seed >>> 0) + 1) % POP.length;
          tiles = POP.map(function (t, i) { return POP[(i + off) % POP.length]; });
        }
        // "Aleatorizar" no layout único: a seed escolhe uma paleta pop (a seed padrão mantém as cores reais da foto)
        var single = null;
        if (!warhol && !env.thumb && (env.seed >>> 0) !== 7) single = POP[(env.seed >>> 0) % POP.length];
        var geo = layoutGeo(W, H, tiles);
        if (single) geo[0].bg = single.bg;
        var C = seedCenters(P, k, rand);
        var labels = new Uint8Array(P.m).fill(255);
        var caches = geo.map(function () { return {}; });
        var maxIter = env.thumb ? 4 : MAX_ITER;
        var iter = 0, res = null, converged = false;

        function stepOnce() {
          res = lloyd(P, C, k, labels);
          iter++;
          converged = res.changed <= Math.max(2, P.m * 0.002);
          return converged || iter >= maxIter;
        }
        function strip() { return p.palette && !env.thumb ? { cols: res.cols, counts: res.counts } : null; }
        function drawLow() {
          var colors = single ? tileColors(res.cols, [single]) : tileColors(res.cols, tiles);
          var imgs = colors.map(function (cs, i) { return labelImage(P.w, P.h, labels, P.pix, null, cs, caches[i]); });
          compose(ctx, env, geo, imgs, !!env.thumb, strip());
        }
        function info(final) {
          var head = 'k = ' + k + ' · ';
          var mid = !final ? 'iteração ' + iter
            : converged ? 'convergiu em ' + iter + (iter === 1 ? ' iteração' : ' iterações')
              : iter + ' iterações (limite)';
          env.setInfo(head + mid + ' · inércia ' + sci(res.inertia));
        }

        /* refinamento: atribui cada pixel da fonte em alta resolução ao centroide final */
        function refine(sync) {
          var srcW = Math.min(1000, Math.max(64, Math.round(fit(geo[0]).w * env.dpr)));
          return env.getSource(srcW).then(function (hs) {
            if (env.cancelled()) return;
            var w = hs.width, hh = hs.height, d = hs.data, lab = new Uint8Array(w * hh), tmp = new Float32Array(3), y = 0;
            return new Promise(function (resolve) {
              function work() {
                if (env.cancelled()) { resolve(); return; }
                var start = performance.now();
                while (y < hh) {
                  for (var x = 0, i = y * w; x < w; x++, i++) {
                    var o = i * 4;
                    if (d[o + 3] < 6) { lab[i] = 255; continue; }
                    oklab(d[o], d[o + 1], d[o + 2], tmp, 0);
                    var best = 0, bd = Infinity;
                    for (var c = 0; c < k; c++) {
                      var q = c * 3, a = tmp[0] - C[q], b = tmp[1] - C[q + 1], e = tmp[2] - C[q + 2], d2 = a * a + b * b + e * e;
                      if (d2 < bd) { bd = d2; best = c; }
                    }
                    lab[i] = best;
                  }
                  y++;
                  if (!sync && performance.now() - start > 9) break;
                }
                if (y < hh) { env.frame(work); return; }
                var colors = single ? tileColors(res.cols, [single]) : tileColors(res.cols, tiles);
                var imgs = colors.map(function (cs, ti) { return labelImage(w, hh, lab, null, d, cs, caches[ti]); });
                compose(ctx, env, geo, imgs, true, strip());
                info(true);
                resolve();
              }
              work();
            });
          });
        }

        if (env.thumb) {
          while (!stepOnce()) { /* poucas iterações */ }
          drawLow();
          return;
        }
        if (RR.reducedMotion) {
          while (!stepOnce()) { /* tudo de uma vez, sem animação */ }
          drawLow();
          info(true);
          return refine(true);
        }
        return new Promise(function (resolve, reject) {
          var last = -Infinity;
          function tick(ts) {
            if (env.cancelled()) { resolve(); return; }
            if (ts - last < STEP_MS) { env.frame(tick); return; }
            last = ts;
            var done = stepOnce();
            drawLow();
            info(false);
            if (done) refine(false).then(resolve, reject);
            else env.frame(tick);
          }
          env.frame(tick);
        });
      });
    }
  });
})();
