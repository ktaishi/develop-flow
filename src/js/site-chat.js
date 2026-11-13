/* global fetch, sessionStorage */
(function () {
  "use strict";

  var CHAT_HISTORY_KEY = "develop-flow:chat-history:v1";
  var MAX_HISTORY = 20;
  var FOCUSABLE_SEL =
    'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  var panel = null;
  var messagesEl = null;
  var inputEl = null;
  var sendBtn = null;
  var fab = null;
  var backdrop = null;
  var isOpen = false;
  var isStreaming = false;

  function getPrefsApi() {
    return window.SitePrefs || null;
  }

  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_e) {
      return [];
    }
  }

  function saveHistory(messages) {
    try {
      sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
    } catch (_e) {
      /* ignore */
    }
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/\n/g, "<br>");
  }

  /* サイト内ページ（例: guide-setup.html#0-quick）だけをリンクにする */
  var SAFE_HREF = /^[a-z0-9][a-z0-9-]*\.html(?:#[A-Za-z0-9_-]+)?$/;

  function linkifyAnswer(text) {
    var out = "";
    var re = /\[([^\]\n]{1,120})\]\(([^)\s]{1,200})\)/g;
    var last = 0, m;
    text = String(text);
    while ((m = re.exec(text))) {
      out += escHtml(text.slice(last, m.index));
      out += SAFE_HREF.test(m[2])
        ? '<a href="' + escHtml(m[2]) + '">' + escHtml(m[1]) + "</a>"
        : escHtml(m[0]);
      last = re.lastIndex;
    }
    return out + escHtml(text.slice(last));
  }

  function getPageText() {
    var container = document.querySelector(".flow-body, .memo-content, .hub-landing");
    if (!container) return "";
    var text = container.innerText || "";
    if (text.length > 12000) text = text.slice(0, 12000) + "\n…（省略）";
    return text;
  }

  function buildSystemPrompt(index, prefs) {
    var chapterList = (index.chapters || [])
      .slice(0, 60)
      .map(function (c) {
        return "- " + c.page + ": " + c.title + " (" + c.category + ", " + c.docKind + ")";
      })
      .join("\n");
    return (
      "あなたは「AI利用開発フロー」ドキュメントサイトのアシスタントです。日本語で簡潔に答えてください。\n" +
      "回答では関連ページへ [タイトル](ファイル名.html#id) 形式で誘導してください。\n" +
      "不明な点は推測せず、サイト内の章を案内してください。\n\n" +
      "ユーザー役割: " +
      prefs.role +
      "\n目的: " +
      prefs.goal +
      "\n\n章一覧:\n" +
      chapterList
    );
  }

  function renderMessages(messages) {
    if (!messagesEl) return;
    messagesEl.innerHTML = messages
      .map(function (m) {
        return (
          '<div class="site-chat-msg site-chat-msg--' +
          escHtml(m.role === "user" ? "user" : "assistant") +
          '">' +
          (m.role === "assistant" ? linkifyAnswer(m.content) : escHtml(m.content)) +
          "</div>"
        );
      })
      .join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function getFocusables() {
    if (!panel) return [];
    return Array.prototype.slice.call(panel.querySelectorAll(FOCUSABLE_SEL));
  }

  function onPanelKeydown(e) {
    if (!isOpen || e.key !== "Tab") return;
    var focusables = getFocusables();
    if (focusables.length < 2) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !panel.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function restoreFocus() {
    if (!fab) return;
    try {
      fab.focus();
    } catch (_e) {
      /* ignore */
    }
  }

  function togglePanel(open) {
    isOpen = open === undefined ? !isOpen : open;
    if (panel) {
      panel.classList.toggle("is-open", isOpen);
      panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }
    if (backdrop) backdrop.classList.toggle("is-open", isOpen);
    if (fab) fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
    document.body.classList.toggle("site-chat-open", isOpen);

    if (isOpen) {
      if (inputEl) inputEl.focus();
      return;
    }

    restoreFocus();
  }

  function sendMessage() {
    if (isStreaming || !inputEl) return;
    var text = inputEl.value.trim();
    if (!text) return;

    var api = getPrefsApi();
    if (!api) return;
    var key = api.getOpenAiKey();
    if (!key) {
      alert("OpenAI API キーを設定してください（設定パネル）。");
      return;
    }

    var prefs = api.getPrefs();
    var messages = loadHistory();
    messages.push({ role: "user", content: text });
    renderMessages(messages);
    inputEl.value = "";
    isStreaming = true;
    if (sendBtn) sendBtn.disabled = true;

    api.fetchSiteIndex().then(function (index) {
      var pageText = getPageText();
      var apiMessages = [
        { role: "system", content: buildSystemPrompt(index, prefs) },
        {
          role: "user",
          content:
            "現在のページ: " +
            api.currentPage() +
            "\n\n現在ページの本文（抜粋）:\n" +
            pageText +
            "\n\n質問: " +
            text,
        },
      ];

      return fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: (prefs.openai && prefs.openai.model) || "gpt-6-luna",
          stream: true,
          messages: apiMessages,
        }),
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error("OpenAI " + res.status + ": " + t.slice(0, 200));
          });
        }
        if (!res.body || !res.body.getReader) {
          return res.json().then(function (data) {
            var reply =
              (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
              "（応答なし）";
            messages.push({ role: "assistant", content: reply });
            saveHistory(messages);
            renderMessages(messages);
          });
        }

        messages.push({ role: "assistant", content: "" });
        renderMessages(messages);
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";

        function pump() {
          return reader.read().then(function (result) {
            if (result.done) {
              saveHistory(messages);
              return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            var lines = buffer.split("\n");
            buffer = lines.pop() || "";
            lines.forEach(function (line) {
              if (!line.startsWith("data: ")) return;
              var payload = line.slice(6).trim();
              if (payload === "[DONE]") return;
              try {
                var parsed = JSON.parse(payload);
                var delta =
                  parsed.choices &&
                  parsed.choices[0] &&
                  parsed.choices[0].delta &&
                  parsed.choices[0].delta.content;
                if (delta) {
                  messages[messages.length - 1].content += delta;
                  renderMessages(messages);
                }
              } catch (_e) {
                /* skip malformed chunk */
              }
            });
            return pump();
          });
        }
        return pump();
      });
    })
      .catch(function (err) {
        messages.push({
          role: "assistant",
          content: "エラー: " + (err.message || String(err)),
        });
        saveHistory(messages);
        renderMessages(messages);
      })
      .finally(function () {
        isStreaming = false;
        if (sendBtn) sendBtn.disabled = false;
      });
  }

  function createUi() {
    if (document.body.classList.contains("page-shell--ai-news")) return;
    if (document.getElementById("site-chat-fab")) return;

    document.body.classList.add("site-chat-enabled");

    fab = document.createElement("button");
    fab.type = "button";
    fab.id = "site-chat-fab";
    fab.className = "site-chat-fab";
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-controls", "site-chat-panel");
    fab.setAttribute("aria-haspopup", "dialog");
    fab.textContent = "AI 質問";

    backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.id = "site-chat-backdrop";
    backdrop.className = "site-chat-backdrop";
    backdrop.setAttribute("aria-label", "チャットを閉じる");
    backdrop.setAttribute("tabindex", "-1");

    panel = document.createElement("div");
    panel.id = "site-chat-panel";
    panel.className = "site-chat-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "ドキュメント AI チャット");
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML =
      '<div class="site-chat-header">' +
      '<div class="site-panel__title" style="margin:0;padding:0">ドキュメント AI チャット</div>' +
      '<button type="button" class="site-chat-close" id="site-chat-close" aria-label="閉じる">×</button>' +
      "</div>" +
      '<p class="site-panel__hint" style="padding:0 0.75rem;margin:0.25rem 0 0">キーは端末内のみ保存。OpenAI に直接送信されます。</p>' +
      '<div class="site-chat-messages" id="site-chat-messages"></div>' +
      '<div class="site-chat-input-row">' +
      '<textarea id="site-chat-input" rows="2" placeholder="このドキュメントについて質問…"></textarea>' +
      '<button type="button" id="site-chat-send">送信</button>' +
      "</div>";

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    document.body.appendChild(fab);

    messagesEl = document.getElementById("site-chat-messages");
    inputEl = document.getElementById("site-chat-input");
    sendBtn = document.getElementById("site-chat-send");
    var closeBtn = document.getElementById("site-chat-close");

    fab.addEventListener("click", function () {
      togglePanel();
    });
    backdrop.addEventListener("click", function () {
      togglePanel(false);
    });
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        togglePanel(false);
      });
    }
    if (sendBtn) sendBtn.addEventListener("click", sendMessage);
    if (inputEl) {
      inputEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    panel.addEventListener("keydown", onPanelKeydown);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) togglePanel(false);
    });

    renderMessages(loadHistory());
  }

  function init() {
    createUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
