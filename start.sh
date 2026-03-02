#!/bin/bash
# 波斯 · 美伊战争态势系统 启动脚本

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

echo "╔══════════════════════════════════════════╗"
echo "║   波斯 · 美伊战争态势系统 v1.0           ║"
echo "║   BoShi US-Iran War Situation System     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Ollama
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "⚠  Ollama 未运行，请先启动 Ollama 服务"
  echo "   运行: ollama serve"
  echo ""
fi

# Check qwen3-vl model
if curl -s http://localhost:11434/api/tags 2>/dev/null | grep -q "qwen3-vl"; then
  echo "✓  Ollama qwen3-vl:8b 模型已就绪"
else
  echo "⚠  qwen3-vl:8b 模型未找到，请先拉取:"
  echo "   ollama pull qwen3-vl:8b"
fi

echo ""
echo "▶ 启动后端服务 (端口 8100)..."
cd "$BACKEND_DIR"
if [ ! -d "venv" ]; then
  echo "  创建 Python 虚拟环境..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt -q
else
  source venv/bin/activate
fi

# Kill old instance
lsof -ti :8100 | xargs kill -9 2>/dev/null || true

uvicorn main:app --host 0.0.0.0 --port 8100 &
BACKEND_PID=$!
echo "  后端 PID: $BACKEND_PID"

# Wait for backend
sleep 3
if curl -s http://localhost:8100/api/health > /dev/null 2>&1; then
  echo "  ✓ 后端已启动: http://localhost:8100"
else
  echo "  ✗ 后端启动失败，查看日志"
fi

echo ""
echo "▶ 启动前端服务 (端口 5173)..."
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
  echo "  安装 npm 依赖..."
  npm install -q
fi

# Kill old instance
lsof -ti :5173 | xargs kill -9 2>/dev/null || true

npm run dev -- --port 5173 &
FRONTEND_PID=$!
echo "  前端 PID: $FRONTEND_PID"

sleep 3
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  系统已启动！                            ║"
echo "║                                          ║"
echo "║  🌐 前端:   http://localhost:5173        ║"
echo "║  🔧 API:    http://localhost:8100        ║"
echo "║  📚 文档:   http://localhost:8100/docs   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "按 Ctrl+C 停止所有服务"

trap "echo ''; echo '停止服务...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

wait
