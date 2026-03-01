# ccl_tmux_sender

## 概要

**日本語** | [English README](README.md)

複数の Claude CodeセッションをWebブラウザから操作できるようにするツールです。
ターミナル上で直接プロンプトを長文入力するのが大変なのを解決したりします。
tmux動作中のターミナルを小さくして目立たなくしておくこともできます。

![Screen shot](docs/screenshot.jpg)

## 動作要件

tmux（Claude Code CLI）を動かす環境に下記が必要です。
Windows 11のWSL（Ubuntu）上での動作を確認しています。

WSL（Ubuntu）
Bash
Python 3
tmux
Claude Code CLI

## クイックスタート

```bash
# 1. 実行権限を付与します
chmod +x ctxsend ctxlist ctxserver

# 2. サーバーを起動します
python3 ctxserver                # デフォルトportは5005
python3 ctxserver --port 8080    # ポート指定して起動する場合

# 3. http://localhost:5005 をWebブラウザで開きます
```

### 機能

- tmuxのペイン一覧を表示（idle/busy状態、消費トークン量など）
- ペイン選択 → プロンプト入力 → Sendボタンで送信（Ctrl+Enterも可）
- 5秒間隔で状態を自動リフレッシュ

### 起動用サンプル

- tmuxを4ペインで起動するときのサンプルは `tmux-start_sample.sh` を参照
- 以下のようにすることで、tmuxが動作しているターミナルを小さくしても、Web UI上で出力が折り返されるのを抑制できます

```bash
# hogeはセッション名
tmux set-option -t hoge:0 window-size manual
tmux resize-window -t "hoge:0.0" -x 180 -y 50
```

## CLI ツール

コア部分はシェルスクリプトとしており、ターミナルから直接実行することもできます。

### ctxsend — プロンプト送信

```bash
./ctxsend <session_id:window.pane> "プロンプト"

# 例
./ctxsend hoge:0.0 "hello"
./ctxsend hoge:0.2 "refactor the database module"
```

### ctxlist — ペイン一覧

```bash
./ctxlist              # テーブル表示
./ctxlist --json       # JSON出力
./ctxlist --all        # Claude Code以外のペインも表示
```

出力例:

```
TARGET               COMMAND    STATUS   CWD
------               -------    ------   ---
hoge:0.0         claude     idle     /mnt/path/to/MyProject
hoge:0.1         claude     busy     /mnt/path/to/OtherProject
```

## トークン使用量の表示（オプション）

下記の設定をしておくと、Claude Codeのstatus line機能を使って
各ペインのトークン消費量などをWeb UIに表示するようになります。

### セットアップ

1. 実行権限を付与します

```bash
chmod +x ctx-statusline
```

2. `~/.claude/settings.json` に下記を追加します

```json
{
  "statusLine": {
    "type": "command",
    "command": "/path/to/ctx-statusline"
  }
}
```

3. Claude Codeを再起動します

### 表示される情報

| 項目 | 説明 |
|------|------|
| 入力トークン (↑) | セッション累計の入力トークン数 |
| 出力トークン (↓) | セッション累計の出力トークン数 |
| ctx % | コンテキストウィンドウ使用率 |

コンテキスト使用率のバーは50％未満で緑、50～80％で黄、80％以上で赤に変化します。

## ファイル構成

```
ctxsend          CLI送信ツール (bash)
ctxlist          ペイン一覧ツール (bash)
ctxserver        Webサーバー (python3)
ctx-statusline   ステータスラインスクリプト (python3)
static/
  index.html     Webフォーム (vanilla HTML/JS/CSS)
```

## 仕組み

tmuxの `send-keys` でPTY経由のキー入力を送る仕組みです。

```bash
tmux send-keys -t <target> -l "プロンプト"   # -l: リテラル送信
tmux send-keys -t <target> Enter           # Enterで実行
```

## 注意事項

- ローカル環境での使用に限定してください（公開サーバー環境での動作は推奨しません）
- tmuxの実際の内容がWeb UIに反映されるまで数秒かかることがあります
- Claude Codeが応答生成中の場合、テキストは入力バッファに入っても即座には送信されないことがあります
- 同一ペインへの同時送信は文字が混在する可能性があります
