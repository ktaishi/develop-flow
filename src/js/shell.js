/* 共通シェル：メニュー、テーマ、ページ内目次、検索、Markdown コピー */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var main = $("#main-content");

  /* ---- モバイルメニュー */
  var side = $("#sidebar"), toggle = $("#menu-toggle"), backdrop = $("#nav-backdrop");
  function setMenu(open) {
    if (!side) return;
    side.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-visible", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
  }
  if (toggle) toggle.addEventListener("click", function () { setMenu(!side.classList.contains("is-open")); });
  if (backdrop) backdrop.addEventListener("click", function () { setMenu(false); });
  $$("#sidebar a").forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
  var cur = $('#sidebar a[aria-current="page"]');
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "center" });

  /* ---- 折りたたみ見出しをハッシュで開く（旧アンカーの読み替えを含む） */
  var HASH_ALIASES = { "21-wiki": "memo-hub", "4-0": "phase-1", "5-1-plan": "phase-2-plan", "6-2-db-1": "phase-3-design",
    "7-3-tdd": "phase-4-core", "8-4-tdd": "phase-5-app", "9-5-if": "phase-6-crosscut", "10-6-pr": "phase-7-pr",
    "17-tdd-plan": "rules-plan", "111": "11-1-directory", "112-gitignore": "11-2-gitignore", "115-cicd-aws": "11-5-cicd",
    "116-docs-z_docs": "11-6-docs-z-docs", "116-tasks": "11-6-tasks", "117-adr": "11-7-adr",
    "117-adr-architecture-decision-records": "11-7-adr" };
  function openForHash() {
    var raw = decodeURIComponent((location.hash || "").slice(1));
    var el = document.getElementById(HASH_ALIASES[raw] || raw);
    if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    var fold = el.closest("details");
    if (fold) fold.open = true;
    if (HASH_ALIASES[raw]) el.scrollIntoView();
  }
  openForHash();
  window.addEventListener("hashchange", openForHash);

  /* ---- テーマ */
  var THEME_KEY = "develop-flow:theme";
  var btnTheme = $("#btn-theme");
  if (btnTheme) btnTheme.addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (_e) {}
    document.dispatchEvent(new CustomEvent("themechange", { detail: next }));
  });

  /* ---- 見出しアンカーとページ内目次 */
  var rail = $("#rail-toc");
  if (main && rail) {
    var n = 0;
    var heads = $$("h2, h3", main).filter(function (h) {
      return !h.closest(".playbook-hub, [hidden], .site-panel, .rule-sample, .info-panel") && h.textContent.trim();
    });
    heads.forEach(function (h) {
      if (!h.id) h.id = "s-" + (++n);
      if (h.closest(".hb") && !h.querySelector(".hb-anchor")) {
        var a = document.createElement("a");
        a.className = "hb-anchor"; a.href = "#" + h.id; a.textContent = "#";
        a.setAttribute("aria-label", "この見出しへのリンク");
        h.appendChild(a);
      }
    });
    var h2count = heads.filter(function (h) { return h.tagName === "H2"; }).length;
    var list = heads.filter(function (h) { return h2count >= 2 ? true : h.tagName === "H3" || h.tagName === "H2"; });
    if (list.length > 40) list = list.filter(function (h) { return h.tagName === "H2"; });
    if (list.length < 2) {
      rail.closest(".rail").classList.add("rail--empty");
    } else {
      var links = {};
      list.forEach(function (h) {
        var li = document.createElement("li");
        li.className = h.tagName === "H3" ? "l3" : "l2";
        var a = document.createElement("a");
        a.href = "#" + h.id;
        a.textContent = h.textContent.replace(/#$/, "").trim();
        li.appendChild(a); rail.appendChild(li); links[h.id] = a;
      });
      if ("IntersectionObserver" in window) {
        var on = null;
        var io = new IntersectionObserver(function (es) {
          es.forEach(function (e) {
            if (!e.isIntersecting) return;
            if (on) on.classList.remove("on");
            on = links[e.target.id];
            if (on) on.classList.add("on");
          });
        }, { rootMargin: "-80px 0px -70% 0px" });
        list.forEach(function (h) { io.observe(h); });
      }
    }
  }


  /* ---- Mermaid 図（図があるページだけ、自前配信の mermaid を読み込む） */
  var diagrams = $$(".mermaid");
  if (diagrams.length) {
    var sources = diagrams.map(function (b) { return b.textContent; });
    var draw = function () {
      if (!window.mermaid) return;
      diagrams.forEach(function (b, i) { b.removeAttribute("data-processed"); b.textContent = sources[i]; });
      window.mermaid.initialize({ startOnLoad: false, securityLevel: "strict",
        theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "neutral", fontFamily: "inherit" });
      window.mermaid.run({ nodes: diagrams });
    };
    var sc = document.createElement("script");
    sc.src = "/assets/vendor/mermaid.min.js";
    sc.onload = draw;
    document.head.appendChild(sc);
    document.addEventListener("themechange", draw);
  }

  /* ---- トースト */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("is-on");
    clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2200);
  }

  /* ---- 本文を Markdown としてコピー（AI に渡す用） */
  function md(node, ctx) {
    if (node.nodeType === 3) return ctx.pre ? node.nodeValue : node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    var t = node.tagName, kids = function (c) { return Array.prototype.map.call(node.childNodes, function (k) { return md(k, c || ctx); }).join(""); };
    if (node.hidden || /^(SCRIPT|STYLE|BUTTON|NAV|SVG|INPUT|SELECT|TEXTAREA)$/.test(t) || node.classList.contains("hb-anchor") || node.classList.contains("pager")) return "";
    if (/^H[1-6]$/.test(t)) return "\n\n" + "#".repeat(+t[1]) + " " + kids().trim() + "\n\n";
    if (t === "P" || t === "FIGCAPTION" || t === "SUMMARY" || t === "DT") return "\n\n" + kids().trim() + "\n\n";
    if (t === "BR") return "\n";
    if (t === "STRONG" || t === "B") return "**" + kids().trim() + "**";
    if (t === "CODE") return ctx.pre ? node.textContent : "`" + node.textContent + "`";
    if (t === "PRE") return "\n\n```\n" + node.textContent.replace(/\n+$/, "") + "\n```\n\n";
    if (t === "A") { var h = node.getAttribute("href") || ""; var x = kids().trim(); return x ? (h && h[0] !== "#" ? "[" + x + "](" + new URL(h, location.href).href + ")" : x) : ""; }
    if (t === "LI") { var ol = node.parentNode.tagName === "OL"; return "\n" + (ol ? "1. " : "- ") + kids().trim().replace(/\n+/g, "\n  "); }
    if (t === "UL" || t === "OL") return "\n" + kids() + "\n\n";
    if (t === "TR") { var cells = Array.prototype.map.call(node.children, function (c) { return md(c, ctx).replace(/\s*\n\s*/g, " ").trim(); });
      var row = "\n| " + cells.join(" | ") + " |";
      if (node.parentNode.tagName === "THEAD") row += "\n|" + cells.map(function () { return " --- |"; }).join("");
      return row; }
    if (t === "TABLE") return "\n" + kids() + "\n\n";
    if (t === "IMG") return node.alt ? "（図：" + node.alt + "）" : "";
    if (t === "DD" || t === "DIV" || t === "SECTION" || t === "ARTICLE" || t === "BLOCKQUOTE" || t === "DETAILS" || t === "FIGURE" || t === "ASIDE") return "\n" + kids() + "\n";
    return kids();
  }
  var btnMd = $("#btn-copy-md");
  if (btnMd && main) btnMd.addEventListener("click", function () {
    var text = md(main, {}).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n\n出典: " + location.href.split("#")[0] + "\n";
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { toast("Markdown をコピーしました"); },
      function () { toast("コピーできませんでした。ブラウザの権限を確認してください"); });
  });

  /* ---- 検索 */
  var box = $("#search"), input = $("#search-input"), listEl = $("#search-list"), index = null, sel = 0, lastFocus = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mark(s, q) { var i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); }
  function render() {
    var q = input.value.trim().toLowerCase();
    if (!index) { listEl.innerHTML = '<li class="search__empty">索引を読み込んでいます…</li>'; return; }
    var terms = q.split(/\s+/).filter(Boolean), out = [];
    index.forEach(function (p) {
      var score = 0, hit = "", ok = terms.every(function (t) {
        var s = 0;
        if (p.t.toLowerCase().indexOf(t) >= 0) s += 10;
        var h = p.h.filter(function (x) { return x[1].toLowerCase().indexOf(t) >= 0; })[0];
        if (h) { s += 5; if (!hit) hit = h; }
        if (p.x.toLowerCase().indexOf(t) >= 0) s += 1;
        score += s; return s > 0;
      });
      if (!terms.length) { ok = !!p.top; score = 1; }
      if (ok) out.push({ p: p, score: score, hit: hit });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    out = out.slice(0, 12); sel = 0;
    if (!out.length) { listEl.innerHTML = '<li class="search__empty">「' + esc(input.value) + '」に一致するページはありません。別の言い方（例：Skills、Phase、PR）で試してください。</li>'; return; }
    listEl.innerHTML = out.map(function (o, i) {
      var p = o.p, url = p.u + (o.hit ? "#" + o.hit[0] : ""), sub = o.hit ? o.hit[1] : p.d;
      if (!o.hit && terms.length) { var k = p.x.toLowerCase().indexOf(terms[0]); if (k >= 0) sub = "…" + p.x.slice(Math.max(0, k - 20), k + 60) + "…"; }
      return '<li><a href="' + esc(url) + '" aria-selected="' + (i === 0) + '"><b>' + mark(p.t, terms[0] || "\u0000") + ' <small style="display:inline">— ' + esc(p.g) + "</small></b><small>" + mark(sub || "", terms[0] || "\u0000") + "</small></a></li>";
    }).join("");
  }
  function openSearch() {
    if (!box) return;
    lastFocus = document.activeElement;
    box.classList.add("is-open"); input.value = ""; input.focus(); render();
    if (!index) fetch("/assets/search-index.json").then(function (r) { return r.json(); }).then(function (j) { index = j; render(); })
      .catch(function () { listEl.innerHTML = '<li class="search__empty">索引を読み込めませんでした。ページを再読み込みしてください。</li>'; });
  }
  function closeSearch() { box.classList.remove("is-open"); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  if (box) {
    $("#btn-search").addEventListener("click", openSearch);
    box.addEventListener("click", function (e) { if (e.target === box) closeSearch(); });
    input.addEventListener("input", render);
    input.addEventListener("keydown", function (e) {
      var items = $$("a", listEl);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!items.length) return;
        items[sel].setAttribute("aria-selected", "false");
        sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        items[sel].setAttribute("aria-selected", "true"); items[sel].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && items[sel]) { location.href = items[sel].href; closeSearch(); }
    });
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); box.classList.contains("is-open") ? closeSearch() : openSearch(); }
      else if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); openSearch(); }
      else if (e.key === "Escape") { if (box.classList.contains("is-open")) closeSearch(); setMenu(false); }
    });
  }
})();
