/* ==========================================================================
   ANTROPOLOGICKÉ ČÍTANIA — aplikačná logika
   --------------------------------------------------------------------------
   Pohľad 1  GALÉRIA   oblúkový karusel kariet (window.CLANKY)
   Pohľad 2  DETAIL    celoobrazovkové čítanie: text, kritika, úlohy, literatúra

   Smerovanie cez adresu:
     index.html                     galéria
     index.html#<id>                detail článku
     index.html#<id>~ulohy          detail, záložka Úlohy   (aj ~literatura)
     index.html#<id>~kritika        detail s otvoreným panelom kritiky

   OBSAH
     0. Konfigurácia
     1. Pomocné funkcie
     2. Bohatý text (HTML / Markdown) a čistenie
     3. Generované obálky (keď článok nemá obrázok)
     4. Príprava dát
     5. Galéria: geometria oblúka
     6. Galéria: vykresľovanie a animácia
     7. Galéria: ovládanie (klik, ťahanie, koliesko, klávesnica)
     8. Zoznam článkov
     9. Detail: šablóna
    10. Detail: otvorenie, zatvorenie, záložky, kritika
    11. Detail: úlohy a kvíz
    12. Smerovanie a štart
   ========================================================================== */
(() => {
  'use strict';

  /* ---------- 0. KONFIGURÁCIA ---------------------------------------------- */

  const CFG = Object.assign({ nazov: 'ANTHROPIA' }, window.NASTAVENIA || {});
  const T = Object.assign({
    text: 'Text',
    kritika: 'Kritika',
    ulohy: 'Úlohy',
    literatura: 'Literatúra',
    citat: 'Čítať článok',
    pripravujeme: 'Pripravuje sa',
    spat: 'Články',
    zoznam: 'Zoznam článkov',
  }, CFG.popisky || {});

  const STORE_KEY = 'antro-citania:v1';
  const TABS = ['text', 'ulohy', 'literatura'];
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DOCK = window.matchMedia('(min-width: 1280px)');   // musí sedieť s CSS (panel kritiky)


  /* ---------- 1. POMOCNÉ FUNKCIE ------------------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mod = (n, m) => ((n % m) + m) % m;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const slugify = s => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 64);

  const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function hashStr(s) {
    let h = 2166136261;
    for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function seededRandom(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Slovenské skloňovanie počtu: 1 úloha, 2–4 úlohy, 5 úloh */
  const plural = (n, one, few, many) => `${n} ${n === 1 ? one : (n >= 2 && n <= 4 ? few : many)}`;

  const textOf = html => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  };

  /** localStorage môže byť zablokované (súkromné okno, náhľad) — nikdy nespadne */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(`${STORE_KEY}:${key}`); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(`${STORE_KEY}:${key}`, JSON.stringify(value)); } catch { /* bez ukladania */ }
    },
    remove(key) {
      try { localStorage.removeItem(`${STORE_KEY}:${key}`); } catch { /* bez ukladania */ }
    },
  };

  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
    split: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14 4.5v15"/></svg>',
    contrast: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
  };


  /* ---------- 2. BOHATÝ TEXT (HTML / MARKDOWN) A ČISTENIE ------------------ */

  const looksLikeHTML = s => /<\/?[a-z][\s\S]*?>/i.test(s);

  /** Záložný Markdown, ak sa knižnica marked nenačíta (napr. offline) */
  function miniMarkdown(md, inlineOnly = false) {
    const inline = t => esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[(.+?)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
    if (inlineOnly) return inline(md);
    return String(md).trim().split(/\n\s*\n/).map(block => {
      // Nadpis: "## Názov" → <h2> (rovnako ako knižnica marked); text za nadpisom
      // v tom istom bloku sa spracuje ako ďalší odsek
      const h = block.match(/^(#{1,6})\s+(.*)(?:\n([\s\S]*))?$/);
      if (h) {
        const lvl = Math.min(6, Math.max(2, h[1].length));
        return `<h${lvl}>${inline(h[2].replace(/\s+#+\s*$/, ''))}</h${lvl}>` + (h[3] ? miniMarkdown(h[3]) : '');
      }
      if (/^(\d+\.|[-*])\s/.test(block)) {
        const ordered = /^\d+\./.test(block);
        const items = block.split(/\n(?=(?:\d+\.|[-*])\s)/)
          .map(li => `<li>${inline(li.replace(/^(\d+\.|[-*])\s+/, ''))}</li>`).join('');
        return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      }
      if (/^>\s?/.test(block)) return `<blockquote><p>${inline(block.replace(/^>\s?/gm, ''))}</p></blockquote>`;
      return `<p>${inline(block).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  function sanitize(html) {
    if (window.DOMPurify) return window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(el => {
      for (const attr of Array.from(el.attributes)) {
        const bad = /^on/i.test(attr.name) ||
          (/^(href|src|xlink:href)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value));
        if (bad) el.removeAttribute(attr.name);
      }
    });
    return doc.body.firstElementChild ? doc.body.firstElementChild.innerHTML : '';
  }

  /** Blokový obsah: HTML ostáva, Markdown sa prevedie */
  function rich(value) {
    if (value == null || value === '') return '';
    const s = String(value);
    if (looksLikeHTML(s)) return sanitize(s);
    const html = window.marked ? window.marked.parse(s) : miniMarkdown(s);
    return sanitize(html);
  }

  /** Riadkový obsah (možnosti kvízu, perex): bez obaľovania do <p> */
  function richInline(value) {
    if (value == null || value === '') return '';
    const s = String(value);
    if (looksLikeHTML(s)) return sanitize(s);
    const html = window.marked?.parseInline ? window.marked.parseInline(s) : miniMarkdown(s, true);
    return sanitize(html);
  }

  /** Zmení holé adresy (https://…) v texte na odkazy */
  function linkify(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.parentElement.closest('a') && /https?:\/\//.test(n.nodeValue)) nodes.push(n);
    }
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      const parts = node.nodeValue.split(/(https?:\/\/[^\s<]+[^\s<.,;:)])/g);
      parts.forEach((part, i) => {
        if (i % 2) {
          const a = document.createElement('a');
          a.href = part; a.textContent = part; a.target = '_blank'; a.rel = 'noopener';
          frag.appendChild(a);
        } else if (part) frag.appendChild(document.createTextNode(part));
      });
      node.replaceWith(frag);
    }
  }

  /** Externé odkazy v článku sa otvárajú v novom okne */
  function externalLinks(root) {
    $$('a[href^="http"]', root).forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  }


  /* ---------- 3. GENEROVANÉ OBÁLKY ----------------------------------------- */
  /* Kým k článku nepridáte vlastný obrázok, dostane abstraktnú farebnú obálku
     odvodenú z jeho ID (rovnaké ID = vždy rovnaký obrázok). */

  const PALETTES = [
    { base: '#2b1708', blobs: ['#e3a53c', '#b5521e', '#f4d9a1', '#6e2a10'], ambient: '#c27a26' },  // okr
    { base: '#03202b', blobs: ['#1e8fb4', '#62d2d9', '#0a4e6b', '#a6e6e0'], ambient: '#1e7fa4' },  // lagúna
    { base: '#2a0508', blobs: ['#d2262f', '#ff6e5a', '#7a0f1a', '#ffb199'], ambient: '#b21e2a' },  // karmín
    { base: '#101a0b', blobs: ['#6e933b', '#cbd68c', '#2f4b1d', '#9fbf62'], ambient: '#5f8a2e' },  // mach
    { base: '#0c0b25', blobs: ['#4c46ca', '#9c8eff', '#1c1a61', '#d3c9ff'], ambient: '#4a44c0' },  // indigo
    { base: '#1e0f20', blobs: ['#c55b8b', '#f2a27b', '#4a2161', '#ffd0b0'], ambient: '#a54a78' },  // súmrak
  ];

  function makeCover(seed) {
    const h = hashStr(seed);
    const rnd = seededRandom(h);
    const p = PALETTES[h % PALETTES.length];
    const blobs = p.blobs.map(color => {
      const cx = (15 + rnd() * 170).toFixed(1);
      const cy = (15 + rnd() * 170).toFixed(1);
      const r = (40 + rnd() * 60).toFixed(1);
      const o = (0.7 + rnd() * 0.3).toFixed(2);
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="${o}"/>`;
    }).join('');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice">` +
      `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>` +
      `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>` +
      `<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .16 0 0 0 0"/></filter></defs>` +
      `<rect width="200" height="200" fill="${p.base}"/><g filter="url(#b)">${blobs}</g>` +
      `<rect width="200" height="200" filter="url(#n)"/></svg>`;
    return { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), ambient: p.ambient };
  }

  /* Vlastný obrázok: orezanie (predvolené) alebo celý obrázok bez orezania
     (obrazok_cely: true, napr. výrez bez pozadia) a ohnisko (obrazok_pozicia). */
  function applyFit(img, a) {
    img.style.objectFit = a.fit;
    img.style.objectPosition = a.pos;
    img.classList.toggle('is-whole', a.fit === 'contain');
    img.classList.toggle('is-bottom', a.fit === 'contain' && a.bottom);
  }

  function resetFit(img) {
    img.style.objectFit = '';
    img.style.objectPosition = '';
    img.classList.remove('is-whole', 'is-bottom');
  }

  /** Atribúty pre <img> v HTML šablónach (zoznam, ďalší článok) */
  function imgAttrs(a) {
    if (!a.image) return `src="${esc(a.cover.src)}"`;
    const cls = a.fit === 'contain' ? ` class="is-whole${a.bottom ? ' is-bottom' : ''}"` : '';
    return `src="${esc(a.image)}" data-cover="${esc(a.cover.src)}" style="object-fit:${a.fit};object-position:${esc(a.pos)}"${cls}`;
  }

  /** Ak sa obrázok nenačíta (preklep v ceste), použije sa vygenerovaná obálka */
  function fallbackToCover(root) {
    $$('img[data-cover]', root).forEach(img => {
      img.addEventListener('error', () => { resetFit(img); img.src = img.dataset.cover; }, { once: true });
    });
  }

  function setImage(img, a) {
    img.src = a.image || a.cover.src;
    if (!a.image) { resetFit(img); return; }
    applyFit(img, a);
    img.onerror = () => { img.onerror = null; resetFit(img); img.src = a.cover.src; };
  }


  /* ---------- 4. PRÍPRAVA DÁT ---------------------------------------------- */

  function parseTasks(ulohy) {
    if (!ulohy) return [];
    if (Array.isArray(ulohy)) {
      return ulohy.map(u => {
        if (typeof u === 'string') return { type: 'open', html: rich(u) };
        if (u && Array.isArray(u.moznosti)) {
          return {
            type: 'quiz',
            html: rich(u.otazka || ''),
            options: u.moznosti.map(o => richInline(o)),
            correct: Number.isInteger(u.spravna) ? u.spravna : -1,
            explain: rich(u.vysvetlenie || ''),
          };
        }
        return { type: 'open', html: rich(u?.otazka || u?.text || '') };
      }).filter(t => t.html);
    }
    const holder = document.createElement('div');
    holder.innerHTML = rich(ulohy);
    const items = $$(':scope > ol > li, :scope > ul > li', holder);
    if (items.length) return items.map(li => ({ type: 'open', html: li.innerHTML }));
    return holder.innerHTML.trim() ? [{ type: 'open', html: holder.innerHTML }] : [];
  }

  function prepareContent(html) {
    const holder = document.createElement('div');
    holder.innerHTML = rich(html);
    // Nadpis 1. úrovne (# v Markdowne) by súperil s titulkom článku → zmeníme na h2
    $$('h1', holder).forEach(h1 => {
      const h2 = document.createElement('h2');
      h2.innerHTML = h1.innerHTML;
      h1.replaceWith(h2);
    });
    const toc = [];
    $$('h2', holder).forEach((h, i) => {
      const id = `sekcia-${i + 1}-${slugify(h.textContent).slice(0, 40)}`;
      h.id = id;
      toc.push({ id, label: h.textContent.trim() });
    });
    externalLinks(holder);
    const words = (holder.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    return { html: holder.innerHTML, toc, minutes: Math.max(1, Math.round(words / 180)) };
  }

  function prepareBibliography(html) {
    if (!html) return { html: '', count: 0 };
    const holder = document.createElement('div');
    holder.innerHTML = rich(html);
    // Odsek, ktorý obsahuje iba tučný text, je nadpis skupiny
    $$('p', holder).forEach(p => {
      const only = p.children.length === 1 && /^(STRONG|B)$/.test(p.children[0].tagName);
      if (only && p.textContent.trim() === p.children[0].textContent.trim()) {
        const h = document.createElement('h3');
        h.textContent = p.textContent.trim();
        p.replaceWith(h);
      }
    });
    linkify(holder);
    externalLinks(holder);
    const count = $$('p, li', holder).length;
    return { html: holder.innerHTML, count };
  }

  const RAW = Array.isArray(window.CLANKY) ? window.CLANKY : [];
  const usedIds = new Set();
  const ARTICLES = RAW.filter(a => a && typeof a === 'object').map((a, i) => {
    let id = slugify(a.id ?? '') || slugify(a.titulok) || `clanok-${i + 1}`;
    while (usedIds.has(id)) id = `${id}-${i + 1}`;
    usedIds.add(id);
    if (!a.titulok) console.warn(`[Čítania] Článok „${id}“ nemá pole „titulok“.`);
    if (!a.perex) console.warn(`[Čítania] Článok „${id}“ nemá pole „perex“.`);
    const cover = makeCover(id);
    return {
      raw: a,
      id,
      index: i,
      titulok: a.titulok || 'Bez názvu',
      perexText: textOf(richInline(a.perex || '')),
      perexHTML: rich(a.perex || ''),
      draft: a.stav === 'pripravuje_sa' || !a.hlavny_obsah,
      image: a.obrazok || '',
      alt: a.obrazok_popis || '',
      credit: a.obrazok_zdroj || '',
      fit: a.obrazok_cely ? 'contain' : 'cover',
      pos: String(a.obrazok_pozicia || '50% 50%').replace(/[;"<>]/g, ''),
      bottom: /(^|\s)(100%|bottom)\s*$/.test(String(a.obrazok_pozicia || '').trim()),
      cover,
      ambient: a.farba || cover.ambient,
      _ready: false,
    };
  });
  const N = ARTICLES.length;

  /** Dlhé titulky (napr. s podtitulom za dvojbodkou) dostanú menší stupeň písma */
  const LONG_TITLE = 80;
  const isLongTitle = a => a.titulok.length > LONG_TITLE;
  const byId = new Map(ARTICLES.map(a => [a.id, a]));

  /** Ťažšie spracovanie (obsah, úlohy, literatúra) až pri prvom otvorení */
  function ensureDetail(a) {
    if (a._ready) return a;
    const content = prepareContent(a.raw.hlavny_obsah);
    const bib = prepareBibliography(a.raw.bibliography || a.raw.literatura);
    Object.assign(a, {
      contentHTML: content.html,
      toc: content.toc,
      minutes: content.minutes,
      critiqueHTML: (() => {
        const d = document.createElement('div');
        d.innerHTML = rich(a.raw.contradiction);
        externalLinks(d);
        return d.innerHTML;
      })(),
      tasks: parseTasks(a.raw.ulohy),
      bibHTML: bib.html,
      bibCount: bib.count,
      _ready: true,
    });
    return a;
  }


  /* ---------- 5. GALÉRIA: GEOMETRIA OBLÚKA --------------------------------- */
  /* Podľa referencie: kruh so stredom pri spodnom okraji, karty natočené po
     dotyčnici, vybraná karta navrchu, text vo vnútri oblúka. */

  const els = {
    gallery: $('#gallery'),
    header: $('#gallery-header'),
    arc: $('#arc'),
    focus: $('#focus'),
    title: $('#focus-title'),
    perex: $('#focus-perex'),
    open: $('#focus-open'),
    draft: $('#focus-draft'),
    count: $('#focus-count'),
    live: $('#focus-live'),
    prev: $('#arc-prev'),
    next: $('#arc-next'),
    index: $('#index'),
    indexList: $('#index-list'),
    indexSearch: $('#index-search'),
    indexEmpty: $('#index-empty'),
    openIndex: $('#open-index'),
    reader: $('#reader'),
    probe: $('#safe-probe'),
  };

  const arc = {
    pos: 0,          // aktuálna (aj necelá) poloha kolesa
    target: 0,       // cieľová celá poloha
    entrance: 1,     // 0 → 1 úvodné rozvinutie kariet
    geo: null,
    pool: new Map(), // absolútny index → element karty
    focusAbs: null,
    focusIdx: -1,
    raf: 0,
    last: 0,
    dragging: false,
    suppressClick: false,
  };

  function computeGeometry() {
    const W = els.gallery.clientWidth;
    const H = els.gallery.clientHeight;
    const headerH = els.header.offsetHeight;
    const safeBottom = parseFloat(getComputedStyle(els.probe).paddingBottom) || 0;
    const portrait = W < 720 || W / H < 0.95;

    let card, R, arcTop, maxTheta;
    if (portrait) {
      card = clamp(W * 0.22, 80, 128);
      R = W * 0.86;
      arcTop = headerH + card * 0.62 + 10;
      maxTheta = 1.35;               // ~77°: oblúk sa na výšku neuzatvára dole
    } else {
      card = clamp(Math.min(W * 0.104, H * 0.165), 84, 150);
      R = Math.min(W * 0.4, H * 0.62);
      arcTop = Math.max(H * 0.33, headerH + card * 0.8);
      maxTheta = 1.95;               // ~112°: karty dobiehajú k spodnému okraju
    }
    // Uhol medzi kartami tak, aby medzi nimi zostala ~13 % medzera
    const step = 2 * Math.asin(Math.min(0.95, (card * 1.13) / (2 * R)));

    let focusTop, focusBottom, focusW, navSize, navY;
    if (portrait) {
      navSize = 52;
      const textH = 300;                                   // odhad: titulok + perex + tlačidlo
      const below = card * 0.5 + R * (1 - Math.cos(2 * step)) + 24;
      const groupH = card * 1.1 + below + textH;
      const availTop = headerH + 8;
      const availBottom = H - safeBottom - navSize - 36;
      // Skupinu (oblúk + text) vertikálne vycentrujeme v dostupnom priestore
      const shift = Math.max(0, (availBottom - availTop - groupH) * 0.42);
      arcTop += shift;
      focusTop = arcTop + below;
      focusBottom = availBottom;
      focusW = Math.min(W - 40, 520);
      navY = 0;
    } else {
      navSize = clamp(W * 0.075, 64, 116);
      focusTop = arcTop + card * 0.8;
      focusBottom = Math.min(arcTop + R, H - 24);
      focusW = Math.min(580, R * 1.05);
      navY = arcTop + R * 0.33;
    }
    const cx = W / 2;
    const cy = arcTop + R;
    return { W, H, portrait, card, R, step, cx, cy, maxTheta, focusTop, focusH: Math.max(160, focusBottom - focusTop), focusW, navSize, navY };
  }

  function applyGeometry() {
    const g = arc.geo = computeGeometry();
    const s = els.gallery.style;
    els.gallery.classList.toggle('is-portrait', g.portrait);
    els.arc.style.setProperty('--card', `${g.card}px`);
    s.setProperty('--focus-top', `${g.focusTop}px`);
    s.setProperty('--focus-h', `${g.focusH}px`);
    s.setProperty('--focus-w', `${g.focusW}px`);
    s.setProperty('--nav-size', `${g.navSize}px`);
    s.setProperty('--nav-y', `${g.navY}px`);
  }


  /* ---------- 6. GALÉRIA: VYKRESĽOVANIE A ANIMÁCIA ------------------------- */

  function makeCard(i) {
    const a = ARTICLES[mod(i, N)];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'arc-card' + (a.draft ? ' is-draft' : '');
    btn.dataset.i = String(i);
    btn.tabIndex = -1;
    btn.setAttribute('aria-label', a.draft ? `${a.titulok} (${T.pripravujeme.toLowerCase()})` : a.titulok);
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    setImage(img, a);
    btn.appendChild(img);
    return btn;
  }

  function renderArc() {
    const g = arc.geo;
    if (!g || !N) return;
    const e = easeOutCubic(arc.entrance);
    const spread = 0.06 + 0.94 * e;
    const base = Math.round(arc.pos);
    const K = Math.ceil(Math.PI / g.step);
    const margin = g.card * 0.8;
    const seen = new Set();

    for (let i = base - K; i <= base + K; i++) {
      const rel = i - arc.pos;
      const theta = rel * g.step * spread;
      if (Math.abs(theta) > g.maxTheta) continue;
      const x = g.cx + g.R * Math.sin(theta);
      const y = g.cy - g.R * Math.cos(theta);
      if (x < -margin || x > g.W + margin || y < -margin || y > g.H + margin) continue;
      seen.add(i);
      let el = arc.pool.get(i);
      if (!el) { el = makeCard(i); els.arc.appendChild(el); arc.pool.set(i, el); }
      const near = Math.max(0, 1 - Math.abs(rel));
      const scale = 1 + 0.07 * near;
      el.style.transform =
        `translate3d(${(x - g.card / 2).toFixed(2)}px, ${(y - g.card / 2).toFixed(2)}px, 0) ` +
        `rotate(${theta.toFixed(4)}rad) scale(${scale.toFixed(3)})`;
      el.style.zIndex = String(200 - Math.round(Math.abs(rel) * 4));
      el.style.opacity = e < 1 ? e.toFixed(3) : '';
    }
    for (const [i, el] of arc.pool) {
      if (!seen.has(i)) { el.remove(); arc.pool.delete(i); }
    }
  }

  function updateFocus(force = false) {
    if (!N) return;
    const abs = Math.round(arc.pos);
    if (abs !== arc.focusAbs || force) {
      const prev = arc.pool.get(arc.focusAbs);
      if (prev) { prev.tabIndex = -1; prev.classList.remove('is-focus'); }
      const cur = arc.pool.get(abs);
      if (cur) { cur.tabIndex = 0; cur.classList.add('is-focus'); }
      arc.focusAbs = abs;
    }
    const idx = mod(abs, N);
    if (idx === arc.focusIdx && !force) return;
    arc.focusIdx = idx;
    const a = ARTICLES[idx];
    document.documentElement.style.setProperty('--ambient', a.ambient);
    swapFocusText(a, idx);
  }

  let swapTimer = 0;
  function swapFocusText(a, idx) {
    const apply = () => {
      els.title.textContent = a.titulok;
      els.perex.textContent = a.perexText;
      els.open.hidden = a.draft;
      els.draft.hidden = !a.draft;
      els.count.textContent = `${idx + 1} z ${N}`;
      els.live.textContent = `${a.titulok}. Článok ${idx + 1} z ${N}${a.draft ? `, ${T.pripravujeme.toLowerCase()}` : ''}.`;
      els.focus.classList.remove('is-swapping');
    };
    clearTimeout(swapTimer);
    if (RM.matches || !els.title.textContent) { apply(); return; }
    els.focus.classList.add('is-swapping');
    swapTimer = setTimeout(apply, 150);
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - arc.last) / 1000 || 0.016);
    arc.last = now;

    if (arc.entrance < 1) arc.entrance = RM.matches ? 1 : Math.min(1, arc.entrance + dt / 1.1);

    if (!arc.dragging) {
      const k = RM.matches ? 1 : 1 - Math.exp(-dt * 11);
      arc.pos += (arc.target - arc.pos) * k;
      if (Math.abs(arc.target - arc.pos) < 0.0008) arc.pos = arc.target;
    }

    renderArc();
    updateFocus();

    const busy = arc.dragging || arc.pos !== arc.target || arc.entrance < 1;
    arc.raf = busy ? requestAnimationFrame(tick) : 0;
  }

  function kick() {
    if (arc.raf || state.reader) return;
    arc.last = performance.now();
    arc.raf = requestAnimationFrame(tick);
  }

  /** Okamžite nastaví koleso (bez animácie), napr. pred otvorením detailu */
  function snapTo(abs) {
    arc.pos = arc.target = abs;
    arc.entrance = 1;
    renderArc();
    updateFocus(true);
  }

  /** Najbližšia absolútna poloha karty, ktorá patrí článku s daným indexom */
  function nearestAbs(idx) {
    const cur = Math.round(arc.target);
    let d = mod(idx - mod(cur, N), N);
    if (d > N / 2) d -= N;
    return cur + d;
  }


  /* ---------- 7. GALÉRIA: OVLÁDANIE ---------------------------------------- */

  function go(delta) {
    if (!N) return;
    arc.target = Math.round(arc.target) + delta;
    const hadFocus = document.activeElement?.classList.contains('arc-card');
    kick();
    if (hadFocus) {
      renderArc();
      arc.pool.get(arc.target)?.focus({ preventScroll: true });
    }
  }

  function openFocused() {
    if (!N) return;
    const a = ARTICLES[mod(Math.round(arc.target), N)];
    if (a.draft) {
      els.focus.classList.remove('is-nudge');
      void els.focus.offsetWidth;
      els.focus.classList.add('is-nudge');
      return;
    }
    navigateTo(a.id);
  }

  els.prev.addEventListener('click', () => go(-1));
  els.next.addEventListener('click', () => go(1));
  els.open.addEventListener('click', openFocused);

  els.arc.addEventListener('click', e => {
    const card = e.target.closest('.arc-card');
    if (!card || arc.suppressClick) return;
    const i = Number(card.dataset.i);
    const settled = Math.abs(arc.pos - arc.target) < 0.08;
    if (i === Math.round(arc.target) && settled) openFocused();
    else { arc.target = i; kick(); }
  });

  // Ťahanie myšou / prstom
  const drag = { id: null, x0: 0, pos0: 0, moved: false, lastX: 0, lastT: 0, v: 0 };

  els.gallery.addEventListener('pointerdown', e => {
    if (!N || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('button:not(.arc-card), a, input')) return;
    Object.assign(drag, { id: e.pointerId, x0: e.clientX, lastX: e.clientX, pos0: arc.pos, moved: false, v: 0, lastT: performance.now() });
  });

  window.addEventListener('pointermove', e => {
    if (e.pointerId !== drag.id || state.reader) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      arc.dragging = true;
      els.gallery.classList.add('is-dragging');
      kick();
    }
    const g = arc.geo;
    const pxPerStep = g.R * g.step;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    const inst = (-(e.clientX - drag.lastX) / pxPerStep) / dt * 1000; // kroky za sekundu
    drag.v = drag.v * 0.75 + inst * 0.25;
    drag.lastX = e.clientX;
    drag.lastT = now;
    arc.pos = arc.target = drag.pos0 - dx / pxPerStep;
  });

  function endDrag(e) {
    if (e.pointerId !== drag.id) return;
    drag.id = null;
    if (!drag.moved) return;
    arc.dragging = false;
    els.gallery.classList.remove('is-dragging');
    const idle = performance.now() - drag.lastT > 90;
    const fling = idle ? 0 : clamp(drag.v * 0.16, -4, 4);
    arc.target = Math.round(arc.pos + fling);
    arc.suppressClick = true;
    setTimeout(() => { arc.suppressClick = false; }, 0);
    kick();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // Koliesko myši a dotykový panel: jeden krok na gesto, s krátkou pauzou
  let wheelAcc = 0, wheelLast = 0, wheelReset = 0;
  els.gallery.addEventListener('wheel', e => {
    if (!N || state.reader) return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelAcc += e.deltaMode === 1 ? d * 30 : d;
    const now = performance.now();
    if (Math.abs(wheelAcc) > 36 && now - wheelLast > 200) {
      go(Math.sign(wheelAcc));
      wheelAcc = 0;
      wheelLast = now;
    }
    clearTimeout(wheelReset);
    wheelReset = setTimeout(() => { wheelAcc = 0; }, 180);
  }, { passive: false });

  // Klávesnica v galérii
  document.addEventListener('keydown', e => {
    if (state.reader) { readerKeydown(e); return; }
    if (!els.index.hidden) { if (e.key === 'Escape') closeIndex(); return; }
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Enter' && !e.target.closest('button, a')) { e.preventDefault(); openFocused(); }
  });

  $('[data-action="home"]').addEventListener('click', e => {
    e.preventDefault();
    if (state.reader) navigateHome();
  });

  window.addEventListener('resize', () => {
    applyGeometry();
    renderArc();
  });


  /* ---------- 8. ZOZNAM ČLÁNKOV -------------------------------------------- */

  function renderIndex(query = '') {
    const q = fold(query.trim());
    const rows = ARTICLES.filter(a => !q || fold(`${a.titulok} ${a.perexText}`).includes(q));
    els.indexList.innerHTML = rows.map(a => `
      <li>
        <button type="button" class="index-row${a.draft ? ' is-draft' : ''}" data-id="${esc(a.id)}">
          <img ${imgAttrs(a)} alt="">
          <span class="flex min-w-0 flex-col gap-1">
            <span class="font-read text-[1.08rem] font-semibold leading-snug text-bone">${esc(a.titulok)}</span>
            <span class="line-clamp-2 text-[0.88rem] leading-snug text-ash">${esc(a.perexText)}</span>
            ${a.draft ? `<span class="text-[0.8rem] font-medium text-ochre">${esc(T.pripravujeme)}</span>` : ''}
          </span>
        </button>
      </li>`).join('');
    fallbackToCover(els.indexList);
    els.indexEmpty.hidden = rows.length > 0;
  }

  function openIndex() {
    renderIndex(els.indexSearch.value);
    els.index.hidden = false;
    els.gallery.inert = true;
    els.indexSearch.focus({ preventScroll: true });
  }

  function closeIndex({ restoreFocus = true } = {}) {
    if (els.index.hidden) return;
    els.index.hidden = true;
    if (!state.reader) els.gallery.inert = false;
    if (restoreFocus) els.openIndex.focus({ preventScroll: true });
  }

  els.openIndex.addEventListener('click', openIndex);
  els.indexSearch.addEventListener('input', () => renderIndex(els.indexSearch.value));
  els.index.addEventListener('click', e => {
    if (e.target.closest('[data-action="index-close"]')) { closeIndex(); return; }
    const row = e.target.closest('.index-row');
    if (!row) return;
    const a = byId.get(row.dataset.id);
    if (!a) return;
    closeIndex({ restoreFocus: false });
    snapTo(nearestAbs(a.index));
    if (a.draft) arc.pool.get(arc.target)?.focus({ preventScroll: true });
    else navigateTo(a.id);
  });


  /* ---------- 9. DETAIL: ŠABLÓNA ------------------------------------------- */

  function nextPublished(a) {
    for (let k = 1; k < N; k++) {
      const b = ARTICLES[mod(a.index + k, N)];
      if (!b.draft) return b;
    }
    return null;
  }

  function readerTemplate(a) {
    const tasksN = a.tasks.length;
    const hasCritique = !!a.critiqueHTML;
    const next = nextPublished(a);

    const tabs = [
      { id: 'text', label: T.text, show: true, badge: '' },
      { id: 'ulohy', label: T.ulohy, show: tasksN > 0, badge: `<span class="tab-badge" data-badge="ulohy">0/${tasksN}</span>` },
      { id: 'literatura', label: T.literatura, show: !!a.bibHTML, badge: a.bibCount ? `<span class="tab-badge">${a.bibCount}</span>` : '' },
    ].filter(t => t.show);

    const meta = [
      `${a.minutes} min čítania`,
      tasksN ? plural(tasksN, 'úloha', 'úlohy', 'úloh') : '',
      a.bibCount ? plural(a.bibCount, 'zdroj', 'zdroje', 'zdrojov') : '',
    ].filter(Boolean);

    const tocItems = a.toc.map(t => `<li><button type="button" data-action="toc" data-target="${esc(t.id)}">${esc(t.label)}</button></li>`).join('');

    const critiqueBtn = (cls, label) => hasCritique
      ? `<button type="button" class="r-btn ${cls}" data-action="critique" aria-controls="critique" aria-expanded="false">${label}</button>`
      : '';

    const afterText = `
      <div class="after-text">
        ${hasCritique ? `
          <div class="callout">
            <h2 class="callout-title">Tento text má aj kritikov</h2>
            <p class="callout-text">Skôr ako sa pustíte do úloh, pozrite si, v čom s autorom nesúhlasia iní výskumníci.</p>
            <div class="flex flex-wrap gap-3">
              ${critiqueBtn('r-btn-solid', `Otvoriť kritiku`)}
              ${tasksN ? `<button type="button" class="r-btn r-btn-outline" data-action="tab" data-tab="ulohy">Prejsť na úlohy</button>` : ''}
            </div>
          </div>` : (tasksN ? `
          <div class="callout">
            <h2 class="callout-title">Pokračujte úlohami</h2>
            <div class="flex flex-wrap gap-3">
              <button type="button" class="r-btn r-btn-solid" data-action="tab" data-tab="ulohy">Prejsť na úlohy</button>
            </div>
          </div>` : '')}
        ${next ? `
          <button type="button" class="next-card" data-action="open" data-id="${esc(next.id)}">
            <img ${imgAttrs(next)} alt="">
            <span class="min-w-0">
              <span class="next-card-label block">Ďalší článok</span>
              <span class="next-card-title block">${esc(next.titulok)}</span>
            </span>
          </button>` : ''}
      </div>`;

    const taskItems = a.tasks.map((t, i) => {
      const n = i + 1;
      const base = `${a.id}-${n}`;
      if (t.type === 'quiz') {
        return `
          <li class="task" data-i="${i}" data-type="quiz">
            <div class="task-head"><span class="task-num">Úloha ${n}</span></div>
            <div class="task-q prose-reader prose-compact" id="q-${base}">${t.html}</div>
            <fieldset class="quiz" aria-labelledby="q-${base}">
              ${t.options.map((o, k) => `
                <label class="quiz-opt" for="opt-${base}-${k}">
                  <input type="radio" id="opt-${base}-${k}" name="quiz-${base}" value="${k}">
                  <span>${o}</span>
                </label>`).join('')}
            </fieldset>
            <div class="quiz-feedback" role="status" aria-live="polite"></div>
          </li>`;
      }
      return `
        <li class="task" data-i="${i}" data-type="open">
          <div class="task-head"><span class="task-num">Úloha ${n}</span></div>
          <div class="task-q prose-reader prose-compact" id="q-${base}">${t.html}</div>
          <label class="sr-only" for="note-${base}">Vaša odpoveď na úlohu ${n}</label>
          <textarea class="task-note" id="note-${base}" rows="4" placeholder="Vaše poznámky a odpoveď…" aria-describedby="q-${base}"></textarea>
          <div class="task-foot">
            <label class="check" for="done-${base}"><input type="checkbox" id="done-${base}"><span>Hotovo</span></label>
            <span class="task-saved" aria-hidden="true">Uložené</span>
          </div>
        </li>`;
    }).join('');

    return `
      <div class="reader-body">
        <div class="reader-bar">
          <div class="reader-bar-inner">
            <button type="button" class="r-btn r-btn-ghost" data-action="close">${ICON.back}<span>${esc(T.spat)}</span></button>
            <p class="reader-bar-title" aria-hidden="true">${esc(a.titulok)}</p>
            <div class="flex items-center gap-2">
              ${hasCritique ? `<button type="button" class="r-btn r-btn-outline" data-action="critique" aria-controls="critique" aria-expanded="false">${ICON.split}<span>${esc(T.kritika)}</span></button>` : ''}
              <button type="button" class="r-btn r-btn-icon" data-action="theme" aria-label="Prepnúť svetlý a tmavý režim čítania" title="Svetlý / tmavý režim">${ICON.contrast}</button>
            </div>
          </div>
          <div class="reader-progress" aria-hidden="true"><span></span></div>
        </div>

        <main class="reader-main">
          <header>
            <div class="hero-wrap">
              <figure class="hero-media${a.image && a.fit === 'contain' ? ` hero-media--whole${a.bottom ? ' is-bottom' : ''}` : ''}">
                <img id="hero-img" alt="${esc(a.alt)}" style="view-transition-name: hero-media">
              </figure>
              ${a.credit ? `<p class="hero-credit">${esc(a.credit)}</p>` : ''}
            </div>
            <div class="shell reader-head">
              <h1 class="reader-title${isLongTitle(a) ? ' is-long' : ''}" id="reader-title" tabindex="-1">${esc(a.titulok)}</h1>
              <p class="reader-meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</p>
              ${a.perexHTML ? `<div class="lead offset-text">${a.perexHTML}</div>` : ''}
            </div>
          </header>

          <div class="reader-tabs-wrap">
            <div class="shell">
              <div class="reader-tabs" role="tablist" aria-label="Časti článku">
                ${tabs.map(t => `<button type="button" role="tab" class="tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="panel-${t.id}" aria-selected="false" tabindex="-1">${esc(t.label)}${t.badge}</button>`).join('')}
              </div>
            </div>
          </div>

          <section id="panel-text" class="reader-panel" role="tabpanel" aria-labelledby="tab-text" tabindex="-1">
            <div class="shell reader-grid">
              <aside class="rail rail--toc rail-sticky">
                ${a.toc.length > 1 ? `<nav class="toc" aria-label="Obsah článku"><p class="rail-label">Obsah</p><ul>${tocItems}</ul></nav>` : ''}
              </aside>
              <div class="text-col">
                ${a.toc.length > 1 ? `<details class="toc-mobile"><summary>Obsah článku</summary><ul>${tocItems}</ul></details>` : ''}
                <article class="prose-reader">${a.contentHTML}</article>
                ${afterText}
              </div>
            </div>
          </section>

          ${tasksN ? `
          <section id="panel-ulohy" class="reader-panel" role="tabpanel" aria-labelledby="tab-ulohy" tabindex="-1" hidden>
            <div class="shell reader-grid">
              <aside class="rail rail-sticky">
                <h2 class="sr-only">${esc(T.ulohy)}</h2>
                <p class="tp-count" data-progress-text>0 z ${tasksN} hotových</p>
                <div class="tp-bar" aria-hidden="true"><span></span></div>
                <div class="rail-actions">
                  <button type="button" class="r-btn r-btn-outline" data-action="copy-answers">${ICON.copy}<span>Kopírovať odpovede</span></button>
                  <button type="button" class="r-btn r-btn-link" data-action="clear-answers">Vymazať poznámky</button>
                </div>
                <p class="rail-note">Poznámky sa ukladajú iba v tomto prehliadači. Pred odovzdaním ich skopírujte.</p>
                <p class="copy-status" role="status" aria-live="polite"></p>
              </aside>
              <div class="text-col">
                <ol class="tasks">${taskItems}</ol>
                <div class="copy-fallback" hidden>
                  <label for="copy-box-${esc(a.id)}" class="text-[0.9rem] font-semibold">Text je označený, skopírujte ho klávesmi Ctrl+C (Cmd+C).</label>
                  <textarea id="copy-box-${esc(a.id)}" readonly></textarea>
                </div>
              </div>
            </div>
          </section>` : ''}

          ${a.bibHTML ? `
          <section id="panel-literatura" class="reader-panel" role="tabpanel" aria-labelledby="tab-literatura" tabindex="-1" hidden>
            <div class="shell reader-grid">
              <aside class="rail rail--empty"></aside>
              <div class="text-col biblio prose-reader">
                <h2 class="sr-only">${esc(T.literatura)}</h2>${a.bibHTML}</div>
            </div>
          </section>` : ''}
        </main>
      </div>

      ${hasCritique ? `
      <div class="drawer-scrim" data-action="critique-close" aria-hidden="true"></div>
      <aside id="critique" class="critique" aria-labelledby="critique-title" inert>
        <div class="critique-head">
          <h2 class="critique-title" id="critique-title" tabindex="-1">${esc(T.kritika)}</h2>
          <p class="critique-sub">Námietky a otvorené otázky k textu</p>
          <button type="button" class="r-btn r-btn-icon" data-action="critique-close" aria-label="Zavrieť panel kritiky">${ICON.close}</button>
        </div>
        <div class="critique-body prose-reader prose-compact">${a.critiqueHTML}</div>
        <div class="critique-foot">
          <button type="button" class="r-btn r-btn-outline" data-action="critique-close">Späť k textu</button>
          ${tasksN ? `<button type="button" class="r-btn r-btn-solid" data-action="tab" data-tab="ulohy">Prejsť na úlohy</button>` : ''}
        </div>
      </aside>` : ''}`;
  }


  /* ---------- 10. DETAIL: OTVORENIE, ZATVORENIE, ZÁLOŽKY, KRITIKA ---------- */

  const state = {
    reader: null,          // { a, tab, critique }
    fromGallery: false,    // otvorené klikom v galérii → „Späť“ = history.back()
    critiqueTrigger: null,
    observers: [],
  };

  function renderReader(a) {
    ensureDetail(a);
    const r = els.reader;
    state.observers.forEach(o => o.disconnect());
    state.observers = [];
    r.innerHTML = readerTemplate(a);
    r.scrollTop = 0;
    r.classList.remove('is-critique', 'is-scrolled');

    const theme = store.get('citanie-rezim', null);
    if (theme === 'light' || theme === 'dark') r.dataset.reading = theme;
    else delete r.dataset.reading;

    setImage($('#hero-img', r), a);
    fallbackToCover(r);

    initTasks(a);
    initToc();
    onReaderScroll();
  }

  function focusReaderTitle() {
    $('#reader-title', els.reader)?.focus({ preventScroll: true });
  }

  function canAnimate() {
    return !RM.matches && typeof document.startViewTransition === 'function';
  }

  function openReader(a, { tab = 'text', critique = false, animate = true } = {}) {
    const switching = !!state.reader;
    if (!els.index.hidden) closeIndex({ restoreFocus: false });

    const abs = nearestAbs(a.index);
    if (!switching) snapTo(abs);

    const swap = () => {
      renderReader(a);
      state.reader = { a, tab: 'text', critique: false };
      els.reader.hidden = false;
      els.gallery.inert = true;
      els.gallery.setAttribute('aria-hidden', 'true');
      cancelAnimationFrame(arc.raf); arc.raf = 0;
      setTab(tab, { updateUrl: false });
      if (critique) setCritique(true, { focus: false });
      document.title = `${CFG.nazov} | ${a.titulok}`;
    };

    const cardImg = !switching && arc.pool.get(abs)?.querySelector('img');
    if (animate && cardImg && canAnimate()) {
      cardImg.style.viewTransitionName = 'hero-media';
      const vt = document.startViewTransition(() => { cardImg.style.viewTransitionName = ''; swap(); });
      vt.finished.finally(focusReaderTitle);
    } else {
      if (switching) snapTo(abs);
      swap();
      if (animate && !RM.matches) {
        els.reader.classList.remove('is-entering');
        void els.reader.offsetWidth;
        els.reader.classList.add('is-entering');
      }
      focusReaderTitle();
    }
  }

  function closeReader({ animate = true } = {}) {
    if (!state.reader) return;
    const { a } = state.reader;
    const abs = nearestAbs(a.index);
    const hero = $('#hero-img', els.reader);
    const heroVisible = hero && hero.getBoundingClientRect().bottom > 0;

    const swap = () => {
      state.observers.forEach(o => o.disconnect());
      state.observers = [];
      els.reader.hidden = true;
      els.reader.classList.remove('is-critique', 'is-entering');
      els.reader.innerHTML = '';
      els.gallery.inert = false;
      els.gallery.removeAttribute('aria-hidden');
      state.reader = null;
      document.title = CFG.nazov;
      applyGeometry();
      snapTo(abs);
    };

    const done = () => arc.pool.get(abs)?.focus({ preventScroll: true });

    if (animate && heroVisible && canAnimate()) {
      const vt = document.startViewTransition(() => {
        swap();
        const img = arc.pool.get(abs)?.querySelector('img');
        if (img) img.style.viewTransitionName = 'hero-media';
      });
      vt.finished.finally(() => {
        const img = arc.pool.get(abs)?.querySelector('img');
        if (img) img.style.viewTransitionName = '';
        done();
      });
    } else {
      if (hero) hero.style.viewTransitionName = '';
      swap();
      done();
    }
  }

  function availableTabs() {
    return $$('[role="tab"]', els.reader).map(t => t.dataset.tab);
  }

  function setTab(tab, { updateUrl = true, scroll = false, focusPanel = false } = {}) {
    if (!state.reader) return;
    const r = els.reader;
    const tabs = availableTabs();
    if (!tabs.includes(tab)) tab = 'text';
    state.reader.tab = tab;

    $$('[role="tab"]', r).forEach(t => {
      const on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    TABS.forEach(id => { const p = $(`#panel-${id}`, r); if (p) p.hidden = id !== tab; });

    if (scroll) {
      const wrap = $('.reader-tabs-wrap', r);
      const barH = $('.reader-bar', r).offsetHeight;
      const top = wrap.offsetTop - barH;
      if (r.scrollTop > top) r.scrollTo({ top, behavior: RM.matches ? 'auto' : 'smooth' });
    }
    if (focusPanel) $(`#panel-${tab}`, r)?.focus({ preventScroll: true });
    if (updateUrl) replaceHash(state.reader.a.id, tab);
    onReaderScroll();
  }

  function setCritique(open, { focus = true } = {}) {
    if (!state.reader) return;
    const r = els.reader;
    const drawer = $('#critique', r);
    if (!drawer) return;
    state.reader.critique = open;
    r.classList.toggle('is-critique', open);
    drawer.inert = !open;
    $$('[data-action="critique"]', r).forEach(b => b.setAttribute('aria-expanded', String(open)));
    syncCritiqueMode();
    if (open && focus) $('#critique-title', r).focus({ preventScroll: true });
    if (!open && focus && state.critiqueTrigger?.isConnected) state.critiqueTrigger.focus({ preventScroll: true });
  }

  /** Úzka obrazovka: panel prekrýva text (modálne). Široká: panel stojí vedľa textu. */
  function syncCritiqueMode() {
    if (!state.reader) return;
    const r = els.reader;
    const drawer = $('#critique', r);
    if (!drawer) return;
    const overlay = state.reader.critique && !DOCK.matches;
    $('.reader-body', r).inert = overlay;
    drawer.setAttribute('role', overlay ? 'dialog' : 'complementary');
    if (overlay) drawer.setAttribute('aria-modal', 'true');
    else drawer.removeAttribute('aria-modal');
  }
  DOCK.addEventListener?.('change', syncCritiqueMode);

  function toggleTheme() {
    const r = els.reader;
    const current = getComputedStyle(r).getPropertyValue('--scheme').trim() || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    r.dataset.reading = next;
    store.set('citanie-rezim', next);
  }

  function onReaderScroll() {
    const r = els.reader;
    if (!state.reader) return;
    const max = r.scrollHeight - r.clientHeight;
    r.style.setProperty('--progress', max > 0 ? (r.scrollTop / max).toFixed(4) : '0');
    const title = $('#reader-title', r);
    if (title) r.classList.toggle('is-scrolled', title.getBoundingClientRect().bottom < 60);
    updateToc();
  }
  els.reader.addEventListener('scroll', onReaderScroll, { passive: true });

  /* Obsah v okraji: aktívna je posledná kapitola, ktorej nadpis prešiel nad
     tretinu obrazovky. Na konci textu je aktívna vždy posledná kapitola
     (aj keď je krátka a jej nadpis sa k hornému okraju nedostane). */
  function initToc() {
    state.tocHeads = $$('#panel-text .prose-reader h2[id]', els.reader);
    state.tocCurrent = null;
    updateToc();
  }

  function updateToc() {
    const r = els.reader;
    const heads = state.tocHeads || [];
    if (heads.length < 2 || $('#panel-text', r)?.hidden) return;
    const line = r.clientHeight * 0.32;
    let current = heads[0];
    for (const h of heads) {
      if (h.getBoundingClientRect().top <= line) current = h;
      else break;
    }
    const text = $('#panel-text .prose-reader', r);
    if (text && text.getBoundingClientRect().bottom <= r.clientHeight) current = heads[heads.length - 1];
    if (current.id === state.tocCurrent) return;
    state.tocCurrent = current.id;
    $$('[data-action="toc"]', r).forEach(b => b.setAttribute('aria-current', String(b.dataset.target === current.id)));
  }

  // Delegované akcie v detaile
  els.reader.addEventListener('click', e => {
    const el = e.target.closest('[data-action], [role="tab"]');
    if (!el || !state.reader) return;
    if (el.getAttribute('role') === 'tab') { setTab(el.dataset.tab, { scroll: true }); return; }

    switch (el.dataset.action) {
      case 'close': navigateHome(); break;
      case 'theme': toggleTheme(); break;
      case 'critique':
        state.critiqueTrigger = el;
        setCritique(!state.reader.critique);
        break;
      case 'critique-close': setCritique(false); break;
      case 'tab':
        if (state.reader.critique && !DOCK.matches) setCritique(false, { focus: false });
        setTab(el.dataset.tab, { scroll: true, focusPanel: true });
        break;
      case 'toc': {
        const target = $(`#${CSS.escape(el.dataset.target)}`, els.reader);
        if (target) {
          target.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'start' });
          el.closest('details')?.removeAttribute('open');
        }
        break;
      }
      case 'open': navigateTo(el.dataset.id); break;
      case 'copy-answers': copyAnswers(el); break;
      case 'clear-answers': clearAnswers(el); break;
      default: break;
    }
  });

  function readerKeydown(e) {
    if (e.key === 'Escape') {
      if (state.reader.critique) { e.preventDefault(); setCritique(false); }
      else if (!e.target.closest('textarea, input')) { e.preventDefault(); navigateHome(); }
      return;
    }
    const tab = e.target.closest('[role="tab"]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const tabs = availableTabs();
      const i = tabs.indexOf(tab.dataset.tab);
      const next = tabs[mod(i + (e.key === 'ArrowRight' ? 1 : -1), tabs.length)];
      setTab(next);
      $(`#tab-${next}`, els.reader)?.focus();
    }
  }


  /* ---------- 11. DETAIL: ÚLOHY A KVÍZ ------------------------------------- */

  const taskKey = a => `ulohy:${a.id}`;
  const loadTasks = a => Object.assign({ notes: {}, done: {}, quiz: {} }, store.get(taskKey(a), {}));

  function initTasks(a) {
    const r = els.reader;
    const panel = $('#panel-ulohy', r);
    if (!panel) return;
    const saved = loadTasks(a);
    let timer = 0;

    const persist = () => store.set(taskKey(a), saved);

    $$('.task', panel).forEach(li => {
      const i = li.dataset.i;
      const t = a.tasks[Number(i)];

      if (t.type === 'open') {
        const note = $('textarea', li);
        const check = $('input[type="checkbox"]', li);
        const flag = $('.task-saved', li);
        note.value = saved.notes[i] || '';
        check.checked = !!saved.done[i];
        li.classList.toggle('is-done', check.checked);
        autosize(note);

        note.addEventListener('input', () => {
          autosize(note);
          saved.notes[i] = note.value;
          clearTimeout(timer);
          timer = setTimeout(() => {
            persist();
            flag.classList.add('is-on');
            setTimeout(() => flag.classList.remove('is-on'), 1400);
          }, 400);
        });
        check.addEventListener('change', () => {
          saved.done[i] = check.checked;
          li.classList.toggle('is-done', check.checked);
          persist();
          updateProgress(a, saved);
        });
      } else {
        const fb = $('.quiz-feedback', li);
        const show = (k, announce) => {
          const right = k === t.correct;
          $$('.quiz-opt', li).forEach((opt, j) => {
            opt.classList.toggle('is-right', right && j === k);
            opt.classList.toggle('is-wrong', !right && j === k);
          });
          fb.className = `quiz-feedback ${right ? 'is-right' : 'is-wrong'}`;
          fb.innerHTML = right
            ? `<strong>Správne.</strong> ${t.explain ? `<span class="prose-reader prose-compact">${t.explain}</span>` : ''}`
            : `<strong>Nie celkom.</strong> Skúste inú možnosť.`;
          if (!announce) fb.setAttribute('aria-live', 'off');
          else fb.setAttribute('aria-live', 'polite');
          li.classList.toggle('is-done', right);
        };
        if (Number.isInteger(saved.quiz[i])) {
          const radio = $(`input[value="${saved.quiz[i]}"]`, li);
          if (radio) { radio.checked = true; show(saved.quiz[i], false); }
        }
        $$('input[type="radio"]', li).forEach(radio => radio.addEventListener('change', () => {
          const k = Number(radio.value);
          saved.quiz[i] = k;
          saved.done[i] = k === t.correct;
          persist();
          show(k, true);
          updateProgress(a, saved);
        }));
      }
    });
    updateProgress(a, saved);
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight + 2, 112)}px`;
  }

  function updateProgress(a, saved) {
    const r = els.reader;
    const total = a.tasks.length;
    const done = a.tasks.filter((_, i) => saved.done[i]).length;
    const text = $('[data-progress-text]', r);
    if (text) text.textContent = `${done} z ${total} hotových`;
    $('.tp-bar', r)?.style.setProperty('--done-ratio', total ? (done / total).toFixed(3) : '0');
    const badge = $('[data-badge="ulohy"]', r);
    if (badge) badge.textContent = `${done}/${total}`;
  }

  function answersText(a) {
    const saved = loadTasks(a);
    const lines = [`${a.titulok}`, `Úlohy — odpovede`, ''];
    a.tasks.forEach((t, i) => {
      lines.push(`Úloha ${i + 1}${saved.done[i] ? ' (hotovo)' : ''}`);
      lines.push(textOf(t.html));
      lines.push('');
      if (t.type === 'quiz') {
        const k = saved.quiz[i];
        lines.push(`Moja odpoveď: ${Number.isInteger(k) ? textOf(t.options[k]) : '(bez odpovede)'}`);
      } else {
        lines.push('Moja odpoveď:');
        lines.push((saved.notes[i] || '').trim() || '(bez odpovede)');
      }
      lines.push('', '---', '');
    });
    return lines.join('\n');
  }

  function copyAnswers(btn) {
    const a = state.reader.a;
    const text = answersText(a);
    const status = $('.copy-status', els.reader);
    const fallback = () => {
      const box = $('.copy-fallback', els.reader);
      const ta = $('textarea', box);
      ta.value = text;
      box.hidden = false;
      ta.focus();
      ta.select();
      status.textContent = '';
    };
    try {
      navigator.clipboard.writeText(text).then(() => {
        status.textContent = 'Odpovede sú skopírované. Vložte ich do e-mailu alebo dokumentu.';
        setTimeout(() => { if (status.isConnected) status.textContent = ''; }, 5000);
      }, fallback);
    } catch { fallback(); }
    btn.blur();
  }

  function clearAnswers(btn) {
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'Naozaj vymazať?';
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove('is-armed');
        btn.textContent = 'Vymazať poznámky';
      }, 4000);
      return;
    }
    const { a, tab } = state.reader;
    store.remove(taskKey(a));
    const top = els.reader.scrollTop;
    renderReader(a);
    setTab(tab, { updateUrl: false });
    els.reader.scrollTop = top;
    const status = $('.copy-status', els.reader);
    if (status) status.textContent = 'Poznámky sú vymazané.';
  }


  /* ---------- 12. SMEROVANIE A ŠTART --------------------------------------- */

  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!h) return null;
    const [id, sub] = h.split('~');
    return { id: slugify(id), sub: sub || '' };
  }

  function replaceHash(id, tab) {
    const hash = `#${id}${tab && tab !== 'text' ? `~${tab}` : ''}`;
    if (location.hash === hash) return;
    try { history.replaceState(null, '', hash); } catch { /* file:// v niektorých prehliadačoch */ }
  }

  function navigateTo(id) {
    state.fromGallery = !state.reader;
    if (location.hash === `#${id}`) route();
    else location.hash = id;
  }

  function navigateHome() {
    if (state.fromGallery) {
      state.fromGallery = false;
      history.back();
    } else {
      try { history.pushState(null, '', location.pathname + location.search); }
      catch { location.hash = ''; return; }   // hashchange zavolá route()
      route();
    }
  }

  let booted = false;
  function route() {
    const r = parseHash();
    const a = r && byId.get(r.id);
    const animate = booted;

    if (a && !a.draft) {
      const tab = TABS.includes(r.sub) ? r.sub : 'text';
      const critique = r.sub === 'kritika';
      if (!state.reader || state.reader.a !== a) openReader(a, { tab, critique, animate });
      else if (state.reader.tab !== tab) setTab(tab, { updateUrl: false });
    } else {
      if (r && !a) console.warn(`[Čítania] Článok s ID „${r.id}“ neexistuje.`);
      if (a && a.draft && !state.reader) snapTo(nearestAbs(a.index));
      if (state.reader) closeReader({ animate });
      state.fromGallery = false;
    }
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  function boot() {
    // Texty rozhrania z konfigurácie
    $$('[data-bind]').forEach(el => {
      const key = el.dataset.bind;
      const value = key === 'nazov' ? CFG.nazov : T[key];
      if (value) el.textContent = value;
    });
    document.title = CFG.nazov;

    applyGeometry();

    if (!N) {
      els.gallery.classList.add('is-empty');
      els.title.textContent = 'Zatiaľ tu nie sú žiadne články';
      els.perex.textContent = 'Pridajte prvý článok do poľa CLANKY v súbore clanky.js.';
      els.open.hidden = true;
      return;
    }

    const deepLink = parseHash();
    arc.entrance = deepLink || RM.matches ? 1 : 0;
    renderArc();
    updateFocus(true);
    route();
    booted = true;
    kick();
  }

  boot();
})();
