/**
 * Add a copy button (top-right) to every code block <pre> in doc content areas.
 */
(function () {
  var ROOT_SEL =
    ".flow-body, .memo-content, .memo-body, .memo-ref-content, .markdown-body";

  function copyText(btn, text) {
    function done() {
      btn.textContent = "✓ コピー済み";
      btn.classList.add("copied");
      btn.setAttribute("aria-label", "コピーしました");
      window.setTimeout(function () {
        btn.textContent = "コピー";
        btn.classList.remove("copied");
        btn.setAttribute("aria-label", "コードをコピー");
      }, 2000);
    }

    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (e) {
        /* ignore */
      }
      document.body.removeChild(ta);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function preText(pre) {
    var code = pre.querySelector("code");
    return ((code && code.textContent) || pre.textContent || "").trim();
  }

  function shouldWrap(pre) {
    if (!pre.closest(ROOT_SEL)) return false;
    if (pre.closest(".code-copy-wrap")) return false;
    return preText(pre).length > 0;
  }

  function wrapPre(pre) {
    var wrap = document.createElement("div");
    wrap.className = "code-copy-wrap";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy-btn";
    btn.textContent = "コピー";
    btn.setAttribute("aria-label", "コードをコピー");
    btn.addEventListener("click", function () {
      copyText(btn, preText(pre));
    });
    wrap.appendChild(btn);
  }

  function hideLegacyBpCopy(root) {
    root.querySelectorAll(".bp-header .bp-copy-btn").forEach(function (btn) {
      btn.hidden = true;
      btn.setAttribute("aria-hidden", "true");
      btn.tabIndex = -1;
    });
  }

  function decorateRoot(root) {
    if (!root) return;
    root.querySelectorAll("pre").forEach(function (pre) {
      if (shouldWrap(pre)) wrapPre(pre);
    });
    hideLegacyBpCopy(root);
  }

  function init() {
    document.querySelectorAll(ROOT_SEL).forEach(decorateRoot);
  }

  window.SiteCodeCopy = { decorateRoot: decorateRoot };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
