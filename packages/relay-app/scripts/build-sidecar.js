#!/usr/bin/env node
/**
 * Build script for creating the relay sidecar.
 * 
 * Strategy: Node Binary Sidecar
 * 1. Bundle server.js -> src-tauri/resources/server.js
 * 2. Copy pglite assets -> src-tauri/resources/
 * 3. Copy local Node executable -> src-tauri/binaries/relay-$TRIPLE
 */

import { execSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform, arch } from 'node:os'
import esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const binariesDir = join(projectRoot, 'src-tauri', 'binaries')
const resourcesDir = join(projectRoot, 'src-tauri', 'resources')

// Get Tauri target triple
function getTargetTriple() {
  if (process.env.TAURI_TARGET_TRIPLE) return process.env.TAURI_TARGET_TRIPLE
  const p = platform()
  const a = arch()
  if (p === 'darwin') return a === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  if (p === 'win32') return 'x86_64-pc-windows-msvc'
  if (p === 'linux') return a === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'
  throw new Error(`Unsupported platform: ${p}-${a}`)
}

async function main() {
  console.log('📦 Building relay sidecar (Node runtime)...')

  const targetTriple = getTargetTriple()
  const isWindows = targetTriple.includes('windows')
  const ext = isWindows ? '.exe' : ''
  console.log(`   Target triple: ${targetTriple}`)

  // Ensure directories exist
  mkdirSync(binariesDir, { recursive: true })
  mkdirSync(resourcesDir, { recursive: true })

  // 1. Bundle server.js
  console.log('   Bundling server.js...')
  const bundlePath = join(resourcesDir, 'server.cjs')
  const entryPoint = join(projectRoot, 'sidecar', 'server.js')

  console.log(`[Build Debug] Entry Point: ${entryPoint}`)
  try {
    const { readFileSync } = await import('fs')
    const content = readFileSync(entryPoint, 'utf8')
    console.log(`[Build Debug] Entry Content Intro: ${content.substring(0, 100).replace(/\n/g, '\\n')}`)
  } catch (e) {
    console.log(`[Build Debug] Failed to read entry file: ${e.message}`)
  }

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node16',
    format: 'cjs',
    outfile: bundlePath,
    minify: false,
    sourcemap: false,
    define: {
      'import.meta.url': '__import_meta_url'
    },
    banner: {
      js: 'const __import_meta_url = require("url").pathToFileURL(__filename).toString();'
    }
  })
  console.log(`✅ Server bundled to: ${bundlePath}`)

  // 2. Copy Assets
  console.log('   Copying assets...')
  // Correct path for monorepo: root/node_modules/
  const pgliteDist = join(projectRoot, '..', '..', 'node_modules', '@electric-sql', 'pglite', 'dist')

  try {
    copyFileSync(join(pgliteDist, 'pglite.wasm'), join(resourcesDir, 'pglite.wasm'))
    copyFileSync(join(pgliteDist, 'pglite.data'), join(resourcesDir, 'pglite.data'))
    console.log(`✅ Assets copied to resources`)
  } catch (e) {
    console.error('Failed to copy assets. Check pglite location.', e)
    process.exit(1)
  }

  // 3. Create Sidecar Binary (Copy Node)
  console.log('   Creating sidecar binary (copying node)...')
  const sidecarName = `relay-sidecar-${targetTriple}${ext}`
  const sidecarPath = join(binariesDir, sidecarName)

  // Create x86_64 fallback for Rosetta contexts
  if (targetTriple === 'aarch64-apple-darwin') {
    const fallbackName = `relay-sidecar-x86_64-apple-darwin${ext}`
    const fallbackPath = join(binariesDir, fallbackName)
    copyFileSync(process.execPath, fallbackPath)
    console.log(`   Created fallback binary: ${fallbackName}`)
  }

  // For local dev, we copy the current node executable
  const nodePath = process.execPath
  copyFileSync(nodePath, sidecarPath)
  console.log(`✅ Sidecar binary created at: ${sidecarPath} (copied from ${nodePath})`)

  console.log('🎉 Sidecar build complete!')
}

main().catch((err) => {
  console.error('❌ Build failed:', err)
  process.exit(1)
})
