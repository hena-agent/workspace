import { strict } from "node:assert"
import { createRequire } from "node:module"
import { plugin } from "bun"

// Use Vite's installed Solid compiler, not Bun's React JSX transform. No
// providers, resources, query observers, or SDK modules are replaced.
const require = createRequire(import.meta.resolve("vite-plugin-solid"))
const { transformAsync } = require("@babel/core")
const solid = require.resolve("babel-preset-solid")

plugin({
  name: "desktop-cold-start-solid",
  setup(build) {
    // Asset loading and workers are outside this DOM/startup test.
    build.onResolve({ filter: /\?(worker|url|raw)/ }, ({ path }) => ({ path, namespace: "asset" }))
    build.onLoad({ filter: /.*/, namespace: "asset" }, ({ path }) => ({
      contents: `export default ${JSON.stringify(path)}`,
      loader: "js",
    }))
    build.onLoad({ filter: /\.(css|svg)$/ }, ({ path }) => ({
      contents: `export default ${JSON.stringify(path)}`,
      loader: "js",
    }))
    build.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const source = await Bun.file(path).text()
      const previous =
        process.env.HENA_TEST_OLD_BOOTSTRAP === "1" && path.replaceAll("\\", "/").endsWith("/context/server-sync.tsx")
      const fixed = 'await queryClient.fetchQuery({ queryKey: [serverSDK.scope, "bootstrap"] })'
      if (previous) strict.ok(source.includes(fixed), "before-fix transform must match the production await")
      return {
        contents: (
          await transformAsync(previous ? source.replace(fixed, "await bootstrap.promise") : source, {
            filename: path,
            presets: [[solid, { generate: "dom", hydratable: false }]],
            parserOpts: { plugins: ["jsx", "typescript"] },
            configFile: false,
            babelrc: false,
          })
        ).code,
        loader: "ts",
      }
    })
  },
})
