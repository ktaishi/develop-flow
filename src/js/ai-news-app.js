/* global document, fetch, DOMParser, AbortSignal */

const ITEMS_PER_FEED = 4;
const ITEMS_PER_FEED_QZ = 8;
const MAX_STREAM_ITEMS = 250;
const ATOM_NS = "http://www.w3.org/2005/Atom";
const FETCH_CONCURRENCY = 12;
const TRANSLATE_BATCH = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FAILED_FEEDS_STORAGE_KEY = "ai-news:failed-feeds:v1";

/** タグチップと一致する 16 ソース */
const QZ_FEED_IDS = new Set([
  "qiita-ai",
  "qiita-llm",
  "qiita-genai",
  "qiita-cursor",
  "qiita-claude",
  "qiita-openai",
  "qiita-rag",
  "zenn-ai",
  "zenn-llm",
  "zenn-genai",
  "zenn-cursor",
  "zenn-claude",
  "zenn-claudecode",
  "zenn-openai",
  "zenn-rag",
  "zenn-codex",
]);

/** Qiita/Zenn トピック絞り込み（約10語） */
const TOPIC_FILTERS = [
  { id: "", label: "すべて", feedIds: null },
  { id: "ai", label: "AI", feedIds: ["qiita-ai", "zenn-ai"] },
  { id: "llm", label: "LLM", feedIds: ["qiita-llm", "zenn-llm"] },
  { id: "genai", label: "生成AI", feedIds: ["qiita-genai", "zenn-genai"] },
  { id: "cursor", label: "Cursor", feedIds: ["qiita-cursor", "zenn-cursor"] },
  { id: "claude", label: "Claude", feedIds: ["qiita-claude", "zenn-claude", "zenn-claudecode"] },
  { id: "openai", label: "OpenAI", feedIds: ["qiita-openai", "zenn-openai"] },
  { id: "rag", label: "RAG", feedIds: ["qiita-rag", "zenn-rag"] },
  { id: "codex", label: "Codex", feedIds: ["zenn-codex"] },
];

const TOPIC_FEED_IDS = new Map(
  TOPIC_FILTERS.filter((topic) => topic.id).map((topic) => [topic.id, new Set(topic.feedIds)])
);

/** 初回表示を早める優先ソース */
const QZ_PRIORITY_IDS = new Set([
  "qiita-ai",
  "zenn-ai",
  "zenn-claude",
  "zenn-claudecode",
  "zenn-cursor",
  "qiita-cursor",
]);

const TOOLS_FEED_IDS = new Set([
  "cursor-changelog",
  "openai-news",
  "codex-releases",
  "anthropic-news",
  "anthropic-engineering",
  "claude-code-releases",
  "github-changelog",
  "github-blog",
  "github-copilot",
  "github-ai-ml",
  "aws-ml-blog",
  "aws-developer",
  "aws-devops",
  "aws-blog-jp",
  "azure-ai-blog",
  "google-ai-blog",
  "vercel-blog",
  "cloudflare-blog",
  "langchain-blog",
]);

let FEEDS = [];
let FEED_BY_ID = new Map();
let FILTER_CONFIG = {
  ngWords: ["カジノ", "ギャンブル"],
  trustedFeedIds: [],
  arxivFeedIds: [],
  devAiKeywordPattern: "",
  arxivKeywordPattern: "",
  offTopicPattern: "",
};
let devAiRe = null;
let arxivRe = null;
let offTopicRe = null;
let translateEnabled = false;
let activeTopic = "";
let activePlatform = "";
const translationCache = new Map();
const loadedViews = new Set();
const viewArticleCache = new Map();
const viewRawArticleCache = new Map();
const trustedFeedSet = new Set();
const arxivFeedSet = new Set();
/** @type {Set<string>} */
const excludedFeedIds = new Set();

const VIEWS = {
  qiitazenn: () => FEEDS.filter((f) => QZ_FEED_IDS.has(f.id)),
  tools: () => FEEDS.filter((f) => TOOLS_FEED_IDS.has(f.id)),
  other: () =>
    FEEDS.filter(
      (f) => f.category === "japan" && f.tag !== "Qiita" && f.tag !== "Zenn"
    ),
};

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DATE_GROUP_ORDER = ["今日", "昨日", "今週", "それ以前", "日付不明"];

function updateStatsBar({
  shown,
  sources,
  excluded,
  failed,
  hint = "",
  loading = false,
  error = false,
} = {}) {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el && val != null) el.textContent = String(val);
  };
  if (shown != null) setText("stat-shown", shown);
  if (failed != null) {
    const failedCount = Number(failed) || 0;
    setText("stat-failed", failedCount);
    const wrap = document.getElementById("stat-failed-wrap");
    if (wrap) wrap.hidden = failedCount <= 0;
  }
  const statusEl = document.getElementById("load-status");
  if (statusEl) {
    statusEl.textContent = hint;
    statusEl.classList.toggle("is-loading", loading);
    statusEl.classList.toggle("is-error", error);
  }
}

function setLoadStatus(hint, { loading = false, error = false } = {}) {
  updateStatsBar({ hint, loading, error });
}

function setStreamBusy(viewKey, busy) {
  const el = document.getElementById(`stream-${viewKey}`);
  if (el) el.setAttribute("aria-busy", busy ? "true" : "false");
}

function streamLoadingMarkup(message = "記事を取得中…") {
  return (
    '<div class="stream-skeleton" aria-hidden="true">' +
    '<div class="skeleton-item"></div>'.repeat(4) +
    "</div>" +
    `<p class="stream-loading-msg">${escHtml(message)}</p>`
  );
}

function dateGroupKey(pubStr) {
  if (!pubStr) return "日付不明";
  try {
    const d = new Date(pubStr);
    if (Number.isNaN(d.getTime())) return "日付不明";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const articleDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today - articleDay) / 86400000);
    if (diffDays === 0) return "今日";
    if (diffDays === 1) return "昨日";
    if (diffDays < 7) return "今週";
    return "それ以前";
  } catch {
    return "日付不明";
  }
}

function groupArticlesByDate(articles) {
  const groups = new Map();
  articles.forEach((article) => {
    const key = dateGroupKey(article.pub);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  });
  return DATE_GROUP_ORDER.filter((key) => groups.has(key)).map((label) => ({
    label,
    items: groups.get(label),
  }));
}

function loadExcludedFeeds() {
  excludedFeedIds.clear();
  try {
    const raw = localStorage.getItem(FAILED_FEEDS_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const ids = Array.isArray(data?.ids) ? data.ids : [];
    ids.forEach((id) => {
      if (typeof id === "string" && id) excludedFeedIds.add(id);
    });
  } catch {
    /* ignore corrupt storage */
  }
}

function saveExcludedFeeds() {
  try {
    localStorage.setItem(
      FAILED_FEEDS_STORAGE_KEY,
      JSON.stringify({
        ids: [...excludedFeedIds],
        updatedAt: new Date().toISOString(),
      })
    );
  } catch {
    /* ignore quota errors */
  }
}

function markFeedFailed(feed) {
  if (!feed?.id || excludedFeedIds.has(feed.id)) return;
  excludedFeedIds.add(feed.id);
  saveExcludedFeeds();
}

function formatLoadHint(base = "") {
  const skipped = excludedFeedIds.size;
  if (!skipped) return base;
  const suffix = `${skipped} ソース除外（取得失敗）`;
  return base ? `${base} · ${suffix}` : suffix;
}

function activeFeedsForView(viewKey) {
  const viewFn = VIEWS[viewKey];
  if (!viewFn) return [];
  return filterFeeds(viewFn());
}

function renderStreamItem(it) {
  const mod = streamItemModifier(it);
  const modClass = mod ? ` ${mod}` : "";
  const timeHtml = it.pub
    ? `<span class="stream-time">${escHtml(fmtDate(it.pub))}</span>`
    : "";
  const sourceLabel = it.feedTitle || it.feedTag;
  return `
    <div class="stream-item${modClass}" data-link="${escHtml(safeLink(it.link))}">
      <a class="stream-item-link" href="${escHtml(safeLink(it.link))}" target="_blank" rel="noopener noreferrer">
        <div class="stream-icon" style="background:${escHtml(it.feedIconBg)}">${it.feedIcon}</div>
        <div class="stream-body">
          <div class="stream-title">${escHtml(it.title)}</div>
          <div class="stream-meta">
            <span class="item-tag">${escHtml(it.feedTag)}</span>
            <span>${escHtml(sourceLabel)}</span>
            ${timeHtml}
          </div>
        </div>
      </a>
      <div class="stream-actions">
        <span class="stream-external" aria-hidden="true">↗</span>
      </div>
    </div>`;
}

function updateStreamCount(viewKey, count) {
  const el = document.getElementById(`stream-count-${viewKey}`);
  if (!el) return;
  if (count > 0) {
    el.textContent = `${count} 件`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function safeLink(url) {
  try {
    const u = new URL(String(url || ""), location.href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "#";
  } catch {
    return "#";
  }
}

function streamItemModifier(it) {
  if (it.feedTag === "Qiita") return "stream-item--qiita";
  if (it.feedTag === "Zenn") return "stream-item--zenn";
  if (TOOLS_FEED_IDS.has(it.feedId)) return "stream-item--tools";
  return "";
}

const PRODUCTION_AI_NEWS_URL =
  "https://develop-flow.vercel.app/ai-news.html";

function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function showBootstrapError(message) {
  setLoadStatus("読み込みエラー", { error: true });
  ["stream-qiitazenn", "stream-tools", "stream-other"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = `<div class="stream-empty">${escHtml(message)}</div>`;
    }
  });
}

function normalizeMatchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function titleDedupeKey(title) {
  return normalizeMatchText(title)
    .replace(/[「」『』【】[\]()（）]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff\s]/gi, "")
    .slice(0, 220);
}

function compileFilters() {
  trustedFeedSet.clear();
  arxivFeedSet.clear();
  FILTER_CONFIG.trustedFeedIds.forEach((id) => trustedFeedSet.add(id));
  FILTER_CONFIG.arxivFeedIds.forEach((id) => arxivFeedSet.add(id));
  devAiRe = FILTER_CONFIG.devAiKeywordPattern
    ? new RegExp(FILTER_CONFIG.devAiKeywordPattern, "i")
    : null;
  arxivRe = FILTER_CONFIG.arxivKeywordPattern
    ? new RegExp(FILTER_CONFIG.arxivKeywordPattern, "i")
    : null;
  offTopicRe = FILTER_CONFIG.offTopicPattern
    ? new RegExp(FILTER_CONFIG.offTopicPattern, "i")
    : null;
}

function hasNgWord(text) {
  const t = normalizeMatchText(text);
  if (!t) return false;
  return FILTER_CONFIG.ngWords.some((word) => {
    const w = String(word).toLowerCase();
    return w && t.includes(w);
  });
}

function isRelevantToAiDev(title, feed) {
  const t = normalizeMatchText(title);
  if (!t || t === "(no title)") return false;

  if (offTopicRe && offTopicRe.test(t) && !(devAiRe && devAiRe.test(t))) {
    return false;
  }

  if (feed && trustedFeedSet.has(feed.id)) {
    return true;
  }

  if (feed && arxivFeedSet.has(feed.id)) {
    return arxivRe ? arxivRe.test(t) : devAiRe?.test(t);
  }

  if (feed && (feed.category === "tools" || feed.category === "practice")) {
    return devAiRe ? devAiRe.test(t) : true;
  }

  return devAiRe ? devAiRe.test(t) : false;
}

function postProcessArticles(articles) {
  const stats = { total: articles.length, ng: 0, offTopic: 0, duplicate: 0 };
  const passed = [];

  articles.forEach((article) => {
    const feed = FEED_BY_ID.get(article.feedId);
    const checkTitle = article.titleOriginal || article.title;

    if (hasNgWord(checkTitle) || hasNgWord(article.title)) {
      stats.ng += 1;
      return;
    }

    if (!isRelevantToAiDev(checkTitle, feed) && !isRelevantToAiDev(article.title, feed)) {
      stats.offTopic += 1;
      return;
    }

    passed.push(article);
  });

  const byTitle = new Map();
  passed.forEach((article) => {
    const key = titleDedupeKey(article.title);
    const prev = byTitle.get(key);
    if (!prev) {
      byTitle.set(key, article);
      return;
    }
    stats.duplicate += 1;
    if (article.sortTime > prev.sortTime) {
      byTitle.set(key, article);
    }
  });

  return {
    articles: Array.from(byTitle.values()),
    stats,
  };
}

function isMostlyJapanese(text) {
  const t = String(text || "");
  if (!t) return true;
  const cjk = (t.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) || []).length;
  return cjk / t.length >= 0.18;
}

async function fetchRSS(url) {
  const cacheKey = `rss:${url}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const { ts, body } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL_MS && body && parseItems(body, 1).length) {
        return body;
      }
      sessionStorage.removeItem(cacheKey);
    }
  } catch {
    /* ignore */
  }

  const proxy = `/api/rss?url=${encodeURIComponent(url)}`;
  const res = await fetchWithTimeout(proxy, {}, 15000);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err && err.error) detail = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const body = await res.text();

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), body }));
  } catch {
    /* ignore */
  }

  return body;
}

function atomChildren(parent, localName) {
  const ns = [...parent.getElementsByTagNameNS(ATOM_NS, localName)];
  if (ns.length) return ns;
  return [...parent.getElementsByTagName("*")].filter((n) => n.localName === localName);
}

function atomText(parent, localName) {
  const el = atomChildren(parent, localName)[0];
  return el?.textContent?.trim() || "";
}

function atomEntryLink(entry) {
  const links = atomChildren(entry, "link");
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const rel = link.getAttribute("rel") || "";
    if (rel === "alternate" || rel === "") return href;
  }
  for (const link of links) {
    const href = link.getAttribute("href");
    if (href) return href;
  }
  const url = atomText(entry, "url");
  return url || "#";
}

function parseItems(xml, limit) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const items = [];

  if (doc.querySelector("parsererror")) {
    return items;
  }

  const rssItems = doc.querySelectorAll("channel > item");
  if (rssItems.length) {
    rssItems.forEach((item, i) => {
      if (i >= limit) return;
      const title = item.querySelector("title")?.textContent?.trim() || "(no title)";
      const link =
        item.querySelector("link")?.textContent?.trim() ||
        item.querySelector("link")?.getAttribute("href") ||
        "#";
      const pub = item.querySelector("pubDate")?.textContent?.trim() || "";
      items.push({ title, link, pub });
    });
    return items;
  }

  const entries = atomChildren(doc, "entry");
  entries.forEach((entry, i) => {
    if (i >= limit) return;
    const title = atomText(entry, "title") || "(no title)";
    const link = atomEntryLink(entry);
    const pub =
      atomText(entry, "updated") ||
      atomText(entry, "published") ||
      atomText(entry, "pubDate") ||
      "";
    items.push({ title, link, pub });
  });

  return items;
}

function parseDate(str) {
  if (!str) return 0;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function fmtDate(str) {
  if (!str) return "";
  try {
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const diffH = Math.round((now - d) / 3600000);
    if (diffH < 1) return "< 1時間前";
    if (diffH < 24) return `${diffH}時間前`;
    const diffD = Math.round(diffH / 24);
    if (diffD < 7) return `${diffD}日前`;
    return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

async function translateTitles(items, feedLang) {
  if (!translateEnabled) return items;

  const need = items.filter((it) => {
    if (feedLang === "ja") return false;
    if (isMostlyJapanese(it.title)) return false;
    const src = it.titleOriginal || it.title;
    return !translationCache.has(src);
  });

  const unique = [...new Set(need.map((it) => it.titleOriginal || it.title))];

  const batches = [];
  for (let i = 0; i < unique.length; i += TRANSLATE_BATCH) {
    batches.push(unique.slice(i, i + TRANSLATE_BATCH));
  }
  await Promise.allSettled(
    batches.map(async (batch) => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: batch }),
        });
        if (res.ok) {
          const data = await res.json();
          const map = data.translations || {};
          Object.entries(map).forEach(([src, dst]) => translationCache.set(src, dst));
        }
      } catch {
        /* keep original */
      }
    })
  );

  return items.map((it) => {
    const src = it.titleOriginal || it.title;
    return {
      ...it,
      title: translationCache.get(src) || it.title,
      titleOriginal: src,
    };
  });
}

function itemsPerFeedForView(viewKey) {
  return viewKey === "qiitazenn" ? ITEMS_PER_FEED_QZ : ITEMS_PER_FEED;
}

async function loadFeedArticles(feed, itemLimit) {
  const limit = itemLimit ?? ITEMS_PER_FEED;
  const xml = await fetchRSS(feed.url);
  const parsed = parseItems(xml, limit);
  const withOriginal = parsed.map((it) => ({ ...it, titleOriginal: it.title }));
  const translated = await translateTitles(withOriginal, feed.lang || "en");
  return translated.map((it) => ({
    ...it,
    feedId: feed.id,
    feedTitle: feed.title,
    feedTag: feed.tag,
    feedIcon: feed.icon,
    feedIconBg: feed.iconBg,
    sortTime: parseDate(it.pub),
    titleOriginal: it.titleOriginal || it.title,
  }));
}

async function fetchFeedsBatch(feeds, perFeed) {
  const articles = [];
  let failed = 0;
  let index = 0;

  async function runner() {
    while (index < feeds.length) {
      const feed = feeds[index++];
      try {
        const batch = await loadFeedArticles(feed, perFeed);
        articles.push(...batch);
      } catch {
        failed += 1;
        markFeedFailed(feed);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, Math.max(feeds.length, 1)) },
    () => runner()
  );
  await Promise.all(workers);
  return { articles, failed };
}

function filterFeeds(feeds) {
  return feeds.filter((feed) => !excludedFeedIds.has(feed.id));
}

function filterArticlesForDisplay(articles) {
  let result = articles;
  if (activePlatform) {
    result = result.filter((a) => a.feedTag === activePlatform);
  }
  if (activeTopic) {
    const feedIds = TOPIC_FEED_IDS.get(activeTopic);
    if (feedIds) {
      result = result.filter((a) => feedIds.has(a.feedId));
    }
  }
  return result;
}

function refreshActiveViewDisplay() {
  const viewKey = getActiveViewKey();
  const cached = viewArticleCache.get(viewKey);
  if (!cached || !loadedViews.has(viewKey)) return;
  renderStream(viewKey, cached, { emptyIsFilter: viewKey === "qiitazenn" });
  syncStatsFromView(viewKey, cached);
}

function syncStatsFromView(viewKey, articles) {
  const shown = filterArticlesForDisplay(articles).length;
  updateStreamCount(viewKey, shown);
  updateStatsBar({ shown, hint: formatLoadHint() });
}

function getActiveViewKey() {
  const active = document.querySelector(".tab-btn.active");
  return active ? active.dataset.view : "qiitazenn";
}

function updateTagPanelVisibility(viewKey) {
  const panel = document.getElementById("tag-panel");
  if (panel) {
    panel.hidden = viewKey !== "qiitazenn";
  }
}

function updateTopicChipUI() {
  document.querySelectorAll(".tag-chip[data-topic]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.topic === activeTopic);
  });
}

function topicFilterLabel() {
  const topic = TOPIC_FILTERS.find((item) => item.id === activeTopic);
  if (topic?.label) return topic.label;
  if (activePlatform) return activePlatform;
  return "すべて";
}

function switchToQiitaZennTab() {
  const tab = document.querySelector('.tab-btn[data-view="qiitazenn"]');
  const viewEl = document.getElementById("view-qiitazenn");
  if (!tab || !viewEl) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  tab.classList.add("active");
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  viewEl.classList.add("active");
  updateTagPanelVisibility("qiitazenn");
}

function finalizeArticles(allArticles) {
  const { articles, stats } = postProcessArticles(allArticles);
  articles.sort((a, b) => b.sortTime - a.sortTime);
  return { sliced: articles.slice(0, MAX_STREAM_ITEMS), stats };
}

function storeViewCache(viewKey, sliced) {
  const raw = sliced.map((a) => ({
    ...a,
    title: a.titleOriginal || a.title,
  }));
  viewRawArticleCache.set(viewKey, raw);
  viewArticleCache.set(viewKey, sliced);
}

function publishLoadStats({ articles, feedCount, stats, failed, phaseHint = "" }) {
  const shown = filterArticlesForDisplay(articles).length;
  updateStatsBar({
    shown,
    failed,
    hint: formatLoadHint(phaseHint),
    loading: Boolean(phaseHint),
  });
}

function refreshQiitaZennDisplay() {
  const viewKey = "qiitazenn";
  const cached = viewArticleCache.get(viewKey);
  if (!cached || !loadedViews.has(viewKey)) {
    switchToQiitaZennTab();
    loadView(viewKey);
    return;
  }
  renderStream(viewKey, cached, { emptyIsFilter: true });
  syncStatsFromView(viewKey, cached);
  const label = topicFilterLabel();
  setLoadStatus(`${label} で絞り込み中`);
}

function setActiveTopicFilter(topicId) {
  activeTopic = topicId || "";
  updateTopicChipUI();
  refreshQiitaZennDisplay();
}

function renderTopicChips() {
  const row = document.getElementById("tag-chip-row");
  if (!row) return;
  row.innerHTML = "";
  TOPIC_FILTERS.forEach((topic) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-chip topic-chip";
    btn.dataset.topic = topic.id;
    btn.textContent = topic.label;
    btn.setAttribute("aria-label", `${topic.label}で絞り込み`);
    row.appendChild(btn);
  });
  updateTopicChipUI();
}

function bindTagChips() {
  const row = document.getElementById("tag-chip-row");
  if (!row) return;
  row.addEventListener("click", (event) => {
    const btn = event.target.closest(".tag-chip[data-topic]");
    if (!btn) return;
    const id = btn.dataset.topic || "";
    setActiveTopicFilter(activeTopic === id ? "" : id);
  });
}

function bindPlatformFilter() {
  document.querySelectorAll(".platform-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activePlatform = btn.dataset.platform || "";
      document.querySelectorAll(".platform-chip").forEach((chip) => {
        chip.classList.toggle("is-active", chip === btn);
      });
      activeTopic = "";
      updateTopicChipUI();
      refreshQiitaZennDisplay();
    });
  });
}

function renderStream(viewKey, articles, options = {}) {
  const el = document.getElementById(`stream-${viewKey}`);
  if (!el) return;

  const display = filterArticlesForDisplay(articles);

  if (!display.length) {
    let title = "記事がありません";
    let msg;
    if (options.stillLoading) {
      el.innerHTML = streamLoadingMarkup(
        "記事を取得中…（残りのソースを読み込んでいます）"
      );
      setStreamBusy(viewKey, true);
      return;
    }
    if (options.emptyIsFilter && (activeTopic || activePlatform)) {
      title = "条件に一致する記事がありません";
      msg = "トピックやプラットフォームの絞り込みを変更してみてください。";
    } else if (options.fetchFailed > 0 && options.feedCount > 0) {
      title = "取得に失敗しました";
      msg = `RSS の取得に失敗しました（${options.fetchFailed}/${options.feedCount} ソース）。失敗したソースは次回から除外されます。`;
    } else {
      msg =
        "記事を取得できませんでした。しばらくして再読み込みしてください。";
    }
    el.innerHTML = `<div class="stream-empty"><p class="stream-empty-title">${escHtml(title)}</p><p class="stream-empty-desc">${escHtml(msg)}</p></div>`;
    setStreamBusy(viewKey, false);
    updateStreamCount(viewKey, 0);
    return;
  }

  const grouped = groupArticlesByDate(display);
  el.innerHTML = grouped
    .map(
      (group) => `
    <section class="stream-group">
      <h3 class="stream-group-label">${escHtml(group.label)}</h3>
      <div class="stream-group-items">
        ${group.items.map((it) => renderStreamItem(it)).join("")}
      </div>
    </section>`
    )
    .join("");
  setStreamBusy(viewKey, false);
  updateStreamCount(viewKey, display.length);
}

function renderFromRawCache(viewKey) {
  const raw = viewRawArticleCache.get(viewKey);
  if (!raw) return false;
  const display = raw.map((a) => ({
    ...a,
    title: translateEnabled
      ? translationCache.get(a.titleOriginal || a.title) || a.title
      : a.titleOriginal || a.title,
  }));
  viewArticleCache.set(viewKey, display);
  renderStream(viewKey, display);
  return true;
}

async function applyTranslateToView(viewKey) {
  const raw = viewRawArticleCache.get(viewKey);
  if (!raw || !loadedViews.has(viewKey)) {
    await loadView(viewKey);
    return;
  }

  if (!translateEnabled) {
    renderFromRawCache(viewKey);
    return;
  }

  setLoadStatus("翻訳中…", { loading: true });

  const pseudoItems = raw.map((a) => ({
    title: a.titleOriginal || a.title,
    titleOriginal: a.titleOriginal || a.title,
    link: a.link,
    pub: a.pub,
  }));
  const translated = await translateTitles(pseudoItems, "en");
  const merged = raw.map((a, i) => ({
    ...a,
    title: translated[i]?.title || a.titleOriginal || a.title,
    titleOriginal: a.titleOriginal || a.title,
  }));
  viewArticleCache.set(viewKey, merged);
  renderStream(viewKey, merged);

  const shown = filterArticlesForDisplay(merged).length;
  updateStatsBar({
    shown,
    hint: translateEnabled ? "翻訳 ON" : "",
  });
  updateStreamCount(viewKey, shown);
}

async function loadView(viewKey) {
  const allFeeds = activeFeedsForView(viewKey);
  const streamEl = document.getElementById(`stream-${viewKey}`);
  const perFeed = itemsPerFeedForView(viewKey);
  const totalDefined = VIEWS[viewKey] ? VIEWS[viewKey]().length : 0;

  if (!streamEl) return;

  streamEl.innerHTML = streamLoadingMarkup();
  setStreamBusy(viewKey, true);

  updateStatsBar({
    hint: formatLoadHint(
      allFeeds.length > 0
        ? `${allFeeds.length} ソースを読み込み中…`
        : totalDefined > 0
          ? "取得可能なソースがありません"
          : "対象ソースがありません"
    ),
    loading: allFeeds.length > 0,
  });

  if (!allFeeds.length) {
    const title =
      totalDefined > 0 ? "取得可能なソースがありません" : "ソースがありません";
    const msg =
      totalDefined > 0
        ? `${excludedFeedIds.size} 件のソースは取得失敗のため除外されています。`
        : "表示する RSS ソースが定義されていません。";
    streamEl.innerHTML = `<div class="stream-empty"><p class="stream-empty-title">${escHtml(title)}</p><p class="stream-empty-desc">${escHtml(msg)}</p></div>`;
    setStreamBusy(viewKey, false);
    loadedViews.add(viewKey);
    updateTabCounts();
    return;
  }

  const usePhased = viewKey === "qiitazenn";
  const allArticles = [];
  let totalFailed = 0;

  if (usePhased) {
    const priority = allFeeds.filter((f) => QZ_PRIORITY_IDS.has(f.id));
    const rest = allFeeds.filter((f) => !QZ_PRIORITY_IDS.has(f.id));

    const phaseA = await fetchFeedsBatch(priority, perFeed);
    allArticles.push(...phaseA.articles);
    totalFailed += phaseA.failed;

    let { sliced, stats } = finalizeArticles(allArticles);
    storeViewCache(viewKey, sliced);
    renderStream(viewKey, sliced, {
      stillLoading: rest.length > 0,
      fetchFailed: totalFailed,
      feedCount: priority.length,
    });
    loadedViews.add(viewKey);

    publishLoadStats({
      articles: sliced,
      feedCount: priority.length,
      stats,
      failed: totalFailed,
      phaseHint: rest.length ? `残り ${rest.length} ソース読込中…` : "",
    });

    if (rest.length) {
      const phaseB = await fetchFeedsBatch(rest, perFeed);
      allArticles.push(...phaseB.articles);
      totalFailed += phaseB.failed;

      ({ sliced, stats } = finalizeArticles(allArticles));
      storeViewCache(viewKey, sliced);
      renderStream(viewKey, sliced, {
        fetchFailed: totalFailed,
        feedCount: allFeeds.length,
      });

      publishLoadStats({
        articles: sliced,
        feedCount: allFeeds.length,
        stats,
        failed: totalFailed,
      });
    }
  } else {
    const batch = await fetchFeedsBatch(allFeeds, perFeed);
    allArticles.push(...batch.articles);
    totalFailed = batch.failed;

    const { sliced, stats } = finalizeArticles(allArticles);
    storeViewCache(viewKey, sliced);
    renderStream(viewKey, sliced, {
      fetchFailed: totalFailed,
      feedCount: allFeeds.length,
    });
    loadedViews.add(viewKey);

    publishLoadStats({
      articles: sliced,
      feedCount: allFeeds.length,
      stats,
      failed: totalFailed,
    });
  }

  document.getElementById("last-updated") &&
    (document.getElementById("last-updated").textContent =
      "更新: " +
      new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }));

  updateTabCounts();
  updateStatsBar({ hint: formatLoadHint() });
}

function updateTabCounts() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const key = btn.dataset.view;
    const count = activeFeedsForView(key).length;
    const badge = btn.querySelector(".count");
    if (badge) badge.textContent = String(count);
  });
}

function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      const view = btn.dataset.view;
      document.querySelectorAll(".view").forEach((v) => {
        v.classList.toggle("active", v.id === `view-${view}`);
      });
      updateTagPanelVisibility(view);

      if (view !== "qiitazenn") {
        activeTopic = "";
        updateTopicChipUI();
      }

      if (!loadedViews.has(view)) {
        loadView(view);
      } else {
        const cached = viewArticleCache.get(view);
        if (cached) {
          renderStream(view, cached);
          syncStatsFromView(view, cached);
        }
      }
    });
  });
}

function bindToolbar() {
  const toggle = document.getElementById("translate-toggle");

  if (toggle) {
    toggle.addEventListener("change", () => {
      translateEnabled = toggle.checked;
      applyTranslateToView(getActiveViewKey());
    });
  }
}

async function init() {
  if (location.protocol === "file:") {
    showBootstrapError(
      `このページは file:// では RSS を取得できません。${PRODUCTION_AI_NEWS_URL} を開くか、vercel dev 等で HTTP サーバー経由で表示してください。`
    );
    return;
  }

  setLoadStatus("フィード定義を読み込み中…", { loading: true });
  updateStatsBar({ shown: "—" });

  const [feedsRes, filtersRes] = await Promise.all([
    fetch("/data/ai-news-feeds.json"),
    fetch("/data/ai-news-filters.json"),
  ]);
  if (!feedsRes.ok) {
    throw new Error("フィード定義の読み込みに失敗しました");
  }
  FEEDS = await feedsRes.json();
  FEED_BY_ID = new Map(FEEDS.map((f) => [f.id, f]));
  if (filtersRes.ok) {
    FILTER_CONFIG = { ...FILTER_CONFIG, ...(await filtersRes.json()) };
  }
  compileFilters();
  loadExcludedFeeds();
  renderTopicChips();
  updateTabCounts();
  bindTabs();
  bindToolbar();
  bindTagChips();
  bindPlatformFilter();
  updateTopicChipUI();
  updateTagPanelVisibility("qiitazenn");
  await loadView("qiitazenn");
}

init().catch((err) => {
  showBootstrapError(`初期化エラー: ${err.message}`);
});
