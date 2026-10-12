# Calendar読み取り同期（Issue #1）

## 方式

0.9.0。拡張が直接Google Calendar APIをGETし、指定したカレンダーの対象日だけを日本時間で読み取る。Chrome Identity APIの`getAuthToken`を使用し、クライアントIDはChrome拡張機能用の独立したOAuth設定。トークン交換用の秘密を拡張へ埋め込まず、他アプリのOAuth・Codex連携の認証情報をコピーしない。安全でないImplicitフロー、GoogleページからのCookie/トークン抽出、追加の外部バックエンドは使用しない。

DiaのIdentity API互換性・Google認証成功は未確認。本人の初回設定・読み取り許可後に確認する。互換性がなければこの方式の実同期は未完成であり、模擬テスト成功を実接続成功として扱わない。

## 分離

- `calendar-sync.js`：日本時間の対象日範囲・全ページ取得・最小の候補抽出・接続状態と認証。純粋な読取処理とブラウザ依存処理を分離。
- `background.js`：拡張所有の日報画面だけからのメッセージに限定。ページ、別拡張、設定画面、似たパスからは接続操作できない。永続ストレージはTRUSTED_CONTEXTSを維持。
- `calendar-ui.js`：本人の接続操作からだけ任意権限を要求。自動取得は接続済み・任意設定時の非対話読取のみ。解除、日付変更、競合を明示。
- `daily-report.js`：取得開始時点の日付、保存済みID、世代、Tasks、時刻、確認、案件別編集が一致する時だけ下書きへ採用。編集済みの下書きは再取得で上書きしない。本人の実績確認・案件別時間の確認・無送信を保持。
- `scripts/configure-calendar-oauth.js`：公開識別子のクライアントIDだけをmanifestへ設定。前のmanifestをローカルバックアップし、秘密やトークンを扱わない。

## データ範囲

OAuthスコープは `https://www.googleapis.com/auth/calendar.events.readonly`。このスコープは共有された他カレンダーのイベントにも及び得る。API呼び出しは記憶した単一IDをURLエンコードし、当日00:00から翌日00:00まで（終端は排他、Asia/Tokyo）、singleEvents、最大10ページ・2,000イベント・20秒の制限で読む。HTTPはGETのみ、Bearerヘッダー、credentials omit、redirect error。生のGoogleエラーや応答本文を診断メッセージへ転記しない。

レスポンスはid、summary、status、start、end、辞退除外に必要なattendeesのself/responseStatus、ページトークンに限定。全ページ成功後、「シフト_出社」「シフト_リモート」だけを再構成。辞退、キャンセル、終日、別日、時刻不明、逆転を除外。日をまたぐ勤務は既存の下書きコアで警告し自動採用しない。重複IDを除外。イベント本文、参加者識別子、添付、リンクは取得・保管・AI送信しない。

予定候補はページメモリのみ。永続登録は接続状態・クライアントID・対象カレンダーID・自動取得の設定だけ。トークンはブラウザのIdentity APIキャッシュを使い、拡張のlocal storageへ書かない。拡張内の一時参照も解除時に破棄する。解除後に遅い取得結果が戻っても接続を再有効化しない。

## 確認範囲

95テスト成功（既存75＋同期20）。対象日境界、GETと最小フィールド、全ページ、部分失敗、ページ循環・上限、認証切れ、設定不足・同意・任意権限、生エラーの非露出、トークン非保存、接続解除・設定変更・日付変更・編集競合、通常プロフィール・週報の保護、無送信を模擬検証。ローカルブラウザの架空UIで接続・候補時刻反映・手編集保護・未確定の確認欄・コンソールエラーなしを確認。

Googleクライアント未作成。実認証・実カレンダー取得・本番フォームへの入力・保存・送信は未実施。配布前にはGoogleの公開・審査要件、安定した拡張ID、会社管理者ポリシーを確認する。

## 公式資料

- https://developer.chrome.com/docs/extensions/reference/api/identity
- https://developer.chrome.com/docs/extensions/reference/api/permissions
- https://developer.chrome.com/docs/extensions/how-to/integrate/oauth
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/calendar/api/v3/reference/events/list
