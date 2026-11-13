/**
 * Playbook export — Markdown, ZIP, share URL (?p=).
 */
(function () {
  "use strict";

  function encodeState(state) {
    var payload = {
      v: 1,
      intent: state.intent,
      roles: state.roles,
      tool: state.tool,
      repo: state.repo,
      taskSize: state.taskSize,
      modules: state.modules,
      title: state.title,
    };
    var json = JSON.stringify(payload);
    var b64 = btoa(
      encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, function (_, p1) {
        return String.fromCharCode(parseInt(p1, 16));
      })
    );
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeUrlParam() {
    var params = new URLSearchParams(location.search);
    var p = params.get("p");
    if (!p) return null;
    try {
      var b64 = p.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var json = decodeURIComponent(
        Array.prototype.map
          .call(atob(b64), function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join("")
      );
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function stripHtml(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent || d.innerText || html;
  }

  function labelForRoles(roles) {
    var list = roles && roles.length ? normalizeRolesList(roles) : DEFAULT_ROLES.slice();
    if (list.length >= 7) return "全職種";
    return list.map(labelForRole).join(" · ");
  }

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

  function normalizeRolesList(roles) {
    if (!roles || !roles.length) return DEFAULT_ROLES.slice();
    var out = [];
    roles.forEach(function (r) {
      var id = LEGACY_ROLE_MAP[r] || r;
      if (ROLE_IDS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id);
    });
    return out.length ? out : DEFAULT_ROLES.slice();
  }

  function labelForRole(role) {
    var id = LEGACY_ROLE_MAP[role] || role;
    var map = {
      product: "プロダクト / 企画",
      design: "デザイン / UX",
      engineering: "開発 / 実装",
      qa: "QA / 品質",
      infra: "インフラ / SRE",
      data: "データ / 分析",
      ops: "運用 / サポート",
      mgmt: "管理 / リード",
    };
    return map[id] || id;
  }

  function labelForIntent(intent, manifest) {
    var intents = manifest.intents || [];
    for (var i = 0; i < intents.length; i++) {
      if (intents[i].id === intent) return intents[i].title;
    }
    return intent;
  }

  function toolPaths(tool) {
    if (tool === "claude") {
      return {
        rulesDir: "リポ直下 CLAUDE.md / .claude/",
        plan: "tasks/todo.md",
        lessons: "tasks/lessons.md",
      };
    }
    if (tool === "codex") {
      return {
        rulesDir: "リポ直下 AGENTS.md / OpenAI 側設定",
        plan: "tasks/todo.md",
        lessons: "tasks/lessons.md",
      };
    }
    return {
      rulesDir: ".cursor/rules/*.mdc",
      plan: "tasks/todo.md",
      lessons: "tasks/lessons.md",
    };
  }

  function buildAiSetupPrompt(state, manifest, shareUrl) {
    var lines = [];
    var header =
      (manifest.templates && manifest.templates.aiSetupPromptHeader) ||
      "# AI エージェント向け — リポセットアップ指示（ガイドまとめとは別ファイル）\n";
    lines.push(header);
    lines.push("");
    lines.push("## コンテキスト");
    lines.push("- **まとめタイトル**: " + (state.title || "（未命名）"));
    lines.push("- **意図**: " + labelForIntent(state.intent, manifest));
    lines.push("- **職種**: " + labelForRoles(state.roles));
    lines.push(
      "- **メイン AI ツール**: " +
        ((manifest.tools && manifest.tools[state.tool]) || state.tool)
    );
    lines.push("- **リポ**: " + (state.repo === "new" ? "新規" : "既存"));
    if (state.intent === "task") {
      var sizeMap = { small: "1日以内", medium: "中規模（数日）", large: "大規模（1週間+）" };
      lines.push("- **タスク規模**: " + (sizeMap[state.taskSize] || state.taskSize));
    }
    if (shareUrl) {
      lines.push("- **まとめ 共有 URL**: " + shareUrl);
    }
    lines.push("");

    var paths = toolPaths(state.tool);
    lines.push("## 配置先（このツール向け）");
    lines.push("- ルール: " + paths.rulesDir);
    lines.push("- Plan 正本: " + paths.plan);
    lines.push("- 指摘メモ: " + paths.lessons);
    lines.push("- 仕様: docs/");
    lines.push("");

    var existingPolicy =
      (manifest.templates && manifest.templates.aiSetupExistingFilesPolicy) || "";
    if (existingPolicy) {
      lines.push(existingPolicy);
      if (state.repo === "existing") {
        lines.push("");
        lines.push(
          "> **このまとめは「既存リポ」向けです。** 上表どおり、既存ルール・Plan がある前提で **追加・追記** を優先してください。"
        );
      }
      lines.push("");
    }

    lines.push("## 共通ルール（必ず守る）");
    var constraints =
      (manifest.templates && manifest.templates.aiSetupConstraints) || [];
    constraints.forEach(function (c, i) {
      lines.push(i + 1 + ". " + c);
    });
    lines.push("");

    lines.push("## 実行フェーズ（この順で完了まで進める）");
    lines.push("");
    var phase = 0;
    state.modules.forEach(function (mid) {
      var mod = manifest.modules[mid];
      if (!mod) return;
      phase += 1;
      lines.push("### フェーズ " + phase + ": " + mod.title);
      if (mod.summary) lines.push(mod.summary);
      lines.push("");
      mod.tasks.forEach(function (task, ti) {
        lines.push(phase + "." + (ti + 1) + ". [ ] " + stripHtml(task));
      });
      lines.push("");
      if (mod.files && mod.files.length) {
        lines.push("**触るファイル:** " + mod.files.join(" · "));
        lines.push("");
      }
      if (mod.done) {
        lines.push("**このフェーズの完了条件:** " + mod.done);
        lines.push("");
      }
      if (mod.guide) {
        lines.push(
          "詳細ガイド（Web）: " +
            (shareUrl ? new URL(mod.guide, shareUrl).href : mod.guide)
        );
        lines.push("");
      }
    });

    var ruleSlugs = filterRuleSlugs(state, manifest);
    if (ruleSlugs.length) {
      lines.push("## 作成するルール・設定ファイル（中身をそのまま配置）");
      lines.push("");
      lines.push(
        "以下を **指定パスに配置** してください。配置前にパスの有無を確認し、**既存ファイルがある場合は「既存ファイルとの衝突」の表に従う**（無条件上書き禁止）。新規のときだけプロンプト本文をそのまま使い、プレースホルダは実プロジェクト向けに書き換えること。"
      );
      lines.push("");
      ruleSlugs.forEach(function (slug) {
        var exp = manifest.ruleExports[slug];
        if (!exp) return;
        lines.push("### " + exp.path);
        if (exp.purpose) {
          lines.push("<!-- 目的: " + exp.purpose + " -->");
        }
        lines.push("```");
        lines.push(exp.body.trim());
        lines.push("```");
        lines.push("");
      });
    }

    lines.push("## 作成する Plan / 運用ファイル");
    lines.push("");
    lines.push("### tasks/todo.md");
    lines.push("```markdown");
    lines.push(
      (manifest.templates && manifest.templates.todoMd) || "# Plan\n"
    );
    lines.push("```");
    lines.push("");
    lines.push("### tasks/lessons.md");
    lines.push("```markdown");
    lines.push("# Lessons\n\n| 日付 | パターン | 対策 |\n| --- | --- | --- |\n");
    lines.push("```");
    lines.push("");

    lines.push("### ONBOARDING.md（チーム共有用）");
    lines.push("```markdown");
    lines.push(buildOnboardingMd(state, manifest, shareUrl));
    lines.push("```");
    lines.push("");

    lines.push("## 最終完了条件（すべて満たしてから報告）");
    state.modules.forEach(function (mid) {
      var mod = manifest.modules[mid];
      if (mod && mod.done) lines.push("- [ ] " + mod.title + ": " + mod.done);
    });
    lines.push("");
    lines.push("## 完了報告フォーマット");
    lines.push("1. 作成・変更したファイル一覧（パス）");
    lines.push("2. 各フェーズの検証結果（コマンドと exit code / 確認内容）");
    lines.push("3. tasks/todo.md の更新内容");
    lines.push("4. ユーザーに確認が必要な操作（git commit 等）があれば `[操作確認]` として列挙");
    lines.push("");
    lines.push("---");
    lines.push("上記を **確認なしで可能な範囲まで一気に実行** し、ブロックされた操作だけユーザーに止まってください。");

    return lines.join("\n");
  }

  function buildPlaybookMd(state, manifest) {
    var lines = ["# " + (state.title || "あなたのまとめ"), ""];
    lines.push("> ガイドまとめ（人が読むチェックリスト）。AI セットアップ指示とは別ファイルです。");
    lines.push("");
    lines.push("## サマリー");
    lines.push("- 意図: " + state.intent);
    lines.push("- 職種: " + labelForRoles(state.roles));
    lines.push("- ツール: " + ((manifest.tools && manifest.tools[state.tool]) || state.tool));
    lines.push("- リポ: " + (state.repo === "new" ? "新規" : "既存"));
    if (state.intent === "task") {
      lines.push("- 規模: " + state.taskSize);
    }
    lines.push("");
    state.modules.forEach(function (mid) {
      var mod = manifest.modules[mid];
      if (!mod) return;
      lines.push("## " + mod.title);
      lines.push("");
      lines.push(mod.summary);
      lines.push("");
      mod.tasks.forEach(function (task, i) {
        lines.push("- [ ] " + stripHtml(task));
      });
      lines.push("");
      if (mod.files && mod.files.length) {
        lines.push("**触るファイル:** " + mod.files.join(", "));
        lines.push("");
      }
      if (mod.done) {
        lines.push("**完了条件:** " + mod.done);
        lines.push("");
      }
      if (mod.guide) {
        lines.push("詳細: [" + mod.guide + "](" + mod.guide + ")");
        lines.push("");
      }
    });
    return lines.join("\n");
  }

  function buildOnboardingMd(state, manifest, shareUrl) {
    var tpl = (manifest.templates && manifest.templates.onboardingMd) || "";
    return tpl.replace(
      "（このサイトの「ガイドを選んでまとめる」から生成した URL を貼る）",
      shareUrl || "（未生成）"
    );
  }

  function filterRuleSlugs(state, manifest) {
    var slugs = [];
    var seen = {};
    state.modules.forEach(function (mid) {
      var mod = manifest.modules[mid];
      if (!mod || !mod.ruleSlugs) return;
      mod.ruleSlugs.forEach(function (slug) {
        var exp = manifest.ruleExports[slug];
        if (exp && exp.tools.indexOf(state.tool) >= 0 && !seen[slug]) {
          seen[slug] = true;
          slugs.push(slug);
        }
      });
    });
    Object.keys(manifest.ruleExports || {}).forEach(function (slug) {
      var exp = manifest.ruleExports[slug];
      if (exp.starter && exp.tools.indexOf(state.tool) >= 0 && !seen[slug]) {
        if (
          state.modules.indexOf("mod-setup-rules-starter") >= 0 ||
          state.modules.indexOf("mod-phase1-rules") >= 0
        ) {
          seen[slug] = true;
          slugs.push(slug);
        }
      }
    });
    slugs.sort(function (a, b) {
      var ea = manifest.ruleExports[a];
      var eb = manifest.ruleExports[b];
      return (ea.starterOrder || 99) - (eb.starterOrder || 99);
    });
    return slugs;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  }

  function sync(state, manifest) {
    var shareUrl =
      location.origin +
      location.pathname +
      "?p=" +
      encodeState(state);
    var shareInput = document.getElementById("playbook-share-url");
    if (shareInput) shareInput.value = shareUrl;

    var md = buildPlaybookMd(state, manifest);
    var todoMd =
      (manifest.templates && manifest.templates.todoMd) || "# Plan\n";
    var onboardingMd = buildOnboardingMd(state, manifest, shareUrl);
    var aiSetupPrompt = buildAiSetupPrompt(state, manifest, shareUrl);

    var preview = document.getElementById("playbook-ai-prompt-text");
    if (preview) {
      preview.value = aiSetupPrompt;
      preview.style.height = "auto";
      var cap = Math.floor(window.innerHeight * 0.75);
      preview.style.height = Math.min(preview.scrollHeight + 2, cap) + "px";
    }

    window.__playbookExport = {
      playbookMd: md,
      todoMd: todoMd,
      onboardingMd: onboardingMd,
      aiSetupPrompt: aiSetupPrompt,
      ruleSlugs: filterRuleSlugs(state, manifest),
      shareUrl: shareUrl,
    };
  }

  function downloadBlob(filename, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportZip() {
    var data = window.__playbookExport;
    var manifest = window.PlaybookHub && window.PlaybookHub.getManifest();
    if (!data || !manifest) return;
    if (typeof JSZip === "undefined") {
      downloadBlob("まとめ.md", data.playbookMd, "text/markdown");
      downloadBlob("tasks-todo.md", data.todoMd, "text/markdown");
      downloadBlob("ONBOARDING.md", data.onboardingMd, "text/markdown");
      if (data.aiSetupPrompt) {
        downloadBlob("AIセットアップ指示.md", data.aiSetupPrompt, "text/markdown");
      }
      return;
    }
    var zip = new JSZip();
    zip.file("まとめ.md", data.playbookMd);
    zip.folder("tasks").file("todo.md", data.todoMd);
    zip.file("ONBOARDING.md", data.onboardingMd);
    zip.file("AIセットアップ指示.md", data.aiSetupPrompt || "");
    var rulesFolder = zip.folder("rules");
    data.ruleSlugs.forEach(function (slug) {
      var exp = manifest.ruleExports[slug];
      if (!exp) return;
      var path = exp.path.replace(/^\.\//, "");
      rulesFolder.file(path.split("/").pop(), exp.body);
    });
    zip.generateAsync({ type: "blob" }).then(function (blob) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "playbook-export.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function bindExportButtons() {
    var btnShare = document.getElementById("btn-copy-share-url");
    if (btnShare) {
      btnShare.addEventListener("click", function () {
        var input = document.getElementById("playbook-share-url");
        if (!input || !input.value) return;
        copyText(input.value).then(function () {
          btnShare.textContent = "コピーしました";
          setTimeout(function () {
            btnShare.textContent = "URL をコピー";
          }, 2000);
        });
      });
    }
    var btnMd = document.getElementById("btn-export-playbook-md");
    if (btnMd) {
      btnMd.addEventListener("click", function () {
        var data = window.__playbookExport;
        if (data) downloadBlob("まとめ.md", data.playbookMd, "text/markdown");
      });
    }
    var btnZip = document.getElementById("btn-export-zip");
    if (btnZip) btnZip.addEventListener("click", exportZip);
    var btnAiMd = document.getElementById("btn-export-ai-prompt-md");
    if (btnAiMd) {
      btnAiMd.addEventListener("click", function () {
        var data = window.__playbookExport;
        if (!data || !data.aiSetupPrompt) {
          alert("先に「まとめを作成」を押してください。");
          return;
        }
        downloadBlob("AIセットアップ指示.md", data.aiSetupPrompt, "text/markdown");
      });
    }
    var btnAi = document.getElementById("btn-copy-ai-prompt");
    if (btnAi) {
      btnAi.addEventListener("click", function () {
        var data = window.__playbookExport;
        if (!data || !data.aiSetupPrompt) {
          alert("先に「まとめを作成」を押してください。");
          return;
        }
        copyText(data.aiSetupPrompt).then(function () {
          btnAi.textContent = "コピーしました";
          setTimeout(function () {
            btnAi.textContent = "セットアップ指示をコピー";
          }, 2500);
        });
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindExportButtons);
  } else {
    bindExportButtons();
  }

  window.PlaybookExport = {
    encodeState: encodeState,
    decodeUrlParam: decodeUrlParam,
    sync: sync,
    exportZip: exportZip,
    buildAiSetupPrompt: buildAiSetupPrompt,
  };
})();
