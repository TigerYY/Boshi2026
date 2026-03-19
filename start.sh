#!/bin/bash
# 波斯 · 美伊战争态势系统 启动脚本

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# ── 动态端口检测 ──────────────────────────────────────────────────────────────
# 检查端口是否被占用：同时用 lsof (TCP LISTEN) 和 nc 双重确认，更可靠
_port_in_use() {
  local port=$1
  # lsof -sTCP:LISTEN 只匹配真正在监听的 TCP socket（IPv4 + IPv6）
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
    return 0  # 被占用
  fi
  # 兜底：nc 连接测试
  if nc -z 127.0.0.1 "$port" 2>/dev/null; then
    return 0  # 被占用
  fi
  return 1    # 空闲
}

find_free_port() {
  local start=$1
  local port=$start
  while _port_in_use "$port"; do
    echo "  端口 $port 已被占用，尝试 $((port+1))..." >&2
    port=$((port + 1))
    if [ $((port - start)) -gt 20 ]; then
      echo "ERROR: 在 $start-$((port-1)) 范围内找不到空闲端口" >&2
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

# ── 获取局域网 IP ─────────────────────────────────────────────────────────────
# 用于提示用户如何从其它设备访问
LAN_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
[ -z "$LAN_IP" ] && LAN_IP="127.0.0.1"

# ── 检查 Ollama ───────────────────────────────────────────────────────────────
# 优先使用环境变量中指定的 OLLAMA_HOST
_OLLAMA_URL=${OLLAMA_HOST:-"http://127.0.0.1:11434"}
_OLLAMA_URL=${_OLLAMA_URL%/} # 移除末尾斜杠
_OLLAMA_URL=${_OLLAMA_URL/localhost/127.0.0.1} # 避免 localhost 优先解析到 IPv6

if ! curl -s "$_OLLAMA_URL/api/tags" > /dev/null 2>&1; then
  echo "⚠  Ollama 未运行或无法连接: $_OLLAMA_URL"
  echo "   请确保 Ollama 服务已启动，或检查 OLLAMA_HOST 环境变量"
  echo ""
else
  _TAGS_JSON=$(curl -s "$_OLLAMA_URL/api/tags" 2>/dev/null || echo "")
  if echo "$_TAGS_JSON" | grep -iq "Qwen3.5-35B-A3B"; then
    echo "✓  Ollama 文本模型 Qwen3.5-35B-A3B:latest 已就绪 @ $_OLLAMA_URL"
  else
    echo "⚠  文本模型 Qwen3.5-35B-A3B:latest 未找到，请先拉取:"
    echo "   ollama pull Qwen3.5-35B-A3B:latest"
  fi
  if echo "$_TAGS_JSON" | grep -iq "qwen3-vl"; then
    echo "✓  Ollama 视觉模型 qwen3-vl:8b 已就绪 @ $_OLLAMA_URL"
  else
    echo "ℹ  可选视觉模型 qwen3-vl:8b 尚未就绪（图像分析将回退 LM Studio）"
  fi
fi

# ── 启动后端 ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ 启动后端服务 (端口 $BACKEND_PORT)..."
cd "$BACKEND_DIR"
if [ -d "venv" ]; then
  source venv/bin/activate
fi

if ! command -v uvicorn > /dev/null 2>&1; then
  echo "  (重新)初始化 Python 虚拟环境与依赖..."
  if [ ! -d "venv" ]; then
    python3 -m venv venv
  fi
  source venv/bin/activate
  pip install -r requirements.txt
fi

# 确保后端绑定到 0.0.0.0 以允许外部访问
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
# 并通过 --host 参数允许局域网访问
VITE_BACKEND_PORT=$BACKEND_PORT npm run dev -- --port "$FRONTEND_PORT" --host &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$ROOT_DIR/.frontend.pid"
echo "  前端 PID: $FRONTEND_PID"

sleep 3
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  系统已启动！                                        ║"
echo "║                                                      ║"
printf "║  🌐 本地入口:   http://localhost:%-5s               ║\n" "$FRONTEND_PORT"
printf "║  📱 远程访问:   http://%-15s:%-5s        ║\n" "$LAN_IP" "$FRONTEND_PORT"
printf "║  🔧 API 文档:   http://localhost:%-5s/docs          ║\n" "$BACKEND_PORT"
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
