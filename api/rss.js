// RSS プロキシ。static/data/ai-news-feeds.json に載っている URL だけを中継する。
const feeds = require("../static/data/ai-news-feeds.json");
const { isSameSite, clientIp, allow } = require("./_guard");

const ALLOWED = new Set(feeds.map((f) => f.url));
const MAX_BYTES = 3 * 1024 * 1024;

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!isSameSite(req)) return res.status(403).json({ error: "This endpoint is for develop-flow pages only" });
  if (!allow("rss:" + clientIp(req), 300, 60_000)) return res.status(429).json({ error: "Too many requests" });

  const url = String((req.query && req.query.url) || "");
  if (!ALLOWED.has(url)) return res.status(400).json({ error: "Invalid or disallowed feed URL" });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const upstream = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "develop-flow-ai-news/2.1 (+https://develop-flow.vercel.app)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    if (!upstream.ok) {
      clearTimeout(timer);
      return res.status(502).json({ error: `Upstream HTTP ${upstream.status}` });
    }
    if (!/^https?:$/.test(new URL(upstream.url).protocol)) {
      clearTimeout(timer);
      return res.status(502).json({ error: "Unexpected redirect" });
    }
    const body = await readLimited(upstream);
    clearTimeout(timer);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=1800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(body);
  } catch (err) {
    if (err && err.code === "TOO_LARGE") return res.status(502).json({ error: "Feed too large" });
    return res.status(504).json({ error: err && err.name === "AbortError" ? "Upstream timeout" : "Fetch failed" });
  }
};
