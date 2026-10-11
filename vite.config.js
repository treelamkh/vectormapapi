import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 如果你的 Repository 名稱是 'hk-vector-map'，base 就設定為 '/hk-vector-map/'
export default defineConfig({
  plugins: [vue()],
  base: process.env.NODE_ENV === 'production' ? '/vectormapapi/' : '/',
  server: {
    proxy: {
      '/csdi-api': {
        target: 'https://mapapi.geodata.gov.hk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/csdi-api/, '')
      }
    }
  }
})