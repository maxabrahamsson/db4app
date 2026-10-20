import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

// Plugin to copy apps folder to public during build
function copyAppsPlugin() {
  return {
    name: 'copy-apps',
    buildStart() {
      const appsSource = join(__dirname, 'apps', 'apps')
      const appsDest = join(__dirname, 'public', 'apps', 'apps')
      
      if (!existsSync(appsSource)) {
        console.warn('⚠️  apps/apps folder not found, skipping copy')
        return
      }

      function copyRecursive(src: string, dest: string) {
        if (!existsSync(dest)) {
          mkdirSync(dest, { recursive: true })
        }
        
        const entries = readdirSync(src, { withFileTypes: true })
        
        for (const entry of entries) {
          const srcPath = join(src, entry.name)
          const destPath = join(dest, entry.name)
          
          if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath)
          } else {
            copyFileSync(srcPath, destPath)
          }
        }
      }

      try {
        copyRecursive(appsSource, appsDest)
        console.log('✅ Copied apps folder to public')
      } catch (error) {
        console.error('❌ Failed to copy apps folder:', error)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyAppsPlugin()],
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
