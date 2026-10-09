# 0.3.0の検証記録

2026-10-09。Linux libobs 30.2.3の実際のOBS LuaJIT、Fontconfig、実際のChromiumで確認した。

- Web操作・日本語描画: 17項目成功。準備と配信の分離、即時プレビュー、入力・取り込み・保存・復元、競合時の入力保護、100%不透明度、プリセット、自動高さ、スクロール、配色・カスタム・バックアップ、狭い画面を含む。
- OBS Lua: 3項目成功。ソース登録とローカル接続、OBSによる設定の保存・復元、子ソースとホットキー・ソケットの後始末。
- 書体の埋め込み制限: 5通り成功。埋め込み許可とプレビュー用許可では読み込み、埋め込み禁止・ビットマップのみ許可・許可情報なしではフォントのバイト列を返さない。
- 実際のWebフォントを読み込んだ等幅書体で、`iiii` と `WWWW` の文字幅が一致し、通常の代替書体では一致しないことを確認。CSS上のフォント名だけの検査にしていない。
- 日本語TTCから作ったOpenType書体の全体チェックサムを確認。認証なし・不明な書体名・ファイルパスからの取得を拒否することを確認。
- 960×540の出力画像で四辺40pxのアルファ値がすべて0、100%のカードの内側が255であることを確認。
- JavaScriptの構文とGitの空白エラーを確認。

詳細は[機械可読の結果](validation-v0.3.0.json)、配布ZIP内の `validation.json`、[`tests`](../tests/)を参照。

OBSのブラウザソースはテスト用の子ソースで代用し、HTML描画を別の実Chromiumで確認した。実際のOBS内蔵ブラウザを通した結合確認ではない。Mac・WindowsのOBS、各OSのフォントAPI、Safariそのものは未検証である。

実機では0.2.0のお便り・見た目を維持した更新、Safariでの追加フォント、OBSでの自動高さ・スクロール・ホットキーを確認する。初期値960×540、文字48px、行間1.5、四辺40pxは維持する。

開発環境での実行例:

```sh
python3 tests/run-letters-tests.py /path/to/obs-sdk/usr /path/to/luajit/usr --artifacts /tmp/jp-letters-checks
python3 tools/package-letters.py --validation /tmp/jp-letters-checks --output /tmp/jp-letters-release
```

開発検証にはLinuxのOBS SDK、LuaJIT、DejaVuとNotoの書体、Fontconfig、Xvfb、Chromium、Node.js、Playwrightを使用する。配布物の利用にこれらの追加インストールは不要。
