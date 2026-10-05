/* =========================================================================
   main.js — casca do site: cabeçalho, menu mobile, seção ativa, revelar ao
   rolar, ano do rodapé, saudação no console e o easter egg Konami.
   Carregado por último. Cada recurso inicia isolado em try/catch: se algo
   falhar, o conteúdo nunca fica escondido.
   ========================================================================= */
(function () {
  'use strict';

  var RR = (window.RR = window.RR || {});
  var doc = document;
  var root = doc.documentElement;

  function safe(name, fn) {
    try { fn(); }
    catch (err) {
      if (window.console) console.error('[main] ' + name + ' falhou:', err);
      if (name === 'revelar') revealAll();
    }
  }
  function reduced() { return !!RR.reducedMotion; }
  function on(target, type, fn, opts) { target.addEventListener(type, fn, opts || false); }
  function isTyping(el) {
    if (!el || el === doc.body) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  /* ---------- revelar ao rolar ---------- */
  var revealIO = null;
  function revealAll() {
    var list = doc.querySelectorAll('[data-reveal]:not(.is-visible)');
    for (var i = 0; i < list.length; i++) list[i].classList.add('is-visible');
    if (revealIO) { revealIO.disconnect(); revealIO = null; }
  }
  /* Observa os [data-reveal] ainda ocultos dentro de scope (pode ser chamado
     de novo por módulos que criem conteúdo com data-reveal depois). */
  function revealScan(scope) {
    if (!revealIO) { revealAll(); return; }
    var list = (scope || doc).querySelectorAll('[data-reveal]:not(.is-visible)');
    for (var i = 0; i < list.length; i++) revealIO.observe(list[i]);
  }
  function initReveal() {
    if (!('IntersectionObserver' in window) || reduced()) { revealAll(); return; }
    revealIO = new IntersectionObserver(function (entries, io) {
      entries.forEach(function (e) {
        // também revela o que já ficou para trás (ex.: salto direto para uma âncora)
        if (e.isIntersecting || e.boundingClientRect.bottom < 0) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0 });
    revealScan(doc);
    on(window, 'load', function () { revealScan(doc); });
    if (RR.on) RR.on('reducedmotion', function (isOn) { if (isOn) revealAll(); });
  }
  RR.revealScan = revealScan;

  /* ---------- rolagem para seções que se autocorrige ----------
     Os módulos montam o DOM sob demanda (a galeria cresce ~1000 px ao entrar
     na tela), então o destino muda no meio de uma rolagem suave. Depois que a
     rolagem para, conferimos a posição e corrigimos até o alvo assentar.
     Qualquer gesto do usuário (roda, toque, tecla) cancela a correção. */
  var settle = { timer: 0, off: null, instant: false };
  function headerOffset() {
    var v = parseFloat(getComputedStyle(root).scrollPaddingTop);
    return isNaN(v) ? 80 : v;
  }
  function stopSettle() {
    clearInterval(settle.timer); settle.timer = 0;
    if (settle.off) { settle.off(); settle.off = null; }
    if (settle.instant) { root.style.scrollBehavior = ''; settle.instant = false; }
  }
  function scrollToTarget(target, opts) {
    opts = opts || {};
    if (typeof target === 'string') target = doc.getElementById(target);
    if (!target) return null;
    var behavior = reduced() || opts.instant ? 'auto' : 'smooth';
    var isTop = target.id === 'inicio' || target.id === 'conteudo';
    function want() {
      if (isTop) return 0;
      var y = (window.scrollY || 0) + target.getBoundingClientRect().top - headerOffset();
      return Math.max(0, Math.min(y, root.scrollHeight - window.innerHeight));
    }
    stopSettle();
    // "auto" ainda herdaria o scroll-behavior: smooth do CSS; desliga enquanto corrige
    if (opts.instant) { settle.instant = true; root.style.scrollBehavior = 'auto'; }
    window.scrollTo({ top: want(), behavior: behavior });

    var lastY = -1, still = 0, ticks = 0;
    settle.timer = setInterval(function () {
      var y = window.scrollY || 0;
      if (++ticks > 45) { stopSettle(); return; }        // ~4,5 s no máximo
      if (Math.abs(y - lastY) < 1) {                      // a rolagem parou
        var w = want();
        if (Math.abs(w - y) > 3) { window.scrollTo({ top: w, behavior: behavior }); still = 0; }
        else if (++still >= 3) stopSettle();
      }
      lastY = y;
    }, 100);
    // anexado no próximo tick para não capturar o próprio clique/Enter que iniciou
    setTimeout(function () {
      if (!settle.timer) return;
      var cancel = function () { stopSettle(); };
      var evs = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
      evs.forEach(function (t) { window.addEventListener(t, cancel, { passive: true, capture: true }); });
      settle.off = function () { evs.forEach(function (t) { window.removeEventListener(t, cancel, { capture: true }); }); };
    }, 0);

    if (opts.focus) {
      // leva o foco do teclado junto, sem anel de foco na seção inteira
      if (!target.hasAttribute('tabindex')) { target.setAttribute('tabindex', '-1'); target.style.outline = 'none'; }
      try { target.focus({ preventScroll: true }); } catch (e) { /* navegadores antigos */ }
    }
    return target;
  }
  RR.scrollToTarget = scrollToTarget;

  // links internos (#secao) usam a rolagem autocorrigida
  function initAnchors() {
    on(doc, 'click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href').slice(1);
      var target = id && doc.getElementById(id);
      if (!target) return;                               // ex.: #galeria/kmeans fica com o navegador
      e.preventDefault();
      if (window.location.hash !== '#' + id && window.history && history.pushState) {
        try { history.pushState(null, '', '#' + id); } catch (err) { /* file:// em alguns navegadores */ }
      }
      scrollToTarget(target, { focus: true });
    });
  }

  /* Link direto (index.html#trajetoria, redirecionamentos de pages/*): o
     navegador rolaria suavemente desde o topo, montando a galeria no caminho
     e errando o alvo. Salto instantâneo + correção depois do load. */
  function initDeepLink() {
    var id = '';
    try { id = decodeURIComponent((window.location.hash || '').slice(1)); } catch (e) { return; }
    var target = id && doc.getElementById(id);
    if (!target || id === 'inicio') return;
    root.style.scrollBehavior = 'auto';
    var go = function () { scrollToTarget(target, { instant: true }); };
    if (doc.readyState === 'complete') go(); else on(window, 'load', go);
  }

  /* ---------- cabeçalho: fundo de vidro depois de rolar ---------- */
  function initHeader() {
    var bar = doc.getElementById('topbar');
    if (!bar) return;
    var ticking = false, last = null;
    function update() {
      ticking = false;
      var s = (window.scrollY || window.pageYOffset || 0) > 12;
      if (s !== last) { bar.classList.toggle('is-scrolled', s); last = s; }
    }
    on(window, 'scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ---------- menu mobile ---------- */
  function initNav() {
    var nav = doc.getElementById('nav');
    var toggle = doc.querySelector('.nav-toggle');
    if (!nav || !toggle) return;
    var desktop = window.matchMedia ? window.matchMedia('(min-width: 961px)') : null;

    function isOpen() { return nav.classList.contains('is-open'); }
    function setOpen(open, focusToggle) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
      if (!open && focusToggle) toggle.focus();
    }

    on(toggle, 'click', function () { setOpen(!isOpen()); });
    on(nav, 'click', function (e) {
      if (e.target.closest && e.target.closest('a')) setOpen(false);
    });
    on(doc, 'keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) {
        var inside = nav.contains(doc.activeElement) || doc.activeElement === toggle;
        setOpen(false, inside);
      }
    });
    on(doc, 'pointerdown', function (e) {
      if (!isOpen()) return;
      if (nav.contains(e.target) || toggle.contains(e.target)) return;
      setOpen(false);
    });
    // foco saindo do menu (Tab além do último link) também fecha
    on(nav, 'focusout', function (e) {
      if (!isOpen() || !e.relatedTarget) return;
      if (!nav.contains(e.relatedTarget) && e.relatedTarget !== toggle) setOpen(false);
    });
    function onMQ() { if (desktop && desktop.matches && isOpen()) setOpen(false); }
    if (desktop) {
      if (desktop.addEventListener) desktop.addEventListener('change', onMQ);
      else if (desktop.addListener) desktop.addListener(onMQ);
    }
    on(window, 'resize', onMQ, { passive: true });
  }

  /* ---------- link da seção ativa ---------- */
  function initActiveSection() {
    var sections = Array.prototype.slice.call(doc.querySelectorAll('main > section[id]'));
    var links = Array.prototype.slice.call(doc.querySelectorAll('#nav a[href^="#"]'));
    if (!sections.length || !links.length) return;
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var current = null;

    function setActive(id) {
      if (id === current) return;
      current = id;
      links.forEach(function (a) {
        var hit = a === byId[id];
        a.classList.toggle('is-active', hit);
        if (hit) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }

    // no fim da página a última seção pode não alcançar a faixa central
    function atBottom() {
      return window.innerHeight + (window.scrollY || 0) >= root.scrollHeight - 4;
    }

    if (!('IntersectionObserver' in window)) {
      var pick = function () {
        if (atBottom()) { setActive(sections[sections.length - 1].id); return; }
        var mid = window.innerHeight * 0.45, id = null;
        sections.forEach(function (s) { var r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) id = s.id; });
        setActive(id);
      };
      on(window, 'scroll', RR.debounce ? RR.debounce(pick, 80) : pick, { passive: true });
      pick();
      return;
    }

    var inBand = {};
    function resolve() {
      if (atBottom()) { setActive(sections[sections.length - 1].id); return; }
      for (var i = 0; i < sections.length; i++) {
        if (inBand[sections[i].id]) { setActive(sections[i].id); return; }
      }
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { inBand[e.target.id] = e.isIntersecting; });
      resolve();
    }, { rootMargin: '-45% 0px -54% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });

    var ticking = false;
    on(window, 'scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; resolve(); });
    }, { passive: true });
  }

  /* ---------- dicas de atalho: ⌘ no Mac; nenhuma em telas só de toque ---------- */
  function initShortcutHints() {
    var nav = window.navigator || {};
    var mac = /Mac|iPhone|iPad|iPod/i.test(nav.platform || nav.userAgent || '');
    var touchOnly = !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    var btns = doc.querySelectorAll('[data-open-palette]');
    for (var i = 0; i < btns.length; i++) {
      var kbd = btns[i].querySelector('kbd');
      if (touchOnly) {
        btns[i].setAttribute('aria-label', 'Abrir paleta de comandos');
        if (kbd) kbd.style.display = 'none';
      } else if (mac) {
        btns[i].setAttribute('aria-label', 'Abrir paleta de comandos (⌘K)');
        if (kbd) kbd.textContent = '⌘ K';
      }
    }
    var keys = doc.querySelectorAll('.footer kbd');
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].textContent !== 'Ctrl') continue;
      if (touchOnly && keys[j].parentNode) keys[j].parentNode.style.display = 'none';
      else if (mac) { keys[j].textContent = '⌘'; keys[j].setAttribute('title', 'Command'); }
    }
  }

  /* ---------- ano no rodapé ---------- */
  function initYear() {
    var y = doc.getElementById('year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  /* ---------- saudação no console ---------- */
  function initConsole() {
    if (!window.console || !console.log) return;
    var banner = [
      '                 _         _',
      ' _ __ __ _ _   _| |   __ _(_)',
      "| '__/ _` | | | | |  / _` | |",
      '| | | (_| | |_| | |_| (_| | |',
      '|_|  \\__,_|\\__,_|_(_)\\__,_|_|'
    ];
    console.log(
      '%c' + banner.join('\n') + '\n%c\nOlá, dev curioso! Este site é HTML, CSS e JavaScript puros, sem bibliotecas.\n%cCtrl+K para comandos · ↑↑↓↓←→←→BA',
      'color:#9ef5cf;font-family:monospace;font-weight:bold;line-height:1.15',
      'color:#c3c9de;font-family:system-ui,sans-serif',
      'color:#07080d;background:#9ef5cf;padding:3px 8px;border-radius:4px;font-family:monospace;font-weight:bold'
    );
  }

  /* ---------- easter egg: código Konami → modo overfitting ---------- */
  function initKonami() {
    var seq = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
    var pos = 0;
    on(doc, 'keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      var k = (e.key || '').toLowerCase();
      if (k === seq[pos]) {
        pos++;
        if (pos === seq.length) { pos = 0; if (RR.emit) RR.emit('konami'); else overfit(); }
      } else {
        pos = k === seq[0] ? 1 : 0;
      }
    });
    if (RR.on) RR.on('konami', overfit);
  }

  var fxTimer = 0, fxEl = null;
  function overfit() {
    var body = doc.body;
    if (!fxEl) {
      fxEl = doc.createElement('div');
      fxEl.className = 'overfit-fx';
      fxEl.setAttribute('aria-hidden', 'true');
      fxEl.hidden = true;
      fxEl.innerHTML =
        '<div class="overfit-fx__scan"></div>' +
        '<p class="overfit-fx__hud"><span class="overfit-fx__dot"></span>' +
        '<b>overfitting</b> · loss treino <span class="overfit-fx__train">0,0001</span> · ' +
        'loss validação <span class="overfit-fx__val">9,87 ↑</span></p>';
      body.appendChild(fxEl);
    }
    var already = body.classList.contains('is-overfitting');
    clearTimeout(fxTimer);
    fxEl.hidden = false;
    if (!already) {
      // reinicia as animações CSS caso o efeito seja disparado de novo
      body.classList.remove('is-overfitting');
      void body.offsetWidth;
      body.classList.add('is-overfitting');
    }
    if (RR.toast) RR.toast('Overfitting detectado! Aplicando dropout…');
    fxTimer = setTimeout(function () {
      body.classList.remove('is-overfitting');
      fxEl.hidden = true;
    }, reduced() ? 2200 : 3000);
  }

  /* ---------- inicialização ---------- */
  safe('revelar', initReveal);
  safe('cabeçalho', initHeader);
  safe('âncoras', initAnchors);
  safe('link direto', initDeepLink);
  safe('menu', initNav);
  safe('seção ativa', initActiveSection);
  safe('ano', initYear);
  safe('atalhos', initShortcutHints);
  safe('console', initConsole);
  safe('konami', initKonami);
})();
