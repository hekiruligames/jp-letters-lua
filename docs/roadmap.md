# 改善項目と取り組む順番

2026-10-09。0.2.0のタグと配布物を先に保存し、この順で改善した。利用者の番号との対応を残す。

| 順 | Issue | 利用者の項目 | 内容 |
| --- | --- | --- | --- |
| 最優先 | [#11](https://github.com/hekiruligames/jp-letters/issues/11) | 不具合報告 | ソースを残したスクリプト削除・再読み込みのクラッシュ（0.3.1で修正） |
| 操作改善 | [#13](https://github.com/hekiruligames/jp-letters/issues/13) | 追加のフィードバック | 配信中の領域を強調し、ページ／スクロールの選択を操作の横へ移す（0.3.2） |
| 操作改善 | [#15](https://github.com/hekiruligames/jp-letters/issues/15) | 追加のフィードバック | 選択・紹介済み・全件の一括削除と、1回で全件を戻す操作（0.3.3） |
| 1 | [#1](https://github.com/hekiruligames/jp-letters/issues/1) | 3 | 不透明度100%のスライダー |
| 2 | [#2](https://github.com/hekiruligames/jp-letters/issues/2) | 5・6 | フォント一覧とプレビューの即時反映 |
| 3 | [#3](https://github.com/hekiruligames/jp-letters/issues/3) | 4・8 | 非表示の追加とMacのショートカット表記 |
| 4 | [#4](https://github.com/hekiruligames/jp-letters/issues/4) | 7・9 | 表示設定の初期化、3つの配色プリセット |
| 5 | [#5](https://github.com/hekiruligames/jp-letters/issues/5) | 2・12 | 枠のプリセット、OBSキャンバス取得、高さ自動調整 |
| 6 | [#6](https://github.com/hekiruligames/jp-letters/issues/6) | 10 | 操作画面の配色と全設定バックアップ |
| 7 | [#7](https://github.com/hekiruligames/jp-letters/issues/7) | 11 | 長文の手動スクロール |
| 調査 | [#8](https://github.com/hekiruligames/jp-letters/issues/8) | 1 | URL取り込みの規約と取得方法 |

先に表示バグを直し、配信中によく使う操作を整える。その後、枠・配色・長文の読み方を追加する。URL取り込みの調査は並行して行い、確認できていない自動アクセスを製品へ組み込まない。

0.3.0では#1〜#7の実装とLinux上の検証を完了した。フォントはSafariだったとの回答を受け、PC内でのWebフォント読み込みも追加した。#8は公式規約と取得手段の調査を記録し、許諾・公式連携手段の確認を残している。運営への確認文案は用意したが、送信はしていない。

残る実機確認は、Mac・WindowsのOBSでの更新、Safariで追加フォントを選ぶ操作、OBS内蔵ブラウザソースとの連携である。この開発環境での検証結果と区別している。

0.3.1では#11の条件を実OBS LuaJITで再現して終了処理を修正した。通常のソース削除に加え、ソースを残したスクリプト削除、再追加、3回連続の再読み込み、ホットキー割り当ての維持を回帰検証へ追加した。[検証記録](validation-v0.3.1.md)。実機確認は[#10](https://github.com/hekiruligames/jp-letters/issues/10)で引き続き追跡する。

0.3.2では、プレビューのページ操作を配信への操作と取り違えるフィードバックを受け、上部を独立した配信操作パネルへ変更した。表示中の本文、操作名、OBSへすぐ反映する案内を加え、配信中と準備中それぞれの表示方式を操作の横で選べるようにする。[検証記録](validation-v0.3.2.md)。

枠の初期値960×540、文字48px、行間1.5、四辺40pxは維持する。旧版のデータは読み込み、新しい版の初期配色変更によって既存ソースの見た目を置き換えない。

スクロールの初回版は手動とする。準備中の読む位置と配信中の読む位置を分け、OBSホットキーでも操作する。自動で進むスクロールは後の検討事項にする。
