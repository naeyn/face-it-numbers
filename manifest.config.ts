import { defineManifest } from "@crxjs/vite-plugin";
import { version } from "./package.json";

export default defineManifest({
  manifest_version: 3,
  name: "Faceit Numbers",
  description:
    "CS2 map play and win rates for your team and enemies during Faceit lobby veto",
  version,
  permissions: ["storage", "cookies"],
  host_permissions: [
    "https://www.faceit.com/*",
    "https://api.faceit.com/*",
  ],
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://www.faceit.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },
  action: {
    default_title: "Faceit Numbers",
    default_popup: "src/popup/index.html",
  },
});
