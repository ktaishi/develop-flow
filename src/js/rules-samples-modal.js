/**
 * flow-rules-samples.html — open #sample-* links in a modal instead of in-page scroll.
 */
(function () {
  var STORE_ID = "rule-sample-store";
  var MODAL_ID = "rule-sample-modal";
  var SAMPLE_LINK = 'a[href^="#sample-"]';

  if (!document.getElementById(STORE_ID) && !document.querySelector(SAMPLE_LINK)) {
    return;
  }

  if (location.hash && /^#sample-/.test(location.hash)) {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }

  var modal;
  var shell;
  var titleEl;
  var bodyEl;
  var closeBtn;
  var lastFocus;
  var lastOpenedId = "";

  function ensureModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "rule-sample-modal";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<div class="rule-sample-modal__shell" role="dialog" aria-modal="true" aria-labelledby="rule-sample-modal-title">' +
      '<div class="rule-sample-modal__header">' +
      '<h2 class="rule-sample-modal__title" id="rule-sample-modal-title"></h2>' +
      '<button type="button" class="rule-sample-modal__close modal-close-button">閉じる</button>' +
      "</div>" +
      '<div class="rule-sample-modal__body flow-body"></div>' +
      "</div>";
    document.body.appendChild(modal);
    shell = modal.querySelector(".rule-sample-modal__shell");
    titleEl = modal.querySelector(".rule-sample-modal__title");
    bodyEl = modal.querySelector(".rule-sample-modal__body");
    closeBtn = modal.querySelector(".rule-sample-modal__close");
    closeBtn.setAttribute("aria-label", "ルールサンプルモーダルを閉じる");

    closeBtn.addEventListener("click", close);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal && !modal.hidden) close();
    });
  }

  function decorateCopyButtons(root) {
    if (window.SiteCodeCopy && window.SiteCodeCopy.decorateRoot) {
      window.SiteCodeCopy.decorateRoot(root);
    }
  }

  function sampleTitle(section) {
    var link = section.querySelector(".rule-sample__title .toclink");
    if (link) return link.textContent.replace(/\s+/g, " ").trim();
    var h = section.querySelector(".rule-sample__title");
    return h ? h.textContent.replace(/\s+/g, " ").trim() : section.id;
  }

  function fillBody(section) {
    bodyEl.innerHTML = "";
    section.querySelectorAll(":scope > *").forEach(function (node) {
      if (node.classList && node.classList.contains("rule-sample__title")) return;
      bodyEl.appendChild(node.cloneNode(true));
    });
    decorateCopyButtons(bodyEl);
  }

  function open(id, options) {
    options = options || {};
    var section = document.getElementById(id);
    if (!section || !section.classList.contains("rule-sample")) return false;

    ensureModal();
    lastOpenedId = id;
    titleEl.textContent = sampleTitle(section);
    fillBody(section);

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("rule-sample-modal-open");
    lastFocus = document.activeElement;
    closeBtn.focus();

    if (options.updateHash !== false && history.replaceState) {
      history.replaceState(null, "", "#" + id);
    }
    return true;
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("rule-sample-modal-open");
    lastOpenedId = "";
    if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    }
    if (history.replaceState) {
      var base = location.pathname + location.search;
      history.replaceState(null, "", base);
    }
  }

  function isSampleHash(hash) {
    return hash && /^#sample-/.test(hash);
  }

  function handleSampleLinkClick(e) {
    var link = e.target.closest(SAMPLE_LINK);
    if (!link || link.closest("#" + MODAL_ID)) return;
    var id = (link.getAttribute("href") || "").slice(1);
    if (!id || !document.getElementById(id)) return;
    e.preventDefault();
    open(id);
  }

  document.addEventListener("click", handleSampleLinkClick);

  window.addEventListener("hashchange", function () {
    var hash = location.hash;
    if (!isSampleHash(hash)) {
      if (modal && !modal.hidden) close();
      return;
    }
    var id = hash.slice(1);
    if (id !== lastOpenedId) open(id, { updateHash: false });
  });

  function boot() {
    var hash = location.hash;
    if (isSampleHash(hash)) {
      open(hash.slice(1), { updateHash: false });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
