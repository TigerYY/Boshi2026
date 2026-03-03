#!/bin/bash
# 波斯 · 美伊战争态势系统 启动脚本

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# ── 动态端口检测 ──────────────────────────────────────────────────────────────
# 从候选端口列表中找第一个未被占用的端口
find_free_port() {
  local start=$1
  local port=$start
  while lsof -ti ":$port" > /dev/null 2>&1; do
    port=$((port + 1))
    if [ $((port - start)) -gt 20 ]; then
      echo "ERROR: 在 $start-$port 范围内找不到空闲端口" >&2
      exit 1
    fi
  done
  echo $port
}

BACKEND_PORT=$(find_free_port 8100)
FRONTEND_PORT=$(find_free_port 5173)

# 将实际端口写入文件，供 stop.sh 使用
echo "BACKEND_PORT=$BACKEND_PORT" > "$ROOT_DIR/.ports"
echo "FRONTEND_PORT=$FRONTEND_PORT" >> "$ROOT_DIR/.ports"

echo "╔══════════════════════════════════════════╗"
echo "║   波斯 · 美伊战争态势系统 v1.0           ║"
echo "║   BoShi US-Iran War Situation System     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 检查 Ollama ───────────────────────────────────────────────────────────────
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "⚠  Ollama 未运行，请先启动 Ollama 服务"
  echo "   运行: ollama serve"
  echo ""
fi

if curl -s http://localhost:11434/api/tags 2>/dev/null | grep -q "qwen3-vl"; then
  echo "✓  Ollama qwen3-vl:8b 模型已就绪"
else
  echo "⚠  qwen3-vl:8b 模型未找到，请先拉取:"
  echo "   ollama pull qwen3-vl:8b"
fi

if curl -s http://localhost:11434/api/tags 2>/dev/null | grep -q "qwen2.5"; then
  echo "✓  Ollama qwen2.5:3b 模型已就绪"
else
  echo "⚠  qwen2.5:3b 模型未找到，请先拉取:"
  echo "   ollama pull qwen2.5:3b"
fi

# ── 启动后端 ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ 启动后端服务 (端口 $BACKEND_PORT)..."
cd "$BACKEND_DIR"
if [ ! -d "venv" ]; then
  echo "  创建 Python 虚拟环境..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt -q
else
  source venv/bin/activate
fi

uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" &
BACKEND_PID=$!
echo $BACKEND_PID > "$ROOT_DIR/.backend.pid"
echo "  后端 PID: $BACKEND_PID"

sleep 3
if curl -s "http://localhost:$BACKEND_PORT/api/health" > /dev/null 2>&1; then
  echo "  ✓ 后端已启动: http://localhost:$BACKEND_PORT"
else
  echo "  ✗ 后端启动失败，查看日志"
fi

# ── 启动前端 ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ 启动前端服务 (端口 $FRONTEND_PORT)..."
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
  echo "  安装 npm 依赖..."
  npm install -q
fi

# 将实际后端端口注入 vite proxy，避免硬编码 8100
VITE_BACKEND_PORT=$BACKEND_PORT npm run dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$ROOT_DIR/.frontend.pid"
echo "  前端 PID: $FRONTEND_PID"

sleep 3
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  系统已启动！                                        ║"
echo "║                                                      ║"
printf "║  🌐 前端:   http://localhost:%-5s                  ║\n" "$FRONTEND_PORT"
printf "║  🔧 API:    http://localhost:%-5s                  ║\n" "$BACKEND_PORT"
printf "║  📚 文档:   http://localhost:%-5s/docs             ║\n" "$BACKEND_PORT"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "按 Ctrl+C 停止所有服务"

_stop() {
  echo ''
  echo '停止服务...'
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  sleep 1
  # 兜底：确保端口彻底释放
  lsof -ti ":$BACKEND_PORT"  | xargs kill -9 2>/dev/null || true
  lsof -ti ":$FRONTEND_PORT" | xargs kill -9 2>/dev/null || true
  rm -f "$ROOT_DIR/.backend.pid" "$ROOT_DIR/.frontend.pid" "$ROOT_DIR/.ports"
  exit 0
}

trap '_stop' INT TERM HUP

wait
