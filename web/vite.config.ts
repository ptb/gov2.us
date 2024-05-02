import { default as reactPlugin } from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { default as tsPathsPlugin } from "vite-tsconfig-paths"

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "../www"
  },
  plugins: [tsPathsPlugin(), reactPlugin()]
})
