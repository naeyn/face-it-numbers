import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json";

// Chrome accepts up to four dot-separated integers, so a prerelease tag like
// 1.1.0-rc.1 ships as 1.1.0 in the manifest while the release keeps its full name.
const version = pkg.version.split("-")[0];

export default defineManifest({
  manifest_version: 3,
  name: "Faceit Numbers",
  description:
    "CS2 map play and win rates for both teams during Faceit lobby veto. Unofficial — not affiliated with FACEIT.",
  version,
  icons: {
    16: "icons/icon16.png",
    32: "icons/icon32.png",
    48: "icons/icon48.png",
    128: "icons/icon128.png",
  },
  // `scripting` is what lets us run the identity probe in the page's own world;
  // the service worker's fetch cannot be trusted to carry Faceit's session.
  permissions: ["storage", "cookies", "scripting"],
  host_permissions: [
    "https://www.faceit.com/*",
    "https://api.faceit.com/*",
    "https://api-public.cs-prod.leetify.com/*",
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
    default_icon: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
    },
    default_popup: "src/popup/index.html",
  },
});
