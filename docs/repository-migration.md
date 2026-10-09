# お便り版のリポジトリ移行

2026-10-09。移行元は [hekiruligames/jp-letters](https://github.com/hekiruligames/jp-letters)、移行先は [hekiruligames/jp-letters-lua](https://github.com/hekiruligames/jp-letters-lua)。

お便り版（Lua＋OBS内蔵ブラウザ）を移行した。初期のC++ネイティブプラグインは対象外。GPL-2.0-or-laterのライセンス、スクリプト名、OBSソースのID、設定保存形式、配布ZIPの内容は変更していない。既存利用者はリポジトリ移行だけを理由にスクリプトの入れ直しやソースの作り直しを行う必要はない。

## 引き継いだ履歴

- 移行元mainのコミット `7e734c73ed0c40ee21a4666777e3c25043f6f9dd` までのGit履歴と6ブランチを引き継いだ。
- 5つのタグは同じコミットを指し、配布ZIPは同じバイト列・SHA-256を保つ。
- 15件のIssueはGitHubの転送を使用し、作成者・コメント・未完了／完了の状態を引き継いだ。
- 完了済みのPRはGitHubの別リポジトリへ転送できないため、元のPRを履歴として残し、以下に参照先を記録した。コミットメッセージに含まれる移行前のPR番号も元のリポジトリの番号を指す。
- 過去のActions実行記録は移行元に残る。配布ZIP添付用のworkflowは移行先のリポジトリ専用認証で実行する。
- 両リポジトリはPrivateの設定を維持している。

## Issue番号の対応

| 移行前 | 移行後 | タスク |
|---|---|---|
| [#1](https://github.com/hekiruligames/jp-letters/issues/1) | [#1](https://github.com/hekiruligames/jp-letters-lua/issues/1) | [P0] カード不透明度のスライダーが100%の端に届くよう修正 |
| [#2](https://github.com/hekiruligames/jp-letters/issues/2) | [#2](https://github.com/hekiruligames/jp-letters-lua/issues/2) | [P0] インストール済みフォントの選択と準備プレビューの即時反映 |
| [#3](https://github.com/hekiruligames/jp-letters/issues/3) | [#3](https://github.com/hekiruligames/jp-letters-lua/issues/3) | [P1] 編集欄に非表示を追加し、OSに合わせたショートカット表記にする |
| [#4](https://github.com/hekiruligames/jp-letters/issues/4) | [#4](https://github.com/hekiruligames/jp-letters-lua/issues/4) | [P1] 表示設定の初期化とデフォルト・マロ・透過プリセット |
| [#5](https://github.com/hekiruligames/jp-letters/issues/5) | [#5](https://github.com/hekiruligames/jp-letters-lua/issues/5) | [P2] 枠のサイズプリセット、OBSキャンバス取得、本文に合わせる高さ |
| [#6](https://github.com/hekiruligames/jp-letters/issues/6) | [#6](https://github.com/hekiruligames/jp-letters-lua/issues/6) | [P2] 現行配色を残した操作画面テーマ4種とカスタム・全設定バックアップ |
| [#7](https://github.com/hekiruligames/jp-letters/issues/7) | [#7](https://github.com/hekiruligames/jp-letters-lua/issues/7) | [P2] 長文を固定枠のまま手動スクロールして読むモード |
| [#8](https://github.com/hekiruligames/jp-letters/issues/8) | [#8](https://github.com/hekiruligames/jp-letters-lua/issues/8) | [調査] マシュマロURL取り込みの利用規約・取得手段を確認する |
| [#10](https://github.com/hekiruligames/jp-letters/issues/10) | [#9](https://github.com/hekiruligames/jp-letters-lua/issues/9) | [検証] 0.3.0をMac・WindowsのOBSとSafari実機で確認する |
| [#11](https://github.com/hekiruligames/jp-letters/issues/11) | [#10](https://github.com/hekiruligames/jp-letters-lua/issues/10) | [P0] ソースを残してスクリプトを削除・再読み込みするとOBSが終了する |
| [#13](https://github.com/hekiruligames/jp-letters/issues/13) | [#11](https://github.com/hekiruligames/jp-letters-lua/issues/11) | 配信中の操作を目立たせ、ページ・スクロールの選択を近くへ移す |
| [#15](https://github.com/hekiruligames/jp-letters/issues/15) | [#12](https://github.com/hekiruligames/jp-letters-lua/issues/12) | お便りの選択・紹介済み・全件の一括削除を追加する |
| [#17](https://github.com/hekiruligames/jp-letters/issues/17) | [#13](https://github.com/hekiruligames/jp-letters-lua/issues/13) | v0.3.3のタグとReleaseページを作成する |
| [#18](https://github.com/hekiruligames/jp-letters/issues/18) | [#14](https://github.com/hekiruligames/jp-letters-lua/issues/14) | OBS下部のプロパティ・フィルタ横から管理画面を直接開く |
| [#19](https://github.com/hekiruligames/jp-letters/issues/19) | [#15](https://github.com/hekiruligames/jp-letters-lua/issues/15) | 開発環境からZIPを直接添付する際の認証エラーを調査する |

## 過去のPR

| 元のPR | 内容 |
|---|---|
| [#9](https://github.com/hekiruligames/jp-letters/pull/9) | お便り操作・Safariの書体プレビュー・配色・長文表示を改善（0.3.0） |
| [#12](https://github.com/hekiruligames/jp-letters/pull/12) | ソースを残したスクリプト削除・再読み込みのクラッシュを修正（0.3.1） |
| [#14](https://github.com/hekiruligames/jp-letters/pull/14) | 配信中の操作と表示前プレビューを見分けやすくする |
| [#16](https://github.com/hekiruligames/jp-letters/pull/16) | お便りの一括削除と一度で全件を戻す操作を追加 |
| [#20](https://github.com/hekiruligames/jp-letters/pull/20) | ReleaseのZIP添付をGitHub Actionsの認証で実行する |

## リリースと配布物

Releaseページを移行先にも登録し、ノートのコード・Issue・配布物へのリンクを更新する。移行先の登録時刻と元の公開時刻は異なるため、元の公開時刻を以下に記録する。過去のZIPを再生成せず、バージョンと検証記録を維持する。v0.3.3のZIPはReleaseへの添付を行い、再ダウンロードして照合する。0.2.0〜0.3.2は元の配布方法と同じく、各タグ内のZIPへリンクする。

| タグ | 元の公開時刻（UTC） | SHA-256 |
|---|---|---|
| [v0.2.0](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.2.0) | 2026-10-09T03:08:35Z | `ad066c82ccbd3b72b064c7a1fdec53d793a0aed600804b654158f13da8ecf283` |
| [v0.3.0](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.0) | 2026-10-09T03:12:15Z | `6bbd29a6d08178ce5be51275597e4305914b0ee72590db843cf0fea97fda290a` |
| [v0.3.1](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.1) | 2026-10-09T03:46:21Z | `3de925474b2773bb1b6176f7400907e49b78c51f2785a4ab122a4e545d6574b0` |
| [v0.3.2](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.2) | 2026-10-09T04:07:43Z | `ae98655a340127709baca784b2e02540390585e81e3898915ce04d997587d58d` |
| [v0.3.3](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.3) | 2026-10-09T12:10:00Z | `42c1918a9e3d3ba3ddb364ad69b3f2370183a658cad5164cb4343b0398cf65b7` |

元のREADME・Releaseには移行先を案内し、元のコード・タグ・配布物は過去の参照を壊さないように履歴として残す。今後のお便り版の修正・Issue・リリースは移行先で扱う。
