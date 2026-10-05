/* =========================================================================
   art/dither.js — "Quantização 1-bit"
   Difusão de erro de Floyd–Steinberg sobre a luminância dos pixels opacos:
   cada pixel vira um de N níveis e o erro do arredondamento vai para os
   vizinhos. Desenhado em blocos inteiros de pixels do dispositivo (nítido).
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  /* rampas escuro -> claro; com N níveis, amostramos N cores ao longo da rampa
     (top2: até onde ir na rampa quando há só 2 níveis) */
  var PALETTES = {
    mint: { bg: null, ramp: ['#0f2b29', '#9ef5cf'] },
    blue: { bg: null, ramp: ['#091040', '#3b63f0', '#8fb0ff', '#e8efff'], top2: 0.62 },
    sunset: { bg: null, ramp: ['#d23a78', '#ffbf95'] },
    gameboy: { bg: '#9bbc0f', ramp: ['#0f380f', '#306230', '#8bac0f', '#c4d97a'], top2: 0.67 }
  };

  function sampleRamp(ramp, t) {
    var x = RR.clamp(t, 0, 1) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
    var a = RR.hexToRgb(ramp[i]), b = RR.hexToRgb(ramp[i + 1]);
    return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
  }

  RR.art.register({
    id: 'dither',
    order: 8,
    title: 'Quantização 1-bit',
    short: 'Dithering',
    algo: 'Floyd–Steinberg',
    field: 'Quantização',
    description: 'A difusão de erro de Floyd–Steinberg reduz cada pixel a poucos níveis de tom e empurra o erro do arredondamento para os vizinhos, então os tons continuam corretos na média. É a mesma ideia por trás da quantização de modelos de IA: guardar pesos em int8 ou int4, com bem menos bits, distribuindo o erro para preservar a qualidade.',
    params: [
      {
        id: 'levels', label: 'Níveis', type: 'range', min: 2, max: 6, step: 1, value: 2,
        format: function (v) { return v + ' · ' + RR.fmt(Math.log(v) / Math.LN2, 2) + ' bit'; }
      },
      {
        id: 'palette', label: 'Paleta', type: 'select', value: 'mint', options: [
          { value: 'mint', label: 'Menta' },
          { value: 'blue', label: 'Azul elétrico' },
          { value: 'sunset', label: 'Pôr do sol' },
          { value: 'gameboy', label: 'Game Boy' }
        ]
      },
      { id: 'pixel', label: 'Tamanho do pixel', type: 'range', min: 1, max: 4, step: 1, value: 2, format: function (v) { return v + ' px'; } },
      { id: 'serpentine', label: 'Varredura serpentina', type: 'toggle', value: true }
    ],
    animated: false,
    render: function (ctx, p, env) {
      var L = RR.clamp(Math.round(p.levels) || 2, 2, 6);
      var pal = PALETTES[p.palette] || PALETTES.mint;
      var bg = pal.bg || env.palette.artBg;
      var cv = ctx.canvas, CW = cv.width, CH = cv.height;
      /* bloco em pixels do dispositivo: inteiro, para o pixel art ficar nítido */
      var px = env.thumb ? 1 : RR.clamp(Math.round(p.pixel) || 2, 1, 4);
      var block = Math.max(1, Math.round(px * env.dpr));
      var gw = Math.max(8, Math.ceil(CW / block));

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, CW, CH);
      ctx.restore();

      return env.getSource(gw).then(function (src) {
        if (env.cancelled()) return;
        var w = src.width, h = src.height, d = src.data, n = w * h, i;
        var mask = new Uint8Array(n), lum = new Float32Array(n), base = new Float32Array(n);
        var hist = new Uint32Array(256), count = 0;

        /* luminância + estiramento de contraste (percentis 1–99) */
        for (i = 0; i < n; i++) {
          var o = i * 4;
          if (d[o + 3] < 128) continue;
          mask[i] = 1;
          var y = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) | 0;
          lum[i] = y;
          hist[y]++;
          count++;
        }
        if (!count) return;
        var lo = 0, hi = 255, acc = 0;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= count * 0.01) { lo = i; break; } }
        acc = 0;
        for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= count * 0.01) { hi = i; break; } }
        var span = Math.max(1, hi - lo);
        for (i = 0; i < n; i++) if (mask[i]) base[i] = Math.pow(RR.clamp((lum[i] - lo) / span, 0, 1), 1.25);

        /* máscara de nitidez (unsharp) só dentro do retrato: realça olhos, barba e contornos */
        var r = Math.max(1, Math.round(w / 160)), amount = 0.8;
        var row = new Float32Array(n), rowN = new Float32Array(n);
        for (var yb = 0; yb < h; yb++) {
          var sum = 0, cnt = 0, rb = yb * w;
          for (var xb = -r; xb < w; xb++) {
            var xa = xb + r, xr = xb - r - 1;
            if (xa < w && mask[rb + xa]) { sum += base[rb + xa]; cnt++; }
            if (xr >= 0 && mask[rb + xr]) { sum -= base[rb + xr]; cnt--; }
            if (xb >= 0) { row[rb + xb] = sum; rowN[rb + xb] = cnt; }
          }
        }
        for (var xc = 0; xc < w; xc++) {
          var s2 = 0, c2 = 0;
          for (var yc = -r; yc < h; yc++) {
            var ya = yc + r, yr = yc - r - 1;
            if (ya < h) { s2 += row[ya * w + xc]; c2 += rowN[ya * w + xc]; }
            if (yr >= 0) { s2 -= row[yr * w + xc]; c2 -= rowN[yr * w + xc]; }
            if (yc >= 0) {
              i = yc * w + xc;
              if (mask[i] && c2 > 0) {
                var v = RR.clamp(base[i] + amount * (base[i] - s2 / c2), 0, 1);
                lum[i] = v;
              }
            }
          }
        }
        for (i = 0; i < n; i++) if (mask[i]) base[i] = lum[i];

        /* Floyd–Steinberg (7/16, 3/16, 5/16, 1/16) com leve jitter determinístico no limiar */
        var rand = RR.rng((env.seed >>> 0) * 747796405 + 2891336453);
        var steps = L - 1, out = new Uint8Array(n), sse = 0;
        var serp = !!p.serpentine;
        for (var yy = 0; yy < h; yy++) {
          var rev = serp && (yy & 1);
          var dir = rev ? -1 : 1, x0 = rev ? w - 1 : 0, x1 = rev ? -1 : w;
          var rw = yy * w, next = rw + w, hasNext = yy + 1 < h;
          for (var x = x0; x !== x1; x += dir) {
            i = rw + x;
            if (!mask[i]) continue;
            var old = lum[i];
            var qi = Math.round(old * steps + (rand() - 0.5) * 0.18);
            qi = qi < 0 ? 0 : qi > steps ? steps : qi;
            var q = qi / steps, err = old - q;
            out[i] = qi;
            var e0 = base[i] - q;
            sse += e0 * e0;
            var xn = x + dir;
            if (xn >= 0 && xn < w && mask[rw + xn]) lum[rw + xn] += err * 0.4375;
            if (hasNext) {
              var xb = x - dir;
              if (xb >= 0 && xb < w && mask[next + xb]) lum[next + xb] += err * 0.1875;
              if (mask[next + x]) lum[next + x] += err * 0.3125;
              if (xn >= 0 && xn < w && mask[next + xn]) lum[next + xn] += err * 0.0625;
            }
          }
        }

        /* pinta os índices com a paleta */
        var colors = [];
        var top = steps === 1 && pal.top2 ? pal.top2 : 1;
        for (i = 0; i <= steps; i++) colors.push(sampleRamp(pal.ramp, i / steps * top));
        var tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        var tx = tmp.getContext('2d');
        var img = tx.createImageData(w, h), od = img.data;
        for (i = 0; i < n; i++) {
          if (!mask[i]) continue;
          var col = colors[out[i]], k = i * 4;
          od[k] = col[0]; od[k + 1] = col[1]; od[k + 2] = col[2]; od[k + 3] = 255;
        }
        tx.putImageData(img, 0, 0);

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, 0, 0, w * block, h * block);
        ctx.restore();

        var bits = Math.log(L) / Math.LN2;
        env.setInfo(L + ' níveis = ' + RR.fmt(bits, 2) + ' bit/px (' + RR.fmt(8 / bits, 1) + '× menos que 8 bits) · ' +
          RR.fmt(count, 0) + ' px · erro quadrático médio ' + RR.fmt(sse / count, 3));
      });
    }
  });
})();
