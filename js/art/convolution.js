/* =========================================================================
   art/convolution.js — "Mapa de features"
   Convolução 2D com kernels 3×3 escolhidos à mão (os mesmos que uma CNN
   aprende nas primeiras camadas). A saída é revelada por uma varredura,
   como se o kernel deslizasse sobre a foto; o kernel atual aparece num
   cartão no canto. Com "Cor por orientação", o matiz vem do ângulo do
   gradiente e o brilho, da resposta do filtro.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  var MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  var DUR = 1000;          // duração da varredura (ms)
  var WORK_FRAC = 0.6;     // resolução de trabalho ≈ 60% da largura do palco (px CSS)
  var TAU = Math.PI * 2;

  /* rampa de ativação (escuro -> azul -> menta -> quase branco) em LUT de 256 */
  var RAMP = [[11, 14, 26], [24, 36, 98], [64, 104, 240], [120, 220, 214], [158, 245, 207], [246, 255, 251]];
  var LUT = (function () {
    var out = new Uint8Array(256 * 3), seg = RAMP.length - 1;
    for (var i = 0; i < 256; i++) {
      var x = i / 255 * seg, k = Math.min(seg - 1, Math.floor(x)), f = x - k, a = RAMP[k], b = RAMP[k + 1];
      for (var c = 0; c < 3; c++) out[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
    }
    return out;
  })();

  /* kernels: matriz 3×3 (linha a linha) em função da intensidade a */
  var KERNELS = {
    sobel: {
      name: 'Sobel', sub: 'Gx · Gy = Gxᵀ', taps: 18,
      m: function () { return [-1, 0, 1, -2, 0, 2, -1, 0, 1]; }
    },
    laplaciano: {
      name: 'Laplaciano', sub: '∇² · foto suavizada', taps: 18,
      m: function () { return [0, 1, 0, 1, -4, 1, 0, 1, 0]; }
    },
    relevo: {
      name: 'Relevo', sub: 'luz a 45°', taps: 9,
      m: function (a) { return [-2 * a, -a, 0, -a, 1, a, 0, a, 2 * a]; }
    },
    nitidez: {
      name: 'Nitidez', sub: 'centro − vizinhos', taps: 9,
      m: function (a) { return [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]; }
    },
    desfoque: {
      name: 'Gaussiano', sub: '÷ 16', taps: 9,
      m: function () { return [1, 2, 1, 2, 4, 2, 1, 2, 1]; }
    }
  };

  var SOBEL_X = KERNELS.sobel.m(), SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  var GAUSS = KERNELS.desfoque.m().map(function (v) { return v / 16; });

  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* HSV -> RGB (0..1) escrito em out[o..o+2] já em 0..255 */
  function hsv(h, s, v, out, o) {
    h = ((h % 1) + 1) % 1 * 6;
    var i = Math.floor(h), f = h - i;
    var p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f)), r, g, b;
    switch (i) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q;
    }
    out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255;
  }

  /* convolução 3×3; na moldura da imagem repete a borda (o corte da camiseta
     não vira "aresta"); o fundo já é zero porque a luminância é pré-multiplicada */
  function conv3(src, w, h, k, out) {
    var k0 = k[0], k1 = k[1], k2 = k[2], k3 = k[3], k4 = k[4], k5 = k[5], k6 = k[6], k7 = k[7], k8 = k[8];
    for (var y = 0; y < h; y++) {
      var r0 = (y > 0 ? y - 1 : 0) * w, r1 = y * w, r2 = (y < h - 1 ? y + 1 : h - 1) * w;
      for (var x = 0; x < w; x++) {
        var xl = x > 0 ? x - 1 : 0, xr = x < w - 1 ? x + 1 : w - 1;
        out[r1 + x] =
          k0 * src[r0 + xl] + k1 * src[r0 + x] + k2 * src[r0 + xr] +
          k3 * src[r1 + xl] + k4 * src[r1 + x] + k5 * src[r1 + xr] +
          k6 * src[r2 + xl] + k7 * src[r2 + x] + k8 * src[r2 + xr];
      }
    }
    return out;
  }

  /* percentil aproximado por histograma (apenas onde mask = 1) */
  function percentile(arr, mask, p) {
    var n = arr.length, max = 0, i, cnt = 0;
    for (i = 0; i < n; i++) if (mask[i] && arr[i] > max) max = arr[i];
    if (max <= 0) return 1;
    var bins = new Uint32Array(1024), sc = 1023 / max;
    for (i = 0; i < n; i++) if (mask[i]) { bins[(arr[i] * sc) | 0]++; cnt++; }
    var target = cnt * p, acc = 0;
    for (i = 0; i < 1024; i++) { acc += bins[i]; if (acc >= target) return Math.max(1e-6, (i + 0.5) / sc); }
    return max;
  }

  /* pré-processamento por resolução: luminância (estirada, pré-multiplicada pelo
     alfa), máscara de "perto do retrato" e gradiente de Sobel para a orientação */
  var prepCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function prepare(src) {
    var hit = prepCache && prepCache.get(src);
    if (hit) return hit;
    var w = src.width, h = src.height, n = w * h, d = src.data, i;
    var lum = new Float32Array(n), alpha = new Float32Array(n), hist = new Uint32Array(256), cnt = 0;
    for (i = 0; i < n; i++) {
      var o = i * 4, a = d[o + 3] / 255;
      alpha[i] = a;
      var y = 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];
      lum[i] = y;
      if (a > 0.5) { hist[y | 0]++; cnt++; }
    }
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cnt * 0.01) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cnt * 0.01) { hi = i; break; } }
    var span = Math.max(1, hi - lo);
    for (i = 0; i < n; i++) lum[i] = RR.clamp((lum[i] - lo) / span, 0, 1) * alpha[i];

    /* máscara dilatada: onde a resposta pode aparecer (inclui o contorno) */
    var mask = new Uint8Array(n);
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var on = 0;
        for (var dy = -1; dy <= 1 && !on; dy++) {
          var ry = yy + dy;
          if (ry < 0 || ry >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var rx = xx + dx;
            if (rx >= 0 && rx < w && alpha[ry * w + rx] > 0.04) { on = 1; break; }
          }
        }
        mask[yy * w + xx] = on;
      }
    }

    var gx = conv3(lum, w, h, SOBEL_X, new Float32Array(n));
    var gy = conv3(lum, w, h, SOBEL_Y, new Float32Array(n));
    var mag = new Float32Array(n);
    for (i = 0; i < n; i++) mag[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
    var magRef = percentile(mag, mask, 0.985);

    var res = { w: w, h: h, n: n, lum: lum, alpha: alpha, mask: mask, gx: gx, gy: gy, mag: mag, magRef: magRef, dim: null };
    if (prepCache) prepCache.set(src, res);
    return res;
  }

  /* foto de entrada esmaecida (parte ainda não varrida) */
  function dimCanvas(P, bg) {
    if (P.dim) return P.dim;
    var c = document.createElement('canvas');
    c.width = P.w; c.height = P.h;
    var x = c.getContext('2d'), img = x.createImageData(P.w, P.h), o = img.data;
    for (var i = 0; i < P.n; i++) {
      var a = P.alpha[i], l = P.alpha[i] > 0 ? P.lum[i] / a : 0, k = i * 4;
      var g = 0.16 + 0.4 * l;
      o[k] = bg[0] + (150 * g - bg[0]) * a;
      o[k + 1] = bg[1] + (165 * g - bg[1]) * a;
      o[k + 2] = bg[2] + (205 * g - bg[2]) * a;
      o[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    P.dim = c;
    return c;
  }

  /* aplica o kernel escolhido e pinta o mapa de features (ImageData opaco) */
  function featureMap(P, p, bg, hueShift) {
    var w = P.w, h = P.h, n = P.n, i;
    var kind = KERNELS[p.kernel] ? p.kernel : 'sobel';
    var a = RR.clamp(+p.intensidade || 1.5, 0.5, 3);
    var val = new Float32Array(n), sign = null;

    if (kind === 'sobel') {
      var g = a * 0.62 / P.magRef;
      for (i = 0; i < n; i++) val[i] = Math.pow(Math.min(1, P.mag[i] * g), 0.82);
    } else if (kind === 'laplaciano') {
      /* uma passada gaussiana antes (≈ LoG): o ∇² puro só realçaria o ruído da pele */
      var sm = conv3(P.lum, w, h, GAUSS, new Float32Array(n));
      var lap = conv3(sm, w, h, KERNELS.laplaciano.m(), new Float32Array(n));
      var absl = new Float32Array(n);
      for (i = 0; i < n; i++) absl[i] = Math.abs(lap[i]);
      var gl = a * 0.55 / percentile(absl, P.mask, 0.985);
      sign = new Int8Array(n);
      for (i = 0; i < n; i++) { val[i] = Math.pow(Math.min(1, absl[i] * gl), 0.95); sign[i] = lap[i] >= 0 ? 1 : -1; }
    } else if (kind === 'desfoque') {
      /* várias passadas do mesmo 3×3 ≈ um gaussiano mais largo (ping-pong entre dois buffers) */
      var passes = Math.max(1, Math.round(a * 2)), cur = P.lum, bufA = new Float32Array(n), bufB = new Float32Array(n);
      for (var ps = 0; ps < passes; ps++) { var dst = ps % 2 ? bufB : bufA; conv3(cur, w, h, GAUSS, dst); cur = dst; }
      for (i = 0; i < n; i++) val[i] = Math.min(1, Math.pow(cur[i], 0.9) * 1.05);
    } else {
      var out = conv3(P.lum, w, h, KERNELS[kind].m(a), new Float32Array(n));
      var gain = kind === 'relevo' ? 0.9 : 1;
      for (i = 0; i < n; i++) val[i] = RR.clamp(out[i] * gain, 0, 1);
    }

    var img = new ImageData(w, h), o = img.data, rgb = [0, 0, 0];
    var orient = !!p.orientacao, edgeKind = kind === 'sobel' || kind === 'laplaciano';
    /* orientação: gradiente da entrada (bordas) ou da própria saída (filtros de imagem) */
    var OX = P.gx, OY = P.gy, OM = P.mag, oref = P.magRef;
    if (orient && !edgeKind) {
      OX = conv3(val, w, h, SOBEL_X, new Float32Array(n));
      OY = conv3(val, w, h, SOBEL_Y, new Float32Array(n));
      OM = new Float32Array(n);
      for (i = 0; i < n; i++) OM[i] = Math.sqrt(OX[i] * OX[i] + OY[i] * OY[i]);
      oref = percentile(OM, P.mask, 0.985);
    }
    var magK = 2.2 / oref;
    for (i = 0; i < n; i++) {
      var k = i * 4, v = val[i];
      if (!P.mask[i] || v <= 0.002) { o[k] = bg[0]; o[k + 1] = bg[1]; o[k + 2] = bg[2]; o[k + 3] = 255; continue; }
      var r, gg, b;
      if (orient) {
        /* matiz = ângulo do gradiente; saturação cai nos picos (núcleo "quente" de neon) */
        var hue = Math.atan2(OY[i], OX[i]) / TAU + hueShift;
        var sat = edgeKind ? 1 - 0.45 * v * v * v : Math.min(1, OM[i] * magK) * 0.9;
        hsv(hue, sat, v, rgb, 0);
        r = rgb[0]; gg = rgb[1]; b = rgb[2];
        /* mistura com o fundo para as sombras não ficarem pretas puras */
        var t = edgeKind ? v : 1;
        r = bg[0] + (r - bg[0]) * Math.min(1, t * 1.6 + 0.2);
        gg = bg[1] + (gg - bg[1]) * Math.min(1, t * 1.6 + 0.2);
        b = bg[2] + (b - bg[2]) * Math.min(1, t * 1.6 + 0.2);
      } else if (sign) {
        /* Laplaciano com sinal: positivo -> menta, negativo -> rosa */
        var cpos = sign[i] > 0, vv = v;
        var cr = cpos ? 158 : 255, cg = cpos ? 245 : 111, cb = cpos ? 207 : 174;
        var hot = vv * vv * 0.55;
        r = bg[0] + (cr + (255 - cr) * hot - bg[0]) * vv;
        gg = bg[1] + (cg + (255 - cg) * hot - bg[1]) * vv;
        b = bg[2] + (cb + (255 - cb) * hot - bg[2]) * vv;
      } else {
        var li = Math.round(v * 255) * 3;
        r = LUT[li]; gg = LUT[li + 1]; b = LUT[li + 2];
      }
      o[k] = r; o[k + 1] = gg; o[k + 2] = b; o[k + 3] = 255;
    }
    return { img: img, kind: kind, a: a };
  }

  /* brilho difuso barato: reduz 4× e amplia com suavização (sem ctx.filter) */
  function bloomCanvas(src) {
    var w = Math.max(4, Math.round(src.width / 4)), h = Math.max(4, Math.round(src.height / 4));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, w, h);
    return c;
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

  function fmtW(v) {
    var s = Math.abs(v) < 1e-9 ? '0' : RR.fmt(v, 1);
    return v > 0 && s !== '0' ? s : s.replace('-', '−');
  }

  /* cartão mono com a matriz 3×3 atual (canto inferior direito) */
  function drawKernelCard(ctx, W, H, kind, a, pal, highlight) {
    var K = KERNELS[kind], m = K.m(a);
    var s = RR.clamp(W / 420, 0.78, 1.3);
    var cell = Math.round(23 * s), gap = Math.max(2, Math.round(3 * s)), pad = Math.round(9 * s);
    var fsT = Math.max(8, Math.round(9 * s)), fsN = Math.max(8, Math.round(9.5 * s));
    var title = 'kernel 3×3 · ' + K.name.toLowerCase();
    ctx.save();
    ctx.font = '500 ' + fsT + 'px ' + MONO;
    var tw = ctx.measureText(title).width;
    ctx.font = '400 ' + Math.max(7, fsT - 1) + 'px ' + MONO;
    var sub = K.sub + (kind === 'desfoque' ? ' · ' + Math.max(1, Math.round(a * 2)) + ' passadas' : '');
    var sw = ctx.measureText(sub).width;
    var gridW = cell * 3 + gap * 2;
    var cw = Math.ceil(Math.max(gridW, tw, sw) + pad * 2);
    var ch = Math.ceil(pad * 2 + fsT + 6 * s + gridW + 6 * s + fsT);
    var margin = Math.round(12 * s);
    var x0 = Math.round(W - cw - margin), y0 = Math.round(H - ch - margin);

    roundRect(ctx, x0 + 0.5, y0 + 0.5, cw - 1, ch - 1, Math.round(9 * s));
    ctx.fillStyle = 'rgba(7, 9, 18, 0.8)';
    ctx.fill();
    ctx.strokeStyle = highlight ? 'rgba(158, 245, 207, 0.55)' : 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = '500 ' + fsT + 'px ' + MONO;
    ctx.fillStyle = pal.mint;
    ctx.fillText(title, x0 + pad, y0 + pad);

    var maxAbs = 0;
    for (var i = 0; i < 9; i++) maxAbs = Math.max(maxAbs, Math.abs(m[i]));
    var gx0 = x0 + Math.round((cw - gridW) / 2), gy0 = y0 + pad + fsT + Math.round(6 * s);
    ctx.font = '500 ' + fsN + 'px ' + MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        var v = m[r * 3 + c], t = maxAbs ? Math.abs(v) / maxAbs : 0;
        var cx = gx0 + c * (cell + gap), cy = gy0 + r * (cell + gap);
        roundRect(ctx, cx, cy, cell, cell, Math.round(4 * s));
        ctx.fillStyle = v > 0 ? 'rgba(158, 245, 207, ' + (0.08 + 0.32 * t) + ')'
          : v < 0 ? 'rgba(255, 111, 174, ' + (0.08 + 0.32 * t) + ')' : 'rgba(255, 255, 255, 0.04)';
        ctx.fill();
        ctx.fillStyle = v === 0 ? pal.muted : pal.text;
        ctx.fillText(fmtW(v), cx + cell / 2, cy + cell / 2 + 0.5);
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '400 ' + Math.max(7, fsT - 1) + 'px ' + MONO;
    ctx.fillStyle = pal.muted;
    ctx.fillText(sub, x0 + pad, gy0 + gridW + Math.round(6 * s));
    ctx.restore();
  }

  RR.art.register({
    id: 'convolution',
    order: 2,
    title: 'Mapa de features',
    short: 'Convolução',
    algo: 'Convolução 2D',
    field: 'Visão computacional · CNNs',
    description: 'Um kernel 3×3 desliza sobre a foto e cada pixel de saída vira a soma ponderada dos seus vizinhos. Redes convolucionais (CNNs) aprendem sozinhas filtros como estes para detectar bordas, texturas e formas; aqui eles foram escolhidos à mão. Com cor por orientação, o matiz mostra para onde aponta cada borda.',
    params: [
      {
        id: 'kernel', label: 'Kernel', type: 'select', value: 'sobel', options: [
          { value: 'sobel', label: 'Sobel (bordas)' },
          { value: 'laplaciano', label: 'Laplaciano' },
          { value: 'relevo', label: 'Relevo' },
          { value: 'nitidez', label: 'Nitidez' },
          { value: 'desfoque', label: 'Desfoque gaussiano' }
        ]
      },
      {
        id: 'intensidade', label: 'Intensidade', type: 'range', min: 0.5, max: 3, step: 0.1, value: 1.5,
        format: function (v) { return RR.fmt(v, 1) + '×'; }
      },
      { id: 'orientacao', label: 'Cor por orientação', type: 'toggle', value: true }
    ],
    animated: true,
    render: function (ctx, p, env) {
      var W = env.width, H = env.height, pal = env.palette;
      var bg = RR.hexToRgb(pal.artBg || '#0b0e1a');
      ctx.fillStyle = pal.artBg;
      ctx.fillRect(0, 0, W, H);

      var gw = env.thumb ? Math.round(W * Math.min(env.dpr, 2) * 0.5) : Math.round(RR.clamp(W * WORK_FRAC, 110, 340));
      return env.getSource(gw).then(function (src) {
        if (env.cancelled()) return;
        var P = prepare(src);
        /* "Aleatorizar" gira a roda de matizes (seed 7 = posição original) */
        var hueShift = ((((env.seed | 0) - 7) * 0.381966) % 1 + 1) % 1;
        var fm = featureMap(P, p, bg, hueShift);
        var out = document.createElement('canvas');
        out.width = P.w; out.height = P.h;
        out.getContext('2d').putImageData(fm.img, 0, 0);
        var bloom = bloomCanvas(out);
        var edge = fm.kind === 'sobel' || fm.kind === 'laplaciano';
        var bloomAlpha = edge ? 0.55 : 0.28;
        var dim = dimCanvas(P, bg);

        var macs = P.n * KERNELS[fm.kind].taps * (fm.kind === 'desfoque' ? Math.max(1, Math.round(fm.a * 2)) : 1);
        env.setInfo(KERNELS[fm.kind].name + ' 3×3 · ' + P.w + '×' + P.h + ' px · ' +
          RR.fmt(macs / 1e6, 2) + ' mi de multiplicações' + (p.orientacao ? ' · matiz = ângulo do gradiente' : ''));

        function paintOut(y1) {
          if (y1 <= 0) return;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, W, y1);
          ctx.clip();
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(out, 0, 0, W, H);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = bloomAlpha;
          ctx.drawImage(bloom, 0, 0, W, H);
          ctx.restore();
        }

        function paintFinal() {
          ctx.fillStyle = pal.artBg;
          ctx.fillRect(0, 0, W, H);
          paintOut(H);
          if (!env.thumb) drawKernelCard(ctx, W, H, fm.kind, fm.a, pal, false);
        }

        if (env.thumb || RR.reducedMotion) { paintFinal(); return; }

        /* varredura: saída acima da linha, foto esmaecida abaixo */
        var t0 = 0;
        function step(ts) {
          if (env.cancelled()) return;
          if (!t0) t0 = ts;
          var lin = RR.clamp((ts - t0) / DUR, 0, 1), e = easeInOut(lin);
          var y = Math.round(e * H);
          ctx.fillStyle = pal.artBg;
          ctx.fillRect(0, 0, W, H);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, y, W, H - y);
          ctx.clip();
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(dim, 0, 0, W, H);
          ctx.restore();
          paintOut(y);
          if (lin < 1) {
            /* rastro luminoso + linha + campo receptivo 3×3 correndo na linha */
            var trail = Math.round(H * 0.07);
            var gr = ctx.createLinearGradient(0, y - trail, 0, y);
            gr.addColorStop(0, 'rgba(158, 245, 207, 0)');
            gr.addColorStop(1, 'rgba(158, 245, 207, 0.22)');
            ctx.fillStyle = gr;
            ctx.fillRect(0, y - trail, W, trail);
            ctx.fillStyle = 'rgba(158, 245, 207, 0.95)';
            ctx.fillRect(0, y - 1, W, 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(0, y - 0.5, W, 1);
            var box = Math.round(RR.clamp(W / 420, 0.7, 1.3) * 18);
            var bx = (lin * 9 % 1) * (W - box);
            ctx.strokeStyle = 'rgba(158, 245, 207, 0.9)';
            ctx.lineWidth = 1;
            ctx.strokeRect(Math.round(bx) + 0.5, Math.round(y - box / 2) + 0.5, box, box);
            ctx.strokeStyle = 'rgba(158, 245, 207, 0.35)';
            ctx.beginPath();
            for (var gi = 1; gi < 3; gi++) {
              var gx = Math.round(bx + box * gi / 3) + 0.5, gyy = Math.round(y - box / 2 + box * gi / 3) + 0.5;
              ctx.moveTo(gx, Math.round(y - box / 2)); ctx.lineTo(gx, Math.round(y + box / 2));
              ctx.moveTo(Math.round(bx), gyy); ctx.lineTo(Math.round(bx + box), gyy);
            }
            ctx.stroke();
            drawKernelCard(ctx, W, H, fm.kind, fm.a, pal, true);
            env.frame(step);
          } else {
            paintFinal();
          }
        }
        /* primeiro quadro já mostra a foto de entrada (sem fundo vazio) */
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(dim, 0, 0, W, H);
        drawKernelCard(ctx, W, H, fm.kind, fm.a, pal, true);
        env.frame(step);
      });
    }
  });
})();
