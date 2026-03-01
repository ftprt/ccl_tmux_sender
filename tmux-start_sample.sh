#!/bin/bash
# tmux 並行開発セッション起動スクリプトサンプル（4ペイン構成）
# Sample script to start a tmux parallel development session (4-pane layout)
# 使い方 / Usage: bash tmux-start.sh

# ============================================
# 環境に合わせてここを変更
# Adjust the following to match your environment
# BASE_DIRにメインロール（指示役など）のプロジェクトファイルがある想定
# BASE_DIR should point to where the main role (e.g. coordinator) project files are located
# ============================================
# WSL:  /mnt/drive-letter/path/to/hoge
# Mac:  ~/path/to/hoge
# Linux: /home/user/path/to/hoge
BASE_DIR="/mnt/drive-letter/path"
# ============================================

# 任意のセッション名を設定
# Set session name as you like
SESSION="project-name"

# 既存セッションがあればアタッチ
# If the session already exists, just attach to it
if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo "Session '$SESSION' already exists. Attaching..."
    tmux attach -t "$SESSION"
    exit 0
fi

# ペインを先にすべて作成（claude はまだ起動しない）
# Create all panes first (don't start claude yet)
tmux new-session -d -s "$SESSION" -c "$BASE_DIR"

tmux set-option -t koseikun:0 window-size manual

tmux split-window -h -t "$SESSION:0.0" -c "$BASE_DIR/project-role2"
tmux split-window -v -t "$SESSION:0.0" -c "$BASE_DIR/project-role3"
tmux split-window -v -t "$SESSION:0.2" -c "$BASE_DIR/project-role4"

# レイアウト / Layout:
#   0: project-role1 (左上 / top-left)      2: project-role3 (右上 / top-right)
#   1: project-role2 (左下 / bottom-left)    3: project-role4 (右下 / bottom-right)

tmux resize-window -t "$SESSION:0.0" -x 180 -y 50
tmux resize-window -t "$SESSION:0.1" -x 180 -y 50
tmux resize-window -t "$SESSION:0.2" -x 180 -y 50
tmux resize-window -t "$SESSION:0.3" -x 180 -y 50

# シェルが準備できるのを待つ
# Wait for shells to be ready
sleep 1

# 各ペインで claude を起動（テキストと Enter を分離）
# Start claude in each pane (separate text and Enter keystrokes)
for pane in 0 1 2 3; do
    tmux send-keys -t "$SESSION:0.$pane" "claude"
    sleep 0.2
    tmux send-keys -t "$SESSION:0.$pane" Enter
done

# ペイン 0 にフォーカス
# Focus on the pane 0
tmux select-pane -t "$SESSION:0.0"

# アタッチ
# Attach to the session
tmux attach -t "$SESSION"
