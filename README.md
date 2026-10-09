# LUNA AI（PWA）

仕組み章（LUNA SUPER ENGINE / 記憶 / AI TOOLS / モデル切替）に基づく実装です。ビルド不要の静的ファイルで動きます。

## 構成

```
index.html            画面の骨格
manifest.webmanifest  PWA定義
sw.js                 Service Worker（アプリ本体のオフライン起動）
icon.svg              アイコン
src/
  main.js             起動・チャットUI・/スキル サジェスト
  store/db.js         IndexedDB ラッパー
  store/config.js     設定（APIキー・切替・既定値）
  core/lse.js         LSEフィルター（応答 → Block[]）
  core/orchestrator.js 1ターン実行（コンテキスト構築・ツールループ）
  core/router.js      ModelRouter（Groq → Cerebras → Gemini）
  core/memory.js      長期記憶・会話短期記憶・自動提示
  core/skills.js      Skills（CRUD・/name展開）
  core/tools.js       AI TOOLS（web_search / memory_*）
  ui/render.js        Block → DOM（Markdown・コード・マインドマップ・ステップカード）
  ui/popups.js        切替通知・質問ポップアップ・トースト
  ui/settings.js      設定（モデル・記憶・スキル）
  styles/app.css
```

## ローカルで試す

ES Modules と Service Worker は `file://` では動きません。簡易サーバーで開いてください。

```
cd luna
python3 -m http.server 8000
# → http://localhost:8000
```

## GitHub Pages で公開

1. リポジトリを作成し、`luna/` の中身（index.html など）をルートに置いてpush
2. Settings > Pages > Source を `main` ブランチのルートに設定
3. 公開URL（https://<user>.github.io/<repo>/）を、iPhone/Androidのブラウザで開き「ホーム画面に追加」

Service Worker を使うため https 配信が必要です（GitHub Pages は https）。

## 初回設定

設定（⚙）> モデル で以下を入力してください。

- Groq / Cerebras / Gemini の APIキー（少なくとも1つ）
- Web検索を使う場合は Tavily のAPIキー

## 注意点

- **APIキーはブラウザ内（IndexedDB）に保存されます。** 個人利用前提です。リポジトリにキーを含めないでください。
- Groq・Cerebras・Gemini を直接ブラウザから呼びます。CORS やレート制限は各サービスの仕様に依存するため、テストで動作確認してください。
- Web検索は Tavily API を想定しています。ブラウザからの直接呼び出しが制限される場合は、検索処理を小さなプロキシ経由に差し替えてください（`src/core/tools.js` の `webSearch` のみ変更すれば済みます）。
- モデルIDは `openai/gpt-oss-120b`（Groq）と `gpt-oss-120b`（Cerebras）としています。違う場合は `src/core/router.js` の `models` を変更してください。
- Markdown描画は CDN（markdown-it / DOMPurify）を使用しています。オフライン時はプレーンテキスト表示になります。
- アプリアイコンは簡易版です。`icon.svg` を差し替えてください。

## 次の工程（テスト観点）

- 制限時の自動切替とポップアップ（Groq → Cerebras → Gemini）
- `/スキル名` の展開・未知スキルの表示
- 記憶の自動提示が1ターン2件まで・クールダウンを守るか
- 短期記憶がチャット外に漏れないか
- LSE：不正なディレクティブがMarkdownにフォールバックするか
- PWAのインストールとオフライン起動


## 新機能（Firebase / チャットツリー V2）

### Firebase Authentication と安全なAIプロキシ

1. Firebase ConsoleでプロジェクトとWebアプリを作成する。
2. AuthenticationでGoogleまたはメール/パスワードのサインイン方法を有効にし、承認済みドメインに `takasi-nakamura.github.io` を追加する。
3. リポジトリの `functions/.env.example` を参考に、ローカルで `functions/.env.<FirebaseのProject ID>` を作成する。実際の `GROQ_API_KEY` / `CEREBRAS_API_KEY` / `GEMINI_API_KEY` はこのローカルファイルにだけ記入し、GitHubへコミットしない。
4. Firebase CLIを使い、`firebase login`、`firebase use <Project ID>`、`cd functions && npm install`、リポジトリルートに戻って `firebase deploy --only functions` を実行する。Cloud Functionsの利用にはFirebaseプロジェクトで課金設定が必要な場合がある。
5. 設定 > モデル > Firebase アカウント連携にFirebase Web設定（apiKey / authDomain / projectId / appId）とデプロイされた `aiChat` のURLを入力して保存し、Googleまたはメールでログインする。
6. AI Proxy URLが設定されると、モデル呼び出しはFirebase Functions経由になり、APIキーはサーバー環境変数から読み込まれる。未設定の場合は従来のブラウザ直接接続が使われるため、公開利用ではプロキシ設定を推奨。

Firebase Web設定の `apiKey` はクライアント用設定値で、AIプロバイダの秘密鍵とは別物です。AIプロバイダの秘密鍵をフロントエンド設定やGitHubにコミットしないでください。

### ファイル読解

添付時にテキスト/Markdown/CSV/JSON/HTML、PDF、DOCX、XLS/XLSX、PPTX、画像OCRからテキストを抽出し、プロンプトに添えて送信します。外部CDNからPDF.js等を読み込むため、初回利用時はネット接続が必要です。抽出上限や対応形式の制約があり、スキャンPDFや複雑なレイアウトは完全に読み取れない場合があります。

### チャットツリー V2

編集・再生成では元の分岐を残し、新しい分岐を作成して会話を続けます。ヘッダーの分岐セレクターから以前の分岐に戻れます。回答は生成完了後に段階表示され、生成中はジャンプするドットを表示します（現状、モデルからのネットワークストリーミングではなくUI側の段階表示です）。
