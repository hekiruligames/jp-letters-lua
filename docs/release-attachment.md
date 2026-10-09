# 配布ZIPをReleaseへ添付する

この開発環境ではGitHubの通常APIとGit操作は成功する一方、ReleaseのZIP添付先 `uploads.github.com` でHTTP 401が発生した。リポジトリへの書き込み権限は確認できているが、接続先によって認証結果が異なる原因は未特定である。[Issue #19](https://github.com/hekiruligames/jp-letters/issues/19)で記録する。

公開処理にはGitHub Actionsの **Attach release ZIP** を使う。GitHubがジョブ用に発行するリポジトリ専用の `GITHUB_TOKEN` で添付するため、利用者が個人用アクセストークンを作成・保存する必要はない。手動で実行したときだけ動作する。

## 実行

1. 検証済みZIPを `releases/vX.Y.Z/jp-letters-X.Y.Z.zip` に保存したコミットへタグを付け、Releaseページを作成する。
2. GitHubの **Actions → Attach release ZIP → Run workflow** を開く。
3. `tag` にタグ名、`sha256` に検証済みZIPのSHA-256を入力して実行する。

v0.3.3の入力:

```text
tag: v0.3.3
sha256: 42c1918a9e3d3ba3ddb364ad69b3f2370183a658cad5164cb4343b0398cf65b7
```

GitHub CLIからも実行できる:

```sh
gh workflow run attach-release-zip.yml --repo hekiruligames/jp-letters \
  -f tag=v0.3.3 \
  -f sha256=42c1918a9e3d3ba3ddb364ad69b3f2370183a658cad5164cb4343b0398cf65b7
```

## 確認する内容

- 指定したタグ内のZIPを取得し、指定されたSHA-256、ZIP内の全ファイル、製品ファイルと検証時のハッシュの一致を確認する。
- 現行の配布基準であるWeb21項目・OBS Lua6項目・フォント制限5通りの結果を確認する。Mac・Windowsでの成功とは扱わない。
- 公開済みの該当Releaseへ添付し、添付ファイルをもう一度ダウンロードしてSHA-256を確認する。
- 同名ファイルが既にある場合は内容を確認する。一致すれば成功として扱い、異なるファイルは上書きしない。

トークンの権限は添付ジョブの `contents: write` に限定する。チェックアウト用の認証はGit設定へ保存せず、入力値は環境変数経由で渡す。GitHubから返った署名付きURL等をエラーログへ出さない。

ZIPの取得にはGitHub Contents APIのbase64形式を使うため、現行の処理は1MB以内の配布ZIPを対象とする。v0.3.3は66,705バイトである。

## 開発環境での検証

```sh
python3 tests/release-attachment.py
GH_REPO=hekiruligames/jp-letters python3 tools/attach-release-zip.py \
  --tag v0.3.3 --sha256 42c1918a9e3d3ba3ddb364ad69b3f2370183a658cad5164cb4343b0398cf65b7 \
  --check-only
```

8項目の検証では、実配布物の確認、検証後のソース変更、誤ったSHA-256、検証記録の欠落、同名ファイルの再実行・不一致、添付後のダウンロード確認、下書きReleaseの保持を確認する。これらのテストはGitHubへテスト用のファイルを公開しない。

[GitHub公式のGITHUB_TOKENの説明](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
