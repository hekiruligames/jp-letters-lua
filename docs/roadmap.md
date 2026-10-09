# 改善項目と取り組む順番

2026-10-09。0.2.0のタグと配布物を先に保存し、この順で改善した。利用者の番号との対応を残す。

| 順 | Issue | 利用者の項目 | 内容 |
| --- | --- | --- | --- |
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

枠の初期値960×540、文字48px、行間1.5、四辺40pxは維持する。旧版のデータは読み込み、新しい版の初期配色変更によって既存ソースの見た目を置き換えない。

スクロールの初回版は手動とする。準備中の読む位置と配信中の読む位置を分け、OBSホットキーでも操作する。自動で進むスクロールは後の検討事項にする。
