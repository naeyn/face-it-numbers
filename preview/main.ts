import "./gallery.css";
import {
  badgeElement,
  badgeFromLabel,
  badgeFromRole,
  badgeFromStreak,
  hideTip,
  LABEL_CSS,
  showTip,
  type Badge,
} from "../src/content/badge-art";
import { GAME_LABEL_TEXT, GAME_LABEL_TONE } from "../src/lib/game-labels";
import { CAREER_DEFS, HISTORY_DEFS, type CareerPlayer } from "../src/lib/role-labels";
import type { LeetifyProfile } from "../src/lib/leetify";
import type { GameLabelKey } from "../src/lib/types";

// The real badge CSS, straight from the module the content script uses.
const style = document.createElement("style");
style.textContent = LABEL_CSS;
document.head.append(style);

const STAGES = ["#1f1f22", "#0e0e10", "#26262b", "#17171b", "#f2f2f4"];

let compact = false;
let stage = STAGES[0];

// --- fixtures, built through the real factories -----------------------------

const NICK = "PreviewPlayer";

function formBadges(): Badge[] {
  return (Object.keys(GAME_LABEL_TEXT) as GameLabelKey[]).map((key) =>
    badgeFromLabel({
      playerId: `form-${key}`,
      nickname: NICK,
      key,
      text: GAME_LABEL_TEXT[key],
      tone: GAME_LABEL_TONE[key],
      detail: "1.42 KD vs 0.98 prior · W · 94th pct of prior 27",
    }),
  );
}

function streakBadges(): Badge[] {
  const out: Badge[] = [];
  for (const won of [true, false]) {
    for (let len = 4; len <= 9; len += 1) {
      out.push(
        badgeFromStreak({
          playerId: `streak-${won ? "w" : "l"}${len}`,
          nickname: NICK,
          streak: { len, won },
          form: Array.from({ length: Math.min(len + 2, 10) }, (_, i) =>
            i < len ? won : !won,
          ),
        }),
      );
    }
  }
  return out;
}

// The `sided` pendant derives its text from the profile, so hand it a stub.
const STUB: CareerPlayer = {
  playerId: "preview",
  nickname: NICK,
  profile: { ctRating: 1.14, tRating: 0.92 } as unknown as LeetifyProfile,
};

function careerBadges(): Badge[] {
  return CAREER_DEFS.map((def) =>
    badgeFromRole({
      playerId: `career-${def.key}`,
      nickname: NICK,
      key: def.key,
      text: typeof def.text === "function" ? def.text(STUB) : def.text,
      tone: def.tone,
      detail: "63% opening-duel success · best of 6 tracked",
      source: "leetify",
    }),
  );
}

function historyBadges(): Badge[] {
  return HISTORY_DEFS.map((def) =>
    badgeFromRole({
      playerId: `history-${def.key}`,
      nickname: NICK,
      key: def.key,
      text: def.text,
      tone: def.tone,
      detail: "0.61 HS% over 28 games · highest in lobby",
      source: "history",
    }),
  );
}

// --- rendering --------------------------------------------------------------

function render(badge: Badge, asCompact = compact): HTMLElement {
  const span = badgeElement(badge, asCompact);
  span.addEventListener("mouseenter", () => showTip(span, badge));
  span.addEventListener("mouseleave", hideTip);
  return span;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function section(title: string, note: string, body: HTMLElement): HTMLElement {
  const wrap = el("section");
  wrap.append(el("h2", undefined, title), el("p", "note", note));
  const stageEl = el("div", "stage");
  stageEl.style.setProperty("--stage", stage);
  stageEl.append(body);
  wrap.append(stageEl);
  return wrap;
}

function grid(badges: Badge[]): HTMLElement {
  const wrap = el("div", "grid");
  for (const badge of badges) {
    const cell = el("div", "cell");
    cell.append(render(badge), el("div", "cap", `${badge.text} · ${badge.tone}`));
    wrap.append(cell);
  }
  return wrap;
}

function playerRow(badges: Badge[], label: string): HTMLElement {
  const row = el("div", "row");
  row.append(el("div", "av"), el("span", "nick", label));
  // Mirrors the flex host the injector adds to a real Faceit row.
  row.classList.add("fin-label-host");
  for (const badge of badges) row.append(render(badge));
  return row;
}

function avatarCards(): HTMLElement {
  const wrap = el("div", "cards");
  for (const badge of [careerBadges()[0], historyBadges()[0]]) {
    const card = el("div", "card");
    const art = el("div", "art fin-avatar-badge-host");
    const span = render(badge, true);
    span.classList.add("avatar-badge");
    art.append(span);
    card.append(art, el("div", "who", badge.text));
    wrap.append(card);
  }
  return wrap;
}

function replay(): void {
  const nodes = [...document.querySelectorAll<HTMLElement>(".fin-player-label")];
  for (const node of nodes) {
    node.classList.remove("fin-enter");
    node.style.animationDelay = "";
  }
  void document.body.offsetWidth; // force reflow so the animation restarts
  nodes.forEach((node, i) => {
    node.style.animationDelay = `${Math.min(i, 9) * 40}ms`;
    node.classList.add("fin-enter");
  });
}

function controls(): HTMLElement {
  const bar = el("div", "controls");

  const compactBtn = el("button", compact ? "on" : undefined, "Compact rows");
  compactBtn.addEventListener("click", () => {
    compact = !compact;
    draw();
  });

  const replayBtn = el("button", undefined, "Replay entry animation");
  replayBtn.addEventListener("click", replay);

  bar.append(compactBtn, replayBtn);

  const swatches = el("div", "swatches");
  swatches.append(el("span", undefined, "surface"));
  for (const color of STAGES) {
    const swatch = el("button", stage === color ? "swatch on" : "swatch");
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", () => {
      stage = color;
      draw();
    });
    swatches.append(swatch);
  }
  bar.append(swatches);
  return bar;
}

function draw(): void {
  hideTip();
  const app = document.getElementById("app");
  if (!app) return;
  const wrap = el("div", "wrap");

  wrap.append(el("h1", undefined, "Badge gallery"));
  const lede = el("p", "lede");
  lede.innerHTML =
    "Every badge the extension injects, built through the real factories and the real CSS in " +
    "<code>src/content/badge-art.ts</code>. Hover any badge for its live tooltip. Edit fixtures " +
    "here; edit styles at the source and they change here too.";
  wrap.append(lede, controls());

  wrap.append(
    section(
      "Form labels",
      "Post-game verdict on this match against that player's previous 30. Filled square, text " +
        "only — in compact rows they collapse to an icon.",
      grid(formBadges()),
    ),
    section(
      "Streaks",
      "Pre-match only, 4+ run across all maps. The one family that always pairs icon with text, " +
        "since the count is the whole point — so it opts out of the icon-only compact treatment.",
      grid(streakBadges()),
    ),
    section(
      "Role pendants — history",
      "Tendency from recent Faceit matches. Outlined pill with an always-visible icon.",
      grid(historyBadges()),
    ),
    section(
      "Role pendants — career (Leetify)",
      "Same pill, wearing the Leetify brand gradient ring to mark the data source.",
      grid(careerBadges()),
    ),
    section(
      "Avatar corner badges",
      "How role pendants sit on the big player cards. Resting CSS position only — in the live " +
        "page pinToCorner() re-pins these in pixels against the measured avatar rect.",
      avatarCards(),
    ),
  );

  const rows = el("div");
  rows.append(
    playerRow([formBadges()[0], streakBadges()[0], historyBadges()[0]], "s1mple"),
    playerRow([streakBadges()[7], careerBadges()[0]], "donk"),
    playerRow([formBadges()[1]], "ropz"),
  );
  wrap.append(
    section(
      "Row collisions",
      "All three families on one name, in the fixed left-to-right order the injector enforces: " +
        "form label, then streak, then role pill.",
      rows,
    ),
  );

  app.replaceChildren(wrap);
}

draw();
