import {
  badgeForMap,
  findOutlier,
  formatElo,
  formatForm,
  isThin,
  suggestBanPick,
} from "../lib/insights";
import { extensionAlive, isContextInvalidated } from "../lib/extension";
import {
  DEFAULT_SETTINGS,
  type FeatureSettings,
  loadSettings,
  patchSettings,
} from "../lib/settings";
import {
  buildBriefing,
  pickedMapKeys,
  TAG_HINTS,
  vetoComplete,
  type BriefPlayer,
  type TeamBrief,
} from "../lib/briefing";
import {
  displayWinRate,
  pickAdvantage,
  playerDisplayWinRate,
} from "../lib/scoring";
import { smartAdvantage } from "../lib/calibration";
import type { LobbyStats, PlayerMapStat, TeamInsight, TeamMapStat } from "../lib/types";
import { formatChip, renderChart, type ChartRow } from "./chart";
import { overlayStyles } from "./overlay-styles";
import { applyTeamColors, teamPalette } from "../lib/team-colors";
import { extensionVersion } from "../lib/version";

const HOST_ID = "faceit-numbers-overlay";
const POS_KEY = "finOverlayPos";
const ONBOARD_KEY = "finOnboarded";

type OverlayCallbacks = {
  onSwap: () => void;
};

function pct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export class Overlay {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private panel: HTMLDivElement;
  private header: HTMLDivElement;
  private notice: HTMLDivElement;
  private body: HTMLDivElement;
  private selectedMap: string | undefined;
  private dragging = false;
  private dragOffset = { x: 0, y: 0 };
  private collapsed = false;
  private settings: FeatureSettings = { ...DEFAULT_SETTINGS };
  private latestStats: LobbyStats | undefined;
  private tab: "veto" | "brief" = "veto";
  private autoBriefed = false;
  private briefMap: string | undefined;
  private callbacks: OverlayCallbacks;
  private onMouseMove: (event: MouseEvent) => void;
  private onMouseUp: () => void;
  private tip: HTMLDivElement;
  private paintKey = "";
  private onboardEl: HTMLDivElement | undefined;
  private noticeText: string | undefined;

  constructor(callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
    const existing = document.getElementById(HOST_ID);
    existing?.remove();

    this.host = document.createElement("div");
    this.host.id = HOST_ID;
    this.root = this.host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = overlayStyles();

    this.panel = document.createElement("div");
    this.panel.className = "panel";
    this.panel.style.left = "16px";
    this.panel.style.top = "88px";

    this.header = document.createElement("div");
    this.header.className = "header";
    this.header.innerHTML = `
      <div class="title"><span>Faceit Numbers</span> · last 30</div>
      <button type="button" data-action="swap">Swap teams</button>
      <button type="button" data-action="collapse" aria-label="Collapse">−</button>
    `;

    this.notice = document.createElement("div");
    this.notice.className = "notice";
    this.notice.style.display = "none";

    this.body = document.createElement("div");
    this.body.className = "body";
    this.body.innerHTML = `<p class="muted">Loading map stats…</p>`;

    this.tip = document.createElement("div");
    this.tip.className = "tip";

    this.panel.append(this.header, this.notice, this.body);
    this.root.append(style, this.panel, this.tip);
    document.documentElement.append(this.host);
    applyTeamColors(this.host, this.settings.youColor, this.settings.themColor);

    this.panel.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      const action = button?.dataset.action;
      if (!action) return;
      event.stopPropagation();
      if (action === "swap") this.callbacks.onSwap();
      else if (action === "collapse") this.toggleCollapsed();
      else if (action === "sort") void this.toggleSetting("sortBest");
      else if (action === "adjust") void this.toggleSetting("adjust");
      else if (action === "tab-veto" && this.latestStats) {
        this.tab = "veto";
        this.paintKey = "";
        this.render(this.latestStats);
      } else if (action === "tab-brief" && this.latestStats) {
        this.tab = "brief";
        this.paintKey = "";
        this.render(this.latestStats);
      } else if (action === "brief-map" && button?.dataset.map && this.latestStats) {
        this.briefMap = button.dataset.map;
        this.tab = "brief";
        this.paintKey = "";
        this.render(this.latestStats);
      } else if (action === "onboard-done") {
        void this.finishOnboarding();
      } else if (action === "onboard-settings") {
        if (extensionAlive()) {
          void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
        }
      }
    });

    this.onMouseMove = (event: MouseEvent) => {
      if (!this.dragging) return;
      const left = Math.max(0, event.clientX - this.dragOffset.x);
      const top = Math.max(0, event.clientY - this.dragOffset.y);
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
    };
    this.onMouseUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      if (!extensionAlive()) return;
      void chrome.storage.local.set({
        [POS_KEY]: { left: this.panel.style.left, top: this.panel.style.top },
      }).catch((error) => {
        if (!isContextInvalidated(error)) throw error;
      });
    };
    this.bindDrag();
    void this.restoreState();
  }

  destroy(): void {
    this.tip.style.display = "none";
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.host.remove();
  }

  setSettings(settings: FeatureSettings): void {
    this.settings = settings;
    applyTeamColors(this.host, settings.youColor, settings.themColor);
  }

  showNeedLogin(): void {
    this.body.innerHTML = `
      <p class="muted err">Log into Faceit in this browser, then reload the match room.</p>
      <p class="muted">No API key needed — stats are read from Faceit while you are signed in.</p>
    `;
  }

  showError(message: string): void {
    this.body.innerHTML = `<p class="muted err">${escapeHtml(message)}</p>`;
  }

  // Non-destructive status strip: keeps the rendered briefing intact while a
  // refresh fails transiently (rate limits etc.). Pass undefined to clear.
  setNotice(message: string | undefined): void {
    this.noticeText = message || undefined;
    if (this.noticeText) this.notice.textContent = this.noticeText;
    this.syncNotice();
  }

  private syncNotice(): void {
    const visible = Boolean(this.noticeText) && !this.collapsed && !this.onboardEl;
    this.notice.style.display = visible ? "" : "none";
  }

  render(stats: LobbyStats): void {
    this.latestStats = stats;
    const canBrief =
      this.settings.preBrief &&
      vetoComplete(stats) &&
      pickedMapKeys(stats).length > 0;
    if (canBrief && !this.autoBriefed) {
      this.tab = "brief";
      this.autoBriefed = true;
    }
    if (!canBrief && this.tab === "brief") this.tab = "veto";

    const key = this.signature(stats, canBrief);
    if (key === this.paintKey) return;
    this.paintKey = key;

    this.body.replaceChildren();
    if (canBrief) this.body.append(this.renderTabs());
    if (this.tab === "brief" && canBrief) this.renderBrief(stats);
    else this.renderVeto(stats);
  }

  private signature(stats: LobbyStats, canBrief: boolean): string {
    const maps = stats.you.maps
      .map((row, i) => {
        const them = stats.them.maps[i];
        return `${row.mapKey}:${row.games}:${row.winRate}:${row.kd}:${row.picked}:${them?.games}:${them?.winRate}`;
      })
      .join(",");
    const adr = stats.historyGames
      .map((row) => row.games[0]?.adr ?? 0)
      .join(",");
    return [
      stats.matchId,
      stats.status,
      stats.myFaction,
      this.tab,
      this.briefMap ?? "",
      this.selectedMap ?? "",
      String(canBrief),
      JSON.stringify(this.settings),
      maps,
      adr,
      String(stats.maps.map((entity) => entity.class_name).join(",")),
      String(stats.you.insight.stack),
      String(stats.them.insight.stack),
      String(stats.smart?.n ?? 0),
      String(stats.smart?.ready ?? false),
    ].join("|");
  }

  private bindHover(node: HTMLElement, title: string, body?: string): void {
    const show = () => {
      this.tip.replaceChildren();
      const head = document.createElement("div");
      head.className = "tip-title";
      head.textContent = title;
      this.tip.append(head);
      if (body) {
        const text = document.createElement("div");
        text.className = "tip-body";
        text.textContent = body;
        this.tip.append(text);
      }
      this.tip.style.display = "block";
      const rect = node.getBoundingClientRect();
      const width = this.tip.offsetWidth;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const top = rect.bottom + 6;
      const flip = top + this.tip.offsetHeight > window.innerHeight - 8;
      this.tip.style.left = `${left}px`;
      this.tip.style.top = `${flip ? Math.max(8, rect.top - this.tip.offsetHeight - 6) : top}px`;
    };
    const hide = () => {
      this.tip.style.display = "none";
    };
    node.addEventListener("mouseenter", show);
    node.addEventListener("mouseleave", hide);
  }

  private renderTabs(): HTMLElement {
    const tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.append(
      this.tabButton("tab-veto", "Veto", this.tab === "veto"),
      this.tabButton("tab-brief", "Brief", this.tab === "brief"),
    );
    return tabs;
  }

  private tabButton(action: string, label: string, on: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    if (on) button.classList.add("on");
    return button;
  }

  private renderVeto(stats: LobbyStats): void {
    const rows: ChartRow[] = stats.maps.map((entity) => {
      const you =
        stats.you.maps.find((row) => row.mapKey === entity.class_name) ??
        emptyTeamMap(entity.class_name, entity.name);
      const them =
        stats.them.maps.find((row) => row.mapKey === entity.class_name) ??
        emptyTeamMap(entity.class_name, entity.name);
      return {
        mapKey: entity.class_name,
        displayName: entity.name,
        dropped: you.dropped,
        picked: you.picked,
        you,
        them,
      };
    });

    const remaining = rows.filter((row) => !row.dropped && !row.picked);
    const smart = this.settings.smartPick ? stats.smart : undefined;
    const byPick = (a: ChartRow, b: ChartRow) =>
      smartAdvantage(
        pickAdvantage(b.you, b.them, this.settings.adjust),
        b.mapKey,
        smart,
      ) -
      smartAdvantage(
        pickAdvantage(a.you, a.them, this.settings.adjust),
        a.mapKey,
        smart,
      );
    const ordered = this.settings.sortBest ? [...rows].sort(byPick) : rows;

    for (const row of ordered) {
      row.thin = this.settings.thinSample && (isThin(row.you) || isThin(row.them));
      const badge = badgeForMap(row, remaining, this.settings.adjust, smart);
      if (badge && badge !== "thin") {
        row.badge = this.settings.permLabels ? badge : undefined;
      }
    }

    const legend = document.createElement("div");
    legend.className = "legend";
    const keys = document.createElement("div");
    keys.className = "keys";
    keys.innerHTML = `
      <span><i class="swatch" style="background:${this.settings.youColor}"></i>You</span>
      <span><i class="swatch" style="background:${this.settings.themColor}"></i>Them</span>
    `;
    const toggles = document.createElement("div");
    toggles.className = "toggles";
    toggles.append(
      this.toggleButton(
        "sort",
        "Best pick",
        this.settings.sortBest,
        "Sort remaining maps from your best pick to worst",
      ),
      this.toggleButton(
        "adjust",
        "Shrink WR",
        this.settings.adjust,
        "Pull tiny samples toward 50% so a 2-game 100% is not treated as a perm",
      ),
    );
    legend.append(keys, toggles);
    this.body.append(legend);

    const context = this.renderContext(stats);
    if (context) this.body.append(context);

    const chartMount = document.createElement("div");
    const svg = renderChart(
      ordered,
      this.selectedMap,
      (mapKey) => {
        this.selectedMap = this.selectedMap === mapKey ? undefined : mapKey;
        this.render(stats);
      },
      this.settings.adjust,
      teamPalette(this.settings.youColor, this.settings.themColor),
    );
    chartMount.append(svg);
    this.body.append(chartMount);

    if (this.settings.suggestBanPick) {
      const suggestion = suggestBanPick(remaining, this.settings.adjust, smart);
      if (suggestion.ban || suggestion.pick) {
        const line = document.createElement("div");
        line.className = "suggest";
        const parts: string[] = [];
        if (suggestion.ban) {
          parts.push(`<span class="ban">Ban ${escapeHtml(suggestion.ban)}</span>`);
        }
        if (suggestion.pick) {
          parts.push(`<span class="pick">Pick ${escapeHtml(suggestion.pick)}</span>`);
        }
        line.innerHTML = parts.join("<span class='dot'>·</span>");
        this.body.append(line);
      }
    }

    if (this.settings.smartPick) {
      const info = stats.smart;
      const smartLine = document.createElement("div");
      smartLine.className = "smart";
      if (!info || !info.ready) {
        const n = info?.n ?? 0;
        const needed = info?.needed ?? 8;
        smartLine.textContent = `Smart pick calibrating ${n}/${needed}`;
        this.bindHover(
          smartLine,
          "Smart pick",
          "After 8 finished lobbies, ban/pick uses your actual results vs last-30 WR — maps you convert more often get a boost.",
        );
      } else {
        const rate =
          info.decided > 0
            ? `${Math.round((info.hits / info.decided) * 100)}% last-30`
            : `${info.n} matches`;
        smartLine.classList.add("ready");
        smartLine.textContent = `Smart pick live · ${rate}`;
        this.bindHover(
          smartLine,
          "Smart pick live",
          `${info.hits}/${info.decided || info.n} times the last-30 edge matched the result. Ban/pick is now biased toward maps you actually win.`,
        );
      }
      this.body.append(smartLine);
    }

    if (this.selectedMap) {
      const selected = ordered.find((row) => row.mapKey === this.selectedMap);
      if (selected) this.body.append(this.renderBreakdown(selected, stats));
    }

    const status = document.createElement("div");
    status.className = "status";
    status.textContent = `${stats.status || "lobby"} · extras in the toolbar menu · v${extensionVersion()}`;
    this.body.append(status);
  }

  private renderBrief(stats: LobbyStats): void {
    const maps = pickedMapKeys(stats);
    const mapKey =
      (this.briefMap && maps.includes(this.briefMap) ? this.briefMap : maps[0]) ??
      "";
    this.briefMap = mapKey;
    const briefing = buildBriefing(stats, mapKey, this.settings.adjust);
    if (!briefing) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Waiting for the picked map…";
      this.body.append(empty);
      return;
    }

    if (maps.length > 1) {
      const picker = document.createElement("div");
      picker.className = "brief-maps";
      for (const key of maps) {
        const entity = stats.maps.find((item) => item.class_name === key);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "brief-map";
        button.dataset.map = key;
        button.textContent = entity?.name ?? key;
        if (key === mapKey) button.classList.add("on");
        picker.append(button);
      }
      this.body.append(picker);
    }

    const head = document.createElement("div");
    head.className = "brief-head";
    const edge = document.createElement("div");
    edge.className = `brief-edge ${briefing.lean}`;
    const signed = `${briefing.gap >= 0 ? "+" : ""}${Math.round(briefing.gap * 100)}%`;
    edge.textContent = briefing.headline;
    const gap = document.createElement("div");
    gap.className = "brief-gap";
    gap.textContent = `${signed} WR`;
    head.append(edge, gap);
    this.body.append(head);

    const snapshot = document.createElement("div");
    snapshot.className = "context brief-snap";
    snapshot.append(
      this.briefSnapshot("You", "you", briefing.you),
      this.briefSnapshot("Them", "them", briefing.them),
    );
    this.body.append(snapshot);

    const cols = document.createElement("div");
    cols.className = "cols brief-rosters";
    cols.append(
      this.briefRoster("You", briefing.you.players),
      this.briefRoster("Them", briefing.them.players),
    );
    this.body.append(cols);
  }

  private briefSnapshot(label: string, side: "you" | "them", team: TeamBrief): HTMLElement {
    const el = document.createElement("div");
    el.className = `side ${side}`;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = label;
    el.append(who);

    const wr = document.createElement("span");
    wr.className = "stat";
    const wrVal = document.createElement("b");
    wrVal.textContent = pct(team.winRate);
    const per = team.players.length > 0 ? team.games / team.players.length : 0;
    wr.append(wrVal, document.createTextNode(` · ${per.toFixed(0)}g`));
    el.append(wr);

    if (team.kd != null) {
      const kd = document.createElement("span");
      kd.className = "stat";
      const val = document.createElement("b");
      val.textContent = team.kd.toFixed(2);
      kd.append(val, document.createTextNode(" kd"));
      el.append(kd);
    }

    if (team.stack >= 3) {
      const chip = document.createElement("span");
      chip.className = "brief-chip";
      chip.textContent = `${team.stack} stacked`;
      this.bindHover(
        chip,
        `${team.stack} stacked`,
        team.stackNames.length
          ? team.stackNames.join(", ")
          : "Last-30 games on this map with at least 3 of this roster together",
      );
      el.append(chip);
    }
    if (team.thin) {
      const chip = document.createElement("span");
      chip.className = "brief-chip muted";
      chip.textContent = "thin";
      this.bindHover(chip, "Thin sample", "Fewer than 5 last-30 games per player on this map");
      el.append(chip);
    }
    if (team.form) {
      const chip = document.createElement("span");
      chip.className = `brief-chip ${team.form === "rolling" ? "hot" : "cold"}`;
      chip.textContent = team.form === "rolling" ? "rolling" : "leaking";
      this.bindHover(
        chip,
        team.form === "rolling" ? "Rolling" : "Leaking",
        team.form === "rolling"
          ? "At least 3 of this roster won 4+ of their last 5"
          : "At least 3 of this roster lost 4+ of their last 5",
      );
      el.append(chip);
    }
    return el;
  }

  private briefRoster(title: string, players: BriefPlayer[]): HTMLElement {
    const col = document.createElement("div");
    col.className = "roster";
    const heading = document.createElement("div");
    heading.className = "col-head";
    heading.textContent = title;
    col.append(heading);
    for (const player of players) {
      const row = document.createElement("div");
      row.className = "player";
      const name = document.createElement("span");
      name.className = "name";
      const nick = document.createElement("span");
      nick.className = "nick";
      nick.textContent = player.nickname;
      nick.title = player.nickname;
      name.append(nick);
      if (player.tag) {
        const tag = document.createElement("em");
        tag.className = `brief-tag ${player.tagTone}`;
        tag.textContent = player.tag;
        this.bindHover(tag, player.tag, TAG_HINTS[player.tag]);
        name.append(tag);
      }
      const wr = document.createElement("span");
      wr.className = "wr";
      wr.innerHTML = `${pct(player.winRate)}<small>(${player.games})</small>`;
      this.bindHover(wr, "Win rate on this map", `${player.games} last-30 games`);
      row.append(name, wr);
      const sub = document.createElement("div");
      sub.className = "sub";
      const form = document.createElement("span");
      form.className = "form";
      this.bindHover(form, "Recent form", formatForm(player.recent) || "no games on this map");
      for (const win of player.recent) {
        const dot = document.createElement("i");
        dot.className = win ? "w" : "l";
        form.append(dot);
      }
      sub.append(form);
      const meta = document.createElement("span");
      meta.className = "kd";
      const bits = [
        player.kd != null ? `${player.kd.toFixed(2)} KD` : null,
        player.adr != null ? `${Math.round(player.adr)} ADR` : null,
      ].filter(Boolean);
      meta.textContent = bits.join(" · ");
      if (bits.length) {
        this.bindHover(meta, "On this map", bits.join(" · "));
      }
      sub.append(meta);
      row.append(sub);
      col.append(row);
    }
    return col;
  }

  private renderBreakdown(row: ChartRow, stats: LobbyStats): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "breakdown";
    const drop = stats.captainDrops.find((item) => item.mapKey === row.mapKey);
    const dropText =
      this.settings.captainDrops && drop?.rate != null
        ? ` · captain drop ${Math.round(drop.rate * 100)}%`
        : "";
    wrap.innerHTML = `<h2>${escapeHtml(row.displayName)} · you ${formatChip(row.you)} · them ${formatChip(row.them)}${dropText}</h2>`;

    const cols = document.createElement("div");
    cols.className = "cols";
    cols.append(
      this.playerList("You", row.you.players, row.you),
      this.playerList("Them", row.them.players, row.them),
    );
    wrap.append(cols);
    return wrap;
  }

  private renderContext(stats: LobbyStats): HTMLElement | undefined {
    if (!this.settings.stackOverlap && !this.settings.eloSwing) return undefined;
    const row = document.createElement("div");
    row.className = "context";
    row.append(
      this.teamContext("You", "you", stats.you.insight),
      this.teamContext("Them", "them", stats.them.insight),
    );
    return row;
  }

  private teamContext(
    label: string,
    side: "you" | "them",
    insight: TeamInsight,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = `side ${side}`;

    const who = document.createElement("span");
    who.className = "who";
    who.textContent = label;
    el.append(who);

    if (this.settings.stackOverlap) {
      const stat = document.createElement("span");
      stat.className = "stat stack";
      const names = insight.stackNames.join(", ");
      stat.title = names
        ? `${insight.stack} last-30 games with at least 3 together: ${names}`
        : "No last-30 games where at least three of this roster queued together";
      const value = document.createElement("b");
      value.textContent = String(insight.stack);
      stat.append(value, document.createTextNode(" stacked"));
      el.append(stat);
    }

    if (this.settings.eloSwing) {
      const stat = document.createElement("span");
      stat.className = "stat elo";
      stat.title =
        "Average Faceit Elo for this roster. The number in parentheses is the change over their last 30 games.";
      if (insight.elo != null) {
        const value = document.createElement("b");
        value.textContent = String(Math.round(insight.elo));
        stat.append(value, document.createTextNode(" elo"));
      } else {
        stat.append(document.createTextNode("elo "));
      }
      if (insight.eloDelta != null) {
        const delta = document.createElement("span");
        const rounded = Math.round(insight.eloDelta);
        delta.className = `delta ${rounded >= 0 ? "up" : "down"}`;
        delta.textContent = `(${formatElo(insight.eloDelta)})`;
        stat.append(document.createTextNode(" "), delta);
      } else if (insight.elo == null) {
        const value = document.createElement("b");
        value.textContent = "—";
        stat.append(value);
      }
      el.append(stat);
    }

    return el;
  }

  private playerList(
    title: string,
    players: PlayerMapStat[],
    team: TeamMapStat,
  ): HTMLElement {
    const col = document.createElement("div");
    col.className = "roster";

    const heading = document.createElement("div");
    heading.className = "col-head";
    const label = document.createElement("span");
    label.textContent = title;
    heading.append(label);
    if (this.settings.mapKd && team.kd != null) {
      const kd = document.createElement("span");
      kd.className = "kd";
      kd.textContent = `${team.kd.toFixed(2)} K/D`;
      heading.append(kd);
    }
    col.append(heading);

    const outlier = this.settings.outlier ? findOutlier(team) : undefined;
    for (const player of players) {
      const row = document.createElement("div");
      row.className = "player";
      if (outlier && outlier.playerId === player.playerId) row.classList.add("drag");

      const shown = playerDisplayWinRate(
        player.wins,
        player.games,
        player.winRate,
        this.settings.adjust,
      );

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = player.nickname;
      name.title = player.nickname;

      const wr = document.createElement("span");
      wr.className = "wr";
      wr.innerHTML = `${pct(shown)}<small>(${player.games})</small>`;

      row.append(name, wr);

      if (this.settings.recentForm || this.settings.mapKd) {
        const sub = document.createElement("div");
        sub.className = "sub";
        if (this.settings.recentForm) {
          const form = document.createElement("span");
          form.className = "form";
          form.title = formatForm(player.recent) || "no recent games";
          for (const win of player.recent) {
            const dot = document.createElement("i");
            dot.className = win ? "w" : "l";
            form.append(dot);
          }
          sub.append(form);
        } else {
          sub.append(document.createElement("span"));
        }
        if (this.settings.mapKd && player.kd != null) {
          const kd = document.createElement("span");
          kd.className = "kd";
          kd.textContent = player.kd.toFixed(2);
          sub.append(kd);
        }
        row.append(sub);
      }

      col.append(row);
    }
    return col;
  }

  private toggleButton(
    action: string,
    label: string,
    on: boolean,
    title: string,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.textContent = label;
    button.title = title;
    if (on) button.classList.add("on");
    return button;
  }

  private toggling = false;

  private async toggleSetting(key: "sortBest" | "adjust"): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    const next = { ...this.settings, [key]: !this.settings[key] };
    this.settings = next;
    applyTeamColors(this.host, next.youColor, next.themColor);
    this.paintKey = "";
    if (this.latestStats) this.render(this.latestStats);
    try {
      await patchSettings({ [key]: next[key] });
    } finally {
      this.toggling = false;
    }
  }

  private async restoreState(): Promise<void> {
    if (!extensionAlive()) return;
    try {
      const stored = await chrome.storage.local.get([POS_KEY, ONBOARD_KEY]);
      const pos = stored[POS_KEY] as { left?: string; top?: string } | undefined;
      if (pos?.left) this.panel.style.left = pos.left;
      if (pos?.top) this.panel.style.top = pos.top;
      this.settings = await loadSettings();
      applyTeamColors(this.host, this.settings.youColor, this.settings.themColor);
      if (this.latestStats) this.render(this.latestStats);
      if (!stored[ONBOARD_KEY]) this.showOnboarding();
    } catch (error) {
      if (!isContextInvalidated(error)) throw error;
    }
  }

  private showOnboarding(): void {
    if (this.onboardEl) return;
    const el = document.createElement("div");
    el.className = "onboard";
    el.innerHTML = `
      <h2>Welcome to <span>Faceit Numbers</span></h2>
      <p>During map veto this panel compares both teams' win rates per map, built from each player's last 30 Faceit matches.</p>
      <ul>
        <li>Drag the header to move the panel; click a map's bars for per-player details.</li>
        <li>Hit <b>Swap teams</b> if the sides look reversed.</li>
        <li>Extras — pre-match briefing, performance labels, smart pick — live in the toolbar icon menu.</li>
      </ul>
      <p class="fine">Stats are read through your logged-in Faceit session. Requests go only to faceit.com — nothing is collected or sent anywhere else.</p>
      <div class="actions">
        <button type="button" class="primary" data-action="onboard-done">Got it</button>
        <button type="button" data-action="onboard-settings">Settings</button>
      </div>
    `;
    this.onboardEl = el;
    this.body.style.display = "none";
    this.panel.append(el);
    this.syncNotice();
  }

  private async finishOnboarding(): Promise<void> {
    this.onboardEl?.remove();
    this.onboardEl = undefined;
    this.body.style.display = this.collapsed ? "none" : "";
    this.syncNotice();
    if (!extensionAlive()) return;
    try {
      await chrome.storage.local.set({ [ONBOARD_KEY]: true });
    } catch (error) {
      if (!isContextInvalidated(error)) throw error;
    }
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.body.style.display = this.collapsed || this.onboardEl ? "none" : "";
    if (this.onboardEl) this.onboardEl.style.display = this.collapsed ? "none" : "";
    this.syncNotice();
    const button = this.header.querySelector('[data-action="collapse"]');
    if (button) button.textContent = this.collapsed ? "+" : "−";
  }

  private bindDrag(): void {
    this.header.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      this.dragging = true;
      const rect = this.panel.getBoundingClientRect();
      this.dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      event.preventDefault();
    });

    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
  }
}

function emptyTeamMap(mapKey: string, displayName: string): TeamMapStat {
  return {
    mapKey,
    displayName,
    games: 0,
    wins: 0,
    winRate: null,
    playRate: 0,
    dropped: false,
    picked: false,
    kd: null,
    players: [],
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
