import pkg from "../../package.json";

export function extensionVersion(): string {
  return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
}

export function mountVersion(parent: HTMLElement): void {
  const line = document.createElement("p");
  line.className = "version";
  line.textContent = `v${extensionVersion()}`;
  parent.append(line);
}
