/* global localStorage, fetch, crypto, CustomEvent */
(function () {
  "use strict";

  var PREFS_KEY = "develop-flow:prefs:v1";
  var OPENAI_KEY_STORAGE = "develop-flow:openai-key";
  var SITE_INDEX_URL = "/data/site-index.json";

  var CATEGORY_BY_PAGE = {
    "flow-0-quickstart.html": "intro",
    "flow-1-policy.html": "intro",
    "flow-2-ai-tools.html": "intro",
    "flow-20-glossary.html": "intro",
    "flow-3-workflow.html": "flow",
    "flow-0-5-requirements.html": "flow",
    "flow-11-repo.html": "flow",
    "flow-4-phase1.html": "flow",
    "flow-5-phase2.html": "flow",
    "flow-6-phase3.html": "flow",
    "flow-7-phase4.html": "flow",
    "flow-8-phase5.html": "flow",
    "flow-9-phase6.html": "flow",
    "flow-10-phase7.html": "flow",
    "flow-17-rules-plan.html": "ops",
    "flow-rules-samples.html": "ops",
    "flow-18-orchestration.html": "ops",
    "flow-14-pr-check.html": "done",
    "flow-15-history.html": "done",
    "flow-16-ai-pitfalls.html": "done",
    "flow-19-ops.html": "done",
    "index.html": "intro",
  };

  var defaultPrefs = {
    version: 1,
    role: "backend-dev",
    goal: "first-read",
    hiddenSections: [],
    aiLayout: null,
    openai: { model: "gpt-6-luna", keySet: false },
  };

  var prefs = loadPrefs();
  var siteIndex = null;
  var chapterMetaByPage = {};
  var openPanelId = null;

  var CATEGORY_LABELS = {
    intro: "はじめに",
    flow: "開発フロー",
    ops: "運用",
    ref: "参考",
    done: "完了",
  };

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return JSON.parse(JSON.stringify(defaultPrefs));
      var data = JSON.parse(raw);
      return Object.assign({}, defaultPrefs, data, {
        hiddenSections: Array.isArray(data.hiddenSections) ? data.hiddenSections : [],
        openai: Object.assign({}, defaultPrefs.openai, data.openai || {}),
      });
    } catch (_e) {
      return JSON.parse(JSON.stringify(defaultPrefs));
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (_e) {
      /* ignore quota */
    }
    applyHiddenSections();
    applyAiLayout();
    document.dispatchEvent(new CustomEvent("site-prefs-changed", { detail: prefs }));
  }

  function currentPage() {
    var path = location.pathname.replace(/\/$/, "");
    var file = path.split("/").pop() || "index.html";
    if (!file || file === "") return "index.html";
    return file;
  }

  function sectionKey(sectionId) {
    return currentPage() + "#" + sectionId;
  }

  function parseSectionKey(key) {
    var idx = key.indexOf("#");
    if (idx < 0) return { page: key, sectionId: "" };
    return { page: key.slice(0, idx), sectionId: key.slice(idx + 1) };
  }

  function getOpenAiKey() {
    try {
      return localStorage.getItem(OPENAI_KEY_STORAGE) || "";
    } catch (_e) {
      return "";
    }
  }

  function setOpenAiKey(key) {
    if (key) {
      localStorage.setItem(OPENAI_KEY_STORAGE, key);
      prefs.openai.keySet = true;
    } else {
      localStorage.removeItem(OPENAI_KEY_STORAGE);
      prefs.openai.keySet = false;
    }
    savePrefs();
  }

  function getPageCategory() {
    var page = currentPage();
    if (chapterMetaByPage[page] && chapterMetaByPage[page].categoryKey) {
      return chapterMetaByPage[page].categoryKey;
    }
    return CATEGORY_BY_PAGE[page] || "ref";
  }

  function getPageCategoryLabel() {
    var page = currentPage();
    if (chapterMetaByPage[page] && chapterMetaByPage[page].category) {
      return chapterMetaByPage[page].category;
    }
    return CATEGORY_LABELS[getPageCategory()] || "参考";
  }

  function injectChapterBadge() {
    var header = document.querySelector(".flow-article header, .memo-page-head");
    if (!header || header.querySelector(".chapter-badge")) return;
    var cat = getPageCategory();
    var badge = document.createElement("span");
    badge.className = "chapter-badge";
    badge.dataset.cat = cat;
    badge.textContent = getPageCategoryLabel();
    header.insertBefore(badge, header.firstChild);
  }

  function indexChapters(index) {
    chapterMetaByPage = {};
    (index.chapters || []).forEach(function (c) {
      chapterMetaByPage[c.page] = c;
    });
  }

  function wrapContentSections() {
    document.querySelectorAll(".flow-body, .memo-content, .hub-landing").forEach(function (container) {
      if (container.dataset.sectionsWrapped === "1") return;
      var cat = getPageCategory();
      var headings = Array.from(container.querySelectorAll(":scope > h3[id]"));
      if (!headings.length) return;

      headings.forEach(function (heading, i) {
        var section = document.createElement("div");
        section.className = "content-section";
        section.dataset.sectionId = heading.id;
        section.dataset.cat = cat;

        heading.parentNode.insertBefore(section, heading);
        section.appendChild(heading);

        var node = section.nextSibling;
        var nextHeading = headings[i + 1];
        while (node && node !== nextHeading) {
          var move = node;
          node = node.nextSibling;
          section.appendChild(move);
        }
      });

      container.dataset.sectionsWrapped = "1";
    });

    applyHiddenSections();
  }

  function toggleHidden(sectionId) {
    var key = sectionKey(sectionId);
    var idx = prefs.hiddenSections.indexOf(key);
    if (idx >= 0) prefs.hiddenSections.splice(idx, 1);
    else prefs.hiddenSections.push(key);
    savePrefs();
    applyHiddenSections();
    syncSidebarHidden();
  }

  function applyHiddenSections() {
    document.querySelectorAll(".content-section").forEach(function (section) {
      var key = sectionKey(section.dataset.sectionId);
      section.classList.toggle("is-hidden", prefs.hiddenSections.indexOf(key) >= 0);
    });
    syncSidebarHidden();
  }

  function syncSidebarHidden() {
    document.querySelectorAll(".sidebar .toc a[href*='#']").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var hashIdx = href.indexOf("#");
      if (hashIdx < 0) return;
      var page = href.slice(0, hashIdx) || currentPage();
      if (!page) page = currentPage();
      var sectionId = href.slice(hashIdx + 1);
      var key = page + "#" + sectionId;
      a.classList.toggle("is-section-hidden-nav", prefs.hiddenSections.indexOf(key) >= 0);
    });
  }

  function openPanel(id) {
    var backdrop = document.getElementById("site-panel-backdrop");
    document.querySelectorAll(".site-panel").forEach(function (p) {
      var open = p.id === id;
      p.classList.toggle("is-open", open);
      p.setAttribute("aria-hidden", open ? "false" : "true");
    });
    if (backdrop) {
      backdrop.hidden = !id;
      backdrop.setAttribute("aria-hidden", id ? "false" : "true");
    }
    openPanelId = id;
    ["btn-myview", "btn-settings"].forEach(function (btnId) {
      var btn = document.getElementById(btnId);
      if (!btn) return;
      var panelId = btnId.replace("btn-", "panel-");
      btn.setAttribute("aria-expanded", panelId === id ? "true" : "false");
    });
  }

  function closePanels() {
    openPanel(null);
  }

  function bindPanels() {
    var map = {
      "btn-myview": "panel-myview",
      "btn-settings": "panel-settings",
    };
    Object.keys(map).forEach(function (btnId) {
      var btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener("click", function () {
        var panelId = map[btnId];
        openPanel(openPanelId === panelId ? null : panelId);
      });
    });
    var backdrop = document.getElementById("site-panel-backdrop");
    if (backdrop) backdrop.addEventListener("click", closePanels);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePanels();
    });
  }

  function bindSettings() {
    var roleEl = document.getElementById("pref-role");
    var goalEl = document.getElementById("pref-goal");
    var modelEl = document.getElementById("openai-model");
    var keyEl = document.getElementById("openai-key");

    if (roleEl) roleEl.value = prefs.role;
    if (goalEl) goalEl.value = prefs.goal;
    if (modelEl) modelEl.value = prefs.openai.model || "gpt-6-luna";
    if (keyEl) keyEl.placeholder = prefs.openai.keySet ? "（保存済み — 上書き可）" : "sk-...";

    if (roleEl) {
      roleEl.addEventListener("change", function () {
        prefs.role = roleEl.value;
        savePrefs();
      });
    }
    if (goalEl) {
      goalEl.addEventListener("change", function () {
        prefs.goal = goalEl.value;
        savePrefs();
      });
    }

    var saveBtn = document.getElementById("btn-save-settings");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        if (modelEl) prefs.openai.model = modelEl.value;
        if (keyEl && keyEl.value.trim()) setOpenAiKey(keyEl.value.trim());
        else savePrefs();
        keyEl.value = "";
        if (keyEl) keyEl.placeholder = prefs.openai.keySet ? "（保存済み — 上書き可）" : "sk-...";
      });
    }

    var clearKeyBtn = document.getElementById("btn-clear-key");
    if (clearKeyBtn) {
      clearKeyBtn.addEventListener("click", function () {
        setOpenAiKey("");
        if (keyEl) keyEl.value = "";
      });
    }

    var showAllBtn = document.getElementById("btn-show-all-sections");
    if (showAllBtn) {
      showAllBtn.addEventListener("click", function () {
        prefs.hiddenSections = [];
        savePrefs();
        applyHiddenSections();
      });
    }

    var resetBtn = document.getElementById("btn-reset-prefs");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        if (!confirm("非表示・AI レイアウトをすべてリセットしますか？")) return;
        prefs = JSON.parse(JSON.stringify(defaultPrefs));
        localStorage.removeItem(OPENAI_KEY_STORAGE);
        savePrefs();
        if (roleEl) roleEl.value = prefs.role;
        if (goalEl) goalEl.value = prefs.goal;
        if (modelEl) modelEl.value = prefs.openai.model;
      });
    }

    var resetLayoutBtn = document.getElementById("btn-reset-layout");
    if (resetLayoutBtn) {
      resetLayoutBtn.addEventListener("click", function () {
        prefs.aiLayout = null;
        savePrefs();
        var summaryEl = document.getElementById("ai-layout-summary");
        if (summaryEl) summaryEl.hidden = true;
        document.querySelectorAll(".sidebar-priority-badge").forEach(function (el) {
          el.remove();
        });
        document.querySelectorAll(".hub-list > li.hub-item--priority").forEach(function (el) {
          el.classList.remove("hub-item--priority");
        });
      });
    }

    var aiLayoutBtn = document.getElementById("btn-ai-layout");
    if (aiLayoutBtn) {
      aiLayoutBtn.addEventListener("click", requestAiLayout);
    }
  }

  function fetchSiteIndex() {
    if (siteIndex) return Promise.resolve(siteIndex);
    return fetch(SITE_INDEX_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("site-index fetch failed");
        return res.json();
      })
      .then(function (data) {
        siteIndex = data;
        indexChapters(data);
        return data;
      })
      .catch(function () {
        siteIndex = { chapters: [], sections: [] };
        return siteIndex;
      });
  }

  function requestAiLayout() {
    var key = getOpenAiKey();
    if (!key) {
      alert("OpenAI API キーを設定してください。");
      openPanel("panel-settings");
      return;
    }
    var btn = document.getElementById("btn-ai-layout");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "提案中…";
    }
    fetchSiteIndex().then(function (index) {
      var roleEl = document.getElementById("pref-role");
      var goalEl = document.getElementById("pref-goal");
      var role = roleEl ? roleEl.options[roleEl.selectedIndex].text : prefs.role;
      var goal = goalEl ? goalEl.options[goalEl.selectedIndex].text : prefs.goal;
      var compact = (index.chapters || [])
        .slice(0, 80)
        .map(function (c) {
          return c.page + " | " + c.title + " | " + c.category + " | " + c.docKind;
        })
        .join("\n");
      var sectionsCompact = (index.sections || [])
        .slice(0, 120)
        .map(function (s) {
          return s.page + "#" + s.sectionId + " | " + s.title;
        })
        .join("\n");

      var body = {
        model: prefs.openai.model || "gpt-6-luna",
        messages: [
          {
            role: "system",
            content:
              "You are a documentation reading assistant. Return JSON only matching the schema. Suggest reading order and sections to hide for the user's role and goal on a Japanese dev-flow documentation site.",
          },
          {
            role: "user",
            content:
              "Role: " +
              role +
              "\nGoal: " +
              goal +
              "\n\nChapters:\n" +
              compact +
              "\n\nSections:\n" +
              sectionsCompact,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "layout_suggestion",
            strict: true,
            schema: {
              type: "object",
              properties: {
                priorityChapters: { type: "array", items: { type: "string" } },
                hiddenSections: { type: "array", items: { type: "string" } },
                readingOrder: { type: "array", items: { type: "string" } },
                summary: { type: "string" },
              },
              required: ["priorityChapters", "hiddenSections", "readingOrder", "summary"],
              additionalProperties: false,
            },
          },
        },
      };

      return fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              throw new Error("OpenAI " + res.status + ": " + t.slice(0, 200));
            });
          }
          return res.json();
        })
        .then(function (data) {
          var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!content) throw new Error("Empty response");
          var layout = JSON.parse(content);
          prefs.aiLayout = Object.assign({ generatedAt: new Date().toISOString() }, layout);
          if (Array.isArray(layout.hiddenSections)) {
            layout.hiddenSections.forEach(function (key) {
              if (prefs.hiddenSections.indexOf(key) < 0) prefs.hiddenSections.push(key);
            });
          }
          savePrefs();
          var summaryEl = document.getElementById("ai-layout-summary");
          if (summaryEl) {
            summaryEl.textContent = layout.summary || "提案を適用しました。";
            summaryEl.hidden = false;
          }
        })
        .catch(function (err) {
          alert("AI レイアウト提案に失敗しました: " + (err.message || err));
        })
        .finally(function () {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "AI に読む順序を提案";
          }
        });
    });
  }

  function applyAiLayout() {
    if (!prefs.aiLayout) return;
    var layout = prefs.aiLayout;
    var order = layout.readingOrder || [];
    var priorities = layout.priorityChapters || [];

    document.querySelectorAll(".sidebar nav.sidebar-toc a[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var page = href.split("#")[0];
      var badge = a.querySelector(".sidebar-priority-badge");
      if (badge) badge.remove();
      var idx = priorities.indexOf(page);
      if (idx >= 0 && idx < 9) {
        var span = document.createElement("span");
        span.className = "sidebar-priority-badge";
        span.textContent = String(idx + 1);
        a.appendChild(span);
      }
    });

    if (currentPage() !== "index.html") return;
    var hubLists = document.querySelectorAll(".hub-list");
    hubLists.forEach(function (ul) {
      var items = Array.from(ul.querySelectorAll(":scope > li"));
      items.forEach(function (li) {
        li.classList.remove("hub-item--priority");
        var link = li.querySelector("a[href]");
        if (!link) return;
        var href = link.getAttribute("href") || "";
        var page = href.split("#")[0];
        var orderIdx = order.indexOf(page);
        if (orderIdx >= 0) {
          li.style.order = String(orderIdx);
          if (orderIdx < 5) li.classList.add("hub-item--priority");
        }
      });
    });
  }

  function init() {
    if (document.body.classList.contains("page-shell--ai-news")) return;
    bindPanels();
    bindSettings();
    fetchSiteIndex().then(function () {
      injectChapterBadge();
      wrapContentSections();
      applyAiLayout();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.SitePrefs = {
    getPrefs: function () {
      return prefs;
    },
    getOpenAiKey: getOpenAiKey,
    fetchSiteIndex: fetchSiteIndex,
    currentPage: currentPage,
    savePrefs: savePrefs,
  };
})();
