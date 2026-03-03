#!/bin/bash
# 波斯 · 美伊战争态势系统 停止脚本
# 用途：当直接关闭终端导致服务残留时，运行此脚本彻底清理

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "停止 波斯 服务..."

# 通过 PID 文件停止
for PIDFILE in "$ROOT_DIR/.backend.pid" "$ROOT_DIR/.frontend.pid"; do
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      echo "  已停止 PID $PID"
    fi
    rm -f "$PIDFILE"
  fi
done

# 兜底：直接释放端口
lsof -ti :8100 | xargs kill -9 2>/dev/null && echo "  已释放端口 8100" || true
lsof -ti :5173 | xargs kill -9 2>/dev/null && echo "  已释放端口 5173" || true

echo "✓ 所有服务已停止"
