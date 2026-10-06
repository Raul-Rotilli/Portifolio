/* =========================================================================
   art/delaunay.js — "Low-poly"
   Amostragem por importância (mais pontos onde o gradiente da imagem é forte:
   olhos, cabelo, fones e o contorno), triangulação de Delaunay por varredura
   radial com flips de arestas (no estilo do Delaunator, escrita do zero) e
   cada face pintada com a cor média dos pixels que cobre. As faces surgem em
   onda a partir do rosto.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  var FACE_X = 250 / 491, FACE_Y = 330 / 712;   // centro do rosto (fração da foto)
  var REVEAL_MS = 900;                           // duração da onda
  var SLICE_MS = 10;                             // orçamento de cálculo por quadro
  var MORE = 'more';                             // etapa fatiada ainda não terminou
  var NEON_BG = '#05070f';
  var EPSILON = Math.pow(2, -52);
  var EDGE_STACK = new Uint32Array(1024);
  var MINT = [158, 245, 207], BLUE = [79, 123, 255], PINK = [255, 111, 174], DEEP = [24, 34, 92];

  /* ---------- predicados geométricos ---------- */
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function orient(px, py, qx, qy, rx, ry) { return (qy - py) * (rx - qx) - (qx - px) * (ry - qy) < 0; }
  function inCircle(ax, ay, bx, by, cx, cy, px, py) {
    var dx = ax - px, dy = ay - py, ex = bx - px, ey = by - py, fx = cx - px, fy = cy - py;
    var ap = dx * dx + dy * dy, bp = ex * ex + ey * ey, cp = fx * fx + fy * fy;
    return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
  }
  function circum(ax, ay, bx, by, cx, cy, out) {
    var dx = bx - ax, dy = by - ay, ex = cx - ax, ey = cy - ay;
    var bl = dx * dx + dy * dy, cl = ex * ex + ey * ey, d = 0.5 / (dx * ey - dy * ex);
    var x = (ey * bl - dy * cl) * d, y = (dx * cl - ex * bl) * d;
    if (out) { out[0] = ax + x; out[1] = ay + y; }
    return x * x + y * y;                         // raio² (Infinity se colineares)
  }
  function pseudoAngle(dx, dy) {
    var p = dx / (Math.abs(dx) + Math.abs(dy));
    return (dy > 0 ? 3 - p : 1 + p) / 4;          // monotônico com o ângulo, em [0, 1]
  }

  /* ---------- triangulação de Delaunay ----------
     Ordena os pontos pela distância a um triângulo-semente e os adiciona um a
     um por fora do fecho convexo (hash angular para achar a aresta visível);
     cada triângulo novo é legalizado com flips até satisfazer o critério do
     círculo vazio. O(n log n) na prática. Devolve índices e meias-arestas. */
  function delaunay(coords) {
    var n = coords.length >> 1;
    if (n < 3) return null;
    var maxTri = 2 * n - 5;
    var tris = new Uint32Array(maxTri * 3), half = new Int32Array(maxTri * 3);
    var hashSize = Math.ceil(Math.sqrt(n));
    var hullPrev = new Uint32Array(n), hullNext = new Uint32Array(n), hullTri = new Uint32Array(n);
    var hullHash = new Int32Array(hashSize);
    var dists = new Float64Array(n);
    var i, x, y, d, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (i = 0; i < n; i++) {
      x = coords[2 * i]; y = coords[2 * i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    var bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;
    var i0 = 0, i1 = 0, i2 = 0, best = Infinity;
    for (i = 0; i < n; i++) { d = dist2(bcx, bcy, coords[2 * i], coords[2 * i + 1]); if (d < best) { i0 = i; best = d; } }
    var i0x = coords[2 * i0], i0y = coords[2 * i0 + 1];
    best = Infinity;
    for (i = 0; i < n; i++) {
      if (i === i0) continue;
      d = dist2(i0x, i0y, coords[2 * i], coords[2 * i + 1]);
      if (d < best && d > 0) { i1 = i; best = d; }
    }
    var i1x = coords[2 * i1], i1y = coords[2 * i1 + 1];
    best = Infinity;
    for (i = 0; i < n; i++) {
      if (i === i0 || i === i1) continue;
      d = circum(i0x, i0y, i1x, i1y, coords[2 * i], coords[2 * i + 1]);
      if (d < best) { i2 = i; best = d; }
    }
    if (best === Infinity) return null;           // todos colineares
    var i2x = coords[2 * i2], i2y = coords[2 * i2 + 1], sw;
    if (orient(i0x, i0y, i1x, i1y, i2x, i2y)) {
      sw = i1; i1 = i2; i2 = sw;
      sw = i1x; i1x = i2x; i2x = sw;
      sw = i1y; i1y = i2y; i2y = sw;
    }
    var cc = [0, 0];
    circum(i0x, i0y, i1x, i1y, i2x, i2y, cc);
    var ccx = cc[0], ccy = cc[1];
    var ids = new Array(n);
    for (i = 0; i < n; i++) { ids[i] = i; dists[i] = dist2(coords[2 * i], coords[2 * i + 1], ccx, ccy); }
    ids.sort(function (a, b) { return dists[a] - dists[b]; });

    var trisLen = 0, hullStart = i0;
    function hashKey(px, py) { return Math.floor(pseudoAngle(px - ccx, py - ccy) * hashSize) % hashSize; }
    function link(a, b) { half[a] = b; if (b !== -1) half[b] = a; }
    function addTri(a0, a1, a2, a, b, c) {
      var t = trisLen;
      tris[t] = a0; tris[t + 1] = a1; tris[t + 2] = a2;
      link(t, a); link(t + 1, b); link(t + 2, c);
      trisLen += 3;
      return t;
    }
    /* flips iterativos com pilha (sem recursão) */
    function legalize(a) {
      var sp = 0, ar = 0;
      for (;;) {
        var b = half[a], a0 = a - a % 3;
        ar = a0 + (a + 2) % 3;
        if (b === -1) {
          if (sp === 0) break;
          a = EDGE_STACK[--sp];
          continue;
        }
        var b0 = b - b % 3, al = a0 + (a + 1) % 3, bl = b0 + (b + 2) % 3;
        var p0 = tris[ar], pr = tris[a], pl = tris[al], p1 = tris[bl];
        if (inCircle(coords[2 * p0], coords[2 * p0 + 1], coords[2 * pr], coords[2 * pr + 1],
          coords[2 * pl], coords[2 * pl + 1], coords[2 * p1], coords[2 * p1 + 1])) {
          tris[a] = p1; tris[b] = p0;
          var hbl = half[bl];
          if (hbl === -1) {                         // flip na borda do fecho: corrige a referência
            var e = hullStart;
            do {
              if (hullTri[e] === bl) { hullTri[e] = a; break; }
              e = hullPrev[e];
            } while (e !== hullStart);
          }
          link(a, hbl);
          link(b, half[ar]);
          link(ar, bl);
          if (sp < EDGE_STACK.length) EDGE_STACK[sp++] = b0 + (b + 1) % 3;
        } else {
          if (sp === 0) break;
          a = EDGE_STACK[--sp];
        }
      }
      return ar;
    }

    hullNext[i0] = hullPrev[i2] = i1;
    hullNext[i1] = hullPrev[i0] = i2;
    hullNext[i2] = hullPrev[i1] = i0;
    hullTri[i0] = 0; hullTri[i1] = 1; hullTri[i2] = 2;
    hullHash.fill(-1);
    hullHash[hashKey(i0x, i0y)] = i0;
    hullHash[hashKey(i1x, i1y)] = i1;
    hullHash[hashKey(i2x, i2y)] = i2;
    addTri(i0, i1, i2, -1, -1, -1);

    var xp = 0, yp = 0;
    for (var k = 0; k < n; k++) {
      i = ids[k]; x = coords[2 * i]; y = coords[2 * i + 1];
      if (k > 0 && Math.abs(x - xp) <= EPSILON && Math.abs(y - yp) <= EPSILON) continue;
      xp = x; yp = y;
      if (i === i0 || i === i1 || i === i2) continue;

      /* aresta visível do fecho, a partir do hash angular */
      var start = 0, key = hashKey(x, y);
      for (var j = 0; j < hashSize; j++) {
        start = hullHash[(key + j) % hashSize];
        if (start !== -1 && start !== hullNext[start]) break;
      }
      start = hullPrev[start];
      var e = start, q = hullNext[e];
      while (!orient(x, y, coords[2 * e], coords[2 * e + 1], coords[2 * q], coords[2 * q + 1])) {
        e = q;
        if (e === start) { e = -1; break; }
        q = hullNext[e];
      }
      if (e === -1) continue;                     // ponto quase duplicado

      var t = addTri(e, i, hullNext[e], -1, -1, hullTri[e]);
      hullTri[i] = legalize(t + 2);
      hullTri[e] = t;

      /* avança pelo fecho adicionando triângulos */
      var nx = hullNext[e];
      q = hullNext[nx];
      while (orient(x, y, coords[2 * nx], coords[2 * nx + 1], coords[2 * q], coords[2 * q + 1])) {
        t = addTri(nx, i, q, hullTri[i], -1, hullTri[nx]);
        hullTri[i] = legalize(t + 2);
        hullNext[nx] = nx;                        // removido do fecho
        nx = q;
        q = hullNext[nx];
      }
      /* e para trás, pelo outro lado */
      if (e === start) {
        q = hullPrev[e];
        while (orient(x, y, coords[2 * q], coords[2 * q + 1], coords[2 * e], coords[2 * e + 1])) {
          t = addTri(q, i, e, -1, hullTri[e], hullTri[q]);
          legalize(t + 2);
          hullTri[q] = t;
          hullNext[e] = e;
          e = q;
          q = hullPrev[e];
        }
      }
      hullStart = hullPrev[i] = e;
      hullNext[e] = hullPrev[nx] = i;
      hullNext[i] = nx;
      hullHash[hashKey(x, y)] = i;
      hullHash[hashKey(coords[2 * e], coords[2 * e + 1])] = e;
    }
    return { triangles: tris.subarray(0, trisLen), halfedges: half.subarray(0, trisLen) };
  }

  /* ---------- processamento da imagem ---------- */
  function blur3(src, w, h) {                     // caixa 3×3 separável
    var tmp = new Float32Array(src.length), out = new Float32Array(src.length), x, y, i;
    for (y = 0; y < h; y++) {
      i = y * w;
      for (x = 0; x < w; x++) {
        var l = x > 0 ? src[i + x - 1] : src[i + x], r = x < w - 1 ? src[i + x + 1] : src[i + x];
        tmp[i + x] = (l + src[i + x] + r) / 3;
      }
    }
    for (y = 0; y < h; y++) {
      var up = y > 0 ? -w : 0, dn = y < h - 1 ? w : 0;
      for (x = 0; x < w; x++) { i = y * w + x; out[i] = (tmp[i + up] + tmp[i] + tmp[i + dn]) / 3; }
    }
    return out;
  }
  function sobel(src, w, h) {                     // magnitude do gradiente
    var out = new Float32Array(src.length);
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var a = src[i - w - 1], b = src[i - w], c = src[i - w + 1];
        var d = src[i - 1], f = src[i + 1];
        var g = src[i + w - 1], hh = src[i + w], k = src[i + w + 1];
        var gx = (c + 2 * f + k) - (a + 2 * d + g), gy = (g + 2 * hh + k) - (a + 2 * b + c);
        out[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return out;
  }
  function percentile(vals, mask, q) {            // percentil aproximado por histograma
    var max = 0, i, n = vals.length, total = 0;
    for (i = 0; i < n; i++) if (mask[i] > 0.5 && vals[i] > max) max = vals[i];
    if (max <= 0) return 1;
    var bins = new Uint32Array(512);
    for (i = 0; i < n; i++) if (mask[i] > 0.5) { bins[Math.min(511, (vals[i] / max * 511) | 0)]++; total++; }
    var target = total * q, acc = 0;
    for (i = 0; i < 512; i++) { acc += bins[i]; if (acc >= target) return Math.max(1e-4, (i + 0.5) / 511 * max); }
    return max;
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgb(c, a) {
    var s = Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]);
    return a == null || a >= 1 ? 'rgb(' + s + ')' : 'rgba(' + s + ',' + a.toFixed(3) + ')';
  }
  /* luminosidade -> cor néon (azul profundo -> azul/rosa -> menta) */
  function neonColor(r, g, b, lum) {
    var warm = RR.clamp((r - b) / 110, 0, 1);
    var midC = mix(BLUE, PINK, warm * 0.85);
    var t = RR.clamp((lum - 0.06) / 0.8, 0, 1);
    return t < 0.5 ? mix(DEEP, midC, t / 0.5) : mix(midC, MINT, (t - 0.5) / 0.5);
  }

  RR.art.register({
    id: 'delaunay',
    order: 5,
    title: 'Low-poly',
    short: 'Delaunay',
    algo: 'Triangulação de Delaunay',
    field: 'Geometria computacional',
    description: 'Amostragem por importância espalha mais pontos onde o gradiente da imagem é forte (olhos, cabelo, fones) e a triangulação de Delaunay liga esses pontos sem deixar nenhum ponto dentro do círculo circunscrito de um triângulo; entre todas as triangulações possíveis, é a que maximiza o menor ângulo da malha, evitando triângulos finos. Cada face recebe a cor média dos pixels que cobre, e o retrato vira alguns milhares de polígonos. Malhas assim aparecem em visão computacional, reconstrução 3D e interpolação de dados espaciais.',
    params: [
      { id: 'pontos', label: 'Pontos', type: 'range', min: 300, max: 4000, step: 100, value: 1600, format: function (v) { return RR.fmt(v); } },
      {
        id: 'estilo', label: 'Estilo', type: 'select', value: 'facet', options: [
          { value: 'facet', label: 'Facetado' },
          { value: 'neon', label: 'Wireframe neon' },
          { value: 'edges', label: 'Facetado + arestas' }
        ]
      }
    ],
    animated: true,
    render: function (ctx, p, env) {
      var W = env.width, H = env.height, thumb = !!env.thumb;
      var style = p.estilo === 'neon' || p.estilo === 'edges' ? p.estilo : 'facet';
      var bg = style === 'neon' ? NEON_BG : env.palette.artBg;
      var rand = RR.rng((env.seed >>> 0) * 2654435761 + 101);

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();

      /* densidade em meia resolução; cor média na resolução do palco */
      var densW = thumb ? 88 : RR.clamp(Math.round(W / 2), 120, 250);
      var colW = Math.min(491, thumb ? 130 : Math.max(220, Math.round(W)));
      return Promise.all([env.getSource(densW), env.getSource(colW)]).then(function (srcs) {
        if (env.cancelled()) return;
        var src = srcs[0], csrc = srcs[1];
        var sw = src.width, sh = src.height, n = sw * sh, data = src.data, i, x, y;
        var sx = W / sw, sy = H / sh;
        var pts = [], count = 0, coords, T, HE, m = 0, col, fg, lumT, cenX, cenY;

        /* luminância composta sobre o fundo escuro + alfa */
        var A = new Float32Array(n), L = new Float32Array(n);
        for (i = 0; i < n; i++) {
          var a = data[i * 4 + 3] / 255;
          A[i] = a;
          L[i] = ((0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255) * a + 0.04 * (1 - a);
        }
        var G = sobel(blur3(L, sw, sh), sw, sh), GA = sobel(A, sw, sh);
        var g95 = percentile(G, A, 0.94);

        /* etapa 1 — densidade de importância: gradiente forte × saliência do rosto + contorno.
           A gaussiana do rosto é separável: exp(-fx²/s)·exp(-0,75·fy²/s) */
        var salX = new Float32Array(sw), salY = new Float32Array(sh);
        for (x = 0; x < sw; x++) { var fx = x / sw - FACE_X; salX[x] = Math.exp(-fx * fx / 0.08); }
        for (y = 0; y < sh; y++) { var fy = y / sh - FACE_Y; salY[y] = Math.exp(-0.75 * fy * fy / 0.08); }
        var den = new Float32Array(n), cdf = new Float64Array(n), sum = 0, dmax = 0, ig = 1 / g95;
        for (y = 0; y < sh; y++) {
          for (x = 0; x < sw; x++) {
            i = y * sw + x;
            var v = 0.006;
            if (A[i] > 0.5) {
              var g = G[i] * ig;
              if (g > 1.6) g = 1.6;
              v = (0.05 + g * Math.sqrt(Math.sqrt(g))) * (1 + 0.9 * salX[x] * salY[y]);   // g^1,25
            }
            var ga = GA[i] * 0.5;
            v += 0.9 * (ga > 1 ? 1 : ga);
            den[i] = v; sum += v; cdf[i] = sum;
            if (v > dmax) dmax = v;
          }
        }

        /* etapa 2 — pontos: moldura (por fora da tela, para a malha cobrir tudo) + dardos
           com raio variável (disco de Poisson adaptativo à densidade). Fatiada por orçamento
           de tempo: o estado fica no fechamento e cada chamada continua de onde parou. */
        var target, inner, total, rMin, rMax, kR, cs, gw, gh, head, nxt, pass = 0, att = 0, maxAtt = 0, pInit = false;
        function insert(px, py) {
          var c = (((py + 4) / cs) | 0) * gw + (((px + 4) / cs) | 0);
          nxt[count] = head[c]; head[c] = count; count++;
        }
        function stagePoints(budget) {
          var t0 = performance.now();
          if (!pInit) {
            pInit = true;
            target = thumb ? RR.clamp(Math.round(p.pontos * 0.22), 160, 520) : RR.clamp(Math.round(p.pontos) || 1600, 100, 6000);
            var nbx = thumb ? 4 : 7, nby = Math.round(nbx * H / W);
            for (i = 0; i <= nbx; i++) {
              var bx = i / nbx * (W + 2) - 1 + (i > 0 && i < nbx ? (rand() - 0.5) * W / nbx * 0.5 : 0);
              pts.push(bx, -1 - rand() * 0.6, bx, H + 1 + rand() * 0.6);
            }
            for (i = 1; i < nby; i++) {
              var by = i / nby * (H + 2) - 1 + (rand() - 0.5) * H / nby * 0.5;
              pts.push(-1 - rand() * 0.6, by, W + 1 + rand() * 0.6, by);
            }
            var nBorder = pts.length / 2;
            inner = Math.max(10, target - nBorder);
            total = nBorder + inner;
            rMin = thumb ? 0.55 : 1.2; rMax = W * 0.085;
            kR = Math.sqrt(0.62 * sum * sx * sy / inner);
            cs = Math.max(thumb ? 1 : 1.6, kR / Math.sqrt(dmax));
            gw = Math.ceil((W + 8) / cs) + 1; gh = Math.ceil((H + 8) / cs) + 1;
            head = new Int32Array(gw * gh).fill(-1); nxt = new Int32Array(total + 8);
            for (i = 0; i < nBorder; i++) insert(pts[2 * i], pts[2 * i + 1]);
            maxAtt = inner * 28;
          }
          while (pass < 4 && count < total) {
            while (att < maxAtt && count < total) {
              att++;
              var u = rand() * sum, lo = 0, hi = n - 1;
              while (lo < hi) { var mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
              var cx = ((lo % sw) + rand()) * sx, cy = (((lo / sw) | 0) + rand()) * sy;
              var r = RR.clamp(kR / Math.sqrt(den[lo]), rMin, rMax), r2 = r * r;
              var gx0 = Math.max(0, ((cx + 4 - r) / cs) | 0), gx1 = Math.min(gw - 1, ((cx + 4 + r) / cs) | 0);
              var gy0 = Math.max(0, ((cy + 4 - r) / cs) | 0), gy1 = Math.min(gh - 1, ((cy + 4 + r) / cs) | 0);
              var ok = true;
              for (var gy = gy0; gy <= gy1 && ok; gy++) {
                for (var gx = gx0; gx <= gx1; gx++) {
                  for (var q = head[gy * gw + gx]; q !== -1; q = nxt[q]) {
                    if (dist2(cx, cy, pts[2 * q], pts[2 * q + 1]) < r2) { ok = false; break; }
                  }
                  if (!ok) break;
                }
              }
              if (ok) { pts.push(cx, cy); insert(cx, cy); }
              if ((att & 511) === 0 && performance.now() - t0 > budget) return MORE;
            }
            kR *= 0.86;                               // ainda faltam pontos: raio menor
            pass++; att = 0;
          }
          head = nxt = null;
          return true;
        }

        /* etapa 3 — triangulação e cor média de cada face */
        var meshT = -1;
        function stageMesh(budget) {
          var t0 = performance.now();
          if (meshT < 0) {
            coords = new Float64Array(pts);
            var dt = delaunay(coords);
            if (!dt) return false;
            T = dt.triangles; HE = dt.halfedges; m = T.length / 3;
            col = new Uint8ClampedArray(m * 3); fg = new Uint8Array(m); lumT = new Float32Array(m);
            cenX = new Float32Array(m); cenY = new Float32Array(m);
            meshT = 0;
            if (performance.now() - t0 > budget * 0.6) return MORE;
          }

          /* cor média por face: rasteriza cada triângulo sobre os pixels da fonte */
          var cd = csrc.data, cw = csrc.width, ch = csrc.height, kx = cw / W, ky = ch / H;
          for (var t = meshT; t < m; t++) {
            if ((t & 63) === 63 && performance.now() - t0 > budget) { meshT = t; return MORE; }
            var a0 = T[3 * t], a1 = T[3 * t + 1], a2 = T[3 * t + 2];
            var x0 = coords[2 * a0] * kx, y0 = coords[2 * a0 + 1] * ky;
            var x1 = coords[2 * a1] * kx, y1 = coords[2 * a1 + 1] * ky;
            var x2 = coords[2 * a2] * kx, y2 = coords[2 * a2 + 1] * ky;
            cenX[t] = (coords[2 * a0] + coords[2 * a1] + coords[2 * a2]) / 3;
            cenY[t] = (coords[2 * a0 + 1] + coords[2 * a1 + 1] + coords[2 * a2 + 1]) / 3;
            var sg = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0) < 0 ? -1 : 1;
            var px0 = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 0.5)), px1 = Math.min(cw - 1, Math.floor(Math.max(x0, x1, x2) - 0.5));
            var py0 = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5)), py1 = Math.min(ch - 1, Math.floor(Math.max(y0, y1, y2) - 0.5));
            var sr = 0, sgc = 0, sb = 0, sa = 0, cnt = 0;
            for (var yy = py0; yy <= py1; yy++) {
              var pcy = yy + 0.5;
              for (var xx = px0; xx <= px1; xx++) {
                var pcx = xx + 0.5;
                if (((x1 - pcx) * (y2 - pcy) - (x2 - pcx) * (y1 - pcy)) * sg < 0 ||
                  ((x2 - pcx) * (y0 - pcy) - (x0 - pcx) * (y2 - pcy)) * sg < 0 ||
                  ((x0 - pcx) * (y1 - pcy) - (x1 - pcx) * (y0 - pcy)) * sg < 0) continue;
                var o = (yy * cw + xx) * 4, al = cd[o + 3];
                sr += cd[o] * al; sgc += cd[o + 1] * al; sb += cd[o + 2] * al; sa += al; cnt++;
              }
            }
            if (!cnt) {                               // face menor que um pixel: amostra o centroide
              var ci = (Math.min(ch - 1, Math.max(0, (cenY[t] * ky) | 0)) * cw + Math.min(cw - 1, Math.max(0, (cenX[t] * kx) | 0))) * 4;
              var ca = cd[ci + 3];
              sr = cd[ci] * ca; sgc = cd[ci + 1] * ca; sb = cd[ci + 2] * ca; sa = ca; cnt = 1;
            }
            if (sa / (cnt * 255) >= 0.5) {
              var jit = 1 + (rand() - 0.5) * 0.09;      // leve variação por faceta (efeito cristal)
              var cr = sr / sa * jit, cg = sgc / sa * jit, cb = sb / sa * jit;
              var mean = (cr + cg + cb) / 3;            // um toque a mais de saturação
              col[3 * t] = mean + (cr - mean) * 1.12; col[3 * t + 1] = mean + (cg - mean) * 1.12; col[3 * t + 2] = mean + (cb - mean) * 1.12;
              lumT[t] = (0.2126 * col[3 * t] + 0.7152 * col[3 * t + 1] + 0.0722 * col[3 * t + 2]) / 255;
              fg[t] = 1;
            }
          }
          meshT = m;
          return true;
        }

        /* etapa 4 — estilos, ordem da onda e desenho incremental: cada face cresce no
           lugar (o desenho maior cobre o menor) e cada aresta é traçada uma única vez,
           quando as duas faces vizinhas já estão assentadas (nada é redesenhado) */
        function stageDraw() {
          var t;
          env.setInfo(RR.fmt(count) + ' pontos · ' + RR.fmt(m) + ' triângulos');

          var fillCss = new Array(m), lineCss = new Array(m), glowCss = new Array(m);
          var bgLine = style === 'neon' ? 'rgba(79,123,255,0.16)' : 'rgba(158,245,207,0.075)';
          var bgDot = style === 'neon' ? 'rgba(158,245,207,0.38)' : 'rgba(158,245,207,0.22)';
          for (t = 0; t < m; t++) {
            if (!fg[t]) continue;
            var c3 = [col[3 * t], col[3 * t + 1], col[3 * t + 2]];
            if (style === 'neon') {
              var nc = neonColor(c3[0], c3[1], c3[2], lumT[t]);
              var la = 0.22 + 0.78 * Math.pow(lumT[t], 0.85);
              fillCss[t] = rgb(mix([5, 7, 15], nc, thumb ? 0.2 + 0.4 * lumT[t] : 0.1 + 0.26 * lumT[t]));
              lineCss[t] = rgb(nc, Math.min(1, thumb ? la * 1.3 : la));
              glowCss[t] = rgb(nc, la * 0.2);
            } else {
              fillCss[t] = rgb(c3);
              if (style === 'edges') lineCss[t] = rgb(mix(c3, [255, 255, 255], 0.3), 0.32 + 0.3 * lumT[t]);
            }
          }
          var lw = Math.max(0.35, W / 420);              // espessura relativa ao tamanho
          var vDone = new Uint8Array(count), done = new Uint8Array(m);

          function tri(c, t, s) {
            var i0 = T[3 * t], i1 = T[3 * t + 1], i2 = T[3 * t + 2], ox = cenX[t], oy = cenY[t];
            c.beginPath();
            c.moveTo(ox + (coords[2 * i0] - ox) * s, oy + (coords[2 * i0 + 1] - oy) * s);
            c.lineTo(ox + (coords[2 * i1] - ox) * s, oy + (coords[2 * i1 + 1] - oy) * s);
            c.lineTo(ox + (coords[2 * i2] - ox) * s, oy + (coords[2 * i2 + 1] - oy) * s);
            c.closePath();
            c.fillStyle = fillCss[t];
            c.fill();
          }
          function edge(c, he) {
            var va = T[he], vb = T[he - he % 3 + (he + 1) % 3];
            c.moveTo(coords[2 * va], coords[2 * va + 1]);
            c.lineTo(coords[2 * vb], coords[2 * vb + 1]);
          }
          function strokeFg(c, src) {                     // aresta do retrato no estilo atual
            if (style === 'neon') {
              c.globalCompositeOperation = 'lighter';
              c.strokeStyle = glowCss[src];
              c.lineWidth = 2.8 * lw;
              c.stroke();
              c.strokeStyle = lineCss[src];
              c.lineWidth = 0.75 * lw;
              c.stroke();
              c.globalCompositeOperation = 'source-over';
            } else {
              c.strokeStyle = lineCss[src];
              c.lineWidth = 0.55 * lw;
              c.stroke();
            }
          }
          function dots(c, t, css, r, add) {
            var drew = false;
            for (var k = 0; k < 3; k++) {
              var v = T[3 * t + k];
              if (vDone[v]) continue;
              vDone[v] = 1;
              var vx = coords[2 * v], vy = coords[2 * v + 1];
              if (vx < 0 || vy < 0 || vx > W || vy > H) continue;
              if (!drew) { c.beginPath(); drew = true; }
              c.moveTo(vx + r, vy);
              c.arc(vx, vy, r, 0, Math.PI * 2);
            }
            if (!drew) return;
            if (add) c.globalCompositeOperation = 'lighter';
            c.fillStyle = css;
            c.fill();
            c.globalCompositeOperation = 'source-over';
          }
          /* assenta a face t: preenchimento final + arestas cujas duas faces já existem */
          function settle(c, t) {
            done[t] = 1;
            if (fg[t]) {
              tri(c, t, 1);
              c.strokeStyle = fillCss[t];                 // mesma cor: some com as frestas do antialias
              c.lineWidth = 0.7 * lw;
              c.stroke();
            }
            var bgPath = false, fgPath = false, e, he, o, ot;
            for (e = 0; e < 3; e++) {                     // arestas internas do retrato (estilo da própria face)
              he = 3 * t + e; o = HE[he]; ot = o >= 0 ? (o / 3) | 0 : -1;
              if (ot >= 0 && !done[ot]) continue;
              if (fg[t] && ot >= 0 && fg[ot]) {
                if (style === 'facet') continue;
                if (!fgPath) { c.beginPath(); fgPath = true; }
                edge(c, he);
              }
            }
            if (fgPath) strokeFg(c, t);
            for (e = 0; e < 3; e++) {                     // silhueta e malha do fundo
              he = 3 * t + e; o = HE[he]; ot = o >= 0 ? (o / 3) | 0 : -1;
              if (ot >= 0 && !done[ot]) continue;
              if (fg[t] && ot >= 0 && fg[ot]) continue;
              var src = fg[t] ? t : (ot >= 0 && fg[ot] ? ot : -1);
              if (src >= 0 && style !== 'facet') {        // borda do retrato: estilo da face do retrato
                c.beginPath();
                edge(c, he);
                strokeFg(c, src);
              } else {
                if (!bgPath) { c.beginPath(); bgPath = true; }
                edge(c, he);
              }
            }
            if (bgPath) {
              c.strokeStyle = bgLine;
              c.lineWidth = 0.6 * lw;
              c.stroke();
            }
            if (!fg[t]) dots(c, t, bgDot, 0.9 * lw, false);
            else if (style === 'neon') dots(c, t, lineCss[t], 1.05 * lw, true);
          }

          /* ordem da onda: distância ao rosto, com um pouco de ruído orgânico */
          var fcx = FACE_X * W, fcy = FACE_Y * H, maxD = Math.sqrt(W * W + H * H) * 0.62;
          var order = new Array(m), key = new Float32Array(m);
          for (t = 0; t < m; t++) {
            order[t] = t;
            key[t] = Math.min(1, Math.sqrt(dist2(cenX[t], cenY[t], fcx, fcy)) / maxD) * 0.9 + rand() * 0.1;
          }
          order.sort(function (a, b) { return key[a] - key[b]; });

          if (thumb || RR.reducedMotion) {
            for (var j = 0; j < m; j++) settle(ctx, order[j]);
            return;
          }

          /* a frente da onda tem no máximo ~400 faces crescendo por quadro */
          var popMs = RR.clamp(REVEAL_MS * 400 / m, 80, 230);
          var settled = 0, t0 = -1;
          function frame(ts) {
            if (env.cancelled()) return;
            if (t0 < 0) t0 = ts;
            var el = ts - t0, k;
            while (settled < m && el - key[order[settled]] * REVEAL_MS >= popMs) settle(ctx, order[settled++]);
            for (var jj = settled; jj < m; jj++) {
              var tt = order[jj];
              k = (el - key[tt] * REVEAL_MS) / popMs;
              if (k <= 0) break;
              if (fg[tt]) tri(ctx, tt, 0.3 + 0.7 * (1 - Math.pow(1 - k, 3)));
            }
            if (settled < m) env.frame(frame);
          }
          env.frame(frame);
        }

        var stages = [stagePoints, stageMesh, stageDraw], si = 0;
        env.setInfo('amostrando pontos por importância…');
        if (thumb) {
          for (; si < stages.length; si++) if (stages[si](Infinity) === false) return;
          return;
        }
        /* preparo fatiado em quadros de ~SLICE_MS (nada trava a página) */
        function prep() {
          if (env.cancelled()) return;
          var r = stages[si](SLICE_MS);
          if (r === false) return;
          if (r !== MORE && ++si === 1) env.setInfo('triangulando ' + RR.fmt(count) + ' pontos…');
          if (si < stages.length) env.frame(prep);
        }
        env.frame(prep);
      });
    }
  });
})();
