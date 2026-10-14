import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { CALENDAR_SCOPES, readPublicClientId } from "./src/calendar/google-http.ts";
import { readUpdateRepository } from "./scripts/update-repository.mjs";

const oauthClientId = loadPublicClientId();
const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version as string;
const updateRepository = readUpdateRepository(process.cwd());
const hostPermissions = [
  ...(oauthClientId ? ["https://www.googleapis.com/*"] : []),
  ...(updateRepository ? [`https://api.github.com/repos/${updateRepository}/*`] : []),
];

// Публичный ключ фиксирует id fgaajikioedkgeddlpfolngopnpkjegm на любом компьютере.
// Приватный ключ в сборку не входит.
const manifest = {
  manifest_version: 3,
  name: "Расписание вуза — предпросмотр",
  version: packageVersion,
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyx/3mt1JvOC4yCd81RrrhPlPqUNWItH3FvNy6B9O3sKCoZrztQ0w+OlWvEJfqv0hGSuhxIoPeWmoOFUFVV7rdAdACR4XWEC/bvS7PLg9fnC1EJJ1lbcP20ulJu0rptS3f91VDcDaqF/h7nKEbWqUX5PlU7QK/0PpDTxgETvdEMvmRo67HneGtPOgflUO+IS7vfizRvs6KAm5CANy213lv4gXilGSv3ucAsqfQs26niJMggUVObzZf2Chd4uLE+dxeu37zJqZ/YJG5FZ5JoBzZT55/iIRJOfSjIfJPq+rGF+W22zkB3VtRmuvIQVhgAM1WLwAFiH8BMChcaEUUj6glwIDAQAB",
  description:
    "Читает таблицу расписания на stud.ibnd.ru. Одна тестовая запись в Google Calendar только после отдельного подтверждения.",
  minimum_chrome_version: "120",
  action: {
    default_title: "Расписание вуза",
    default_popup: "src/ui/popup/index.html",
    default_icon: {
      "16": "icons/16.png",
      "48": "icons/48.png",
    },
  },
  background: {
    service_worker: "background.js",
    type: "module",
  },
  options_ui: {
    page: "src/ui/options/index.html",
    open_in_tab: true,
  },
  icons: {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png",
  },
  permissions: ["activeTab", "scripting", "storage", "identity"],
  ...(oauthClientId ? { oauth2: { client_id: oauthClientId, scopes: CALENDAR_SCOPES } } : {}),
  ...(hostPermissions.length > 0 ? { host_permissions: hostPermissions } : {}),
};

function loadPublicClientId(): string {
  const path = resolve("oauth.public.json");
  if (!existsSync(path)) return "";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { clientId?: unknown };
    return typeof parsed.clientId === "string" ? readPublicClientId(parsed.clientId) : "";
  } catch {
    return "";
  }
}

function manifestPlugin(): Plugin {
  return {
    name: "ucs-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

function stripCrossOrigin(): Plugin {
  return {
    name: "ucs-strip-crossorigin",
    apply: "build",
    transformIndexHtml(html) {
      return html.replaceAll(" crossorigin", "");
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: "public",
  define: {
    __UCS_OAUTH_CONFIGURED__: JSON.stringify(Boolean(oauthClientId)),
    __UCS_UPDATE_REPOSITORY__: JSON.stringify(updateRepository),
    __UCS_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [manifestPlugin(), stripCrossOrigin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    modulePreload: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve("src/ui/popup/index.html"),
        review: resolve("src/ui/review/index.html"),
        options: resolve("src/ui/options/index.html"),
        background: resolve("src/background/service-worker.ts"),
      },
      output: {
        entryFileNames(chunk) {
          if (chunk.name === "background") return "background.js";
          return "assets/[name].js";
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
