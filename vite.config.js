import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 如果你的 Repository 名稱是 'hk-vector-map'，base 就設定為 '/hk-vector-map/'
export default defineConfig({
  plugins: [vue()],
  base: process.env.NODE_ENV === 'production' ? '/vectormapapi/' : '/',
  server: {
    proxy: {
      '/csdi-api': {
        target: 'https://mapapi.geodata.gov.hk/gs/api', // 加上 /gs/api
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/csdi-api/, '') // 把 /csdi-api 拿掉，後面直接接 /v1.0.0/...
      }
    }
  }
})