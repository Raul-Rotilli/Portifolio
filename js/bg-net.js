/* =========================================================================
   bg-net.js — "constelação neural" de fundo no canvas#bg-net
   Nós à deriva, sinapses com alfa pela distância e pulsos de sinal que
   viajam pelas ligações (e às vezes se propagam). Discreto de propósito:
   ~30 fps, DPR ≤ 1,5, pausa com a aba oculta, quadro estático com
   movimento reduzido, leve paralaxe com a rolagem.
   ========================================================================= */
(function () {
  'use strict';

  var RR = window.RR || {};
  var canvas = document.getElementById('bg-net');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var FRAME_MS = 1000 / 30;
  var PARALLAX = 0.06;            // fração da rolagem aplicada aos nós
  var LEVELS = 7;                 // baldes de alfa para agrupar traços
  var MINT = [158, 245, 207], BLUE = [79, 123, 255], PINK = [255, 111, 174], SUN = [255, 179, 138];

  var W = 0, H = 0, dpr = 1, M = 90, WW = 0, WH = 0, link = 150, link2 = 22500;
  var nodes = [], pulses = [], sx, sy, fade;
  var raf = 0, running = false, lastDraw = 0, spawnIn = 0.6, intro = 0, boost = 0;
  var grad = null, sprites = {};
  var pointer = { x: 0, y: 0, on: false };
  var finePointer = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : false;
  var buckets = [];
  for (var b = 0; b < LEVELS; b++) buckets.push([]);
  var stats = { frameMs: 0 };

  function reduced() { return !!RR.reducedMotion; }

  /* sprite de brilho pré-renderizado (mais barato que shadowBlur) */
  function sprite(rgb) {
    var s = 48, c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d'), r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,0.95)');
    r.addColorStop(0.18, 'rgba(' + rgb + ',0.9)');
    r.addColorStop(0.45, 'rgba(' + rgb + ',0.25)');
    r.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
    return c;
  }

  function resize(force) {
    var w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    // barras do navegador mobile mudam só a altura: ignora variações pequenas
    if (!force && w === W && Math.abs(h - H) < 140) return false;
    var oldW = W || w, oldH = H || h;
    W = w; H = h;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var small = W < 700;
    link = small ? 120 : RR.clamp ? RR.clamp(Math.min(W, H) * 0.19, 120, 170) : 150;
    link2 = link * link;
    M = link * 0.7;
    WW = W + M * 2; WH = H + M * 2;

    var target = Math.round((W * H) / (small ? 15000 : 29000));
    target = Math.max(small ? 18 : 24, Math.min(small ? 26 : 48, target));
    // reescala os nós existentes e ajusta a quantidade
    var kx = (W + 2 * M) / (oldW + 2 * M), ky = (H + 2 * M) / (oldH + 2 * M);
    nodes.forEach(function (n) { n.x *= kx; n.y *= ky; });
    while (nodes.length < target) nodes.push(makeNode());
    if (nodes.length > target) { nodes.length = target; pulses = []; }
    sx = new Float32Array(nodes.length); sy = new Float32Array(nodes.length); fade = new Float32Array(nodes.length);

    grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgb(' + MINT + ')');
    grad.addColorStop(0.6, 'rgb(' + [118, 170, 255] + ')');
    grad.addColorStop(1, 'rgb(' + BLUE + ')');
    return true;
  }

  function makeNode() {
    var a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9; // px/s
    return {
      x: Math.random() * (W + 2 * M), y: Math.random() * (H + 2 * M),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      r: 0.8 + Math.random() * 1.3, energy: 0, phase: Math.random() * 6.28
    };
  }

  /* ---------- simulação ---------- */
  function update(dt, t) {
    var i, n;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      n.x += n.vx * dt; n.y += n.vy * dt;
      // leve ondulação para não parecer trilho reto
      n.x += Math.sin(t * 0.0004 + n.phase) * 2 * dt;
      if (n.x < 0) n.x += WW; else if (n.x >= WW) n.x -= WW;
      if (n.y < 0) n.y += WH; else if (n.y >= WH) n.y -= WH;
      if (n.energy > 0) n.energy = Math.max(0, n.energy - dt * 1.4);
    }
    if (boost > 0) boost = Math.max(0, boost - dt);

    // pulsos
    spawnIn -= dt * (boost > 0 ? 7 : 1);
    if (spawnIn <= 0) {
      spawnIn = 0.45 + Math.random() * 0.9;
      var maxP = boost > 0 ? 34 : 7;
      if (pulses.length < maxP) spawn(Math.floor(Math.random() * nodes.length), -1, 0);
    }
    for (i = pulses.length - 1; i >= 0; i--) {
      var p = pulses[i];
      p.t += dt * p.speed;
      if (p.t >= 1) {
        var to = nodes[p.b];
        if (to) to.energy = 1;
        pulses.splice(i, 1);
        if (p.depth < 4 && Math.random() < (boost > 0 ? 0.8 : 0.55)) spawn(p.b, p.a, p.depth + 1);
      }
    }
  }

  function spawn(from, avoid, depth) {
    if (!nodes[from]) return;
    projectOne(from);
    var cand = [], i, dx, dy;
    for (i = 0; i < nodes.length; i++) {
      if (i === from || i === avoid) continue;
      projectOne(i);
      dx = sx[i] - sx[from]; dy = sy[i] - sy[from];
      if (dx * dx + dy * dy < link2 * 0.8 && fade[i] > 0.4) cand.push(i);
    }
    if (!cand.length) return;
    var to = cand[Math.floor(Math.random() * cand.length)];
    dx = sx[to] - sx[from]; dy = sy[to] - sy[from];
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var colors = boost > 0 ? [PINK, SUN, MINT] : [MINT, MINT, BLUE];
    pulses.push({
      a: from, b: to, t: 0, depth: depth,
      speed: (boost > 0 ? 260 : 120 + Math.random() * 60) / d,
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }

  /* posição na tela (com paralaxe) + atenuação perto da emenda do "toro" */
  var scrollOff = 0;
  function projectOne(i) {
    var n = nodes[i];
    var x = n.x - M;
    var y = n.y - scrollOff;
    y = ((y % WH) + WH) % WH - M;
    sx[i] = x; sy[i] = y;
    var fx = Math.min(x + M, W + M - x) / M, fy = Math.min(y + M, H + M - y) / M;
    var f = Math.min(1, fx, fy);
    fade[i] = f < 0 ? 0 : f;
  }

  /* ---------- desenho ---------- */
  function draw() {
    var t0 = performance.now();
    var i, j, n, dx, dy, d2, a, k;
    scrollOff = reduced() ? 0 : (window.scrollY || 0) * PARALLAX;
    for (i = 0; i < nodes.length; i++) projectOne(i);

    ctx.clearRect(0, 0, W, H);
    var g = intro * (boost > 0 ? 1.5 : 1);

    // sinapses agrupadas por nível de alfa (poucos stroke())
    for (k = 0; k < LEVELS; k++) buckets[k].length = 0;
    for (i = 0; i < nodes.length; i++) {
      if (fade[i] <= 0) continue;
      for (j = i + 1; j < nodes.length; j++) {
        if (fade[j] <= 0) continue;
        dx = sx[i] - sx[j]; dy = sy[i] - sy[j];
        d2 = dx * dx + dy * dy;
        if (d2 >= link2) continue;
        a = 1 - Math.sqrt(d2) / link;
        a = a * a * Math.min(fade[i], fade[j]);
        a += Math.max(nodes[i].energy, nodes[j].energy) * 0.45 * a;
        k = Math.min(LEVELS - 1, Math.floor(a * LEVELS * 1.1));
        if (k < 0 || a < 0.03) continue;
        buckets[k].push(i, j);
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = grad;
    for (k = 0; k < LEVELS; k++) {
      var list = buckets[k];
      if (!list.length) continue;
      ctx.globalAlpha = Math.min(1, ((k + 1) / LEVELS) * 0.34 * g);
      ctx.beginPath();
      for (var q = 0; q < list.length; q += 2) {
        ctx.moveTo(sx[list[q]], sy[list[q]]);
        ctx.lineTo(sx[list[q + 1]], sy[list[q + 1]]);
      }
      ctx.stroke();
    }

    // conexões com o ponteiro (o cursor vira um neurônio de entrada)
    if (pointer.on && finePointer && !reduced()) {
      var pr = link * 1.1, pr2 = pr * pr;
      ctx.beginPath();
      var any = false;
      for (i = 0; i < nodes.length; i++) {
        dx = sx[i] - pointer.x; dy = sy[i] - pointer.y;
        if (dx * dx + dy * dy < pr2) { ctx.moveTo(pointer.x, pointer.y); ctx.lineTo(sx[i], sy[i]); any = true; }
      }
      if (any) { ctx.globalAlpha = 0.16 * g; ctx.stroke(); }
    }

    // neurônios
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.55 * g;
    ctx.beginPath();
    for (i = 0; i < nodes.length; i++) {
      if (fade[i] <= 0) continue;
      n = nodes[i];
      ctx.moveTo(sx[i] + n.r, sy[i]);
      ctx.arc(sx[i], sy[i], n.r, 0, 6.2832);
    }
    ctx.fill();
    // neurônios ativados brilham
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.energy <= 0.02 || fade[i] <= 0) continue;
      var s = 10 + n.energy * 14;
      ctx.globalAlpha = n.energy * 0.6 * fade[i] * g;
      ctx.drawImage(sprites.mint, sx[i] - s / 2, sy[i] - s / 2, s, s);
    }

    // pulsos de sinal
    for (i = 0; i < pulses.length; i++) {
      var p = pulses[i];
      var A = p.a, B = p.b;
      dx = sx[B] - sx[A]; dy = sy[B] - sy[A];
      if (dx * dx + dy * dy > link2 * 1.3) { p.t = 1; continue; } // ligação rompida: some
      var x = sx[A] + dx * p.t, y = sy[A] + dy * p.t;
      var tail = Math.max(0, p.t - 0.22);
      var f = Math.min(fade[A], fade[B]) * g;
      ctx.globalAlpha = 0.5 * f;
      ctx.strokeStyle = 'rgb(' + p.color + ')';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx[A] + dx * tail, sy[A] + dy * tail);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 0.95 * f;
      var spr = p.color === BLUE ? sprites.blue : p.color === PINK ? sprites.pink : p.color === SUN ? sprites.sun : sprites.mint;
      ctx.drawImage(spr, x - 9, y - 9, 18, 18);
    }
    ctx.globalAlpha = 1;

    var ms = performance.now() - t0;
    stats.frameMs = stats.frameMs ? stats.frameMs * 0.9 + ms * 0.1 : ms;
  }

  /* ---------- laço (~30 fps) ---------- */
  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (lastDraw && t - lastDraw < FRAME_MS - 2) return;
    var dt = lastDraw ? Math.min((t - lastDraw) / 1000, 0.1) : 1 / 30;
    lastDraw = t;
    intro = Math.min(1, intro + dt / 1.4);
    update(dt, t);
    draw();
  }
  function start() {
    if (running || document.hidden || reduced()) return;
    running = true; lastDraw = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  function staticFrame() {
    intro = 1;
    // alguns neurônios acesos para o quadro estático não parecer "morto"
    for (var i = 0; i < nodes.length; i += 5) nodes[i].energy = 0.7;
    pulses = [];
    draw();
  }

  function init() {
    sprites = { mint: sprite(MINT), blue: sprite(BLUE), pink: sprite(PINK), sun: sprite(SUN) };
    resize(true);
    if (reduced()) staticFrame(); else start();

    var onResize = RR.debounce ? RR.debounce(function () {
      if (resize(false) && (reduced() || !running)) draw();
    }, 150) : function () { if (resize(false)) draw(); };
    window.addEventListener('resize', onResize, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
    if (RR.on) {
      RR.on('reducedmotion', function (on) { if (on) { stop(); staticFrame(); } else start(); });
      RR.on('konami', function () {
        boost = 3;
        for (var i = 0; i < 6; i++) spawn(Math.floor(Math.random() * nodes.length), -1, 0);
        if (!running && !reduced()) start();
      });
    }
    if (finePointer) {
      window.addEventListener('pointermove', function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = true; }, { passive: true });
      document.documentElement.addEventListener('pointerleave', function () { pointer.on = false; });
    }
  }

  RR.bgNet = { start: start, stop: stop, stats: stats };
  try { init(); } catch (err) { console.error('[bg-net] falhou ao iniciar:', err); }
})();
