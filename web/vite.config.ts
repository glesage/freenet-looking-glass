import { defineConfig, type PluginOption } from "vite";

const NODE_HOST = process.env.FREENET_NODE_HOST ?? "127.0.0.1:7509";

function lookingGlassUrls(): PluginOption {
  return {
    name: "looking-glass:print-urls",
    configureServer(server) {
      const print = server.printUrls.bind(server);
      server.printUrls = () => {
        const urls = server.resolvedUrls;
        if (!urls?.local.length) return print();
        const withNode = urls.local.map((u) => `${u}?node=${NODE_HOST}`);
        server.config.logger.info(
          `  \u279C  Local:   ${withNode[0]}`,
        );
      };
    },
  };
}

export default defineConfig({
  plugins: [lookingGlassUrls()],
  // CRITICAL: the gateway serves the app inside a sandboxed iframe at
  // /v1/contract/web/<id>/ — absolute asset paths would 404 against the
  // node root. Relative base keeps every asset same-origin and in-path.
  base: "./",
  // Pin IPv4. Vite 6 on macOS otherwise binds [::1] only, and the documented
  // http://127.0.0.1:5173 URL then fails with ERR_CONNECTION_REFUSED.
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
