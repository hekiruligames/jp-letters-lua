# 0.3.1: スクリプト削除時のクラッシュ修正

2026-10-09（日本時間）。利用者から、OBSでスクリプトを削除するとOBSが終了するとの報告を受けた。

## 再現と原因

0.3.0の実ファイルをLinux libobs 30.2.3の実OBS LuaJITで実行した。アクティブかつ表示中のソースを残して `obs_script_destroy` を実行すると、SIGSEGV（ホストの終了値 -11）で終了した。通常のソース削除は成功した。前回のテストはソースを先に削除する順序で、この条件が抜けていた。

`source.destroy` が直接 `obs.obs_hotkey_unregister(callback)` を呼んでいた。OBSはスクリプトのソース型を無効化する際、Luaのdestroyを呼ぶが、通常のソース破棄時と異なり `current_lua_script` を設定しない。Luaのホットキー解除は、この実行情報を使ってコールバックを検索するため、NULL参照になる。

利用者のOBSのバージョンに対応する32.2.2でも、以下の公式ソースを確認した。

- [obs-scripting-lua-source.c: undef_source_type](https://github.com/obsproject/obs-studio/blob/32.2.2/shared/obs-scripting/obs-scripting-lua-source.c)
- [obs-scripting-lua.h: find_next_lua_obs_callback](https://github.com/obsproject/obs-studio/blob/32.2.2/shared/obs-scripting/obs-scripting-lua.h)

## 修正

個別ソースの削除ではホットキー解除を次のタイマー処理へ移し、有効なスクリプト実行情報があるところで解除する。破棄済みのソースへホットキーがアクセスしないガードも追加した。

スクリプト全体の削除時は、OBS自身によるコールバック解除を使用する。再追加・再読み込みに備え、解除前にホットキー割り当てを親ソースの設定へ保存する。子ブラウザの表示・アクティブ参照を解放し、ローカル接続を停止する。終了処理からfrontendの保存を呼ぶ処理も除き、スクリプト削除への再入を避ける。本文と表示設定はそれまでの更新で既に親ソースへ書き込まれている。

## 修正後の検証

すべて成功した。

- 通常のソース削除で子ブラウザとホットキーを解放する。
- アクティブかつ表示中のソースを残してスクリプトを削除し、OBSが動作を続ける。ソースの設定が残り、子ブラウザ・ホットキー・ローカルの待受ソケットを解放する。
- スクリプトを再追加し、同じソースへ子ブラウザを1つだけ復元する。
- 3回続けて再読み込みし、子ブラウザ・ホットキーが増えない。
- お便りの設定、ソース寸法、子ブラウザの表示とアクティブ状態、実際に割り当てたCtrl+Alt+F8のホットキーを維持する。
- 従来のWeb17項目、OBS Lua6項目、フォント制限5通りが通過する。

検証時の製品ソースのSHA-256を記録し、配布ZIP生成時に一致を確認する。[機械可読の結果](validation-v0.3.1.json)。再現と回帰検証は[`letters-integration.cpp`](../tests/letters-integration.cpp)で実行する。

```sh
python3 tests/run-letters-tests.py /path/to/obs-sdk/usr /path/to/luajit/usr --artifacts /tmp/jp-letters-lifecycle --lifecycle-only
```

今回の修正前後の実行はLinuxであり、Mac・WindowsのOBS実機は未検証。OBSのブラウザ子ソースはテスト用の描画ソースで代用し、HTMLは別の実Chromiumで検証した。Mac・Windows実機での確認は[Issue #10](https://github.com/hekiruligames/jp-letters/issues/10)に残している。

## 更新方法

旧版をOBSのスクリプト一覧で削除・再読み込みせず、OBSを終了した状態で既存フォルダの `jp-letters.lua` と `runtime`・`web` を上書きする。保存先を維持してOBSを起動し、操作画面を開き直す。[詳細手順](../letters/README.md#020030から更新する)。
