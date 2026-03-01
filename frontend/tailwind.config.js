/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        military: {
          dark: '#0a0e14',
          panel: '#0d1117',
          border: '#1e2d40',
          accent: '#00d4ff',
          warn: '#ff6b35',
          danger: '#ff2244',
          success: '#00ff88',
          us: '#1a6fb5',
          iran: '#cc2222',
          proxy: '#cc8800',
          neutral: '#666666',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      }
    },
  },
  plugins: [],
}

