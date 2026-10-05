/* =========================================================================
   art/flowfield.js — "Pintura por gradientes"
   Gradiente de luminância (Sobel sobre a imagem suavizada) -> tensor de
   estrutura suavizado -> direção das isofotas (perpendicular ao gradiente),
   misturada a um campo de ruído suave onde o gradiente é fraco. Milhares de
   pinceladas seguem esse campo (integração RK2) em camadas, do pincel largo
   ao fino, e a tela vai sendo pintada aos poucos.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  var DURATION = 2600;                 // duração da pintura (ms)
  var BUDGET = 9;                      // ms de desenho por quadro
  var TAU = Math.PI * 2;
  var PAPER = '#efe7d6', NEON_BG = '#04050b';
  var MINT = [158, 245, 207], BLUE = [79, 123, 255], PINK = [255, 111, 174], DEEP = [30, 44, 120];

  /* camadas por estilo: fração dos traços, largura, comprimento relativo,
     tolerância de luminância (o traço para ao cruzar uma borda) e viés de borda */
  var LAYERS = {
    oleo: [
      { frac: 0.22, width: 4.6, len: 1.3, tol: 0.26, edge: 0, grid: true, alpha: 0.92 },
      { frac: 0.33, width: 2.5, len: 1.0, tol: 0.2, edge: 0.45, alpha: 0.88 },
      { frac: 0.45, width: 1.2, len: 0.62, tol: 0.13, edge: 0.85, alpha: 0.9 }
    ],
    neon: [
      { frac: 0.3, width: 2.2, len: 1.25, tol: 0.3, edge: 0.1, alpha: 1 },
      { frac: 0.7, width: 0.95, len: 0.8, tol: 0.18, edge: 0.55, alpha: 1 }
    ],
    nanquim: [
      { frac: 0.45, width: 0.95, len: 1.35, tol: 0.3, edge: 0.15, dark: 1.9, alpha: 1 },
      { frac: 0.2, width: 0.8, len: 0.9, tol: 0.3, edge: 0, dark: 3.2, cross: true, alpha: 1 },
      { frac: 0.35, width: 0.7, len: 0.55, tol: 0.18, edge: 0.9, dark: 0.8, alpha: 1 }
    ]
  };

  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  /* desfoque de caixa separável (raio r), n passadas — aproxima uma gaussiana */
  function blur(src, w, h, r, passes) {
    var a = new Float32Array(src), b = new Float32Array(src.length), x, y, i, s, norm = 1 / (2 * r + 1);
    for (var p = 0; p < passes; p++) {
      for (y = 0; y < h; y++) {
        var row = y * w;
        s = 0;
        for (x = -r; x <= r; x++) s += a[row + (x < 0 ? 0 : x >= w ? w - 1 : x)];
        for (x = 0; x < w; x++) {
          b[row + x] = s * norm;
          s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
        }
      }
      for (x = 0; x < w; x++) {
        s = 0;
        for (y = -r; y <= r; y++) s += b[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + x];
        for (y = 0; y < h; y++) {
          i = y * w + x;
          a[i] = s * norm;
          s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
        }
      }
    }
    return a;
  }
  function percentile(vals, mask, q) {
    var max = 0, i, n = vals.length, total = 0;
    for (i = 0; i < n; i++) if (mask[i] > 0.5 && vals[i] > max) max = vals[i];
    if (max <= 0) return 1;
    var bins = new Uint32Array(512);
    for (i = 0; i < n; i++) if (mask[i] > 0.5) { bins[Math.min(511, (vals[i] / max * 511) | 0)]++; total++; }
    var target = total * q, acc = 0;
    for (i = 0; i < 512; i++) { acc += bins[i]; if (acc >= target) return Math.max(1e-6, (i + 0.5) / 511 * max); }
    return max;
  }

  RR.art.register({
    id: 'flowfield',
    order: 7,
    title: 'Pintura por gradientes',
    short: 'Gradientes',
    algo: 'Campo vetorial de gradientes',
    field: 'Cálculo · descida do gradiente',
    description: 'O filtro de Sobel mede o gradiente de brilho da foto e cada pincelada segue as isofotas, as curvas de mesmo brilho, perpendiculares ao gradiente; onde a imagem é lisa, um campo de ruído suave assume. Gradientes são o mesmo sinal que treina redes neurais: a retropropagação calcula o gradiente da perda e a descida do gradiente segue esse campo morro abaixo, passo a passo.',
    params: [
      { id: 'tracos', label: 'Traços', type: 'range', min: 2000, max: 30000, step: 1000, value: 12000, format: function (v) { return RR.fmt(v); } },
      { id: 'comprimento', label: 'Comprimento', type: 'range', min: 6, max: 60, step: 1, value: 22, format: function (v) { return v + ' px'; } },
      {
        id: 'estilo', label: 'Estilo', type: 'select', value: 'oleo', options: [
          { value: 'oleo', label: 'Óleo' },
          { value: 'neon', label: 'Néon' },
          { value: 'nanquim', label: 'Nanquim' }
        ]
      }
    ],
    animated: true,
    render: function (ctx, p, env) {
      var W = env.width, H = env.height, thumb = !!env.thumb;
      var style = LAYERS[p.estilo] ? p.estilo : 'oleo';
      var layers = LAYERS[style];
      var S = thumb ? 1500 : RR.clamp(Math.round(p.tracos) || 12000, 200, 60000);
      var unit = thumb ? 0.42 : W / 420;                       // escala das larguras
      var lenRaw = RR.clamp(Number(p.comprimento) || 22, 2, 120), lenPx = lenRaw * (thumb ? 0.36 : W / 420);
      /* tinta por traço compensa a cobertura (néon e nanquim são translúcidos):
         poucos traços curtos ficam mais opacos; muitos e longos, mais leves */
      var cover = (S / 12000) * (lenRaw / 22);                  // cobertura relativa ao padrão
      var inkMul = thumb ? 1 : style === 'neon' ? RR.clamp(Math.pow(cover, -0.85), 0.15, 3)   // soma aditiva satura rápido
        : RR.clamp(Math.pow(cover, -0.5), 0.6, 3);
      var rand = RR.rng((env.seed >>> 0) * 3266489917 + 11);
      var dpr = ctx.canvas.width / W;

      /* fundo de cada estilo */
      function paintBg(c) {
        c.save();
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
        if (style === 'nanquim') {
          c.fillStyle = PAPER;
          c.fillRect(0, 0, W, H);
          var gr = RR.rng((env.seed >>> 0) + 99), specks = Math.round(W * H / (thumb ? 160 : 70));
          for (var k = 0; k < specks; k++) {
            c.fillStyle = gr() < 0.5 ? 'rgba(110,86,52,' + (0.04 + gr() * 0.07).toFixed(3) + ')' : 'rgba(255,255,250,' + (0.12 + gr() * 0.2).toFixed(3) + ')';
            c.fillRect(gr() * W, gr() * H, 0.6 + gr() * 0.9, 0.6 + gr() * 0.9);
          }
          var vg = c.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
          vg.addColorStop(0, 'rgba(255,252,245,0.3)');
          vg.addColorStop(1, 'rgba(120,96,64,0.18)');
          c.fillStyle = vg;
          c.fillRect(0, 0, W, H);
        } else if (style === 'neon') {
          c.fillStyle = NEON_BG;
          c.fillRect(0, 0, W, H);
        } else {
          c.fillStyle = env.palette.artBg;
          c.fillRect(0, 0, W, H);
          var gl = c.createRadialGradient(W * 0.52, H * 0.42, 0, W * 0.52, H * 0.42, Math.max(W, H) * 0.7);
          gl.addColorStop(0, 'rgba(79,123,255,0.10)');
          gl.addColorStop(1, 'rgba(79,123,255,0)');
          c.fillStyle = gl;
          c.fillRect(0, 0, W, H);
        }
        c.restore();
      }
      paintBg(ctx);

      var workW = thumb ? 110 : Math.min(491, Math.max(160, Math.round(W * 0.62)));
      return env.getSource(workW).then(function (src) {
        if (env.cancelled()) return;
        var w = src.width, h = src.height, n = w * h, data = src.data;
        var kx = w / W, ky = h / H;                            // palco -> trabalho
        var A, L, T, E, Jxx, Jxy, Jyy, FC, FS, opq, plan, total = 0;
        var c = ctx, still = RR.reducedMotion && !thumb, drawn = 0, sumLen = 0;

        /* etapa 1: luminância composta sobre o fundo do estilo (a silhueta também
           vira borda), tom normalizado e Sobel -> tensor de estrutura (gx², gx·gy, gy²) */
        function stageGradient() {
          var bgLum = style === 'nanquim' ? 0.9 : 0.05, i, x, y;
          A = new Float32Array(n); L = new Float32Array(n); T = new Float32Array(n);
          for (i = 0; i < n; i++) {
            var a = data[i * 4 + 3] / 255;
            A[i] = a;
            L[i] = ((0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255) * a + bgLum * (1 - a);
          }
          var lo = percentile(L, A, 0.02), hi = percentile(L, A, 0.98);
          if (hi - lo < 0.05) { lo = 0; hi = 1; }
          for (i = 0; i < n; i++) T[i] = RR.clamp((L[i] - lo) / (hi - lo), 0, 1);
        }
        function stageSobel() {
          var i, x, y, Lb = blur(L, w, h, 1, 2);
          Jxx = new Float32Array(n); Jxy = new Float32Array(n); Jyy = new Float32Array(n); E = new Float32Array(n);
          for (y = 1; y < h - 1; y++) {
            for (x = 1; x < w - 1; x++) {
              i = y * w + x;
              var tl = Lb[i - w - 1], tc = Lb[i - w], tr = Lb[i - w + 1], ml = Lb[i - 1], mr = Lb[i + 1];
              var bl = Lb[i + w - 1], bc = Lb[i + w], br = Lb[i + w + 1];
              var gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl), gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
              Jxx[i] = gx * gx; Jxy[i] = gx * gy; Jyy[i] = gy * gy;
              E[i] = Math.sqrt(gx * gx + gy * gy);
            }
          }
        }

        /* etapa 2: tensor suavizado -> isofotas em ângulo dobrado (Jyy − Jxx, −2·Jxy),
           misturadas a um campo de ruído suave (grade grossa interpolada) onde o gradiente é fraco */
        function stageTensor() {
          var r2 = thumb ? 2 : Math.max(2, Math.round(w / 90));
          Jxx = blur(Jxx, w, h, r2, 2); Jxy = blur(Jxy, w, h, r2, 2); Jyy = blur(Jyy, w, h, r2, 2);
        }
        function stageField() {
          var i, x, y, coh = new Float32Array(n);
          for (i = 0; i < n; i++) {
            var vx = Jyy[i] - Jxx[i], vy = -2 * Jxy[i];
            coh[i] = Math.sqrt(vx * vx + vy * vy);
          }
          var c90 = percentile(coh, A, 0.9), e95 = percentile(E, A, 0.95);
          var ph1 = rand() * TAU, ph2 = rand() * TAU, ph3 = rand() * TAU;
          var f1 = TAU / (w * (0.5 + rand() * 0.3)), f2 = TAU / (w * (0.4 + rand() * 0.3)), f3 = TAU / (w * (0.25 + rand() * 0.2));
          var G = 4, nw = Math.ceil(w / G) + 2, nh = Math.ceil(h / G) + 2;
          var NC = new Float32Array(nw * nh), NS = new Float32Array(nw * nh);
          for (y = 0; y < nh; y++) {
            for (x = 0; x < nw; x++) {
              var X = x * G, Y = y * G;
              var th = 1.3 * Math.sin(X * f1 + Y * f1 * 0.35 + ph1) + 1.1 * Math.sin(Y * f2 - X * f2 * 0.45 + ph2) + 0.6 * Math.sin((X + Y) * f3 + ph3);
              NC[y * nw + x] = Math.cos(2 * th); NS[y * nw + x] = Math.sin(2 * th);
            }
          }
          FC = new Float32Array(n); FS = new Float32Array(n);
          for (y = 0; y < h; y++) {
            var gy0 = (y / G) | 0, fy = y / G - gy0;
            for (x = 0; x < w; x++) {
              i = y * w + x;
              var m = coh[i], wt = RR.smoothstep(0.03, 0.35, m / c90);
              var cx = 0, cy = 0;
              if (wt > 0) { cx = (Jyy[i] - Jxx[i]) / m * wt; cy = -2 * Jxy[i] / m * wt; }
              if (wt < 1) {
                var gx0 = (x / G) | 0, fx = x / G - gx0, q = gy0 * nw + gx0;
                var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
                cx += (NC[q] * w00 + NC[q + 1] * w10 + NC[q + nw] * w01 + NC[q + nw + 1] * w11) * (1 - wt);
                cy += (NS[q] * w00 + NS[q + 1] * w10 + NS[q + nw] * w01 + NS[q + nw + 1] * w11) * (1 - wt);
              }
              var nn = Math.sqrt(cx * cx + cy * cy) || 1;
              FC[i] = cx / nn; FS[i] = cy / nn;
              E[i] = Math.min(1, E[i] / e95);
            }
          }
          Jxx = Jxy = Jyy = null;
        }

        /* amostra o campo (bilinear no ângulo dobrado -> meio ângulo) em coordenadas do palco */
        var dirX = 0, dirY = 0;
        function field(sx, sy) {
          var fx = sx * kx - 0.5, fy = sy * ky - 0.5;
          if (fx < 0) fx = 0; else if (fx > w - 1.001) fx = w - 1.001;
          if (fy < 0) fy = 0; else if (fy > h - 1.001) fy = h - 1.001;
          var x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, j = y0 * w + x0;
          var w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
          var cc = FC[j] * w00 + FC[j + 1] * w10 + FC[j + w] * w01 + FC[j + w + 1] * w11;
          var ss = FS[j] * w00 + FS[j + 1] * w10 + FS[j + w] * w01 + FS[j + w + 1] * w11;
          var mm = Math.sqrt(cc * cc + ss * ss);
          if (mm < 1e-6) { dirX = 1; dirY = 0; return; }
          cc /= mm;
          dirX = Math.sqrt(Math.max(0, (1 + cc) * 0.5));
          dirY = Math.sqrt(Math.max(0, (1 - cc) * 0.5)) * (ss < 0 ? -1 : 1);
        }
        function idxAt(sx, sy) {
          var fx = (sx * kx) | 0, fy = (sy * ky) | 0;
          if (fx < 0 || fy < 0 || fx >= w || fy >= h) return -1;
          return fy * w + fx;
        }

        /* etapa 3: sorteia as pinceladas de cada camada (nascimento ponderado por borda/escuridão) */
        function stageOpaque() {
          var i, list = [];
          for (i = 0; i < n; i++) if (A[i] > 0.6) list.push(i);
          opq = new Int32Array(list);
          plan = [];                                               // [x, y, camada, ...]
        }
        function planLayer(li) {
          return function () {
            if (!opq.length) return;
            var ly = layers[li], count = Math.round(S * ly.frac), k = 0, tries = 0;
            if (ly.grid) {
              /* subpintura: grade com jitter cobre todo o retrato, em ordem aleatória */
              var cell = Math.sqrt(opq.length / (kx * ky) / count), cells = [];
              for (var gy = 0; gy < H; gy += cell) {
                for (var gx = 0; gx < W; gx += cell) {
                  var px = gx + rand() * cell, py = gy + rand() * cell, j = idxAt(px, py);
                  if (j >= 0 && A[j] > 0.6) cells.push(px, py);
                }
              }
              for (var q = cells.length / 2 - 1; q > 0; q--) {         // Fisher–Yates em pares
                var r = (rand() * (q + 1)) | 0, t0 = cells[2 * q], t1 = cells[2 * q + 1];
                cells[2 * q] = cells[2 * r]; cells[2 * q + 1] = cells[2 * r + 1]; cells[2 * r] = t0; cells[2 * r + 1] = t1;
              }
              /* exatamente "count" pinceladas: corta o excesso ou completa com sorteios */
              for (q = 0; q < cells.length && k < count; q += 2, k++) plan.push(cells[q], cells[q + 1], li);
              for (; k < count; k++) {
                var id0 = opq[(rand() * opq.length) | 0];
                plan.push(((id0 % w) + rand()) / kx, (((id0 / w) | 0) + rand()) / ky, li);
              }
              total = plan.length / 3;
              return;
            }
            while (k < count && tries < count * 40) {
              tries++;
              var id = opq[(rand() * opq.length) | 0];
              var prob = ly.edge ? (1 - ly.edge) + ly.edge * Math.pow(E[id], 0.8) : 1;
              if (style === 'nanquim') prob *= Math.pow(1 - T[id], ly.dark) * (ly.cross ? 1.5 : 1.15) + (ly.edge > 0.5 ? 0.12 * E[id] : 0);
              else if (style === 'neon') prob *= 0.35 + 0.65 * L[id];
              if (rand() > prob) continue;
              plan.push(((id % w) + rand()) / kx, (((id / w) | 0) + rand()) / ky, li);
              k++;
            }
            total = plan.length / 3;
          };
        }

        /* subpintura do óleo: a foto bem desfocada e escurecida, recortada pela
           silhueta nítida (nenhum buraco mostra a tela e não sobra halo) */
        function underpaint(cc) {
          if (style !== 'oleo') return;
          var big = document.createElement('canvas');
          big.width = w; big.height = h;
          big.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
          var sm = document.createElement('canvas');
          sm.width = Math.max(4, Math.round(w / 7)); sm.height = Math.max(4, Math.round(h / 7));
          var sx2 = sm.getContext('2d');
          sx2.imageSmoothingQuality = 'high';
          sx2.drawImage(big, 0, 0, sm.width, sm.height);
          var mk = document.createElement('canvas');
          mk.width = Math.max(1, Math.round(W * 0.75)); mk.height = Math.max(1, Math.round(H * 0.75));
          var mx = mk.getContext('2d');
          mx.imageSmoothingEnabled = true;
          mx.imageSmoothingQuality = 'high';
          mx.drawImage(sm, 0, 0, mk.width, mk.height);
          mx.globalCompositeOperation = 'destination-in';
          mx.drawImage(big, 0, 0, mk.width, mk.height);
          cc.save();
          cc.globalAlpha = 0.8;
          cc.drawImage(mk, 0, 0, W, H);
          cc.restore();
          big.width = sm.width = mk.width = 0;
        }

        /* etapa 4: superfície de pintura (sem animação: pinta fora da tela e copia no fim) */
        function stageSurface() {
          if (still) {
            var off = document.createElement('canvas');
            off.width = ctx.canvas.width; off.height = ctx.canvas.height;
            c = off.getContext('2d');
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            paintBg(c);
          }
          underpaint(c);
          c.lineCap = 'round';
          c.lineJoin = 'round';
          c.globalCompositeOperation = style === 'neon' ? 'lighter' : 'source-over';
        }

        /* traça meia pincelada a partir de (x, y) na direção inicial (vx, vy), integrando com RK2 */
        var BUF = new Float32Array(2 * 256), BUF2 = new Float32Array(2 * 256);
        var alphaStop = style === 'oleo' ? 0.12 : 0.3;
        function traceHalf(x0, y0, vx, vy, maxLen, lum0, tol, cross, out) {
          var hstep = Math.max(0.6, Math.min(2, maxLen / 10)), steps = Math.min(255, Math.ceil(maxLen / hstep));
          var x = x0, y = y0, cnt = 0;
          for (var s = 0; s < steps; s++) {
            field(x, y);
            var ux = cross ? -dirY : dirX, uy = cross ? dirX : dirY;
            if (ux * vx + uy * vy < 0) { ux = -ux; uy = -uy; }
            field(x + ux * hstep * 0.5, y + uy * hstep * 0.5);       // ponto médio
            var wx = cross ? -dirY : dirX, wy = cross ? dirX : dirY;
            if (wx * ux + wy * uy < 0) { wx = -wx; wy = -wy; }
            if (s > 0 && wx * vx + wy * vy < 0.55) break;              // curva fechada demais
            x += wx * hstep; y += wy * hstep;
            var j = idxAt(x, y);
            if (j < 0 || A[j] < alphaStop) break;
            if (s > 0 && Math.abs(L[j] - lum0) > tol) break;          // cruzou uma borda
            out[2 * cnt] = x; out[2 * cnt + 1] = y; cnt++;
            vx = wx; vy = wy;
          }
          return cnt;
        }

        /* cor de cada pincelada */
        function strokeCss(j, ly) {
          var o = j * 4, r = data[o], g = data[o + 1], b = data[o + 2];
          if (style === 'nanquim') {
            var d = 1 - T[j];
            var al = (0.04 + 0.62 * Math.pow(d, 1.7)) * (ly.cross ? 0.75 : 1) + (ly.edge > 0.5 ? 0.3 * E[j] : 0);
            return 'rgba(24,20,16,' + Math.min(0.85, al * inkMul).toFixed(3) + ')';
          }
          if (style === 'neon') {
            var warm = RR.clamp((r - b) / 110, 0, 1), t = RR.clamp((L[j] - 0.04) / 0.82, 0, 1);
            var midC = mix(BLUE, PINK, warm * 0.85);
            var cc = t < 0.5 ? mix(DEEP, midC, t / 0.5) : mix(midC, MINT, (t - 0.5) / 0.5);
            var na = Math.min(1, (0.06 + 0.34 * Math.pow(t, 1.3)) * inkMul);
            return 'rgba(' + (cc[0] | 0) + ',' + (cc[1] | 0) + ',' + (cc[2] | 0) + ',' + na.toFixed(3) + ')';
          }
          /* óleo: cor da foto com variação de tinta e um pouco mais de saturação */
          var jb = 1 + (rand() - 0.5) * 0.14, mean = (r + g + b) / 3;
          r = (mean + (r - mean) * 1.12 + (rand() - 0.5) * 14) * jb;
          g = (mean + (g - mean) * 1.12 + (rand() - 0.5) * 14) * jb;
          b = (mean + (b - mean) * 1.12 + (rand() - 0.5) * 14) * jb;
          if (ly.grid) { r *= 0.9; g *= 0.9; b *= 0.9; }               // subpintura um pouco mais escura
          return 'rgba(' + RR.clamp(r | 0, 0, 255) + ',' + RR.clamp(g | 0, 0, 255) + ',' + RR.clamp(b | 0, 0, 255) + ',' + ly.alpha + ')';
        }

        function paintOne(q) {
          var x0 = plan[3 * q], y0 = plan[3 * q + 1], ly = layers[plan[3 * q + 2]];
          var j = idxAt(x0, y0);
          if (j < 0) return;
          var maxLen = lenPx * ly.len * (0.7 + rand() * 0.6) * 0.5;
          field(x0, y0);
          var vx = ly.cross ? -dirY : dirX, vy = ly.cross ? dirX : dirY;
          var nf = traceHalf(x0, y0, vx, vy, maxLen, L[j], ly.tol, ly.cross, BUF);
          var nb = traceHalf(x0, y0, -vx, -vy, maxLen, L[j], ly.tol, ly.cross, BUF2);
          var lw = Math.max(thumb ? 0.45 : 0.5, ly.width * unit * (0.8 + rand() * 0.4));
          c.beginPath();
          c.moveTo(nb ? BUF2[2 * nb - 2] : x0, nb ? BUF2[2 * nb - 1] : y0);
          for (var k = nb - 2; k >= 0; k--) c.lineTo(BUF2[2 * k], BUF2[2 * k + 1]);
          if (nb) c.lineTo(x0, y0);
          for (k = 0; k < nf; k++) c.lineTo(BUF[2 * k], BUF[2 * k + 1]);
          if (!nb && !nf) c.lineTo(x0 + vx * lw * 0.6, y0 + vy * lw * 0.6);   // pincelada mínima (um toque)
          sumLen += (nb + nf) * Math.max(0.6, Math.min(2, maxLen / 10));
          c.strokeStyle = strokeCss(j, ly);
          c.lineWidth = lw;
          c.stroke();
        }
        function infoLine(done) {
          var li = drawn < total ? plan[3 * Math.min(drawn, total - 1) + 2] : layers.length - 1;
          var mean = drawn ? sumLen / drawn : 0;
          env.setInfo((done ? RR.fmt(total) + ' traços' : 'traço ' + RR.fmt(drawn) + '/' + RR.fmt(total)) +
            ' · camada ' + (li + 1) + '/' + layers.length + ' · comprimento médio ' + RR.fmt(mean, 1) + ' px');
        }
        /* brilho final do néon: cópia reduzida e ampliada (desfoque barato) somada por cima */
        function bloom() {
          if (style !== 'neon') return;
          var b = document.createElement('canvas');
          b.width = Math.max(8, Math.round(W / 6)); b.height = Math.max(8, Math.round(H / 6));
          var bx = b.getContext('2d');
          bx.imageSmoothingQuality = 'high';
          bx.drawImage(c.canvas, 0, 0, b.width, b.height);
          c.save();
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 0.45;
          c.imageSmoothingEnabled = true;
          c.drawImage(b, 0, 0, c.canvas.width, c.canvas.height);
          c.restore();
          b.width = 0;
        }
        function finish() {
          bloom();
          c.globalCompositeOperation = 'source-over';
          if (still) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(c.canvas, 0, 0);
            ctx.restore();
            c.canvas.width = 0;
          }
          infoLine(true);
        }

        /* etapas curtas (cada uma cabe num quadro) */
        var stages = [stageGradient, stageSobel, stageTensor, stageField, stageOpaque];
        layers.forEach(function (ly, li) { stages.push(planLayer(li)); });
        stages.push(stageSurface);
        if (thumb) {
          stages.forEach(function (fn) { fn(); });
          for (var q0 = 0; q0 < total; q0++) paintOne(q0);
          drawn = total;
          finish();
          return;
        }

        /* preparo fatiado (uma etapa por quadro), depois a pintura progressiva */
        var si = 0, t0 = -1;
        function prep() {
          if (env.cancelled()) return;
          stages[si++]();
          if (si < stages.length) { env.frame(prep); return; }
          if (!total) return;
          infoLine(false);
          env.frame(paint);
        }
        function paint(ts) {
          if (env.cancelled()) return;
          if (t0 < 0) t0 = ts;
          var start = performance.now();
          var target = still ? total : Math.min(total, Math.ceil(total * (ts - t0 + 16) / DURATION));
          while (drawn < target) {
            paintOne(drawn++);
            if ((drawn & 15) === 0 && performance.now() - start > (still ? 11 : BUDGET)) break;
          }
          if (drawn < total) {
            if (!still) infoLine(false);
            env.frame(paint);
          } else {
            finish();
          }
        }
        env.setInfo('calculando o campo de gradientes…');
        prep();
      });
    }
  });
})();
