const OVERLAY_STYLES = `
:host {
  all: initial;
  font-family: Segoe UI, system-ui, sans-serif;
  --fin-you: #3d8bfd;
  --fin-them: #ff5500;
  --fin-you-soft: #9ec1ff;
  --fin-them-soft: #ffb086;
}

.panel {
  position: fixed;
  z-index: 2147483646;
  width: 400px;
  color: #f2f2f2;
  background: #1a1a1ae6;
  border: 1px solid #333;
  border-radius: 10px;
  box-shadow: 0 8px 28px #0008;
  backdrop-filter: blur(8px);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #111c;
  cursor: grab;
  user-select: none;
}

.header:active { cursor: grabbing; }

.title {
  flex: 1;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.title span { color: #ff5500; }

/* Compact: three controls share the header with the title. */
.header button {
  padding: 2px 7px;
  font-size: 10px;
}

button {
  background: transparent;
  color: #ddd;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

button:hover { border-color: #ff5500; color: #fff; }

button.on {
  border-color: #ff5500;
  color: #fff;
  background: #ff55001f;
}

/* The side is a guess: dashed, not alarming — it is a prompt to check, and
   half the time the guess is right. */
button.warn {
  border-style: dashed;
  border-color: #c8a13a;
  color: #f0d489;
}

.notice {
  padding: 4px 10px;
  font-size: 11px;
  color: #ffc46b;
  background: #ff990014;
  border-bottom: 1px solid #ff990033;
}

.body { padding: 8px 10px 12px; }

.caption {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 11px;
  line-height: 1.35;
  color: #9aa6b8;
}

.caption span { flex: 1; }

.caption .help {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  color: #9aa6b8;
}

.caption .help:hover { color: #fff; }
.caption .help.on {
  color: #fff;
  background: #ff55001f;
  border-color: #ff5500;
}

.explain {
  margin-bottom: 10px;
  padding: 9px 11px;
  border: 1px solid #2a2f39;
  border-radius: 6px;
  background: #12151b;
  font-size: 11px;
  line-height: 1.45;
  color: #c5cdd8;
}

.explain p { margin: 0 0 6px; }
.explain .lede { color: #e6e9ee; }
.explain .lede b { color: #fff; }
.explain ol { margin: 0 0 6px; padding-left: 16px; }
.explain li { margin-bottom: 3px; }
.explain li b { color: #e6e9ee; }
.explain .live { color: #8fbc8f; }
.explain .fine {
  margin: 0;
  padding-top: 6px;
  border-top: 1px solid #2a2f39;
  color: #8d94a2;
}

.context {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 8px;
}

.side {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  min-width: 0;
}

.side .who {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.side.you .who { color: var(--fin-you); }
.side.them .who { color: var(--fin-them); }

.side .stat {
  font-size: 11px;
  color: #c8c8c8;
}

.side .stat.stack,
.side .stat.elo,
.side .stat .delta { cursor: help; }

.side .stat b {
  color: #f2f2f2;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.side.you .stat b { color: var(--fin-you-soft); }
.side.them .stat b { color: var(--fin-them-soft); }

.side .stat .delta {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.side .stat .delta.up { color: #7dce7d; }
.side .stat .delta.down { color: #e07070; }

.suggest {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 700;
}

.suggest .ban { color: #e07070; }
.suggest .pick { color: #7dce7d; }
.suggest .dot { color: #666; margin: 0 6px; font-weight: 500; }

.smart {
  margin-top: 4px;
  font-size: 11px;
  color: #9aa6b8;
  cursor: help;
}
.smart.ready { color: #8fbc8f; }

.muted {
  color: #9a9a9a;
  font-size: 12px;
  line-height: 1.4;
  margin: 8px 0;
}

.err { color: #ff8a80; }

.link {
  color: #ff5500;
  cursor: pointer;
  text-decoration: underline;
}

.breakdown {
  margin-top: 8px;
  border-top: 1px solid #333;
  padding-top: 8px;
  font-size: 11px;
}

.breakdown h2 {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: #bdbdbd;
}

.breakdown h2 .raw {
  margin: 0 4px;
  padding: 1px 4px;
  border-radius: 3px;
  background: #262b34;
  color: #9aa6b8;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.roster { min-width: 0; }

.col-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #888;
}

.player {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  row-gap: 2px;
  padding: 7px 0;
  border-bottom: 1px solid #2c2c2c;
  color: #ccc;
}

.player:last-child { border-bottom: 0; }

.player .name {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  font-weight: 600;
  font-size: 11px;
  color: #eee;
}

.player .nick {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player .wr {
  justify-self: end;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 11px;
  color: #fff;
  white-space: nowrap;
}

.player .wr small {
  margin-left: 5px;
  color: #777;
  font-weight: 500;
}

.player .sub {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.form {
  display: flex;
  gap: 3px;
}

.form i {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.form i.w { background: #6dbe72; }
.form i.l { background: #c45c5c; }

.kd {
  font-variant-numeric: tabular-nums;
  color: #8a8a8a;
  font-size: 10px;
}

.player.drag .wr { color: #e07070; }
.player.drag .name { color: #e07070; }

.status {
  font-size: 10px;
  color: #888;
  margin-top: 6px;
}

.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.tabs button {
  flex: 1;
  padding: 5px 8px;
}

.brief-maps {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.brief-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.brief-edge {
  font-size: 13px;
  font-weight: 800;
}

.brief-edge.you { color: var(--fin-you-soft); }
.brief-edge.them { color: var(--fin-them-soft); }
.brief-edge.even { color: #d8d8d8; }

.brief-gap {
  font-size: 11px;
  color: #9a9a9a;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.brief-snap { margin-bottom: 8px; }

.brief-chip {
  font-size: 10px;
  font-weight: 700;
  color: #c8c8c8;
  background: #2a2a2a;
  border-radius: 3px;
  padding: 1px 5px;
  cursor: help;
}

.brief-chip.muted { color: #888; }
.brief-chip.hot { color: #ffb086; background: #3a2218; }
.brief-chip.cold { color: #ff9a9a; background: #3a1f1f; }

.brief-rosters .player { padding: 4px 0; }

.brief-tag {
  flex: 0 0 auto;
  display: inline-block;
  margin-left: 0;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 9px;
  font-style: normal;
  font-weight: 800;
  letter-spacing: 0.03em;
  cursor: help;
}

/* Pre-game expectations read as forecasts: solid outline, no fill —
   distinct from the filled form labels and outlined-pill role pendants. */
.brief-tag.hot { border: 1px solid #ff5500; background: transparent; color: #ff8a55; }
.brief-tag.good { border: 1px solid #3f7a4c; background: transparent; color: #9ee59e; }
.brief-tag.cold { border: 1px solid #8a4444; background: transparent; color: #ff9a9a; }
.brief-tag.bad { border: 1px solid #7a4c33; background: transparent; color: #f0b090; }
.brief-tag.info { border: 1px solid #3d5680; background: transparent; color: #9ec1ff; }

.tip {
  position: fixed;
  z-index: 2147483647;
  display: none;
  max-width: 240px;
  padding: 7px 9px;
  background: #161a22;
  color: #f2f4f8;
  border: 1px solid #3d4656;
  border-radius: 6px;
  box-shadow: 0 8px 20px rgba(0,0,0,.45);
  font-size: 11px;
  line-height: 1.35;
  pointer-events: none;
}

.tip .tip-title { font-weight: 800; margin-bottom: 2px; }
.tip .tip-body { color: #c5cdd8; }

.onboard {
  padding: 12px 14px 14px;
  font-size: 12px;
  line-height: 1.45;
  color: #ddd;
}

.onboard h2 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}

.onboard h2 span { color: #ff5500; }
.onboard p { margin: 0 0 8px; }
.onboard ul { margin: 0 0 8px; padding-left: 16px; }
.onboard li { margin-bottom: 4px; }
.onboard .fine { color: #9a9a9a; font-size: 11px; }

.onboard .actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.onboard .actions .primary {
  background: #ff5500;
  border-color: #ff5500;
  color: #fff;
}

.onboard .actions .primary:hover { background: #ff6a1f; }
`;

export function overlayStyles(): string {
  return OVERLAY_STYLES;
}
