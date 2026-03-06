import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端端口：优先读取 start.sh 注入的环境变量，回退到 8100
const backendPort = process.env.VITE_BACKEND_PORT || '8100'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 端口由 start.sh 通过 --port 参数传入，这里的值仅作为直接 npm run dev 时的默认值
    port: 5173,
    host: true,
    strictPort: true, // 严格使用指定端口，不自动递增（start.sh 已保证传入的端口空闲）
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
})
