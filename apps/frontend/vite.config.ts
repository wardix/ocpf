import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file dari folder current directory
  const env = loadEnv(mode, process.cwd());

  return {
    plugins: [react()],
    server: {
      host: true,
      // Ambil dari VITE_ALLOWED_HOST, default ke localhost jika tidak ada
      allowedHosts: [env.VITE_ALLOWED_HOST || 'localhost']
    }
  }
})