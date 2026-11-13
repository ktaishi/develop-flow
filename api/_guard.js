// API 共通の防御：同一サイトからの呼び出しか、短時間の呼び出し回数が多すぎないかを確認する。
// 回数制限はサーバーレス関数のインスタンス内メモリで数える簡易版。
// 本格的に絞る場合は Vercel の Firewall（Rate Limiting ルール）を併用する。
const SITE_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS || "develop-flow.vercel.app").split(",").map((h) => h.trim()).filter(Boolean)
);
const buckets = new Map();

function hostOf(value) {
  try {
    return new URL(value).host;
  } catch (_e) {
    return "";
  }
}

// ブラウザからの同一サイト呼び出しだけを通す（プレビュー URL と localhost は許可）
function isSameSite(req) {
  const src = req.headers.origin || req.headers.referer || "";
  const host = hostOf(src);
  if (!host) return false;
  if (SITE_HOSTS.has(host)) return true;
  if (host === req.headers.host) return true;
  if (/^develop-flow-[a-z0-9-]+\.vercel\.app$/.test(host)) return true;
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

// key ごとに windowMs あたり limit 回まで
function allow(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    if (buckets.size > 5000) buckets.clear();
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

module.exports = { isSameSite, clientIp, allow };
