package main

// appStyles returns the full application CSS string.
// It is mounted into <head> via gom.Style() in main(), keeping styles
// part of the gom node system rather than imperative DOM manipulation.
func appStyles() string {
	return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --accent:      #a78bfc;
  --accent-2:    #818cf8;
  --accent-glow: rgba(167,139,250,.18);
  --red:         #f87171;
  --red-glow:    rgba(248,113,113,.15);
  --green:       #6ee7b7;
  --text:        #f8fafc;
  --text-2:      #94a3b8;
  --muted:       #3f4f63;
  --surface:     rgba(15,23,42,.7);
  --surface-2:   rgba(30,41,59,.6);
  --surface-3:   rgba(51,65,85,.5);
  --rim:         rgba(255,255,255,.07);
  --radius:      20px;
}

body {
  font-family: "Inter", -apple-system, sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 72px 16px 96px;
  background: #060912;
  overflow-x: hidden;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 20% 10%, rgba(139,92,246,.22) 0%, transparent 60%),
    radial-gradient(ellipse 50% 60% at 80% 80%, rgba(99,102,241,.18) 0%, transparent 60%),
    radial-gradient(ellipse 40% 40% at 60% 30%, rgba(236,72,153,.1) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}

.card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 480px;
  background: var(--surface);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border-radius: var(--radius);
  border: 1px solid var(--rim);
  box-shadow:
    0 0 0 1px rgba(255,255,255,.04) inset,
    0 2px 4px rgba(0,0,0,.4),
    0 20px 60px rgba(0,0,0,.6),
    0 0 120px rgba(139,92,246,.06);
  overflow: hidden;
}

.header {
  padding: 32px 28px 24px;
  position: relative;
}

.header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);
}

.header-top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}

.header-icon {
  width: 36px; height: 36px;
  background: linear-gradient(135deg, #7c3aed, #a78bfa);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  box-shadow: 0 4px 14px rgba(124,58,237,.4);
  flex-shrink: 0;
}

h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -.04em;
}

.high-badge {
  font-size: .6rem;
  font-weight: 700;
  background: linear-gradient(135deg, #ef4444, #f87171);
  color: #fff;
  padding: 3px 9px;
  border-radius: 99px;
  letter-spacing: .08em;
  text-transform: uppercase;
  box-shadow: 0 2px 10px rgba(239,68,68,.5);
  animation: pop .25s cubic-bezier(.34,1.56,.64,1);
}

@keyframes pop {
  from { transform: scale(0.5) rotate(-8deg); opacity: 0; }
  to   { transform: scale(1) rotate(0deg);    opacity: 1; }
}

.tagline {
  font-size: .73rem;
  color: var(--muted);
  letter-spacing: .01em;
  padding-left: 48px;
}
.tagline strong { color: var(--accent); font-weight: 500; }
.tagline a { color: inherit; text-decoration: none; }
.tagline a:hover { text-decoration: underline; }

.input-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 20px 20px 16px;
}

.todo-input {
  flex: 1;
  min-width: 0;
  padding: 11px 16px;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 12px;
  font-size: .9rem;
  font-family: inherit;
  outline: none;
  background: var(--surface-2);
  color: var(--text);
  transition: border-color .2s, box-shadow .2s, background .2s;
}
.todo-input::placeholder { color: var(--muted); }
.todo-input:focus {
  border-color: rgba(167,139,250,.5);
  background: var(--surface-3);
  box-shadow: 0 0 0 3px var(--accent-glow), 0 1px 3px rgba(0,0,0,.3);
}
.todo-input.high {
  border-color: rgba(248,113,113,.4);
}
.todo-input.high:focus {
  border-color: rgba(248,113,113,.6);
  box-shadow: 0 0 0 3px var(--red-glow), 0 1px 3px rgba(0,0,0,.3);
}

.add-btn {
  padding: 11px 20px;
  background: linear-gradient(135deg, #7c3aed, #a78bfa);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: .9rem;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: opacity .15s, box-shadow .2s, transform .1s;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(124,58,237,.35);
  letter-spacing: .01em;
}
.add-btn:hover  { opacity: .9; box-shadow: 0 6px 20px rgba(124,58,237,.5); }
.add-btn:active { transform: scale(.96); opacity: 1; }

.priority-btn {
  padding: 11px 14px;
  background: var(--surface-2);
  color: var(--text-2);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 12px;
  font-size: .82rem;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: all .2s;
  white-space: nowrap;
}
.priority-btn:hover { border-color: rgba(255,255,255,.18); color: var(--text); }
.priority-btn.on {
  background: var(--red-glow);
  color: var(--red);
  border-color: rgba(248,113,113,.3);
  box-shadow: 0 0 0 3px rgba(248,113,113,.07);
}

.priority-hint {
  width: 100%;
  font-size: .75rem;
  color: var(--red);
  opacity: .8;
  padding: 0 4px;
  letter-spacing: .01em;
}

.error-msg {
  width: 100%;
  font-size: .75rem;
  color: var(--red);
  background: var(--red-glow);
  border-radius: 8px;
  padding: 6px 12px;
  letter-spacing: .01em;
}

.list-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);
  margin: 0 20px;
}

.todo-list {
  list-style: none;
  padding: 8px 0;
  min-height: 60px;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  transition: background .15s;
  cursor: default;
  position: relative;
}
.todo-item::after {
  content: '';
  position: absolute;
  bottom: 0; left: 20px; right: 20px;
  height: 1px;
  background: rgba(255,255,255,.04);
}
.todo-item:last-child::after { display: none; }
.todo-item:hover { background: rgba(255,255,255,.03); }
.todo-item[draggable="true"] { cursor: grab; }
.todo-item[draggable="true"]:active { cursor: grabbing; }
.todo-item.dragging { opacity: .35; }
.todo-item.drag-over-top    { box-shadow: inset 0  2px 0 0 var(--accent); }
.todo-item.drag-over-bottom { box-shadow: inset 0 -2px 0 0 var(--accent); }

.todo-cb {
  appearance: none;
  -webkit-appearance: none;
  width: 20px; height: 20px;
  border: 1.5px solid rgba(255,255,255,.15);
  border-radius: 7px;
  cursor: pointer;
  flex-shrink: 0;
  position: relative;
  transition: all .2s;
  background: var(--surface-2);
}
.todo-cb:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.todo-cb:checked {
  background: linear-gradient(135deg, #7c3aed, #a78bfa);
  border-color: transparent;
  box-shadow: 0 2px 8px rgba(124,58,237,.4);
}
.todo-cb:checked::after {
  content: '';
  position: absolute;
  left: 5px; top: 2px;
  width: 6px; height: 10px;
  border: 2px solid #fff;
  border-top: none;
  border-left: none;
  transform: rotate(45deg);
}

.todo-text {
  flex: 1;
  font-size: .9rem;
  color: var(--text);
  line-height: 1.45;
  transition: color .2s;
  display: flex;
  align-items: center;
}
.todo-item.done .todo-text {
  text-decoration: line-through;
  text-decoration-color: rgba(255,255,255,.2);
  color: var(--muted);
}

.badge {
  font-size: .58rem;
  font-weight: 700;
  background: linear-gradient(135deg, #ef4444, #f87171);
  color: #fff;
  padding: 2px 8px;
  border-radius: 99px;
  flex-shrink: 0;
  letter-spacing: .08em;
  text-transform: uppercase;
  box-shadow: 0 2px 8px rgba(239,68,68,.35);
}

.del-btn {
  background: none;
  border: none;
  color: transparent;
  font-size: .8rem;
  cursor: pointer;
  padding: 5px 7px;
  border-radius: 8px;
  line-height: 1;
  transition: color .15s, background .15s;
  flex-shrink: 0;
}
.todo-item:hover .del-btn { color: var(--muted); }
.del-btn:hover { color: var(--red); background: var(--red-glow); }

.empty {
  padding: 44px 24px;
  color: var(--muted);
  font-size: .85rem;
  text-align: center;
  list-style: none;
  letter-spacing: .01em;
}

footer.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 20px;
  position: relative;
}

footer.footer::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--rim) 30%, var(--rim) 70%, transparent);
}

.count {
  font-size: .75rem;
  color: var(--muted);
  white-space: nowrap;
  font-weight: 500;
  letter-spacing: .01em;
}

.filter-bar { display: flex; gap: 2px; }

.filter-btn {
  padding: 5px 13px;
  background: none;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: .75rem;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  color: var(--muted);
  transition: all .15s;
  letter-spacing: .01em;
}
.filter-btn:hover  { color: var(--text-2); background: var(--surface-2); }
.filter-btn.active {
  border-color: rgba(167,139,250,.3);
  color: var(--accent);
  font-weight: 600;
  background: rgba(167,139,250,.08);
}

.clear-btn {
  background: none;
  border: none;
  font-size: .75rem;
  font-family: inherit;
  color: var(--muted);
  cursor: pointer;
  padding: 5px 10px;
  border-radius: 8px;
  transition: color .15s, background .15s;
  white-space: nowrap;
  letter-spacing: .01em;
}
.clear-btn:hover { color: var(--red); background: var(--red-glow); }

.sync-status {
  font-size: .68rem;
  font-weight: 600;
  letter-spacing: .04em;
  padding: 3px 10px;
  border-radius: 99px;
  opacity: 0;
  transition: opacity .2s;
}
.sync-status.saving {
  opacity: 1;
  color: var(--text-2);
  background: var(--surface-3);
}
.sync-status.saved {
  opacity: 1;
  color: var(--green);
  background: rgba(110,231,183,.1);
}
.sync-status.error {
  opacity: 1;
  color: var(--red);
  background: var(--red-glow);
}

.stats-bar {
  text-align: center;
  font-size: .65rem;
  color: var(--muted);
  padding: 6px 20px 14px;
  letter-spacing: .04em;
  opacity: .5;
  border-top: 1px solid rgba(255,255,255,.04);
}
.stats-bar span { cursor: pointer; transition: color .15s; }
.stats-bar span:hover { color: var(--accent); opacity: 1; }
.stats-bar strong { font-weight: 600; color: var(--text-2); }
`
}
