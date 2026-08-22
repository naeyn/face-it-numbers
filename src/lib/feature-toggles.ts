import {
  FEATURE_GROUPS,
  loadSettings,
  saveSettings,
  type FeatureKey,
  type FeatureSettings,
} from "./settings";
import { COLOR_PRESETS } from "./team-colors";

function persist(settings: FeatureSettings): void {
  void saveSettings(settings);
}

function mountColorPickers(root: HTMLElement, settings: FeatureSettings): void {
  const heading = document.createElement("h2");
  heading.textContent = "Team colours";
  root.append(heading);

  const row = document.createElement("div");
  row.className = "colors";

  const youLabel = document.createElement("label");
  youLabel.className = "color";
  const youText = document.createElement("span");
  youText.textContent = "You";
  const youInput = document.createElement("input");
  youInput.type = "color";
  youInput.value = settings.youColor;
  youLabel.append(youText, youInput);

  const themLabel = document.createElement("label");
  themLabel.className = "color";
  const themText = document.createElement("span");
  themText.textContent = "Enemy";
  const themInput = document.createElement("input");
  themInput.type = "color";
  themInput.value = settings.themColor;
  themLabel.append(themText, themInput);

  const swap = document.createElement("button");
  swap.type = "button";
  swap.className = "color-swap";
  swap.textContent = "Swap";

  row.append(youLabel, themLabel, swap);
  root.append(row);

  const presets = document.createElement("div");
  presets.className = "color-presets";
  for (const preset of COLOR_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.label;
    button.addEventListener("click", () => {
      settings.youColor = preset.you;
      settings.themColor = preset.them;
      youInput.value = preset.you;
      themInput.value = preset.them;
      persist(settings);
    });
    presets.append(button);
  }
  root.append(presets);

  youInput.addEventListener("input", () => {
    settings.youColor = youInput.value;
    persist(settings);
  });
  themInput.addEventListener("input", () => {
    settings.themColor = themInput.value;
    persist(settings);
  });
  swap.addEventListener("click", () => {
    const nextYou = settings.themColor;
    const nextThem = settings.youColor;
    settings.youColor = nextYou;
    settings.themColor = nextThem;
    youInput.value = nextYou;
    themInput.value = nextThem;
    persist(settings);
  });
}

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

  mountColorPickers(root, settings);

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
    for (const input of root.querySelectorAll("input[data-key]")) {
      const el = input as HTMLInputElement;
      const key = el.dataset.key as FeatureKey;
      settings[key] = el.checked;
    }
    persist(settings);
  });
}
