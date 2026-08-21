import {
  FEATURE_GROUPS,
  loadSettings,
  saveSettings,
  type FeatureKey,
  type FeatureSettings,
} from "./settings";

export async function mountFeatureToggles(root: HTMLElement): Promise<void> {
  const settings = await loadSettings();
  root.replaceChildren();

  for (const group of FEATURE_GROUPS) {
    const heading = document.createElement("h2");
    heading.textContent = group.title;
    root.append(heading);

    for (const item of group.items) {
      const label = document.createElement("label");
      label.className = "toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = settings[item.key];
      input.dataset.key = item.key;
      const text = document.createElement("span");
      text.innerHTML = `<strong>${item.label}</strong><small>${item.hint}</small>`;
      label.append(input, text);
      root.append(label);
    }
  }

  root.addEventListener("change", () => {
    const next = { ...settings };
    for (const input of root.querySelectorAll("input[data-key]")) {
      const el = input as HTMLInputElement;
      const key = el.dataset.key as FeatureKey;
      next[key] = el.checked;
    }
    Object.assign(settings, next);
    void saveSettings(next as FeatureSettings);
  });
}
