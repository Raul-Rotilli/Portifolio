/* =========================================================================
   art/ascii.js — "Retrato tokenizado"
   O retrato vira texto: cada célula da grade monoespaçada recebe um caractere
   pela luminância média da região (ASCII), um pedaço de um fluxo de tokens de
   IA em "chips" coloridos, como num visualizador de tokenizador (Tokens), ou
   um bit do nome do Raul em UTF-8 (Binário). A célula tem a proporção real do
   glifo da fonte, então o rosto não estica.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR || !RR.art) return;

  var FAMILY = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  var RAMP = ' .:-=+*#%@';     // escuro -> claro (no fundo escuro, mais tinta = mais brilho)
  var LINE_H = 1.08;           // altura da célula em "em"
  var THUMB_COLS = 30;
  var STREAM_MS = 1100;        // duração da animação de geração no palco

  var VOCAB = ['tensor', 'gradiente', 'atenção', 'embedding', 'neurônio', 'raul', 'backprop', 'transformer',
    'época', 'loss', 'softmax', 'pesos', 'viés', 'camada', 'ativação', 'token', 'logits', 'dropout', 'batch',
    'ReLU', 'LLM', 'vetor', 'matriz', 'otimizador', 'Adam', 'convolução', 'kernel', 'inferência', 'dataset',
    'rótulo', 'treino', 'validação', 'perceptron', 'sigmoide', 'entropia', 'contexto', 'prompt', 'encoder',
    'decoder', 'python', 'GPU', 'gradiente', 'atenção', 'raul'];
  /* cores de "tokenizador" (uma por token, em ciclo) para o modo sem cor */
  var TOK_COLORS = [[158, 245, 207], [143, 176, 255], [255, 179, 138], [255, 140, 196]];
  var MINT = [158, 245, 207];

  /* espera a JetBrains Mono (com limite de tempo: offline cai no monospace do sistema) */
  var fontPromise = null;
  function fontReady() {
    if (fontPromise) return fontPromise;
    var fs = document.fonts;
    if (!fs || !fs.load) return (fontPromise = Promise.resolve());
    var load = Promise.all([fs.load('400 16px "JetBrains Mono"'), fs.load('600 16px "JetBrains Mono"')])
      .then(function () { return fs.ready; }, function () {});
    fontPromise = Promise.race([load, new Promise(function (r) { setTimeout(r, 1500); })]);
    return fontPromise;
  }

  /* bits do texto em UTF-8 (acentos incluídos) */
  var BITS = (function () {
    var txt = 'Raul Rotilli Aguirre · IA & ML · ', bytes = [];
    if (typeof TextEncoder === 'function') bytes = Array.prototype.slice.call(new TextEncoder().encode(txt));
    else for (var i = 0; i < txt.length; i++) bytes.push(txt.charCodeAt(i) & 255);
    var out = '';
    bytes.forEach(function (b) { for (var k = 7; k >= 0; k--) out += (b >> k) & 1; });
    return out;
  })();

  /* cor viva com brilho controlado: normaliza o canal mais forte e aplica o brilho b */
  function vivid(r, g, b, bright, out) {
    var mx = Math.max(r, g, b, 1), mean = (r + g + b) / 3;
    /* leve aumento de saturação antes de normalizar */
    r = mean + (r - mean) * 1.25; g = mean + (g - mean) * 1.25; b = mean + (b - mean) * 1.25;
    var s = bright * 255 / mx;
    out[0] = RR.clamp(r * s, 0, 255); out[1] = RR.clamp(g * s, 0, 255); out[2] = RR.clamp(b * s, 0, 255);
    return out;
  }

  /* grade: média ponderada pelo alfa da região de cada célula */
  function sampleGrid(src, W, H, cols, rows, cellW, cellH, y0) {
    var sw = src.width, sh = src.height, d = src.data;
    var sx = sw / W, sy = sh / H, n = cols * rows;
    var cov = new Float32Array(n), cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n), lum = new Float32Array(n);
    for (var row = 0; row < rows; row++) {
      var ya = Math.floor((y0 + row * cellH) * sy), yb = Math.max(ya + 1, Math.floor((y0 + (row + 1) * cellH) * sy));
      ya = RR.clamp(ya, 0, sh - 1); yb = RR.clamp(yb, ya + 1, sh);
      for (var col = 0; col < cols; col++) {
        var xa = Math.floor(col * cellW * sx), xb = Math.max(xa + 1, Math.floor((col + 1) * cellW * sx));
        xa = RR.clamp(xa, 0, sw - 1); xb = RR.clamp(xb, xa + 1, sw);
        var sa = 0, sr = 0, sg = 0, sbb = 0, cnt = 0;
        for (var y = ya; y < yb; y++) {
          var o = (y * sw + xa) * 4;
          for (var x = xa; x < xb; x++, o += 4) {
            var a = d[o + 3];
            sa += a; sr += d[o] * a; sg += d[o + 1] * a; sbb += d[o + 2] * a; cnt++;
          }
        }
        var i = row * cols + col;
        cov[i] = sa / (cnt * 255);
        if (sa > 0) {
          cr[i] = sr / sa; cg[i] = sg / sa; cb[i] = sbb / sa;
          lum[i] = (0.2126 * cr[i] + 0.7152 * cg[i] + 0.0722 * cb[i]) / 255;
        }
      }
    }
    return { cov: cov, r: cr, g: cg, b: cb, lum: lum };
  }

  /* estira o contraste da luminância (percentis 2–98 das células opacas) */
  function stretch(G, on) {
    var hist = new Uint32Array(256), cnt = 0, i, n = G.lum.length;
    for (i = 0; i < n; i++) if (on[i]) { hist[(G.lum[i] * 255) | 0]++; cnt++; }
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cnt * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cnt * 0.02) { hi = i; break; } }
    var span = Math.max(8, hi - lo), t = new Float32Array(n);
    for (i = 0; i < n; i++) if (on[i]) t[i] = RR.clamp((G.lum[i] * 255 - lo) / span, 0, 1);
    return t;
  }

  /* contraste local (máscara de nitidez na grade): olhos, sobrancelhas e barba
     ficam legíveis mesmo com poucas células */
  function localContrast(t, on, cols, rows, r, amount) {
    var n = cols * rows, sum = new Float32Array(n), cnt = new Float32Array(n), out = new Float32Array(n), x, y, i;
    var tmpS = new Float32Array(n), tmpC = new Float32Array(n);
    for (y = 0; y < rows; y++) {
      var s = 0, c = 0, b = y * cols;
      for (x = -r; x < cols; x++) {
        var xa = x + r, xr = x - r - 1;
        if (xa < cols && on[b + xa]) { s += t[b + xa]; c++; }
        if (xr >= 0 && on[b + xr]) { s -= t[b + xr]; c--; }
        if (x >= 0) { tmpS[b + x] = s; tmpC[b + x] = c; }
      }
    }
    for (x = 0; x < cols; x++) {
      var s2 = 0, c2 = 0;
      for (y = -r; y < rows; y++) {
        var ya = y + r, yr = y - r - 1;
        if (ya < rows) { s2 += tmpS[ya * cols + x]; c2 += tmpC[ya * cols + x]; }
        if (yr >= 0) { s2 -= tmpS[yr * cols + x]; c2 -= tmpC[yr * cols + x]; }
        if (y >= 0) { sum[y * cols + x] = s2; cnt[y * cols + x] = c2; }
      }
    }
    for (i = 0; i < n; i++) {
      if (!on[i]) continue;
      var m = cnt[i] > 0 ? sum[i] / cnt[i] : t[i];
      out[i] = RR.clamp(t[i] + amount * (t[i] - m), 0, 1);
    }
    return out;
  }

  RR.art.register({
    id: 'ascii',
    order: 4,
    title: 'Retrato tokenizado',
    short: 'Tokens',
    algo: 'Tokenização',
    field: 'Processamento de linguagem natural',
    description: 'Antes de ler qualquer coisa, um modelo de linguagem quebra o texto em tokens e os transforma em números. Aqui o caminho é o inverso: cada região da foto vira um caractere, escolhido pelo brilho (ASCII), tirado de um fluxo de vocabulário de IA (Tokens) ou de um bit do nome do Raul em UTF-8 (Binário).',
    params: [
      {
        id: 'modo', label: 'Modo', type: 'select', value: 'tokens', options: [
          { value: 'tokens', label: 'Tokens' },
          { value: 'ascii', label: 'ASCII' },
          { value: 'binario', label: 'Binário' }
        ]
      },
      { id: 'colunas', label: 'Colunas', type: 'range', min: 40, max: 140, step: 2, value: 84 },
      { id: 'colorido', label: 'Colorido', type: 'toggle', value: true }
    ],
    animated: true,
    render: function (ctx, p, env) {
      var W = env.width, H = env.height, pal = env.palette;
      var mode = p.modo === 'ascii' || p.modo === 'binario' ? p.modo : 'tokens';
      var color = !!p.colorido;
      var cols = env.thumb ? THUMB_COLS : RR.clamp(Math.round(+p.colunas || 84), 40, 140);
      ctx.fillStyle = pal.artBg;
      ctx.fillRect(0, 0, W, H);

      return Promise.all([fontReady(), env.getSource(Math.min(491, Math.max(96, cols * 4)))]).then(function (res) {
        if (env.cancelled()) return;
        var src = res[1];

        /* métrica real da fonte: avanço do glifo em "em" */
        ctx.font = '400 100px ' + FAMILY;
        var adv = ctx.measureText('M').width / 100 || 0.6;
        var cellW = W / cols, fontSize = cellW / adv, cellH = fontSize * LINE_H;
        var rows = Math.max(1, Math.floor(H / cellH)), y0 = (H - rows * cellH) / 2;
        var G = sampleGrid(src, W, H, cols, rows, cellW, cellH, y0);
        var n = cols * rows, on = new Uint8Array(n), i, opaque = 0;
        for (i = 0; i < n; i++) if (G.cov[i] >= 0.4) { on[i] = 1; opaque++; }
        var T = localContrast(stretch(G, on), on, cols, rows, Math.max(2, Math.round(cols / 20)), 0.6);

        /* monta as células: caractere, cor do glifo, fundo (Tokens) e peso */
        var rand = RR.rng((env.seed >>> 0) * 2654435761 + 97);
        var chars = new Array(n), fg = new Array(n), bg = null, bold = new Uint8Array(n), edge = null;
        var rgb = [0, 0, 0], stream = '', tokIndex = null, tokens = 0;
        if (mode === 'tokens') {
          /* fluxo contínuo de tokens embaralhados pela seed; cada token vira um "chip"
             com fundo próprio, como nos visualizadores de tokenizador */
          var order = VOCAB.slice();
          for (i = order.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
          tokIndex = new Uint32Array(Math.max(1, opaque));
          edge = new Uint8Array(n);    // bit 1 = início do token, bit 2 = fim
          bg = new Array(n);
          var ti = 0;
          while (stream.length < opaque) {
            var word = order[ti % order.length];
            for (var c = 0; c < word.length && stream.length < opaque; c++) { tokIndex[stream.length] = ti; stream += word[c]; }
            ti++;
          }
        }
        var bitOff = Math.floor(rand() * BITS.length), si = 0;
        var colPhase = new Float32Array(cols), colLen = new Float32Array(cols);
        for (i = 0; i < cols; i++) { colPhase[i] = rand(); colLen[i] = 0.35 + rand() * 0.5; }
        function css(r, g, b, a) { return 'rgba(' + (r & 248) + ',' + (g & 248) + ',' + (b & 248) + ',' + a + ')'; }

        for (var row = 0; row < rows; row++) {
          for (var col = 0; col < cols; col++) {
            i = row * cols + col;
            if (!on[i]) continue;
            var t = T[i], ch, bright;
            if (mode === 'tokens') {
              var tk = tokIndex[si];
              ch = stream[si];
              edge[i] = (si === 0 || tokIndex[si - 1] !== tk ? 1 : 0) | (si === opaque - 1 || tokIndex[si + 1] !== tk ? 2 : 0);
              si++;
              tokens = Math.max(tokens, tk + 1);
              if (color) vivid(G.r[i], G.g[i], G.b[i], 1, rgb);
              else { var pc = TOK_COLORS[tk % TOK_COLORS.length]; rgb[0] = pc[0]; rgb[1] = pc[1]; rgb[2] = pc[2]; }
              /* curva forte: sombras (olhos, barba, cabelo) bem apagadas, pele acesa;
                 o fundo do chip fica mais forte onde a foto é clara */
              var tc = Math.pow(t, env.thumb ? 1.3 : 1.8), kb = 0.45 + 0.55 * t;
              var ba = env.thumb ? 0.06 + 0.8 * Math.pow(t, 1.5) : 0.02 + 0.56 * Math.pow(t, 2.2);
              bg[i] = css(rgb[0] * kb, rgb[1] * kb, rgb[2] * kb, Math.round(ba * 50) / 50);
              /* glifo: sempre mais claro que o fundo */
              var wm = 0.1 + 0.55 * tc, f = 0.2 + 0.8 * tc;
              fg[i] = css((rgb[0] + (255 - rgb[0]) * wm) * f, (rgb[1] + (255 - rgb[1]) * wm) * f, (rgb[2] + (255 - rgb[2]) * wm) * f, 1);
              bold[i] = t > 0.6 ? 1 : 0;
            } else {
              if (mode === 'ascii') {
                ch = RAMP[1 + Math.round(t * (RAMP.length - 2))];
                bright = 0.22 + 0.78 * Math.pow(t, 1.3);
              } else {
                ch = BITS[(bitOff + si) % BITS.length];
                si++;
                /* rastros verticais sutis, estilo "chuva de código" */
                var ph = (row / rows + colPhase[col]) % colLen[col] / colLen[col];
                bright = (0.13 + 0.87 * Math.pow(t, 1.7)) * (0.74 + 0.26 * ph);
                bold[i] = t > 0.7 ? 1 : 0;
              }
              if (color) vivid(G.r[i], G.g[i], G.b[i], bright, rgb);
              else if (mode === 'binario') { rgb[0] = MINT[0] * bright; rgb[1] = MINT[1] * bright; rgb[2] = MINT[2] * bright; }
              else { rgb[0] = 40 + 205 * bright * bright; rgb[1] = 92 + 163 * bright; rgb[2] = 80 + 170 * bright; }
              fg[i] = css(rgb[0], rgb[1], rgb[2], 1);
            }
            chars[i] = ch;
          }
        }

        var fontN = '400 ' + fontSize.toFixed(2) + 'px ' + FAMILY;
        var fontB = '600 ' + fontSize.toFixed(2) + 'px ' + FAMILY;
        var hgap = Math.max(0.6, cellW * 0.14), vgap = Math.max(0.5, cellH * 0.08);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        function cellX(idx) { return (idx % cols + 0.5) * cellW; }
        function cellY(idx) { return y0 + (Math.floor(idx / cols) + 0.5) * cellH; }
        function chipRect(idx) {
          var e = edge[idx], x = (idx % cols) * cellW, w = cellW;
          if (e & 1) { x += hgap; w -= hgap; }
          if (e & 2) w -= hgap;
          ctx.fillRect(x, y0 + Math.floor(idx / cols) * cellH + vgap, w, cellH - 2 * vgap);
        }

        /* desenho estático: fundos agrupados por cor, depois glifos por (peso, cor) */
        function drawAll() {
          var q, groups;
          if (bg) {
            groups = {};
            for (q = 0; q < n; q++) if (on[q]) (groups[bg[q]] || (groups[bg[q]] = [])).push(q);
            Object.keys(groups).forEach(function (key) {
              ctx.fillStyle = key;
              groups[key].forEach(chipRect);
            });
          }
          groups = {};
          for (q = 0; q < n; q++) {
            if (!on[q]) continue;
            var key = (bold[q] ? 'b' : 'n') + fg[q];
            (groups[key] || (groups[key] = [])).push(q);
          }
          var curFont = '';
          Object.keys(groups).forEach(function (key) {
            var fnt = key[0] === 'b' ? fontB : fontN;
            if (fnt !== curFont) { ctx.font = fnt; curFont = fnt; }
            ctx.fillStyle = key.slice(1);
            var list = groups[key];
            for (var z = 0; z < list.length; z++) ctx.fillText(chars[list[z]], cellX(list[z]), cellY(list[z]));
          });
        }

        var info = cols + '×' + rows + ' células · ' + RR.fmt(opaque, 0) + ' caracteres';
        if (mode === 'tokens') info += ' · ' + RR.fmt(tokens, 0) + ' tokens';
        else if (mode === 'binario') info += ' · ' + RR.fmt(Math.floor(opaque / 8), 0) + ' bytes de “Raul Rotilli Aguirre” em UTF-8';
        else info += ' · rampa "' + RAMP.trim() + '"';
        env.setInfo(info);

        if (env.thumb || RR.reducedMotion || mode === 'ascii') { drawAll(); return; }

        /* palco: Tokens "geram" em fluxo como um LLM (com cursor); Binário cai em chuva */
        var cells = [];
        for (i = 0; i < n; i++) if (on[i]) cells.push(i);
        var drawn = 0, cursor = -1, t0 = 0, curFontS = '', curStyle = '';
        var colDelay = new Float32Array(cols), colRow = new Int32Array(cols), colDone = 0;
        for (i = 0; i < cols; i++) colDelay[i] = rand() * 0.45;

        function put(idx) {
          if (bg) { ctx.fillStyle = bg[idx]; curStyle = ''; chipRect(idx); }
          var f = bold[idx] ? fontB : fontN;
          if (f !== curFontS) { ctx.font = f; curFontS = f; }
          if (fg[idx] !== curStyle) { ctx.fillStyle = fg[idx]; curStyle = fg[idx]; }
          ctx.fillText(chars[idx], cellX(idx), cellY(idx));
        }
        function clearCell(idx) {
          ctx.fillStyle = pal.artBg; curStyle = '';
          ctx.fillRect((idx % cols) * cellW, y0 + Math.floor(idx / cols) * cellH, cellW, cellH);
        }

        function step(ts) {
          if (env.cancelled()) return;
          if (!t0) t0 = ts;
          var lin = RR.clamp((ts - t0) / STREAM_MS, 0, 1);
          if (mode === 'tokens') {
            if (cursor >= 0) { clearCell(cursor); put(cursor); cursor = -1; }
            var target = lin >= 1 ? cells.length : Math.floor(cells.length * (1 - Math.pow(1 - lin, 1.6)));
            while (drawn < target) put(cells[drawn++]);
            if (drawn < cells.length) {
              /* cursor de bloco na próxima célula */
              cursor = cells[drawn];
              ctx.fillStyle = pal.mint; curStyle = '';
              ctx.fillRect((cursor % cols) * cellW + cellW * 0.1, y0 + Math.floor(cursor / cols) * cellH + cellH * 0.12, cellW * 0.8, cellH * 0.76);
              env.frame(step);
            }
          } else {
            /* cada coluna desce no seu ritmo; o glifo da frente brilha em branco */
            colDone = 0;
            for (var cc = 0; cc < cols; cc++) {
              var prog = RR.clamp((lin * 1.45 - colDelay[cc]) / 1, 0, 1);
              var upto = lin >= 1 ? rows : Math.floor(prog * rows);
              var r0 = colRow[cc];
              if (r0 > 0) { var prev = (r0 - 1) * cols + cc; if (on[prev]) { clearCell(prev); put(prev); } }
              for (var rr = r0; rr < upto; rr++) { var id = rr * cols + cc; if (on[id]) put(id); }
              colRow[cc] = upto;
              if (upto < rows && upto > 0) {
                var head = (upto - 1) * cols + cc;
                if (on[head]) {
                  clearCell(head);
                  ctx.font = fontN; curFontS = fontN;
                  ctx.fillStyle = 'rgba(240, 255, 248, 0.95)'; curStyle = '';
                  ctx.fillText(chars[head], cellX(head), cellY(head));
                }
              }
              if (upto >= rows) colDone++;
            }
            if (colDone < cols) env.frame(step);
          }
        }
        env.frame(step);
      });
    }
  });
})();
