import { default as reactPlugin } from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { default as tsPathsPlugin } from "vite-tsconfig-paths"

export default defineConfig({
  build: {
    assetsDir: "",
    emptyOutDir: true,
    outDir: "../www",
    rollupOptions: {
      output: {
        assetFileNames: ({ name = "" }) => {
          const info = name.split(".")
          const extType = info[info.length - 1]

          switch (true) {
            case /\.(eot|[ot]tf|woff2?)$/.test(name):
              return `fonts/[name]-[hash].${extType}`
            case /\.(gif|jpe?g|png|svg|webp)$/.test(name):
              return `image/[name]-[hash].${extType}`
            case /\.(css)$/.test(name):
              return `style/[name]-[hash].${extType}`
            default:
              return `asset/[name]-[hash].${extType}`
          }
        },
        chunkFileNames: "js/[name]-[hash].js",
        entryFileNames: "js/[name]-[hash].js",
        manualChunks: (id) =>
          id.includes("node_modules") ? "share" : undefined
      }
    }
  },
  plugins: [tsPathsPlugin(), reactPlugin()]
})
