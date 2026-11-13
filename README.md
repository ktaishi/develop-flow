# AI利用開発フロー

https://develop-flow.vercel.app のソース。「AI利用開発フロー」（手順ガイド）と「AI開発ベストプラクティス」（全10章ハンドブック）を1つにまとめた静的サイトです。

## 構成

| パス | 役割 |
| --- | --- |
| `content/*.html` | 本文の断片。1行目の `<!--meta {...} -->` にタイトル・説明・種別（`flow` / `handbook` / `home`）・最終更新日（`reviewed`） |
| `site.json` | サイドバーの構成、ページ別スクリプト、「設定」のモデル一覧、読み替える旧モデル ID、最終更新日の既定値 |
| `src/css/` | `legacy.css`（旧フロー本文用）→ `10-tokens` → `20-shell` → `25-unify` → `30-prose` → `40-home` の順に連結 |
| `src/js/` | `shell.js`（メニュー・テーマ・目次・検索・Markdown コピー・Mermaid）と、旧サイトから引き継いだスクリプト |
| `static/` | 画像、`data/*.json`、`assets/vendor/`（mermaid 11.17.2・jszip 3.10.1 を自前配信） |
| `api/` | Vercel Functions。`rss.js`（AIニュースの RSS 中継）、`translate.js`（見出しの日本語訳）、`_guard.js`（共通の防御） |
| `build.py` | ビルド。Python 標準ライブラリのみ。`public/` に HTML・検索索引・`llms.txt`・`sitemap.xml` を出力し、リンク切れがあれば失敗する |

## 使い方

```bash
python3 build.py                                 # public/ を生成（リンク切れがあると exit 1）
python3 -m http.server 8000 --directory public   # ローカル確認（/api は動かない）
```

`main` に push すると Vercel が本番にデプロイし、プルリクエストごとにプレビュー URL が発行されます（Vercel と GitHub の連携が必要）。

## 書き方のルール

- ページを足す: `content/<slug>.html` を作り、`site.json` の `nav` に追加する。新規ページは `<div class="hb">…</div>` で囲む。
- 内容を見直したら、そのページの meta に `"reviewed": "YYYY-MM-DD"` を入れる。4か月以上前の日付のページには注意表示が出る。
- 本文に `<script>` や `onclick` などのイベント属性は書けない（CSP で止まるため、ビルドが失敗する）。動きが必要なら `src/js/` に置き、`site.json` の `pageScripts` で読み込む。
- 色や書体を変える: `src/css/10-tokens.css` だけを編集する（ライト / ダーク両方）。

## セキュリティ

- CSP（`vercel.json`）でスクリプトは自サイトのものだけに限定している。外部ライブラリは `static/assets/vendor/` に置いて配信する。
- 「設定」の OpenAI API キーは閲覧者のブラウザ（localStorage）にだけ保存される。XSS がそのままキーの漏えいにつながるため、本文や AI の回答を `innerHTML` に入れる箇所は必ずエスケープする。
- `api/` は同一サイトからの呼び出し（Origin / Referer）に限り、インスタンス内で回数を制限している。Referer は偽装できるため、強く絞る場合は Vercel Firewall の Rate Limiting を併用する。

### 環境変数（Vercel）

| 名前 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | 見出し翻訳。未設定なら原題のまま表示 |
| `TRANSLATE_MODEL` | 翻訳モデル（既定 `gpt-6-luna`） |
| `TRANSLATE_LIMIT_PER_IP` / `TRANSLATE_LIMIT_TOTAL` | 1時間あたりの翻訳回数の上限（既定 20 / 300） |
| `ALLOWED_HOSTS` | API を呼べるホスト（既定 `develop-flow.vercel.app`、カンマ区切り） |
