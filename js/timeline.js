/* =========================================================================
   timeline.js — "Log de treinamento" (#timeline-root) + "Espaço de
   embeddings das habilidades" (#embedding-root)
   - Trajetória: curva de loss (SVG) fixa ao lado das épocas; um marcador
     segue a época em foco (IntersectionObserver).
   - Embeddings: dispersão 2D de habilidades com vizinhos mais próximos.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR;
  if (!RR) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, children) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  var uid = 0;
  function nextId(p) { uid += 1; return p + uid; }

  /* Interpolação cúbica monotônica (Fritsch–Carlson): passa pelos pontos sem "ondular" */
  function monotone(xs, ys) {
    var n = xs.length, d = [], m = [], i;
    for (i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      var k = 0;
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      while (k < n - 2 && x > xs[k + 1]) k++;
      var h = xs[k + 1] - xs[k], u = (x - xs[k]) / h, u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h * m[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h * m[k + 1];
    };
  }

  /* =========================================================================
     TRAJETÓRIA — curva de loss
     ========================================================================= */
  function initTimeline() {
    var root = document.getElementById('timeline-root');
    if (!root) return;
    var list = root.querySelector('.timeline__list');
    if (!list) return;
    var items = Array.prototype.slice.call(list.querySelectorAll('li.epoch'));
    if (!items.length) return;

    var epochs = items.map(function (li, i) {
      return { e: +li.getAttribute('data-epoch') || i + 1, loss: parseFloat(li.getAttribute('data-loss')) || 0, li: li };
    });
    var last = epochs[epochs.length - 1];
    var X_MAX = last.e + 0.7, Y_MAX = 1.05;

    // curva-base passando pelas épocas (+ início e projeção futura)
    var xs = [0], ys = [Math.min(1, epochs[0].loss + 0.08)];
    epochs.forEach(function (p) { xs.push(p.e); ys.push(p.loss); });
    var slope = epochs.length > 1 ? last.loss - epochs[epochs.length - 2].loss : -0.1;
    xs.push(X_MAX); ys.push(Math.max(0.04, last.loss + slope * 0.42));
    var base = monotone(xs, ys);

    // loss "bruta": base + ruído autocorrelacionado (semente fixa = sempre igual)
    var rand = RR.rng(20231), raw = [], noise = 0, SUB = 22;
    for (var k = 0; k <= last.e * SUB; k++) {
      var x = k / SUB, b = base(x);
      noise = 0.72 * noise + RR.gauss(rand) * (0.008 + 0.024 * b);
      var spike = rand() < 0.035 ? 0.05 * b * rand() : 0;
      var pin = Math.min(1, Math.abs(x - Math.round(x)) * 6); // encosta nos pontos das épocas
      raw.push([x, RR.clamp(b + (noise + spike) * pin, 0.01, Y_MAX)]);
    }

    root.classList.add('timeline--live');

    // selo "treinando…" na época atual + mini-barra de loss em cada cartão
    epochs.forEach(function (p) {
      var meta = p.li.querySelector('.epoch__meta');
      var chip = RR.el('span', { class: 'epoch__loss mono', 'aria-label': 'loss ' + RR.fmt(p.loss, 2) }, [
        RR.el('span', { 'aria-hidden': 'true' }, ['loss ', RR.el('b', { text: RR.fmt(p.loss, 2) })]),
        RR.el('i', { 'aria-hidden': 'true' })
      ]);
      chip.style.setProperty('--w', Math.round(p.loss * 100) + '%');
      if (meta) meta.parentNode.insertBefore(chip, meta);
      if (p.li.classList.contains('epoch--current') && meta) {
        meta.appendChild(RR.el('span', { class: 'epoch__badge' }, [RR.el('span', { class: 'pulse-dot', 'aria-hidden': 'true' }), 'treinando…']));
      }
    });

    /* ----- painel do gráfico ----- */
    var readout = RR.el('span', { class: 'timeline__readout' });
    var svgEl = svg('svg', { class: 'timeline__svg', role: 'img', 'aria-labelledby': 'tl-chart-desc', focusable: 'false' });
    var descText = 'Gráfico da loss de treino ao longo das épocas: ' + epochs.map(function (p) {
      return 'época ' + p.e + ', ' + RR.fmt(p.loss, 2);
    }).join('; ') + '. A curva continua caindo além da época atual.';
    var panel = RR.el('div', { class: 'timeline__chart' }, [
      RR.el('div', { class: 'timeline__chart-head mono' }, [
        RR.el('span', { class: 'timeline__chart-title' }, [RR.el('span', { class: 'timeline__chart-dot', 'aria-hidden': 'true' }), 'treino/loss']),
        readout
      ]),
      RR.el('div', { class: 'timeline__plot' }, [svgEl]),
      RR.el('p', { class: 'sr-only', id: 'tl-chart-desc', text: descText }),
      RR.el('div', { class: 'timeline__chart-foot mono', 'aria-hidden': 'true' }, [
        RR.el('span', { class: 'timeline__key timeline__key--raw' }, 'bruta'),
        RR.el('span', { class: 'timeline__key timeline__key--smooth' }, 'suavizada'),
        RR.el('span', { class: 'timeline__key timeline__key--proj' }, 'projeção')
      ])
    ]);
    root.insertBefore(panel, list);

    var geo = null, refs = {}, active = -1, shown = 0, anim = null;
    var ids = { area: nextId('tl-area'), line: nextId('tl-line'), clip: nextId('tl-clip'), glow: nextId('tl-glow') };

    function build() {
      var plot = svgEl.parentNode, W = Math.round(plot.clientWidth);
      if (!W) return;
      var compact = window.innerWidth < 960;
      var H = compact ? 104 : Math.round(RR.clamp(W * 0.66, 240, 330));
      var pad = compact ? { l: 30, r: 12, t: 10, b: 20 } : { l: 44, r: 18, t: 16, b: 38 };
      if (geo && geo.W === W && geo.H === H) return;
      geo = { W: W, H: H, pad: pad, compact: compact };
      var X = function (e) { return pad.l + (e / X_MAX) * (W - pad.l - pad.r); };
      var Y = function (l) { return pad.t + (1 - l / Y_MAX) * (H - pad.t - pad.b); };
      geo.X = X; geo.Y = Y;

      svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svgEl.setAttribute('width', W);
      svgEl.setAttribute('height', H);
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

      var defs = svg('defs', null, [
        svg('linearGradient', { id: ids.area, x1: '0', y1: '0', x2: '0', y2: '1' }, [
          svg('stop', { offset: '0', 'stop-color': '#9ef5cf', 'stop-opacity': '0.28' }),
          svg('stop', { offset: '1', 'stop-color': '#9ef5cf', 'stop-opacity': '0' })
        ]),
        svg('linearGradient', { id: ids.line, x1: '0', y1: '0', x2: '1', y2: '0' }, [
          svg('stop', { offset: '0', 'stop-color': '#4f7bff' }),
          svg('stop', { offset: '1', 'stop-color': '#9ef5cf' })
        ]),
        svg('clipPath', { id: ids.clip }, [refs.clipRect = svg('rect', { x: 0, y: 0, width: 0, height: H })]),
        svg('filter', { id: ids.glow, x: '-100%', y: '-100%', width: '300%', height: '300%' }, [
          svg('feGaussianBlur', { stdDeviation: '4' })
        ])
      ]);
      svgEl.appendChild(defs);

      // grade + eixos
      var g = svg('g', { class: 'tl-grid' });
      (compact ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).forEach(function (v) {
        g.appendChild(svg('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: v === 0 ? 'tl-axis' : 'tl-gridline' }));
        g.appendChild(svg('text', { x: pad.l - 8, y: Y(v), class: 'tl-tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, RR.fmt(v, 2)));
      });
      epochs.forEach(function (p) {
        g.appendChild(svg('line', { x1: X(p.e), x2: X(p.e), y1: Y(0), y2: Y(0) + 4, class: 'tl-axis' }));
        g.appendChild(svg('text', { x: X(p.e), y: Y(0) + (compact ? 13 : 16), class: 'tl-tick', 'text-anchor': 'middle' }, (p.e < 10 ? '0' : '') + p.e));
      });
      if (!compact) {
        g.appendChild(svg('text', { x: W - pad.r, y: H - 4, class: 'tl-axis-label', 'text-anchor': 'end' }, 'época →'));
        g.appendChild(svg('text', { x: pad.l - 8, y: pad.t - 4, class: 'tl-axis-label', 'text-anchor': 'end' }, 'loss'));
      }
      svgEl.appendChild(g);

      // caminhos
      var smooth = [], n = 120, i, xv;
      for (i = 0; i <= n; i++) { xv = (i / n) * last.e; smooth.push([X(xv), Y(base(xv))]); }
      var dSmooth = 'M' + smooth.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L');
      var dArea = dSmooth + 'L' + X(last.e).toFixed(1) + ' ' + Y(0) + 'L' + X(0) + ' ' + Y(0) + 'Z';
      var dRaw = 'M' + raw.map(function (p) { return X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('L');
      var proj = [];
      for (i = 0; i <= 20; i++) { xv = last.e + (i / 20) * (X_MAX - last.e); proj.push(X(xv).toFixed(1) + ' ' + Y(base(xv)).toFixed(1)); }

      svgEl.appendChild(svg('path', { d: dArea, fill: 'url(#' + ids.area + ')', 'clip-path': 'url(#' + ids.clip + ')', class: 'tl-area' }));
      svgEl.appendChild(svg('path', { d: dRaw, class: 'tl-raw' }));
      svgEl.appendChild(svg('path', { d: dSmooth, class: 'tl-smooth-dim' }));
      svgEl.appendChild(svg('path', { d: dSmooth, class: 'tl-smooth', stroke: 'url(#' + ids.line + ')', 'clip-path': 'url(#' + ids.clip + ')' }));
      svgEl.appendChild(svg('path', { d: 'M' + proj.join('L'), class: 'tl-proj' }));
      var endX = X(X_MAX), endY = Y(base(X_MAX));
      svgEl.appendChild(svg('circle', { cx: endX, cy: endY, r: 2.5, class: 'tl-proj-dot' }));
      if (!compact) svgEl.appendChild(svg('text', { x: endX, y: endY + 20, class: 'tl-proj-label', 'text-anchor': 'end' }, 'treinando…'));

      // guias + pontos das épocas + marcador
      refs.gx = svg('line', { class: 'tl-guide' });
      refs.gy = svg('line', { class: 'tl-guide' });
      svgEl.appendChild(refs.gx); svgEl.appendChild(refs.gy);
      refs.dots = epochs.map(function (p, idx) {
        var c = svg('circle', { cx: X(p.e), cy: Y(p.loss), r: compact ? 3 : 4, class: 'tl-dot' });
        var hit = svg('circle', { cx: X(p.e), cy: Y(p.loss), r: 14, class: 'tl-hit' });
        hit.addEventListener('click', function () { goTo(idx); });
        svgEl.appendChild(c); svgEl.appendChild(hit);
        return c;
      });
      refs.marker = svg('g', { class: 'tl-marker' }, [
        svg('circle', { r: 12, class: 'tl-marker-glow', filter: 'url(#' + ids.glow + ')' }),
        svg('circle', { r: 9, class: 'tl-marker-ring' }),
        svg('circle', { r: 4.5, class: 'tl-marker-core' })
      ]);
      svgEl.appendChild(refs.marker);
      render(shown);
    }

    /* desenha o estado para uma posição contínua "pos" (em épocas) */
    function render(pos) {
      if (!geo) return;
      var X = geo.X, Y = geo.Y, px = X(pos), py = Y(base(pos));
      refs.clipRect.setAttribute('width', Math.max(0, px));
      refs.marker.setAttribute('transform', 'translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ')');
      refs.gx.setAttribute('x1', px); refs.gx.setAttribute('x2', px); refs.gx.setAttribute('y1', py); refs.gx.setAttribute('y2', Y(0));
      refs.gy.setAttribute('x1', geo.pad.l); refs.gy.setAttribute('x2', px); refs.gy.setAttribute('y1', py); refs.gy.setAttribute('y2', py);
      refs.dots.forEach(function (d, i) {
        d.classList.toggle('is-past', epochs[i].e <= pos + 0.001);
        d.classList.toggle('is-active', i === active);
      });
    }

    function setActive(idx) {
      if (idx === active || idx < 0 || idx >= epochs.length) return;
      active = idx;
      epochs.forEach(function (p, i) { p.li.classList.toggle('is-active', i === idx); });
      var p = epochs[idx];
      readout.textContent = 'época ' + (p.e < 10 ? '0' : '') + p.e + ' · loss ' + RR.fmt(p.loss, 3);
      var from = shown, to = p.e;
      if (anim) cancelAnimationFrame(anim);
      if (RR.reducedMotion || !geo) { shown = to; render(shown); return; }
      var t0 = performance.now(), dur = 520 + Math.min(3, Math.abs(to - from)) * 160;
      (function frame(now) {
        var u = Math.min(1, (now - t0) / dur);
        shown = from + (to - from) * easeOut(u);
        render(shown);
        anim = u < 1 ? requestAnimationFrame(frame) : null;
      })(t0);
    }

    function goTo(idx) {
      var li = epochs[idx].li;
      li.scrollIntoView({ behavior: RR.reducedMotion ? 'auto' : 'smooth', block: 'center' });
      setActive(idx);
    }

    // época "em foco": a que cruza a faixa entre 38% e 52% da altura da janela
    function pickInitial() {
      var line = window.innerHeight * 0.45, pick = 0;
      epochs.forEach(function (p, i) { if (p.li.getBoundingClientRect().top < line) pick = i; });
      return pick;
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) setActive(epochs.findIndex(function (p) { return p.li === en.target; }));
        });
        if (active < 0) setActive(pickInitial()); // nenhuma na faixa: usa a posição atual
      }, { rootMargin: '-38% 0px -48% 0px', threshold: 0 });
      epochs.forEach(function (p) { io.observe(p.li); });
    } else setActive(epochs.length - 1);

    // o SVG é montado no callback do ResizeObserver (layout já calculado)
    var onResize = RR.debounce(function () { build(); }, 150);
    if ('ResizeObserver' in window) new ResizeObserver(function () { if (!geo) build(); else onResize(); }).observe(panel);
    else { window.addEventListener('resize', onResize); window.addEventListener('load', onResize); }
  }

  /* =========================================================================
     ESPAÇO DE EMBEDDINGS — habilidades em 2D
     Coordenadas posicionadas à mão (ilustrativas), em [-1, 1]².
     ========================================================================= */
  var CLUSTERS = {
    web: { label: 'Back-end & web', color: '#9ef5cf', top: true },
    ia: { label: 'IA & ML', color: '#86a6ff', top: true, training: true },
    infra: { label: 'Infra & suporte', color: '#ffb38a' },
    soft: { label: 'Soft skills', color: '#ff7db6' },
    tools: { label: 'Ferramentas', color: '#c3c9de', top: true }
  };
  var CLUSTER_ORDER = ['web', 'ia', 'infra', 'soft', 'tools'];
  var SKILLS = [
    { name: 'Java', c: 'web', x: -0.70, y: 0.50, side: 'l' },
    { name: 'Spring', c: 'web', x: -0.52, y: 0.66, side: 'r' },
    { name: 'HTML', c: 'web', x: -0.58, y: 0.12, side: 'l' },
    { name: 'CSS', c: 'web', x: -0.42, y: -0.02, side: 'r' },
    { name: 'JavaScript', c: 'web', x: -0.30, y: 0.24, side: 'r' },
    { name: 'Git/GitHub', c: 'tools', x: -0.04, y: 0.56, side: 't' },
    { name: 'Python', c: 'ia', x: 0.20, y: 0.32, side: 'b' },
    { name: 'NumPy', c: 'ia', x: 0.36, y: 0.60, side: 't' },
    { name: 'Pandas', c: 'ia', x: 0.46, y: 0.40, side: 'r' },
    { name: 'scikit-learn', c: 'ia', x: 0.60, y: 0.68, side: 'r' },
    { name: 'PyTorch', c: 'ia', x: 0.82, y: 0.50, side: 'r' },
    { name: 'Redes neurais', c: 'ia', x: 0.68, y: 0.24, side: 'r' },
    { name: 'LLMs & RAG', c: 'ia', x: 0.84, y: 0.04, side: 'b' },
    { name: 'Hardware', c: 'infra', x: -0.76, y: -0.44, side: 't' },
    { name: 'Manutenção', c: 'infra', x: -0.62, y: -0.70, side: 'b' },
    { name: 'Redes', c: 'infra', x: -0.44, y: -0.38, side: 'r' },
    { name: 'Ordens de serviço', c: 'infra', x: -0.30, y: -0.66, side: 'r' },
    { name: 'Comunicação assertiva', c: 'soft', x: 0.24, y: -0.46, side: 'b', short: ['Comunicação', 'assertiva'] },
    { name: 'Trabalho em equipe', c: 'soft', x: 0.50, y: -0.72, side: 'b', short: ['Trabalho', 'em equipe'] },
    { name: 'Networking', c: 'soft', x: 0.66, y: -0.40, side: 'r' }
  ];
  var TOUR = ['Python', 'Java', 'LLMs & RAG', 'Comunicação assertiva', 'Redes', 'JavaScript'];

  function initEmbedding() {
    var root = document.getElementById('embedding-root');
    if (!root) return;

    // vizinhos mais próximos (euclidiana no espaço 2D)
    SKILLS.forEach(function (s, i) {
      s.i = i;
      s.nn = SKILLS.map(function (o, j) { return { j: j, d: Math.hypot(o.x - s.x, o.y - s.y) }; })
        .filter(function (o) { return o.j !== i; })
        .sort(function (a, b) { return a.d - b.d; })
        .slice(0, 3);
      s.phase = [i * 1.7, i * 2.3 + 1];
    });

    var fallback = root.querySelector('.embedding__fallback');
    if (fallback) fallback.remove();

    /* ----- DOM ----- */
    var svgEl = svg('svg', { class: 'embedding__svg', role: 'img', focusable: 'false',
      'aria-label': 'Mapa 2D ilustrativo com ' + SKILLS.length + ' habilidades em ' + CLUSTER_ORDER.length + ' grupos. A lista de habilidades logo abaixo permite explorar os vizinhos mais próximos pelo teclado.' });
    var tip = RR.el('div', { class: 'embedding__tip', 'aria-hidden': 'true' });
    var plot = RR.el('div', { class: 'embedding__plot' }, [svgEl, tip]);

    var chips = [];
    var groupEls = {};
    CLUSTER_ORDER.forEach(function (key) {
      var cl = CLUSTERS[key], gid = nextId('emb-g-');
      var ul = RR.el('ul', { class: 'embedding__chips', 'aria-labelledby': gid });
      SKILLS.filter(function (s) { return s.c === key; }).forEach(function (s) {
        var nn = s.nn.map(function (o) { return SKILLS[o.j].name; }).join(', ');
        var btn = RR.el('button', {
          type: 'button', class: 'chip embedding__chip' + (cl.training ? ' is-training' : ''),
          'aria-pressed': 'false',
          'aria-label': s.name + ' — ' + cl.label + (cl.training ? ', em treinamento' : '') + '. Vizinhos mais próximos: ' + nn + '.'
        }, [RR.el('span', { class: 'embedding__chip-dot', 'aria-hidden': 'true' }), s.name]);
        btn.style.setProperty('--c', cl.color);
        btn.addEventListener('focus', function () { stopTour(); focusChip = s.i; setActive(s.i); });
        btn.addEventListener('blur', function () { focusChip = -1; if (pinned < 0) setActive(-1); else setActive(pinned); });
        btn.addEventListener('click', function () { stopTour(); pin(pinned === s.i ? -1 : s.i); });
        btn.addEventListener('pointerenter', function () { if (pinned < 0 && focusChip < 0) { stopTour(); setActive(s.i); } });
        btn.addEventListener('pointerleave', function () { if (pinned < 0 && focusChip < 0) setActive(-1); });
        chips[s.i] = btn;
        ul.appendChild(RR.el('li', null, btn));
      });
      var grp = RR.el('div', { class: 'embedding__group' }, [
        RR.el('p', { class: 'embedding__group-title mono', id: gid }, [
          RR.el('span', { class: 'embedding__swatch' + (cl.training ? ' is-training' : ''), 'aria-hidden': 'true' }),
          cl.label + (cl.training ? ' · em treinamento' : '')
        ]),
        ul
      ]);
      grp.style.setProperty('--c', cl.color);
      groupEls[key] = grp;
    });
    // colunas: [back-end + ferramentas] [IA & ML] [infra] [soft skills]
    var groups = [
      RR.el('div', { class: 'embedding__col' }, [groupEls.web, groupEls.tools]),
      groupEls.ia, groupEls.infra, groupEls.soft
    ];

    var legend = RR.el('div', { class: 'embedding__key mono' }, [
      RR.el('span', { class: 'embedding__key-item' }, [RR.el('span', { class: 'embedding__key-dot', 'aria-hidden': 'true' }), 'base já construída']),
      RR.el('span', { class: 'embedding__key-item' }, [RR.el('span', { class: 'embedding__key-dot is-training', 'aria-hidden': 'true' }), 'em treinamento: estudo atual, ainda sem experiência profissional']),
      RR.el('span', { class: 'embedding__key-item embedding__key-note' }, 'posições ilustrativas, feitas à mão (não é a saída de um modelo)')
    ]);

    var app = RR.el('div', { class: 'embedding__app' }, [
      RR.el('div', { class: 'embedding__bar mono' }, [
        RR.el('span', null, [RR.el('span', { class: 'embedding__logo', 'aria-hidden': 'true' }), 'habilidades.embed(dim=2)']),
        RR.el('span', { class: 'embedding__hint' }, 'k = 3 vizinhos · distância euclidiana')
      ]),
      plot,
      legend,
      RR.el('div', { class: 'embedding__groups', role: 'group', 'aria-label': 'Habilidades por grupo' }, groups)
    ]);
    root.appendChild(app);

    /* ----- estado ----- */
    var active = -1, pinned = -1, focusChip = -1, geo = null, nodes = [], lines = [];
    var tourOn = !RR.reducedMotion, tourIdx = 0, tourTimer = 0, visible = false, t = 0;

    function build() {
      var W = Math.round(plot.clientWidth);
      if (!W) return;
      var narrow = W < 620;
      var H = Math.round(narrow ? RR.clamp(W * 1.32, 400, 560) : RR.clamp(W * 0.52, 400, 560));
      if (geo && geo.W === W && geo.H === H) return;
      var pad = narrow ? { l: 20, r: 20, t: 46, b: 46 } : { l: 70, r: 70, t: 54, b: 54 };
      geo = { W: W, H: H, narrow: narrow };
      var labelPos = {}, obstacles = [];
      var X = function (x) { return pad.l + ((x + 1) / 2) * (W - pad.l - pad.r); };
      var Y = function (y) { return pad.t + ((1 - y) / 2) * (H - pad.t - pad.b); };
      geo.X = X; geo.Y = Y;
      svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svgEl.setAttribute('width', W); svgEl.setAttribute('height', H);
      svgEl.classList.toggle('is-narrow', narrow);
      while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

      // grade pontilhada + eixos
      var grid = svg('g', { class: 'emb-grid', 'aria-hidden': 'true' });
      for (var gx = -1; gx <= 1.001; gx += 0.5) grid.appendChild(svg('line', { x1: X(gx), x2: X(gx), y1: Y(1.08), y2: Y(-1.08), class: Math.abs(gx) < 1e-6 ? 'emb-axis' : 'emb-gridline' }));
      for (var gy = -1; gy <= 1.001; gy += 0.5) grid.appendChild(svg('line', { x1: X(-1.08), x2: X(1.08), y1: Y(gy), y2: Y(gy), class: Math.abs(gy) < 1e-6 ? 'emb-axis' : 'emb-gridline' }));
      grid.appendChild(svg('text', { x: W - 12, y: H - 12, class: 'emb-axis-label', 'text-anchor': 'end' }, 'dim 1 →'));
      grid.appendChild(svg('text', { x: 12, y: 20, class: 'emb-axis-label' }, '↑ dim 2'));
      svgEl.appendChild(grid);

      // "casco" suave de cada grupo: polígono convexo com traço grosso e arredondado
      var hulls = svg('g', { class: 'emb-hulls', 'aria-hidden': 'true' });
      CLUSTER_ORDER.forEach(function (key) {
        var cl = CLUSTERS[key];
        var pts = SKILLS.filter(function (s) { return s.c === key; }).map(function (s) { return [X(s.x), Y(s.y)]; });
        var hull = convexHull(pts);
        var d = hull.length > 1 ? 'M' + hull.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z'
          : 'M' + hull[0][0] + ' ' + hull[0][1] + 'l0.01 0';
        hulls.appendChild(svg('path', { d: d, class: 'emb-hull', style: 'color:' + cl.color, 'stroke-width': narrow ? 40 : 58 }));
        // rótulo do grupo acima do ponto mais alto (grupos de 1 ponto dispensam)
        var top = pts.reduce(function (a, b) { return b[1] < a[1] ? b : a; });
        var bottom = pts.reduce(function (a, b) { return b[1] > a[1] ? b : a; });
        var cx = pts.reduce(function (a, b) { return a + b[0]; }, 0) / pts.length;
        var above = !!cl.top;
        var text = cl.label.toUpperCase() + (cl.training ? ' · EM TREINAMENTO' : '');
        var ly = above ? top[1] - 40 : bottom[1] + 52;
        labelPos[key] = { x: cx, y: ly, w: text.length * 7.2 };
        if (!narrow && pts.length > 1) {
          obstacles.push({ x: cx - labelPos[key].w / 2, y: ly - 11, w: labelPos[key].w, h: 14 });
          hulls.appendChild(svg('text', { x: cx, y: ly, class: 'emb-cluster-label', fill: cl.color, 'text-anchor': 'middle' }, text));
        }
      });
      svgEl.appendChild(hulls);

      // vetor "foco atual": do centróide de back-end ao de IA
      var la = labelPos.web, lb = labelPos.ia;
      var ax = la.x + la.w / 2 + 14, ay = la.y - 4, bx = lb.x - lb.w / 2 - 14, by = lb.y - 4;
      var arrowId = nextId('emb-arrow');
      svgEl.appendChild(svg('defs', null, [
        svg('marker', { id: arrowId, viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, [
          svg('path', { d: 'M0 0L10 5L0 10z', class: 'emb-arrow-head' })
        ])
      ]));
      if (!narrow) {
        var mx = (ax + bx) / 2, my = Math.min(ay, by) - 34;
        svgEl.appendChild(svg('path', { d: 'M' + ax + ' ' + ay + 'Q' + mx + ' ' + my + ' ' + bx + ' ' + by, class: 'emb-vector', 'marker-end': 'url(#' + arrowId + ')' }));
        svgEl.appendChild(svg('text', { x: mx, y: (ay + by) / 4 + my / 2 - 8, class: 'emb-vector-label', 'text-anchor': 'middle' }, 'foco atual'));
      }

      // linhas de vizinhos (atualizadas no hover)
      var lg = svg('g', { class: 'emb-links', 'aria-hidden': 'true' });
      lines = [0, 1, 2].map(function () { var l = svg('line', { class: 'emb-link' }); lg.appendChild(l); return l; });
      svgEl.appendChild(lg);

      // pontos
      var pg = svg('g', { class: 'emb-points' });
      nodes = SKILLS.map(function (s) {
        var cl = CLUSTERS[s.c];
        var g = svg('g', { class: 'emb-pt' + (cl.training ? ' is-training' : ''), style: 'color:' + cl.color });
        g.appendChild(svg('circle', { r: 16, class: 'emb-pt-halo' }));
        g.appendChild(svg('circle', { r: narrow ? 5 : 6, class: 'emb-pt-dot' }));
        g.appendChild(svg('circle', { r: 22, class: 'emb-pt-hit' }));
        var text = svg('text', { class: 'emb-pt-label' });
        g.appendChild(text);
        g.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse' && pinned < 0) { stopTour(); setActive(s.i); } });
        g.addEventListener('click', function (e) { e.stopPropagation(); stopTour(); pin(pinned === s.i ? -1 : s.i); });
        pg.appendChild(g);
        return { g: g, text: text, s: s, px: X(s.x), py: Y(s.y), dx: 0, dy: 0 };
      });
      svgEl.appendChild(pg);

      placeLabels(obstacles);
      place(0);
      applyActive();
    }

    /* posicionamento guloso dos rótulos: tenta o lado preferido e depois os
       outros, evitando bordas, outros rótulos, pontos e rótulos de grupo */
    var mctx = document.createElement('canvas').getContext('2d');
    function placeLabels(obstacles) {
      var narrow = geo.narrow, size = narrow ? 11 : 12.5, lh = size + 2, off = narrow ? 10 : 12;
      mctx.font = '500 ' + size + 'px Inter, system-ui, sans-serif';
      var rects = obstacles.slice();
      nodes.forEach(function (n) { rects.push({ x: n.px - 8, y: n.py - 8, w: 16, h: 16, own: n }); });
      var hit = function (a, b) { return a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y; };
      nodes.forEach(function (n) {
        var s = n.s, lines = narrow && s.short ? s.short : [s.name];
        var w = Math.max.apply(null, lines.map(function (l) { return mctx.measureText(l).width; })), h = lines.length * lh;
        var sides = [s.side, 'r', 'l', 'b', 't'].filter(function (v, i, a) { return a.indexOf(v) === i; });
        var best = null, bestPen = Infinity;
        sides.forEach(function (side, si) {
          var r = side === 'r' ? { x: n.px + off, y: n.py - h / 2 } : side === 'l' ? { x: n.px - off - w, y: n.py - h / 2 }
            : side === 't' ? { x: n.px - w / 2, y: n.py - off - h } : { x: n.px - w / 2, y: n.py + off - 1 };
          r.w = w; r.h = h; r.side = side;
          var pen = si * 0.1;
          if (r.x < 4 || r.x + w > geo.W - 4 || r.y < 4 || r.y + h > geo.H - 4) pen += 20;
          rects.forEach(function (o) { if (o.own !== n && hit(r, o)) pen += o.label ? 8 : 5; });
          if (pen < bestPen) { bestPen = pen; best = r; }
        });
        best.label = true;
        rects.push(best);
        var side = best.side, anchor = side === 'r' ? 'start' : side === 'l' ? 'end' : 'middle';
        var tx = side === 'r' ? off : side === 'l' ? -off : 0;
        var ty0 = (best.y - n.py) + size * 0.86; // linha de base da 1ª linha
        while (n.text.firstChild) n.text.removeChild(n.text.firstChild);
        n.text.setAttribute('text-anchor', anchor);
        lines.forEach(function (ln, k) { n.text.appendChild(svg('tspan', { x: tx, y: (ty0 + k * lh).toFixed(1) }, ln)); });
      });
    }

    /* deriva suave dos pontos (±3 px), linhas e tooltip acompanham */
    function place(time) {
      var amp = RR.reducedMotion ? 0 : 3;
      nodes.forEach(function (n) {
        n.dx = Math.sin(time * 0.55 + n.s.phase[0]) * amp;
        n.dy = Math.cos(time * 0.47 + n.s.phase[1]) * amp;
        n.g.setAttribute('transform', 'translate(' + (n.px + n.dx).toFixed(2) + ' ' + (n.py + n.dy).toFixed(2) + ')');
      });
      if (active >= 0) {
        var a = nodes[active];
        a.s.nn.forEach(function (o, k) {
          var b = nodes[o.j];
          lines[k].setAttribute('x1', (a.px + a.dx).toFixed(2)); lines[k].setAttribute('y1', (a.py + a.dy).toFixed(2));
          lines[k].setAttribute('x2', (b.px + b.dx).toFixed(2)); lines[k].setAttribute('y2', (b.py + b.dy).toFixed(2));
        });
      }
    }

    function setActive(i) {
      if (i === active) return;
      active = i;
      applyActive();
    }

    function applyActive() {
      var a = active >= 0 ? SKILLS[active] : null;
      var nnSet = {};
      if (a) a.nn.forEach(function (o) { nnSet[o.j] = true; });
      svgEl.classList.toggle('has-active', !!a);
      nodes.forEach(function (n, i) {
        n.g.classList.toggle('is-active', i === active);
        n.g.classList.toggle('is-near', !!nnSet[i]);
      });
      lines.forEach(function (l) { l.style.color = a ? CLUSTERS[a.c].color : ''; l.classList.toggle('is-on', !!a); });
      chips.forEach(function (c, i) { c.classList.toggle('is-active', i === active); });
      if (a && nodes.length) { place(t); showTip(a); } else tip.classList.remove('is-on');
    }

    function pin(i) {
      pinned = i;
      chips.forEach(function (c, k) { c.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
      setActive(i >= 0 ? i : focusChip);
      if (i < 0 && focusChip < 0) setActive(-1);
    }

    function showTip(s) {
      var cl = CLUSTERS[s.c];
      tip.innerHTML = '';
      tip.style.setProperty('--c', cl.color);
      tip.appendChild(RR.el('p', { class: 'embedding__tip-name' }, s.name));
      tip.appendChild(RR.el('p', { class: 'embedding__tip-cluster mono' }, [
        RR.el('span', { class: 'embedding__swatch' + (cl.training ? ' is-training' : '') }), cl.label + (cl.training ? ' · em treinamento' : '')
      ]));
      tip.appendChild(RR.el('p', { class: 'embedding__tip-sub mono', text: 'vizinhos mais próximos' }));
      tip.appendChild(RR.el('ol', { class: 'embedding__tip-nn' }, s.nn.map(function (o) {
        var n = SKILLS[o.j];
        var li = RR.el('li', null, [RR.el('span', { class: 'embedding__tip-dot' }), RR.el('span', { text: n.name }), RR.el('span', { class: 'mono', text: 'd = ' + o.d.toFixed(2).replace('.', ',') })]);
        li.style.setProperty('--c', CLUSTERS[n.c].color);
        return li;
      })));
      positionTip();
      tip.classList.add('is-on');
    }

    /* posiciona o cartão no lado que menos cobre o ponto ativo e seus vizinhos */
    function positionTip() {
      if (active < 0 || !geo) return;
      var n = nodes[active], W = geo.W, H = geo.H;
      var tw = tip.offsetWidth || 220, th = tip.offsetHeight || 140, gap = 24;
      var ax = n.px, ay = n.py, near = {};
      n.s.nn.forEach(function (o) { near[o.j] = true; });
      var cands = [
        [ax + gap, ay - th / 2], [ax - gap - tw, ay - th / 2], [ax - tw / 2, ay + gap], [ax - tw / 2, ay - gap - th],
        [ax + gap, ay + gap - 12], [ax - gap - tw, ay + gap - 12], [ax + gap, ay - th - gap + 12], [ax - gap - tw, ay - th - gap + 12],
        [8, 8], [W - tw - 8, 8], [8, H - th - 8], [W - tw - 8, H - th - 8], [(W - tw) / 2, H - th - 8], [(W - tw) / 2, 8]
      ];
      var best = null, bestScore = Infinity;
      cands.forEach(function (c, ci) {
        var x = RR.clamp(c[0], 8, W - tw - 8), y = RR.clamp(c[1], 8, H - th - 8);
        var score = (Math.abs(x - c[0]) + Math.abs(y - c[1])) * 0.04 + ci * 0.01;
        nodes.forEach(function (m, j) {
          // o ponto ativo conta com o rótulo (área maior)
          var mx = j === active ? 64 : 12, my = j === active ? 26 : 12;
          var inside = m.px > x - mx && m.px < x + tw + mx && m.py > y - my && m.py < y + th + my;
          if (inside) score += j === active ? 50 : near[j] ? 6 : 1;
        });
        score += Math.hypot(x + tw / 2 - ax, y + th / 2 - ay) * 0.004;
        if (score < bestScore) { bestScore = score; best = [x, y]; }
      });
      tip.style.transform = 'translate(' + Math.round(best[0]) + 'px,' + Math.round(best[1]) + 'px)';
    }

    function stopTour() { tourOn = false; }

    /* ----- interação de fundo ----- */
    plot.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && pinned < 0 && focusChip < 0) setActive(-1); });
    svgEl.addEventListener('click', function () { stopTour(); if (pinned >= 0) pin(-1); else setActive(-1); });

    /* ----- animação: só com a seção visível ----- */
    var loop = RR.loop(function (dt) {
      t += dt;
      place(t);
      if (tourOn) {
        tourTimer += dt;
        if (tourTimer > 3.2 || active < 0) {
          tourTimer = 0;
          var name = TOUR[tourIdx++ % TOUR.length];
          setActive(SKILLS.findIndex(function (s) { return s.name === name; }));
        }
      }
    });
    function sync() {
      if (visible && !document.hidden && !RR.reducedMotion) loop.start(); else loop.stop();
    }
    RR.whenVisible(root, function () { visible = true; sync(); }, function () { visible = false; sync(); });
    document.addEventListener('visibilitychange', sync);
    RR.on('reducedmotion', function (on) { if (on) { stopTour(); place(0); } sync(); });

    if (RR.reducedMotion) { setActive(SKILLS.findIndex(function (s) { return s.name === 'Python'; })); tourOn = false; }
    var onResize = RR.debounce(function () { build(); }, 150);
    if ('ResizeObserver' in window) new ResizeObserver(function () { if (!geo) build(); else onResize(); }).observe(plot);
    else { window.addEventListener('resize', onResize); window.addEventListener('load', onResize); }
  }

  /* fecho convexo (cadeia monótona de Andrew) */
  function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var cross = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lower = [], upper = [], i;
    for (i = 0; i < p.length; i++) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop(); lower.push(p[i]); }
    for (i = p.length - 1; i >= 0; i--) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop(); upper.push(p[i]); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // DOM leve criado já (evita deslocar o layout); SVGs montados no ResizeObserver
  // e animações só com a seção visível
  initTimeline();
  initEmbedding();
})();
