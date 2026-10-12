# 改善項目と取り組む順番

## 現在の作業一覧（2026-10-12）

最新の配布は[v0.5.0](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.5.0)。Issueは完了12件、未完了5件に整理した。利用者の環境はmacOSなので、次はMacのOBSとSafariでの確認を優先する。

| 優先度 | 状態 | Issue | 次の作業・再開条件 |
| --- | --- | --- | --- |
| 最優先 | 実機検証待ち | [#9](https://github.com/hekiruligames/jp-letters-lua/issues/9) | v0.5.0をmacOS＋Safariで確認する。追加機能の表示・保存・復元にはPR #27のMac＋Safari確認報告がある。フォント、受信箱のコピペ、保存・再開、配信中の操作、スクリプト削除を確認し、Windowsの確認も別の項目として継続する。 |
| 保留 | 調査 | [#8](https://github.com/hekiruligames/jp-letters-lua/issues/8) | URLの直接取り込み。公式API・連携条件と未公開のお便りの扱いを確認できた時点で再開する。手動コピーからの一括登録はv0.4.0で実装済み。 |
| 保留 | 提案 | [#14](https://github.com/hekiruligames/jp-letters-lua/issues/14) | OBS下部から操作画面を開くボタン。操作の要望が増えた場合に、Luaのホットキー案と比較し、Macでの導入負担・OBS更新時の互換性を検討する。 |
| 保留 | 提案 | [#20](https://github.com/hekiruligames/jp-letters-lua/issues/20) | 受信箱のお便りをコピーするSafari・Chrome拡張。要望が増えた場合に検討する。採用や実装時期は未定で、既存のコピペ方式を維持する。 |
| 保留 | 開発環境の調査 | [#15](https://github.com/hekiruligames/jp-letters-lua/issues/15) | Releaseへ直接アップロードする際の401。Actions経由の配布は対応済み。認証設定を調べられる場合や、直接アップロードが必要になった場合に再開する。 |

「優先度:高」「検証待ち」「調査」「提案」「保留」「macOS」「Safari」「配布・開発環境」のラベルで絞り込める。実装済みのIssueにはリリース・検証記録を追記した。Mac・Windowsでの動作確認が完了したという意味ではなく、実機の結果は#9に記録する。

## 実装・公開が完了した作業

| Issue・PR | 完了した内容 | リリース |
| --- | --- | --- |
| [#1〜#7](https://github.com/hekiruligames/jp-letters-lua/issues?q=is%3Aissue%20is%3Aclosed) | 不透明度、フォント、非表示、表示プリセット、枠・高さ、配色・バックアップ、手動スクロール | [v0.3.0](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.0) |
| [#10](https://github.com/hekiruligames/jp-letters-lua/issues/10) | ソースを残したスクリプト削除・再読み込みのクラッシュ修正 | [v0.3.1](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.1) |
| [#11](https://github.com/hekiruligames/jp-letters-lua/issues/11) | 配信中の操作と表示前プレビューを見分けやすくする | [v0.3.2](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.2) |
| [#12](https://github.com/hekiruligames/jp-letters-lua/issues/12)・[#13](https://github.com/hekiruligames/jp-letters-lua/issues/13) | お便りの一括削除とリリース公開・ZIP添付 | [v0.3.3](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.3.3) |
| [PR #19](https://github.com/hekiruligames/jp-letters-lua/pull/19) | コピーした受信箱の本文を確認・編集・選択して一括登録する | [v0.4.0](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.4.0) |
| [PR #23](https://github.com/hekiruligames/jp-letters-lua/pull/23) | 保存状況とファイルの保存・読み込みを画面上部へまとめる | [v0.4.1](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.4.1) |
| [#26](https://github.com/hekiruligames/jp-letters-lua/issues/26)・[PR #27](https://github.com/hekiruligames/jp-letters-lua/pull/27) | マシュマロ向け表示、利用者指定の画像、新規ソースの初期値調整 | [v0.5.0](https://github.com/hekiruligames/jp-letters-lua/releases/tag/v0.5.0) |

READMEの導入・取り込み手順と画像、保存・後日の再開の説明もmainへ反映済み。[保存と再開の案内](../README.md#配信前に準備してあとで続きを使う)

## 初期の改善計画と経緯

2026-10-09。0.2.0のタグと配布物を先に保存し、この順で改善した。利用者の番号との対応を残す。

| 順 | Issue | 利用者の項目 | 内容 |
| --- | --- | --- | --- |
| 最優先 | [#10](https://github.com/hekiruligames/jp-letters-lua/issues/10) | 不具合報告 | ソースを残したスクリプト削除・再読み込みのクラッシュ（0.3.1で修正） |
| 操作改善 | [#11](https://github.com/hekiruligames/jp-letters-lua/issues/11) | 追加のフィードバック | 配信中の領域を強調し、ページ／スクロールの選択を操作の横へ移す（0.3.2） |
| 操作改善 | [#12](https://github.com/hekiruligames/jp-letters-lua/issues/12) | 追加のフィードバック | 選択・紹介済み・全件の一括削除と、1回で全件を戻す操作（0.3.3） |
| 1 | [#1](https://github.com/hekiruligames/jp-letters-lua/issues/1) | 3 | 不透明度100%のスライダー |
| 2 | [#2](https://github.com/hekiruligames/jp-letters-lua/issues/2) | 5・6 | フォント一覧とプレビューの即時反映 |
| 3 | [#3](https://github.com/hekiruligames/jp-letters-lua/issues/3) | 4・8 | 非表示の追加とMacのショートカット表記 |
| 4 | [#4](https://github.com/hekiruligames/jp-letters-lua/issues/4) | 7・9 | 表示設定の初期化、3つの配色プリセット |
| 5 | [#5](https://github.com/hekiruligames/jp-letters-lua/issues/5) | 2・12 | 枠のプリセット、OBSキャンバス取得、高さ自動調整 |
| 6 | [#6](https://github.com/hekiruligames/jp-letters-lua/issues/6) | 10 | 操作画面の配色と全設定バックアップ |
| 7 | [#7](https://github.com/hekiruligames/jp-letters-lua/issues/7) | 11 | 長文の手動スクロール |
| 調査 | [#8](https://github.com/hekiruligames/jp-letters-lua/issues/8) | 1 | URL取り込みの規約と取得方法 |

先に表示バグを直し、配信中によく使う操作を整える。その後、枠・配色・長文の読み方を追加する。URL取り込みの調査は並行して行い、確認できていない自動アクセスを製品へ組み込まない。

0.3.0では#1〜#7の実装とLinux上の検証を完了した。フォントはSafariだったとの回答を受け、PC内でのWebフォント読み込みも追加した。#8は公式規約と取得手段の調査を記録し、許諾・公式連携手段の確認を残している。運営への確認文案は用意したが、送信はしていない。

2026-10-11に[#8のURL取り込みを再調査](research-url-import-2026-10-11.md)した。公開された個別のお便り2件はログインなしでHTMLから本文を取得できた。公式の取得API・連携条件と未公開の受信箱の取得は未確認。次の候補は、自分の受信箱を手動でコピーして貼り付けた内容からお便りを選ぶ一括登録とし、公開URLの単件取得は別の候補として残す。

0.4.0では、受信箱を手動でコピーし、本文候補の確認・編集・選択を経て一括登録する機能を追加した。Safariの日本語の未確認一覧から利用者が提供した実テキスト2件を使い、本文と改行の抽出を確認した。判別できない形式では原文を残す。[使い方と検証範囲](validation-v0.4.0.md)。URLの直接取得・公式連携条件の確認は別件として#8に残す。

残る実機確認は、Mac・WindowsのOBSでの更新、Safariで追加フォントを選ぶ操作、OBS内蔵ブラウザソースとの連携である。この開発環境での検証結果と区別している。

0.3.1では#10の条件を実OBS LuaJITで再現して終了処理を修正した。通常のソース削除に加え、ソースを残したスクリプト削除、再追加、3回連続の再読み込み、ホットキー割り当ての維持を回帰検証へ追加した。[検証記録](validation-v0.3.1.md)。実機確認は[#9](https://github.com/hekiruligames/jp-letters-lua/issues/9)で引き続き追跡する。

0.3.2では、プレビューのページ操作を配信への操作と取り違えるフィードバックを受け、上部を独立した配信操作パネルへ変更した。表示中の本文、操作名、OBSへすぐ反映する案内を加え、配信中と準備中それぞれの表示方式を操作の横で選べるようにする。[検証記録](validation-v0.3.2.md)。

枠の初期値960×540、文字48px、行間1.5、四辺40pxは維持する。旧版のデータは読み込み、新しい版の初期配色変更によって既存ソースの見た目を置き換えない。

スクロールの初回版は手動とする。準備中の読む位置と配信中の読む位置を分け、OBSホットキーでも操作する。自動で進むスクロールは後の検討事項にする。
