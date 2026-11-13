#!/usr/bin/env python3
"""静的サイトのビルド。標準ライブラリのみ。  使い方: python3 build.py  →  public/ に出力

content/*.html  本文の断片（1行目の <!--meta {...} --> にタイトル等）
site.json       ナビゲーション・モデル一覧などの設定
src/css, src/js 共通スタイルとスクリプト
static/         そのままコピーするファイル（画像・data・vendor）
"""
import hashlib, html, json, re, shutil, sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).parent
OUT = ROOT / "public"
SITE = json.loads((ROOT / "site.json").read_text(encoding="utf-8"))
E = html.escape

ICON = {
    "menu": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    "search": '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    "sun": '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    "moon": '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
    "brand": '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 9h13a5 5 0 0 1 0 10h-4a4 4 0 0 0 0 8h13" fill="none" stroke="var(--theme-accent)" stroke-width="4" stroke-linecap="round"/><circle cx="5" cy="9" r="3.5" fill="var(--theme-bg)" stroke="var(--theme-accent)" stroke-width="2.5"/><circle cx="27" cy="27" r="3.5" fill="var(--theme-bg)" stroke="var(--signal)" stroke-width="2.5"/></svg>',
}

# テーマの初期化と、提供終了したモデル設定の読み替え（CSP のためインラインにせず外部ファイルにする）
THEME_INIT = """(function(){try{var t=localStorage.getItem("develop-flow:theme");if(!t)t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t);
var k="develop-flow:prefs:v1",p=JSON.parse(localStorage.getItem(k)||"null"),r=%s;if(p&&p.openai&&r.indexOf(p.openai.model)>=0){p.openai.model="gpt-6-luna";localStorage.setItem(k,JSON.stringify(p));}}catch(e){}})();
"""


def read_content():
    pages = {}
    for f in sorted((ROOT / "content").glob("*.html")):
        text = f.read_text(encoding="utf-8")
        m = re.match(r"<!--meta (.*?) -->\n", text)
        if not m:
            raise SystemExit(f"{f.name}: 1行目に <!--meta {{...}} --> がありません")
        meta = json.loads(m.group(1))
        meta["slug"], meta["body"] = f.stem, text[m.end():]
        if re.search(r"<script\b|\son[a-z]+=", meta["body"], re.I):
            raise SystemExit(f"{f.name}: 本文にスクリプトやイベント属性は書けません（CSP で止まります）。src/js に置いてください")
        pages[f.stem] = meta
    return pages


def flat_nav():
    order = []
    for g in SITE["nav"]:
        for it in g["items"]:
            order.append((it, g))
            for c in it.get("children", []):
                order.append((c, g))
    return order


def ensure_heading_ids(body):
    n = 0
    def fix(m):
        nonlocal n
        if "id=" in m.group(2):
            return m.group(0)
        n += 1
        return f'<{m.group(1)}{m.group(2)} id="s-{n}">'
    return re.sub(r"<(h[23])\b([^>]*)>", fix, body)


def text_of(fragment):
    fragment = re.sub(r"<(script|style)\b.*?</\1>", " ", fragment, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def sidebar(cur, group_of):
    out = []
    for g in SITE["nav"]:
        is_open = group_of.get(cur) is g or (cur == "index" and g["key"] in ("intro", "principles", "lifecycle"))
        out.append(f'<details class="side-group"{" open" if is_open else ""}><summary>{E(g["title"])}</summary><ul>')
        def link(it):
            tag = it.get("tag")
            mark = ""
            if tag == "NEW":
                mark = '<span class="tagmark tagmark--new">NEW</span>'
            elif tag:
                mark = f'<span class="tagmark" title="ハンドブックの章">{E(tag)}</span>'
            current = ' aria-current="page"' if it["slug"] == cur else ""
            return f'<a href="{it["slug"]}.html"{current}><span>{E(it["label"])}</span>{mark}</a>'
        for it in g["items"]:
            out.append("<li>" + link(it))
            if it.get("children"):
                out.append("<ul>" + "".join(f"<li>{link(c)}</li>" for c in it["children"]) + "</ul>")
            out.append("</li>")
        out.append("</ul></details>")
    return "\n".join(out)


def model_options():
    out = []
    for g in SITE["models"]:
        out.append(f'<optgroup label="{E(g["group"])}">' + "".join(f'<option value="{E(v)}">{E(l)}</option>' for v, l in g["items"]) + "</optgroup>")
    return "".join(out)


def page_meta_line(p):
    """本文末尾に出す「最終確認日・直す・報告する」の行"""
    reviewed = p.get("reviewed") or SITE["reviewedDefault"][p.get("kind", "flow")]
    repo = SITE["repo"]
    edit = f'{repo}/edit/main/content/{p["slug"]}.html'
    issue = f'{repo}/issues/new?title={quote("[" + p["title"] + "] ")}&body={quote("ページ: " + SITE["url"] + "/" + p["slug"] + chr(10) + chr(10) + "気づいた点：")}'
    stale = ' page-meta--stale' if reviewed < "2026-09-01" else ""
    note = '（4か月以上前の内容です。手順やモデル名は公式情報で確かめてください）' if stale else ""
    return (f'<p class="page-meta{stale}">このページの最終更新：<time datetime="{reviewed}">{reviewed}</time>{note}'
            f'<span class="page-meta__links"><a href="{E(edit)}" rel="noopener">このページを直す</a>'
            f'<a href="{E(issue)}" rel="noopener">誤りを報告する</a></span></p>')


def check_links(pages):
    """サイト内リンクと画像の参照先が public/ に存在するかを確認する。"""
    broken = []
    for slug in pages:
        doc = (OUT / f"{slug}.html").read_text(encoding="utf-8")
        ids_cache = {}
        for attr, target in set(re.findall(r'\b(href|src)="([^"]+)"', doc)):
            if re.match(r"(https?:|mailto:|data:|javascript:|//|#)", target) or "${" in target or "' +" in target:
                continue
            path, _, frag = target.partition("#")
            path = path.split("?")[0]
            f = OUT / ("index.html" if path in ("", "/") else path.lstrip("/"))
            if not f.exists():
                broken.append(f"{slug}.html → {target}")
            elif frag and f.suffix == ".html":
                if f not in ids_cache:
                    ids_cache[f] = set(re.findall(r'\bid="([^"]+)"', f.read_text(encoding="utf-8")))
                if frag not in ids_cache[f]:
                    broken.append(f"{slug}.html → {target}（アンカー無し）")
    return broken


LAYOUT = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="article">
<meta property="og:image" content="{site_url}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="{canonical}">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script src="/assets/theme-init.js?v={v}"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap">
<link rel="stylesheet" href="/assets/site.css?v={v}">
</head>
<body class="{body_class}">
<a class="skip" href="#main-content">本文へスキップ</a>
<header class="top">
  <button type="button" class="top__menu" id="menu-toggle" aria-controls="sidebar" aria-expanded="false" aria-label="メニューを開く">{i_menu}</button>
  <a class="brand" href="/">{i_brand}<span>{site}</span></a>
  <button type="button" class="search-btn" id="btn-search" aria-label="サイト内を検索">{i_search}<span>ガイドを検索</span><kbd>⌘K</kbd></button>
  <div class="top__tools page-header-tools" aria-label="ツール">
    <a class="hide-s" href="trends-2026.html"{cur_trends}>トレンド</a>
    <a class="hide-s" href="ai-news.html"{cur_news}>AIニュース</a>
    <button type="button" id="btn-myview" class="header-tool-btn" aria-expanded="false" aria-controls="panel-myview" title="役割と目的から読む順序を提案"><span class="lbl">マイビュー</span></button>
    <button type="button" id="btn-settings" class="header-tool-btn" aria-expanded="false" aria-controls="panel-settings"><span>設定</span></button>
    <button type="button" id="btn-theme" aria-label="ライト / ダークを切り替える" title="ライト / ダークを切り替える">{i_sun}{i_moon}</button>
  </div>
</header>
<div id="site-panel-backdrop" class="site-panel-backdrop" hidden aria-hidden="true"></div>
<aside id="panel-myview" class="site-panel" role="dialog" aria-labelledby="panel-myview-title" aria-hidden="true">
  <h2 class="site-panel__title" id="panel-myview-title">マイビュー</h2>
  <p class="site-panel__hint">役割と目的を選ぶと、AI が読む順序を提案します。OpenAI API キーは「設定」で登録してください。</p>
  <label for="pref-role">役割</label>
  <select id="pref-role"><option value="pm">PdM / 要件</option><option value="backend-dev">バックエンド</option><option value="frontend-dev">フロントエンド</option><option value="infra">インフラ / DevOps</option><option value="reviewer">レビュアー</option></select>
  <label for="pref-goal">目的</label>
  <select id="pref-goal"><option value="first-read">初めて読む</option><option value="phase4-tdd">Phase 4 実装中</option><option value="pr-review">PR 前チェック</option><option value="rules-setup">ルール整備</option><option value="agent-ops">エージェント運用</option></select>
  <div id="ai-layout-summary" class="ai-layout-summary" hidden></div>
  <div class="site-panel-actions">
    <button type="button" id="btn-ai-layout" class="primary">AI に読む順序を提案してもらう</button>
    <button type="button" id="btn-reset-layout">レイアウトをリセット</button>
  </div>
</aside>
<aside id="panel-settings" class="site-panel" role="dialog" aria-labelledby="panel-settings-title" aria-hidden="true">
  <h2 class="site-panel__title" id="panel-settings-title">設定</h2>
  <p class="site-panel__hint">OpenAI API キーはこの端末のブラウザ（localStorage）にのみ保存され、当サイトのサーバーには送信されません。利用時のみブラウザから OpenAI API へ直接送信されます。共用 PC では使い終わったら「キーを削除」してください。</p>
  <label for="openai-key">OpenAI API キー</label>
  <input type="password" id="openai-key" autocomplete="off" placeholder="sk-...">
  <label for="openai-model">モデル</label>
  <select id="openai-model">{model_options}</select>
  <p class="site-panel__hint">GPT-4o / GPT-4.1 系は 2027-01-14 に API 提供が終了するため一覧から外しました。保存済みの設定は gpt-6-luna に読み替えます。<a href="trends-2026.html#models">詳細</a></p>
  <div class="site-panel-actions">
    <button type="button" id="btn-save-settings" class="primary">保存</button>
    <button type="button" id="btn-clear-key" class="danger">キーを削除</button>
    <button type="button" id="btn-show-all-sections">非表示をすべて表示</button>
    <button type="button" id="btn-reset-prefs" class="danger">すべてリセット</button>
  </div>
</aside>
<div class="frame">
  <aside class="sidebar side" id="sidebar"><nav class="toc sidebar-toc" aria-label="ガイド一覧">
{sidebar}
  </nav></aside>
  <div class="main-area">
    <main id="main-content" tabindex="-1">
{body}
{page_meta}
{pager}
    </main>
    <footer class="foot"><span>{site} — 最終更新 {updated}</span><a href="trends-2026.html">2026年11月のトレンド</a><a href="/llms.txt">llms.txt</a><a href="handbook.html">ハンドブック</a><a href="{repo}" rel="noopener">ソース（GitHub）</a></footer>
  </div>
  <aside class="rail" aria-label="このページ">
    <div class="rail__toc"><p class="rail__title">このページ</p><ol id="rail-toc"></ol></div>
    <div class="rail__actions"><button type="button" id="btn-copy-md" title="本文を Markdown に変換してクリップボードへ">Markdown でコピー</button></div>
  </aside>
</div>
<div id="nav-backdrop" class="nav-backdrop" aria-hidden="true"></div>
<div class="search" id="search" role="dialog" aria-modal="true" aria-label="サイト内検索">
  <div class="search__box">
    <input id="search-input" type="search" placeholder="例：Skills、PR 前チェック、AGENTS.md" autocomplete="off" aria-controls="search-list">
    <ul class="search__list" id="search-list"></ul>
    <div class="search__hint">↑↓ で選択、Enter で開く、Esc で閉じる</div>
  </div>
</div>
<script src="/assets/shell.js?v={v}" defer></script>
{scripts}
</body>
</html>
"""


def main():
    pages = read_content()
    order = flat_nav()
    group_of, label_of = {}, {}
    for it, g in order:
        group_of[it["slug"]] = g
        label_of[it["slug"]] = it["label"]
    missing = [s for s in group_of if s not in pages]
    orphan = [s for s in pages if s not in group_of]
    if missing:
        raise SystemExit("site.json にあるが content/ に無い: " + ", ".join(missing))
    if orphan:
        print("注意: ナビ未登録のページ:", ", ".join(orphan))

    (OUT / "assets").mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / "static", OUT, dirs_exist_ok=True)
    css_files = [ROOT / "src/css/legacy.css"] + sorted(p for p in (ROOT / "src/css").glob("*.css") if p.name != "legacy.css")
    css = "\n".join(p.read_text(encoding="utf-8") for p in css_files)
    (OUT / "assets/site.css").write_text(css, encoding="utf-8")
    theme_init = THEME_INIT % json.dumps(SITE["retiredModels"])
    (OUT / "assets/theme-init.js").write_text(theme_init, encoding="utf-8")
    js_hash = hashlib.md5(theme_init.encode())
    for p in sorted((ROOT / "src/js").glob("*.js")):
        data = p.read_bytes()
        js_hash.update(data)
        (OUT / "assets" / p.name).write_bytes(data)
    v = hashlib.md5(css.encode() + js_hash.digest()).hexdigest()[:8]
    (OUT / "assets/favicon.svg").write_text(ICON["brand"].replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replace("var(--theme-accent)", "#2447c6").replace("var(--theme-bg)", "#f7f9fc").replace("var(--signal)", "#d4411e"), encoding="utf-8")

    slugs = [it["slug"] for it, _ in order]
    search, chapters, sections = [], [], []
    for slug, p in pages.items():
        body = ensure_heading_ids(p["body"])
        g = group_of.get(slug, {"title": "その他", "key": "ref"})
        pager = ""
        if p.get("kind") != "flow" and slug in slugs and slug != "index":
            i = slugs.index(slug)
            prev = f'<a class="prev" href="{slugs[i-1]}.html"><small>前へ</small><b>{E(label_of[slugs[i-1]])}</b></a>' if i > 0 else "<span></span>"
            nxt = f'<a class="next" href="{slugs[i+1]}.html"><small>次へ</small><b>{E(label_of[slugs[i+1]])}</b></a>' if i + 1 < len(slugs) else ""
            pager = f'<nav class="pager" aria-label="前後のページ">{prev}{nxt}</nav>'
        scripts = ['/assets/site-prefs.js', '/assets/site-chat.js', '/assets/site-code-copy.js'] + SITE["pageScripts"].get(slug, [])
        script_html = "\n".join(f'<script src="{s}?v={v}" defer></script>' for s in scripts)
        title = p["title"] if slug == "index" else f'{p["title"]} | {SITE["name"]}'
        page_html = LAYOUT.format(
            title=E(title), desc=E(p.get("desc") or SITE["tagline"]), canonical=f'{SITE["url"]}/{"" if slug == "index" else slug}',
            site_url=SITE["url"], repo=SITE["repo"], v=v, site=E(SITE["name"]), updated=SITE["updated"],
            body_class=" ".join(filter(None, ["site-chat-enabled", "kind-" + p.get("kind", "flow"), SITE["bodyClass"].get(slug, "")])),
            i_menu=ICON["menu"], i_brand=ICON["brand"], i_search=ICON["search"], i_sun=ICON["sun"], i_moon=ICON["moon"],
            cur_trends=' aria-current="page"' if slug == "trends-2026" else "", cur_news=' aria-current="page"' if slug == "ai-news" else "",
            model_options=model_options(), sidebar=sidebar(slug, group_of), body=body,
            page_meta="" if slug in ("index", "ai-news") else page_meta_line(p), pager=pager, scripts=script_html)
        (OUT / f"{slug}.html").write_text(page_html, encoding="utf-8")

        heads = [(m.group(2), text_of(m.group(3))) for m in re.finditer(r'<(h[23])\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</\1>', body, re.S)]
        heads = [(i, t) for i, t in heads if t]
        search.append({"u": f"{slug}.html", "t": p["title"], "g": g["title"], "d": p.get("desc", ""), "h": heads[:60],
                       "x": text_of(body)[:2400], "top": slug in ("guide-setup", "guide-rules", "trends-2026", "handbook", "guide-workflow", "flow-rules-samples")})
        if slug in slugs and slug != "index":
            chapters.append({"page": f"{slug}.html", "eid": slug, "title": p["title"], "navLabel": label_of[slug], "category": g["title"],
                             "categoryKey": g["key"], "docKind": "考え方" if p.get("kind") == "handbook" else "手順", "lead": p.get("desc", ""), "inSidebar": True})
            for m in re.finditer(r'<(h[23])\b[^>]*\bid="([^"]+)"[^>]*>(.*?)</\1>', body, re.S):
                if len([s for s in sections if s["page"] == f"{slug}.html"]) < 4 and text_of(m.group(3)):
                    sections.append({"page": f"{slug}.html", "sectionId": m.group(2), "title": text_of(m.group(3)), "level": m.group(1), "category": g["key"]})

    (OUT / "assets/search-index.json").write_text(json.dumps(search, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "data").mkdir(exist_ok=True)
    (OUT / "data/site-index.json").write_text(json.dumps({"version": 2, "generatedFrom": "build.py", "chapters": chapters, "sections": sections}, ensure_ascii=False), encoding="utf-8")

    lines = [f'# {SITE["name"]}', "", f'> {SITE["tagline"]}。AIコーディングエージェント（Claude Code / Codex / Cursor）を前提にした開発の手順ガイドと、考え方をまとめたハンドブック。最終更新 {SITE["updated"]}。', ""]
    for g in SITE["nav"]:
        lines += [f'## {g["title"]}', ""]
        for it in g["items"]:
            for x in [it] + it.get("children", []):
                d = pages[x["slug"]].get("desc", "")
                lines.append(f'- [{pages[x["slug"]]["title"]}]({SITE["url"]}/{x["slug"]}.html)' + (f": {d}" if d else ""))
        lines.append("")
    (OUT / "llms.txt").write_text("\n".join(lines), encoding="utf-8")
    sm = "".join(f'<url><loc>{SITE["url"]}/{"" if s == "index" else s}</loc><lastmod>{pages[s].get("reviewed") or SITE["reviewedDefault"][pages[s].get("kind", "flow")]}</lastmod></url>' for s in slugs)
    (OUT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sm}</urlset>', encoding="utf-8")
    (OUT / "robots.txt").write_text(f'User-agent: *\nAllow: /\nSitemap: {SITE["url"]}/sitemap.xml\n', encoding="utf-8")

    broken = check_links(pages)
    print(f"{len(pages)} ページを public/ に出力しました（v={v}）")
    if broken:
        print(f"リンク切れ {len(broken)} 件:")
        for b in broken[:40]:
            print("  ", b)
        sys.exit(1)


if __name__ == "__main__":
    main()
