/**
 * Playbook Hub — intent cards, context tiles, module synthesis, progress.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "playbook-hub-v1";
  var manifest = null;
  var ROLE_IDS = [
    "product",
    "design",
    "engineering",
    "qa",
    "infra",
    "data",
    "ops",
    "mgmt",
  ];
  var LEGACY_ROLE_MAP = {
    pdm: "product",
    be: "engineering",
    fe: "engineering",
    reviewer: "qa",
    lead: "mgmt",
  };
  var DEFAULT_ROLES = ["engineering"];

  var state = {
    intent: null,
    roles: DEFAULT_ROLES.slice(),
    tool: "cursor",
    repo: "existing",
    taskSize: "medium",
    modules: [],
    title: "",
    checks: {},
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    return fetch("/data/playbook-manifest.json")
      .then(function (r) {
        if (!r.ok) throw new Error("manifest fetch failed");
        return r.json();
      })
      .then(function (data) {
        manifest = data;
        return data;
      });
  }

  var GENERAL_ROLE_IDS = ["product", "ops", "mgmt"];
  var ENGINEERING_ROLE_IDS = ["engineering", "qa", "infra"];

  function normalizeCtxRoles(ctx) {
    if (ctx.roles && ctx.roles.length) return normalizeRoles(ctx.roles);
    if (ctx.role) return normalizeRoles([ctx.role]);
    return DEFAULT_ROLES.slice();
  }

  function isGeneralFocused(roles) {
    var hasGeneral = roles.some(function (r) {
      return GENERAL_ROLE_IDS.indexOf(r) >= 0;
    });
    var hasEng = roles.some(function (r) {
      return ENGINEERING_ROLE_IDS.indexOf(r) >= 0;
    });
    return hasGeneral && !hasEng;
  }

  function generalModuleIds(roles) {
    var ids = [
      "mod-general-overview",
      "mod-general-research",
      "mod-general-summarize",
      "mod-general-meeting",
      "mod-general-knowledge",
      "mod-general-safety",
    ];
    if (roles.indexOf("product") >= 0 || roles.indexOf("mgmt") >= 0) {
      ids.push("mod-general-docs");
    }
    if (roles.indexOf("ops") >= 0 || roles.indexOf("mgmt") >= 0) {
      ids.push("mod-general-automation");
    }
    return ids;
  }

  function resolveModules(intent, ctx) {
    var repoNew = ctx.repo === "new";
    var size = ctx.taskSize || "medium";
    var roles = normalizeCtxRoles(ctx);
    var ids = [];

    if (intent === "setup") {
      if (repoNew) {
        ids.push(
          "mod-setup-intro",
          "mod-setup-tools",
          "mod-setup-policy",
          "mod-repo-structure",
          "mod-setup-rules-plan",
          "mod-setup-rules-starter",
          "mod-skills-first",
          "mod-setup-orchestration"
        );
      } else {
        ids.push(
          "mod-setup-tools",
          "mod-repo-structure",
          "mod-setup-rules-plan",
          "mod-setup-rules-starter",
          "mod-skills-first",
          "mod-setup-orchestration"
        );
      }
      ids.push("mod-glossary");
    } else if (intent === "task") {
      if (size === "small") {
        ids.push("mod-quick-3step", "mod-orchestration-mini", "mod-pr-check");
      } else {
        ids.push("mod-workflow-overview");
        if (size === "medium" || size === "large" || repoNew) ids.push("mod-req-align");
        if (repoNew) ids.push("mod-phase1-rules");
        ids.push("mod-plan");
        if (size === "medium" || size === "large" || repoNew) ids.push("mod-design");
        ids.push("mod-implement-core");
        if (size === "medium" || size === "large") ids.push("mod-implement-app");
        if (size === "large") ids.push("mod-crosscut");
        ids.push("mod-ship-pr", "mod-pr-check");
        if (size === "medium" || size === "large") {
          ids.push("mod-dev-scheduled-workflow");
        }
      }
    } else if (intent === "general-work") {
      ids = ids.concat(generalModuleIds(roles));
    } else if (intent === "rules") {
      ids.push("mod-setup-rules-plan", "mod-rules-deep");
      if (repoNew) ids.push("mod-phase1-rules");
      ids.push("mod-setup-rules-starter", "mod-repo-structure");
    } else if (isGeneralFocused(roles)) {
      ids = ids.concat(generalModuleIds(roles));
    } else {
      ids.push("mod-workflow-overview");
    }

    var seen = {};
    var out = [];
    ids.forEach(function (id) {
      if (manifest.modules[id] && !seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    });
    out.sort(function (a, b) {
      return (manifest.modules[a].order || 0) - (manifest.modules[b].order || 0);
    });
    return out;
  }

  function playbookTitle(intent, ctx) {
    var intents = manifest.intents || [];
    var base = "あなたのまとめ";
    for (var i = 0; i < intents.length; i++) {
      if (intents[i].id === intent) {
        base = intents[i].title;
        break;
      }
    }
    var toolLabel =
      (manifest.tools && manifest.tools[ctx.tool]) || ctx.tool;
    var repoLabel = ctx.repo === "new" ? "新規リポ" : "既存リポ";
    if (intent === "task") {
      var sizeMap = { small: "小タスク", medium: "中規模", large: "大規模" };
      return base + " — " + (sizeMap[ctx.taskSize] || "") + " · " + repoLabel + " · " + toolLabel;
    }
    if (intent === "general-work") {
      return base + " · " + toolLabel;
    }
    return base + " — " + repoLabel + " · " + toolLabel;
  }

  function normalizeRoles(roles) {
    if (!roles || !roles.length) return DEFAULT_ROLES.slice();
    var out = [];
    roles.forEach(function (r) {
      var id = LEGACY_ROLE_MAP[r] || r;
      if (ROLE_IDS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id);
    });
    return out.length ? out : DEFAULT_ROLES.slice();
  }

  function readContextFromTiles() {
    var roleEls = $$('input[name="ctx-role"]:checked');
    state.roles = roleEls.length
      ? roleEls.map(function (el) {
          return el.value;
        })
      : DEFAULT_ROLES.slice();
    var toolEl = $('input[name="ctx-tool"]:checked');
    var repoEl = $('input[name="ctx-repo"]:checked');
    var sizeEl = $('input[name="ctx-taskSize"]:checked');
    if (toolEl) state.tool = toolEl.value;
    if (repoEl) state.repo = repoEl.value;
    if (sizeEl) state.taskSize = sizeEl.value;
  }

  function updateModulePreview() {
    readContextFromTiles();
    if (!state.intent || !manifest) return;
    var auto = resolveModules(state.intent, {
      repo: state.repo,
      taskSize: state.taskSize,
      roles: state.roles,
      tool: state.tool,
    });
    var list = $("#playbook-module-list");
    if (!list) return;
    list.innerHTML = "";
    auto.forEach(function (mid) {
      var mod = manifest.modules[mid];
      if (!mod) return;
      var li = document.createElement("li");
      li.className = "playbook-module-preview";
      var label = document.createElement("label");
      label.className = "playbook-module-card";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "mod-" + mid;
      cb.value = mid;
      cb.checked = state.modules.indexOf(mid) >= 0 || state.modules.length === 0;
      if (state.modules.length === 0) cb.checked = true;
      var body = document.createElement("span");
      body.className = "playbook-module-card__body";
      body.innerHTML =
        "<strong>" +
        mod.title +
        "</strong>" +
        (mod.optional ? ' <span class="playbook-tag">任意</span>' : "") +
        '<span class="playbook-module-preview__sum">' +
        mod.summary +
        "</span>";
      label.appendChild(cb);
      label.appendChild(body);
      li.appendChild(label);
      list.appendChild(li);
    });
    var taskSizeGroup = $("#ctx-group-taskSize");
    if (taskSizeGroup) {
      taskSizeGroup.hidden = state.intent !== "task";
    }
    var repoGroup = $("#playbook-context fieldset:nth-of-type(3)");
    if (repoGroup) {
      repoGroup.hidden = state.intent === "general-work";
    }
  }

  function getSelectedModules() {
    return $$("#playbook-module-list input:checked").map(function (cb) {
      return cb.value;
    });
  }

  function saveProgress() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ checks: state.checks, lastModules: state.modules })
      );
    } catch (e) {
      /* ignore */
    }
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.checks) state.checks = data.checks;
    } catch (e) {
      /* ignore */
    }
  }

  function renderPlaybook() {
    readContextFromTiles();
    state.modules = getSelectedModules();
    if (!state.modules.length) {
      alert("モジュールを1つ以上選んでください。");
      return;
    }
    state.title = playbookTitle(state.intent, state);
    var panel = $("#playbook-result");
    var titleEl = $("#playbook-result-title");
    if (titleEl) titleEl.textContent = state.title;
    if (panel) panel.hidden = false;

    var nextEl = $("#playbook-next-action");
    if (nextEl && state.modules.length) {
      var firstMod = manifest.modules[state.modules[0]];
      var nextTask = firstMod && firstMod.tasks && firstMod.tasks[0] ? firstMod.tasks[0] : "";
      if (nextTask) {
        nextEl.hidden = false;
        nextEl.innerHTML =
          '<strong>次のアクション:</strong> <span class="playbook-next-action__task">' +
          nextTask +
          "</span>" +
          (firstMod.guide
            ? ' — <a href="' + firstMod.guide + '">詳細ガイド</a>'
            : "");
      } else {
        nextEl.hidden = true;
      }
    }

    var list = $("#playbook-checklist");
    if (!list) return;
    list.innerHTML = "";
    var step = 0;
    state.modules.forEach(function (mid) {
      var mod = manifest.modules[mid];
      if (!mod) return;
      var section = document.createElement("section");
      section.className = "playbook-module-block";
      section.dataset.moduleId = mid;
      var title = document.createElement("div");
      title.className = "playbook-module-block__title";
      title.setAttribute("role", "heading");
      title.setAttribute("aria-level", "3");
      var guideLink = mod.guide ? '<a href="' + mod.guide + '">詳細ガイド</a>' : "";
      title.innerHTML = mod.title + " " + guideLink;
      section.appendChild(title);
      if (mod.summary) {
        var p = document.createElement("p");
        p.className = "playbook-module-block__summary";
        p.textContent = mod.summary;
        section.appendChild(p);
      }
      var ol = document.createElement("ol");
      ol.className = "playbook-checklist";
      mod.tasks.forEach(function (task, ti) {
        step += 1;
        var key = mid + ":" + ti;
        var li = document.createElement("li");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.id = "chk-" + key;
        cb.checked = !!state.checks[key];
        cb.dataset.checkKey = key;
        var label = document.createElement("label");
        label.htmlFor = "chk-" + key;
        label.innerHTML = task;
        li.appendChild(cb);
        li.appendChild(label);
        ol.appendChild(li);
      });
      section.appendChild(ol);
      if (mod.files && mod.files.length) {
        var filesP = document.createElement("p");
        filesP.className = "playbook-module-block__files";
        filesP.innerHTML =
          "<strong>触るファイル:</strong> " + mod.files.map(function (f) {
            return "<code>" + f + "</code>";
          }).join(" · ");
        section.appendChild(filesP);
      }
      if (mod.done) {
        var doneP = document.createElement("p");
        doneP.className = "playbook-module-block__done";
        doneP.innerHTML = "<strong>完了条件:</strong> " + mod.done;
        section.appendChild(doneP);
      }
      list.appendChild(section);
    });

    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    if (window.PlaybookExport) {
      window.PlaybookExport.sync(state, manifest);
    }
    saveProgress();
  }

  function bindChecklistEvents() {
    document.addEventListener("change", function (e) {
      if (e.target && e.target.dataset && e.target.dataset.checkKey) {
        state.checks[e.target.dataset.checkKey] = e.target.checked;
        saveProgress();
      }
    });
  }

  function selectIntent(intentId) {
    state.intent = intentId;
    $$(".intent-card").forEach(function (card) {
      card.classList.toggle("is-selected", card.dataset.intent === intentId);
    });
    var ctxPanel = $("#playbook-context");
    if (ctxPanel) {
      ctxPanel.hidden = false;
      ctxPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    state.modules = [];
    updateModulePreview();
    var modPanel = $("#playbook-modules");
    if (modPanel) modPanel.hidden = false;
  }

  function applyUrlState() {
    if (!window.PlaybookExport) return;
    var decoded = window.PlaybookExport.decodeUrlParam();
    if (!decoded) return;
    if (decoded.intent === "share") {
      decoded.intent = decoded.shareBase || "setup";
    }
    if (decoded.intent) state.intent = decoded.intent;
    if (decoded.role) state.role = decoded.role;
    if (decoded.tool) state.tool = decoded.tool;
    if (decoded.repo) state.repo = decoded.repo;
    if (decoded.taskSize) state.taskSize = decoded.taskSize;
    if (decoded.roles && decoded.roles.length) {
      state.roles = normalizeRoles(decoded.roles);
    } else if (decoded.role) {
      state.roles = normalizeRoles([decoded.role]);
    }
    if (decoded.modules && decoded.modules.length) state.modules = decoded.modules;
    if (decoded.title) state.title = decoded.title;

    if (state.intent) selectIntent(state.intent);
    $$('input[name="ctx-role"]').forEach(function (el) {
      el.checked = state.roles.indexOf(el.value) >= 0;
    });
    $$('input[name="ctx-tool"]').forEach(function (el) {
      el.checked = el.value === state.tool;
    });
    $$('input[name="ctx-repo"]').forEach(function (el) {
      el.checked = el.value === state.repo;
    });
    $$('input[name="ctx-taskSize"]').forEach(function (el) {
      el.checked = el.value === state.taskSize;
    });
    updateModulePreview();
    if (state.modules.length) {
      state.modules.forEach(function (mid) {
        var cb = $("#mod-" + mid);
        if (cb) cb.checked = true;
      });
      renderPlaybook();
    }
  }

  function loadPrefsDefaults() {
    try {
      var raw = localStorage.getItem("develop-flow:prefs:v1");
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (prefs.tool) state.tool = prefs.tool;
    } catch (e) {
      /* ignore */
    }
  }

  function init() {
    loadManifest().then(function () {
      loadProgress();
      loadPrefsDefaults();
      $$(".intent-card").forEach(function (card) {
        card.addEventListener("click", function () {
          selectIntent(card.dataset.intent);
        });
        card.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectIntent(card.dataset.intent);
          }
        });
      });
      $$("#playbook-context input").forEach(function (el) {
        el.addEventListener("change", updateModulePreview);
      });
      var btnGen = $("#btn-generate-playbook");
      if (btnGen) btnGen.addEventListener("click", renderPlaybook);
      bindChecklistEvents();
      applyUrlState();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.PlaybookHub = {
    getState: function () {
      return state;
    },
    getManifest: function () {
      return manifest;
    },
    renderPlaybook: renderPlaybook,
  };
})();
