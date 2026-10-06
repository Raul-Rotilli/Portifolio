/* =========================================================================
   palette.js — paleta de comandos (Ctrl+K / Cmd+K / "/") + RR.toast()
   Diálogo modal acessível: combobox + listbox com aria-activedescendant,
   busca fuzzy sem acentos com destaque, foco preso e restaurado ao fechar.
   ========================================================================= */
(function () {
  'use strict';

  var RR = (window.RR = window.RR || {});
  var mount = document.getElementById('palette-root');
  if (!mount) return;

  var SITE_URL = 'https://portifolio-raul-rotilli.vercel.app/';
  var GROUPS = ['Navegar', 'Galeria', 'Ações', 'Links'];

  function el(tag, attrs, children) {
    if (RR.el) return RR.el(tag, attrs, children);
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function reduced() { return !!RR.reducedMotion; }
  function isTyping(t) {
    if (!t || t === document.body) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }

  /* ---------- ícones (24×24, traço) ---------- */
  var ICONS = {
    home: '<path d="m3 11 9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.4-4 4.4-6 8-6s6.6 2 8 6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    flask: '<path d="M9 3h6M10 3v6.5L4.6 18.8A1.5 1.5 0 0 0 5.9 21h12.2a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3"/><path d="M7.5 15h9"/>',
    chat: '<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3.5 21l1.4-5A8.5 8.5 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
    send: '<path d="M21.5 2.5 14.6 21l-3.9-8.2L2.5 9z"/><path d="M21.5 2.5 10.7 12.8"/>',
    spark: '<path d="M12 3.5 13.9 8l4.6 1.9-4.6 1.9L12 16.5l-1.9-4.7L5.5 9.9 10.1 8z"/><path d="m18.5 15 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
    noise: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 3.5V8H16"/><path d="M9 10h.01M12 13h.01M15 10h.01M10 15.5h.01M14 15.5h.01"/>',
    scatter: '<path d="M3.5 3.5v17h17"/><circle cx="8.5" cy="14.5" r="1.4"/><circle cx="12" cy="9" r="1.4"/><circle cx="16.5" cy="12.5" r="1.4"/><circle cx="18" cy="6" r="1.4"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
    zap: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    github: '<path fill="currentColor" stroke="none" d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.38 7.86 10.9.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/>',
    linkedin: '<g fill="currentColor" stroke="none"><rect x="2" y="9" width="4" height="12" rx="1"/><circle cx="4" cy="4" r="2"/><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V9h4v1.5A5 5 0 0 1 16 8z"/></g>',
    instagram: '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><path d="M17.6 6.4h.01"/>',
    enter: '<path d="M20 5v6a3 3 0 0 1-3 3H5"/><path d="m9 10-4 4 4 4"/>'
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }

  /* ---------- toasts ---------- */
  var toastRegion = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
  mount.appendChild(toastRegion);

  RR.toast = function (message) {
    if (!message) return;
    var t = el('div', { class: 'toast' });
    t.innerHTML = '<span class="toast__dot" aria-hidden="true"></span>';
    t.appendChild(document.createTextNode(String(message)));
    toastRegion.appendChild(t);
    // no máximo 3 empilhados
    var all = toastRegion.querySelectorAll('.toast:not(.is-leaving)');
    if (all.length > 3) dismiss(all[0]);
    requestAnimationFrame(function () { t.classList.add('is-in'); });
    setTimeout(function () { dismiss(t); }, 2800);
  };
  function dismiss(t) {
    if (!t || t.classList.contains('is-leaving')) return;
    t.classList.add('is-leaving');
    t.classList.remove('is-in');
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, reduced() ? 0 : 260);
  }

  /* ---------- ações utilitárias ---------- */
  function scrollToId(id, opts) {
    // main.js oferece a rolagem que se corrige quando módulos crescem no caminho
    if (RR.scrollToTarget) return RR.scrollToTarget(id, opts);
    var target = document.getElementById(id);
    if (!target) return null;
    var behavior = reduced() ? 'auto' : 'smooth';
    if (id === 'inicio') window.scrollTo({ top: 0, behavior: behavior });
    else target.scrollIntoView({ behavior: behavior, block: 'start' });
    return target;
  }
  function goSection(id) {
    return function () {
      scrollToId(id, { focus: true });
      // mantém a URL coerente (remove um #galeria/<obra> antigo), como os links do topo
      try { history.replaceState(null, '', id === 'inicio' ? location.pathname + location.search : '#' + id); } catch (e) { /* file:// */ }
    };
  }

  function focusWhenReady(id, tries) {
    var input = document.getElementById(id);
    if (input) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } return; }
    if ((tries || 0) < 30) setTimeout(function () { focusWhenReady(id, (tries || 0) + 1); }, 100);
  }

  function copyLink() {
    var ok = function () { RR.toast('Link copiado para a área de transferência'); };
    var fail = function () { RR.toast('Não foi possível copiar. O link é ' + SITE_URL.replace(/^https:\/\/|\/$/g, '')); };
    var legacy = function () {
      try {
        var ta = el('textarea', { readonly: '', 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;opacity:0;pointer-events:none' });
        ta.value = SITE_URL;
        document.body.appendChild(ta);
        ta.select();
        var done = document.execCommand && document.execCommand('copy');
        ta.remove();
        (done ? ok : fail)();
      } catch (e) { fail(); }
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(SITE_URL).then(ok, legacy);
    else legacy();
  }

  function openLink(url) {
    return function () {
      var w = window.open(url, '_blank', 'noopener,noreferrer');
      if (w) try { w.opener = null; } catch (e) { /* ok */ }
    };
  }

  /* ---------- comandos ---------- */
  function staticCommands() {
    var nav = [
      ['inicio', 'Início', 'home', 'topo home hero começo difusão'],
      ['sobre', 'Sobre', 'user', 'sobre mim bio model card quem'],
      ['galeria', 'Galeria neural', 'image', 'arte retratos obras algoritmos ia visão computacional'],
      ['lab', 'Lab', 'flask', 'playground rede neural treino otimizadores ia ml machine learning'],
      ['raulgpt', 'RaulGPT', 'chat', 'chat rag perguntas assistente'],
      ['trajetoria', 'Trajetória', 'route', 'experiência formação currículo log treino embeddings habilidades'],
      ['contato', 'Contato', 'send', 'contato falar oportunidade redes']
    ].map(function (s) {
      return { group: 'Navegar', label: s[1], icon: s[2], hint: '#' + s[0], keywords: 'ir para seção ' + s[3], run: goSection(s[0]) };
    });

    var datasets = [['spiral', 'Espiral'], ['xor', 'XOR'], ['circle', 'Círculo'], ['gauss', 'Gaussianas'], ['moons', 'Luas']];
    var actions = [
      {
        group: 'Ações', label: 'Gerar nova amostra de difusão', icon: 'noise', hint: 'hero',
        keywords: 'difusão ruído retrato regenerar seed nova',
        run: function () { scrollToId('inicio'); if (RR.emit) RR.emit('hero:renoise'); }
      }
    ].concat(datasets.map(function (d) {
      return {
        group: 'Ações', label: 'Playground: dataset ' + d[1], icon: 'scatter', hint: 'lab',
        keywords: 'rede neural treinar dados classificação lab',
        run: function () {
          if (!scrollToId('playground-root')) scrollToId('lab');
          if (RR.emit) RR.emit('playground:dataset', d[0]);
        }
      };
    })).concat([
      {
        group: 'Ações', label: 'Perguntar ao RaulGPT', icon: 'chat', hint: 'chat',
        keywords: 'rag pergunta conversar chat',
        run: function () { scrollToId('raulgpt-root') || scrollToId('raulgpt'); focusWhenReady('raulgpt-input'); }
      },
      {
        group: 'Ações', label: 'Copiar link do portfólio', icon: 'link', hint: 'url',
        keywords: 'compartilhar url endereço copiar',
        run: copyLink
      },
      {
        group: 'Ações', label: RR.motionOff ? 'Retomar animações' : 'Pausar animações', icon: 'noise', hint: 'movimento',
        keywords: 'animação movimento parar pausar acessibilidade reduzir',
        run: function () {
          if (!RR.setMotionOff) return;
          RR.setMotionOff(!RR.motionOff);
          if (RR.toast) RR.toast(RR.motionOff ? 'Animações pausadas' : 'Animações retomadas');
        }
      },
      {
        group: 'Ações', label: 'Ativar modo overfitting', icon: 'zap', hint: '↑↑↓↓←→←→BA',
        keywords: 'konami easter egg glitch segredo',
        run: function () { if (RR.emit) RR.emit('konami'); }
      }
    ]);

    var links = [
      ['GitHub', 'github', '@Raul-Rotilli', 'https://github.com/Raul-Rotilli', 'código repositórios'],
      ['LinkedIn', 'linkedin', 'raul-rotilli-aguirre', 'https://www.linkedin.com/in/raul-rotilli-aguirre/', 'perfil profissional carreira'],
      ['Instagram', 'instagram', '@raulrotilli', 'https://www.instagram.com/raulrotilli/', 'fotos social']
    ].map(function (l) {
      return { group: 'Links', label: l[0], icon: l[1], hint: l[2], external: true, keywords: 'links redes sociais abrir ' + l[4], run: openLink(l[3]) };
    });

    return nav.concat(actions, links);
  }

  // obras são lidas a cada abertura (registradas pelos scripts js/art/*)
  function galleryCommands() {
    var pieces = (RR.art && RR.art.pieces) || [];
    return pieces.map(function (p) {
      return {
        group: 'Galeria', label: 'Abrir obra: ' + p.title, icon: 'spark', hint: p.algo || '',
        keywords: 'galeria obra arte ' + (p.algo || '') + ' ' + (p.field || '') + ' ' + p.id,
        run: function () {
          scrollToId('galeria');
          if (RR.emit) RR.emit('gallery:select', { id: p.id, scroll: false });
        }
      };
    });
  }

  function buildCommands() {
    var all = staticCommands().concat(galleryCommands());
    all.sort(function (a, b) { return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group); });
    all.forEach(function (c, i) {
      c.order = i;
      c.labelNorm = normalize(c.label);
      c.words = normalize(c.label + ' ' + c.keywords + ' ' + c.group).split(/[\s:()\/.·#@-]+/).filter(Boolean);
    });
    return all;
  }

  /* ---------- busca fuzzy ----------
     Subsequência com programação dinâmica: bônus para início de palavra e
     letras consecutivas, penalidade por lacunas. Sem acentos e sem caixa. */
  var MARKS = /[\u0300-\u036f]/g;
  function normalize(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i).normalize ? s.charAt(i).normalize('NFD').replace(MARKS, '').toLowerCase() : s.charAt(i).toLowerCase();
      out += c.charAt(0) || s.charAt(i);
    }
    return out;
  }
  var SEP = ' :-/()·._@#';
  function wordStart(text, j) {
    if (j === 0) return true;
    var p = text.charAt(j - 1), c = text.charAt(j);
    if (SEP.indexOf(p) >= 0) return true;
    return c !== c.toLowerCase() && p === p.toLowerCase() && p !== p.toUpperCase(); // camelCase (RaulGPT)
  }
  var NEG = -1e9, GAP = 0.5, CONSEC = 5, WORD = 8;
  function fuzzy(q, text, textNorm) {
    var n = textNorm.length, m = q.length, i, j;
    if (!m) return { score: 0, idx: [] };
    if (m > n) return null;
    for (i = 0, j = 0; j < n && i < m; j++) if (textNorm.charAt(j) === q.charAt(i)) i++;
    if (i < m) return null;

    var bonus = new Array(n);
    for (j = 0; j < n; j++) bonus[j] = wordStart(text, j) ? WORD : 0;
    var back = [], cur = new Array(n), bk = new Array(n), prev;
    for (j = 0; j < n; j++) {
      cur[j] = textNorm.charAt(j) === q.charAt(0) ? 1 + bonus[j] - Math.min(j, 16) * 0.2 : NEG;
      bk[j] = -1;
    }
    back.push(bk);
    for (i = 1; i < m; i++) {
      prev = cur; cur = new Array(n); bk = new Array(n);
      var run = NEG, runIdx = -1;
      for (j = 0; j < n; j++) {
        if (j >= 2) {
          run -= GAP;
          if (prev[j - 2] - GAP > run) { run = prev[j - 2] - GAP; runIdx = j - 2; }
        }
        cur[j] = NEG; bk[j] = -1;
        if (textNorm.charAt(j) !== q.charAt(i)) continue;
        var best = NEG, bi = -1;
        if (j >= 1 && prev[j - 1] > NEG / 2) { best = prev[j - 1] + CONSEC; bi = j - 1; }
        if (runIdx >= 0 && run > NEG / 2 && run > best) { best = run; bi = runIdx; }
        if (bi < 0) continue;
        cur[j] = best + 1 + bonus[j];
        bk[j] = bi;
      }
      back.push(bk);
    }
    var bestScore = NEG, end = -1;
    for (j = 0; j < n; j++) if (cur[j] > bestScore) { bestScore = cur[j]; end = j; }
    if (end < 0 || bestScore < NEG / 2) return null;
    var idx = new Array(m);
    for (i = m - 1; i >= 0; i--) { idx[i] = end; end = back[i][end]; }
    return { score: bestScore - n * 0.03, idx: idx };
  }

  /* Qualidade do alinhamento: cada trecho contíguo deve começar no início de
     uma palavra; tolera um único trecho no meio de palavra (consultas ≥ 3). */
  function goodMatch(text, idx, qlen) {
    var mid = 0;
    for (var i = 0; i < idx.length; i++) {
      if (i > 0 && idx[i] === idx[i - 1] + 1) continue;
      if (!wordStart(text, idx[i])) mid++;
    }
    return mid <= (qlen >= 3 ? 1 : 0);
  }

  function search(commands, query) {
    var norm = normalize(query).trim();
    var q = norm.replace(/\s+/g, '');
    if (!q) return commands.map(function (c) { return { cmd: c, score: 0, idx: [] }; });
    var terms = norm.split(/\s+/);
    var res = [];
    commands.forEach(function (c) {
      var r = fuzzy(q, c.label, c.labelNorm);
      if (r && goodMatch(c.label, r.idx, q.length)) { res.push({ cmd: c, score: r.score + 20, idx: r.idx }); return; }
      // sinônimos: cada termo precisa ser prefixo de alguma palavra-chave
      var hit = terms.every(function (t) {
        for (var k = 0; k < c.words.length; k++) if (c.words[k].indexOf(t) === 0) return true;
        return false;
      });
      if (hit) res.push({ cmd: c, score: 4 + q.length, idx: [] });
    });
    // grupos ordenados pelo melhor resultado; itens por pontuação
    var groupBest = {};
    res.forEach(function (r) { var g = r.cmd.group; groupBest[g] = Math.max(groupBest[g] == null ? NEG : groupBest[g], r.score); });
    res.sort(function (a, b) {
      if (a.cmd.group !== b.cmd.group) return groupBest[b.cmd.group] - groupBest[a.cmd.group];
      // pontuações quase iguais (ex.: "Abrir obra: …") mantêm a ordem original
      var d = b.score - a.score;
      return Math.abs(d) >= 1 ? d : a.cmd.order - b.cmd.order;
    });
    return res;
  }

  /* ---------- DOM da paleta ---------- */
  var ui = {}, commands = [], results = [], active = 0, isOpen = false, lastFocus = null, closeTimer = 0, announceTimer = 0;

  function build() {
    ui.root = el('div', { class: 'palette', hidden: true });
    ui.backdrop = el('div', { class: 'palette__backdrop', 'aria-hidden': 'true' });
    ui.dialog = el('div', { class: 'palette__dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'palette-title' });

    var title = el('h2', { id: 'palette-title', class: 'sr-only' }, 'Paleta de comandos');
    var label = el('label', { for: 'palette-input', class: 'sr-only' }, 'Buscar comando');
    ui.input = el('input', {
      id: 'palette-input', class: 'palette__input', type: 'text', role: 'combobox',
      'aria-expanded': 'true', 'aria-controls': 'palette-list', 'aria-autocomplete': 'list',
      'aria-describedby': 'palette-help', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      enterkeyhint: 'go', placeholder: 'Buscar seções, obras, ações…'
    });
    ui.esc = el('button', { type: 'button', class: 'palette__esc', 'aria-label': 'Fechar paleta de comandos' }, 'esc');
    var bar = el('div', { class: 'palette__search' });
    bar.innerHTML = icon('search', 'palette__search-icon');
    bar.appendChild(label);
    bar.appendChild(ui.input);
    bar.appendChild(ui.esc);

    ui.list = el('div', { id: 'palette-list', class: 'palette__list', role: 'listbox', 'aria-label': 'Comandos' });
    ui.empty = el('div', { class: 'palette__empty', hidden: true });
    ui.live = el('p', { class: 'sr-only', 'aria-live': 'polite' });

    var foot = el('div', { class: 'palette__foot' });
    foot.innerHTML =
      '<p id="palette-help" class="palette__hints"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>' +
      '<span><kbd>Enter</kbd> executar</span><span><kbd>Esc</kbd> fechar</span></p>' +
      '<p class="palette__touch" aria-hidden="true">toque em um comando para executar</p>' +
      '<p class="palette__brand" aria-hidden="true"><span class="palette__pulse"></span><span>raul<b>.ai</b></span></p>';

    ui.dialog.appendChild(title);
    ui.dialog.appendChild(bar);
    ui.dialog.appendChild(ui.list);
    ui.dialog.appendChild(ui.empty);
    ui.dialog.appendChild(foot);
    ui.dialog.appendChild(ui.live);
    ui.root.appendChild(ui.backdrop);
    ui.root.appendChild(ui.dialog);
    mount.insertBefore(ui.root, toastRegion);

    ui.input.addEventListener('input', function () { active = 0; render(); announce(); });
    ui.input.addEventListener('keydown', onInputKey);
    ui.dialog.addEventListener('keydown', onDialogKey);
    ui.backdrop.addEventListener('click', function () { close(); });
    ui.esc.addEventListener('click', function () { close(); });

    // cliques em áreas não interativas (opções, rótulos, rodapé) mantêm o foco no campo
    ui.dialog.addEventListener('mousedown', function (e) {
      if (e.target !== ui.input && !e.target.closest('button')) e.preventDefault();
    });
    ui.list.addEventListener('click', function (e) {
      var o = e.target.closest('[role="option"]');
      if (o) run(+o.getAttribute('data-index'));
    });
    ui.list.addEventListener('pointermove', function (e) {
      var o = e.target.closest('[role="option"]');
      if (o) setActive(+o.getAttribute('data-index'), false);
    });
    // a página atrás não rola enquanto a paleta está aberta
    var block = function (e) { if (!ui.list.contains(e.target)) e.preventDefault(); };
    ui.root.addEventListener('wheel', block, { passive: false });
    ui.root.addEventListener('touchmove', block, { passive: false });
  }

  function highlight(label, idx) {
    var frag = document.createDocumentFragment();
    if (!idx || !idx.length) { frag.appendChild(document.createTextNode(label)); return frag; }
    var set = {}, buf = '', inMark = false;
    idx.forEach(function (k) { set[k] = true; });
    function flush(mark) {
      if (!buf) return;
      frag.appendChild(mark ? el('mark', null, buf) : document.createTextNode(buf));
      buf = '';
    }
    for (var i = 0; i < label.length; i++) {
      var m = !!set[i];
      if (m !== inMark) { flush(inMark); inMark = m; }
      buf += label.charAt(i);
    }
    flush(inMark);
    return frag;
  }

  function render() {
    var query = ui.input.value;
    results = search(commands, query);
    ui.list.textContent = '';
    var group = null, groupEl = null, gi = 0;
    results.forEach(function (r, i) {
      if (r.cmd.group !== group) {
        group = r.cmd.group; gi++;
        var gid = 'palette-g' + gi;
        groupEl = el('div', { class: 'palette__group', role: 'group', 'aria-labelledby': gid });
        groupEl.appendChild(el('div', { class: 'palette__group-label', id: gid, role: 'presentation' }, group));
        ui.list.appendChild(groupEl);
      }
      var opt = el('div', {
        class: 'palette__option', role: 'option', id: 'palette-opt-' + i,
        'data-index': i, 'aria-selected': 'false'
      });
      var ic = el('span', { class: 'palette__icon', 'aria-hidden': 'true' });
      ic.innerHTML = icon(r.cmd.icon);
      var lab = el('span', { class: 'palette__label' });
      lab.appendChild(highlight(r.cmd.label, r.idx));
      if (r.cmd.external) lab.appendChild(el('span', { class: 'sr-only' }, ' (abre em nova aba)'));
      opt.appendChild(ic);
      opt.appendChild(lab);
      if (r.cmd.hint) opt.appendChild(el('span', { class: 'palette__hint', 'aria-hidden': 'true' }, r.cmd.hint + (r.cmd.external ? ' ↗' : '')));
      var enter = el('span', { class: 'palette__enter', 'aria-hidden': 'true' });
      enter.innerHTML = icon('enter');
      opt.appendChild(enter);
      groupEl.appendChild(opt);
    });

    var none = !results.length;
    ui.empty.hidden = !none;
    ui.list.hidden = none;
    if (none) {
      ui.empty.innerHTML = '';
      ui.empty.appendChild(el('p', { class: 'palette__empty-title' }, ['Nenhum comando para “', el('b', null, query.trim()), '”']));
      ui.empty.appendChild(el('p', { class: 'palette__empty-tip' }, 'Tente “galeria”, “espiral” ou “contato”.'));
    }
    setActive(Math.min(active, results.length - 1), true);
  }

  function announce() {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      var n = results.length;
      ui.live.textContent = !ui.input.value.trim() ? '' :
        n === 0 ? 'Nenhum comando encontrado.' : n === 1 ? '1 comando encontrado.' : n + ' comandos encontrados.';
    }, 450);
  }

  function setActive(i, scroll) {
    var opts = ui.list.querySelectorAll('[role="option"]');
    if (!opts.length || i < 0) { active = 0; ui.input.removeAttribute('aria-activedescendant'); return; }
    var prevEl = ui.list.querySelector('[aria-selected="true"]');
    if (prevEl) { prevEl.setAttribute('aria-selected', 'false'); prevEl.classList.remove('is-active'); }
    active = (i + opts.length) % opts.length;
    var o = opts[active];
    o.setAttribute('aria-selected', 'true');
    o.classList.add('is-active');
    ui.input.setAttribute('aria-activedescendant', o.id);
    if (scroll) {
      // mantém a opção visível; a primeira de cada grupo leva junto o rótulo
      var list = ui.list, lbl = o.previousElementSibling;
      var top = lbl && lbl.classList.contains('palette__group-label') ? lbl.offsetTop : o.offsetTop;
      var bottom = o.offsetTop + o.offsetHeight;
      if (active === 0) list.scrollTop = 0;
      else if (top - 6 < list.scrollTop) list.scrollTop = top - 6;
      else if (bottom + 6 > list.scrollTop + list.clientHeight) list.scrollTop = bottom + 6 - list.clientHeight;
    }
  }

  function onInputKey(e) {
    var n = results.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive(active + 1, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive(active - 1, true); }
    else if (e.key === 'PageDown') { e.preventDefault(); if (n) setActive(Math.min(active + 5, n - 1), true); }
    else if (e.key === 'PageUp') { e.preventDefault(); if (n) setActive(Math.max(active - 5, 0), true); }
    else if (e.key === 'Enter') { e.preventDefault(); if (n && !e.isComposing) run(active); }
  }

  function onDialogKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      // foco preso: alterna entre o campo e o botão fechar
      var f = [ui.input, ui.esc];
      var i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }

  function run(i) {
    var r = results[i];
    if (!r) return;
    close();
    try { r.cmd.run(); }
    catch (err) { console.error('[palette] comando falhou:', err); RR.toast('Ops, esse comando falhou.'); }
  }

  /* ---------- abrir / fechar ---------- */
  function open() {
    if (isOpen) { ui.input.focus(); ui.input.select(); return; }
    if (!ui.root) build();
    isOpen = true;
    clearTimeout(closeTimer);
    lastFocus = document.activeElement;
    // o menu mobile não fica aberto por trás do diálogo
    var navEl = document.getElementById('nav');
    if (navEl && navEl.classList.contains('is-open')) {
      var tg = document.querySelector('.nav-toggle');
      if (tg) tg.click();
      if (lastFocus && navEl.contains(lastFocus)) lastFocus = tg;
    }
    commands = buildCommands();
    ui.input.value = '';
    active = 0;
    render();
    ui.live.textContent = '';
    ui.root.hidden = false;
    ui.root.classList.remove('is-open');
    void ui.root.offsetWidth; // reinicia a transição
    ui.root.classList.add('is-open');
    ui.input.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    ui.root.classList.remove('is-open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () { if (!isOpen) ui.root.hidden = true; }, reduced() ? 0 : 200);
    var back = lastFocus;
    lastFocus = null;
    if (back && back !== document.body && document.contains(back) && back.focus) {
      try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); }
    } else if (document.activeElement && ui.dialog.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  RR.openPalette = open;
  RR.closePalette = close;

  /* ---------- atalhos e gatilhos ---------- */
  document.addEventListener('keydown', function (e) {
    var k = e.key || '';
    if (isOpen && k === 'Escape') { e.preventDefault(); close(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K')) {
      e.preventDefault();
      if (isOpen) close(); else open();
      return;
    }
    if (k === '/' && !isOpen && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
      e.preventDefault();
      open();
    }
  });
  // foco preso de verdade: se algo levar o foco para fora do diálogo, ele volta ao campo
  document.addEventListener('focusin', function (e) {
    if (isOpen && ui.dialog && !ui.dialog.contains(e.target)) ui.input.focus({ preventScroll: true });
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-open-palette]');
    if (t) { e.preventDefault(); open(); }
  });
  if (RR.on) RR.on('palette:open', open);
})();
