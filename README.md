# 波斯 · 美伊战争态势系统

**BoShi — US-Iran War Situation Awareness System**

一个基于 AI 驱动的实时战场态势感知平台，聚合多源新闻资讯，通过大语言模型智能分析，以可视化地图、时间轴、情报面板等形式呈现美伊冲突动态。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/Python-3.11+-green.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)

---

## 功能特性

- **实时态势地图** — 基于 React Leaflet 的交互式地图，标注冲突区域、军事单位位置与事件热点
- **多源新闻聚合** — 自动抓取 BBC、Reuters、Al Jazeera 等主流媒体 RSS，结合 Playwright 动态爬取
- **AI 智能分析** — 支持 **Ollama + LM Studio** 双后端自动切换；默认在 `auto` 下先试 Ollama（`Qwen3.5-35B-A3B:latest` 文本），失败再回退 LM Studio
- **事件时间轴** — 按时间序列展示冲突事件，支持筛选与详情查看
- **实时推送** — 后端通过 WebSocket 向前端实时推送最新事件与新闻
- **定时调度** — APScheduler 驱动，每小时自动抓取更新数据，每日生成综合分析

---

## 技术栈

### 前端

| 技术 | 版本 | 用途 |
|---|---|---|
| React | 19 | UI 框架 |
| TypeScript | 5 | 类型安全 |
| Vite | 7 | 构建工具 |
| Tailwind CSS | 3 | 样式框架 |
| React Leaflet | — | 交互地图 |
| Recharts | — | 数据图表 |
| Axios | — | HTTP 客户端 |

### 后端

| 技术 | 版本 | 用途 |
|---|---|---|
| FastAPI | 0.115 | API 框架 |
| Uvicorn | 0.32 | ASGI 服务器 |
| SQLAlchemy | 2.0 | ORM（异步） |
| aiosqlite | — | SQLite 异步驱动 |
| APScheduler | 3.10 | 定时任务 |
| Playwright | 1.49 | 动态页面爬取 |
| BeautifulSoup4 | — | HTML 解析 |
| Ollama | — | 本地 LLM 推理 |

---

## 系统架构

```
BoShi2025/
├── backend/                # Python FastAPI 后端
│   ├── main.py             # 应用入口，WebSocket，定时任务注册
│   ├── scheduler.py        # APScheduler 任务定义
│   ├── seed_data.py        # 初始化种子数据
│   ├── api/                # REST API 路由
│   │   ├── events.py       # 冲突事件接口
│   │   ├── news.py         # 新闻资讯接口
│   │   ├── analysis.py     # AI 分析接口
│   │   ├── zones.py        # 地理区域接口
│   │   └── control.py      # 系统控制接口
│   ├── models/             # SQLAlchemy 数据模型
│   ├── pipeline/           # 数据处理管道
│   │   ├── ollama_client.py# Ollama LLM 调用
│   │   └── ...
│   └── scrapers/           # 数据抓取模块
├── frontend/               # React + TypeScript 前端
│   ├── src/
│   │   ├── components/     # UI 组件
│   │   │   ├── Map/        # 地图组件
│   │   │   ├── News/       # 新闻面板
│   │   │   ├── Timeline/   # 事件时间轴
│   │   │   ├── Analysis/   # AI 分析面板
│   │   │   ├── Control/    # 控制面板
│   │   │   └── UI/         # 通用 UI 组件
│   │   ├── hooks/          # React Hooks（含 WebSocket）
│   │   ├── api/            # API 客户端
│   │   └── store/          # 状态管理
│   └── vite.config.ts
└── start.sh                # 一键启动脚本
```

---

## 快速开始

### 前置依赖

- **Python** 3.11+
- **Node.js** 18+
- **Ollama**（本地 LLM 运行时）

### 1. 安装 Ollama 并拉取模型

```bash
# 安装 Ollama（macOS）
brew install ollama

# 启动 Ollama 服务
ollama serve

# 拉取文本模型（推荐，MoE，约 21GB）
ollama pull Qwen3.5-35B-A3B:latest

# 可选：拉取视觉模型（用于 Ollama 原生图像分析）
ollama pull qwen3-vl:8b
```

### 2. 一键启动

```bash
git clone https://github.com/TigerYY/Boshi2026.git
cd Boshi2026
chmod +x start.sh
./start.sh
```

脚本会自动完成：

- 创建 Python 虚拟环境并安装依赖
- 启动 FastAPI 后端（端口 `8100`）
- 安装 npm 依赖并启动 Vite 前端（端口 `5173`）

### 3. 访问系统

| 服务 | 地址 (本地) | 说明 |
| :--- | :--- | :--- |
| **前端界面** | `http://localhost:5173` | 系统主入口 (远程访问请使用局域网 IP) |
| **API 文档** | `http://localhost:8100/docs` | Swagger UI 交互文档 |
| **数据监控** | `http://localhost:8100/api/health` | 检查后端运行状态 |
| **API 文档** | `http://localhost:8100/redoc` | ReDoc 文档 |

---

## 手动启动

如需分别启动各服务：

```bash
# 后端
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8100 --reload

# 前端（新终端）
cd frontend
npm install
npm run dev
```

---

## 端口说明

| 服务 | 端口 |
|---|---|
| 前端 Vite Dev Server | `5173` |
| 后端 FastAPI | `8100` |
| Ollama | `11434` |
| LM Studio（可选） | `1234` | OpenAI 兼容 `/v1`，文字推理优先走此服务 |

### LLM 环境变量（后端）

在启动 `uvicorn` 前可设置：

| 变量 | 默认 | 说明 |
|------|------|------|
| `LM_STUDIO_BASE` | `http://127.0.0.1:1234/v1` | LM Studio 本地服务器 OpenAI 兼容根路径 |
| `LM_STUDIO_MODEL` | `qwen/qwen3.5-35b-a3b` | 须与 LM Studio 中已加载模型的 API id 一致 |
| `LLM_PRIMARY` | `auto` | `auto`：先试 Ollama，失败再 LM Studio；`lm_studio`：先试 LM Studio；`ollama`：先试 Ollama |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama 地址（降级与图像分析） |
| `OLLAMA_TEXT_MODEL` | `Qwen3.5-35B-A3B:latest` | Ollama 文本任务模型（摘要、OSINT、日报等） |
| `OLLAMA_VISION_MODEL` | `qwen3-vl:8b` | Ollama 视觉任务模型（可选，未就绪时图像分析会走 LM Studio） |
| `LM_STUDIO_ONLY` | `0` | 设为 `1` 时仅使用 LM Studio，不回退 Ollama |
| `PROVIDER_FAILOVER_THRESHOLD` | `2` | 在 `auto` 模式下，首选服务连续失败达到该次数后进入短暂冷却 |
| `PROVIDER_FAILOVER_COOLDOWN_SEC` | `45` | 首选服务冷却秒数，冷却期间优先尝试备用服务 |

**图像分析**（`analyze_image`）会优先检测 Ollama 视觉模型是否存在：存在则走 `OLLAMA_VISION_MODEL`，否则直接走 LM Studio 多模态；若你本地只开一个服务，系统会自动落到可用服务。

---

## License

[MIT](LICENSE) © 2026 Tiger
