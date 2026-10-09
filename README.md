# jp-letters

日本語テキスト→マシュマロ対応へ。

マシュマロ読み配信などのお便りを、準備・プレビュー・配信への表示・ページ切り替えまで扱うOBS用ソースです。LuaとOBS内蔵ブラウザを使用し、PythonやNode.jsの追加インストールは不要です。

## 試す

[0.2.0の配布ZIP](releases/v0.2.0/jp-letters-0.2.0.zip)をダウンロードして展開し、OBSの「ツール → スクリプト」で `jp-letters.lua` を追加してください。ソース追加から「日本語お便りテキスト（マシュマロ向け）」を選びます。

リポジトリから使う場合は `letters/jp-letters.lua` を追加し、`letters/runtime` と `letters/web` も一緒に保管します。

[詳しい導入と使い方](letters/README.md) · [初回版の記録](docs/baseline-v0.2.0.md)

![操作画面](docs/images/operator-v0.2.0.png)

OBS 30.2以降を対象とします。同じ配布ファイルをMac・Windowsで使う構成です。Linuxの実際のOBS LuaとChromiumで検証していますが、Mac・WindowsのOBS実機での検証はまだ行っていません。

現在は本文貼り付け・テキスト・JSON取り込みに対応します。マシュマロ受信箱へのログインや自動取得は含みません。本プロジェクトはマシュマロの公式ツールではありません。

## 開発

- `letters/jp-letters.lua`: OBSソースと設定保存・ホットキー
- `letters/runtime/http.lua`: PC内の操作画面への接続
- `letters/web/`: 操作画面と日本語テキスト描画
- `tests/`: OBS LuaとChromiumの検証
- `tools/package-letters.py`: 配布ZIPの生成

GPL-2.0-or-later。ソースは配布物にも同梱します。
