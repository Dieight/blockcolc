import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname, "../../apps/web"),
  plugins: [{
    name: "verify-csp-safe-litematic-bundle",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const forbiddenModules = Object.keys(output.modules).filter((id) => /(?:prismarine-nbt|protodef|node_modules[\\/]buffer)/.test(id));
        if (forbiddenModules.length > 0) this.error(`CSP-unsafe Litematic dependencies entered the browser bundle: ${forbiddenModules.join(", ")}`);
        if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(output.code)) this.error(`Dynamic code evaluation entered ${output.fileName}`);
      }
    },
  }],
  build: {
    write: false,
    lib: {
      entry: resolve(import.meta.dirname, "test/browser-entry.ts"),
      formats: ["es"],
      fileName: "litematic-browser-smoke",
    },
  },
});
