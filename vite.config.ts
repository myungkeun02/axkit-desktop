import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import pkg from './package.json';

const commit = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; } })();
// §32: the build number is the repository's commit count; the assistant's Mac records the same number for its zip.
const build = (() => { try { return Number(execSync('git rev-list --count HEAD').toString().trim()) || 0; } catch { return 0; } })();

// Tauri runs the dev server on a fixed port and serves the built files from dist/.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version} (${commit}, 빌드 ${build})`), __APP_BUILD__: JSON.stringify(build) },
  clearScreen: false,
  server: {
    port: 1420, strictPort: true, host: '127.0.0.1', watch: { ignored: ['**/src-tauri/**'] },
    // Browser preview only (no Tauri): reach the mock Mac (AXKIT_MOCK_PORT when 47795 is taken). The app itself never uses this.
    proxy: { '/m/': { target: `http://127.0.0.1:${process.env.AXKIT_MOCK_PORT ?? 47795}`, changeOrigin: true } },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'safari16', outDir: 'dist', sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
