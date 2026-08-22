import { extensionAlive } from "./extension";

export function extensionVersion(): string {
  if (!extensionAlive()) return "0.0.0";
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

export function mountVersion(parent: HTMLElement): void {
  const line = document.createElement("p");
  line.className = "version";
  line.textContent = `v${extensionVersion()}`;
  parent.append(line);
}
