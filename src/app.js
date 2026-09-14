/* ===========================================================
   PickleStack — interface
   =========================================================== */
(function () {
  "use strict";

  /* Stamped by build.py — so you can tell at a glance whether the page
     you are looking at is the one that was last published. */
  const BUILD = "__BUILD__";

  const root = document.getElementById("app");
  let sheet = null;          // {kind, arg}
  let toastTimer = null;

  /* ---------------- tiny helpers ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pct(n) { return Math.round(n * 100) + "%"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function toast(msg) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2600);
  }
  /* The viewer suppresses window.confirm/prompt, so every question the app
     needs to ask is asked in the page itself. */
  let pending = null;
  function askConfirm(o, onYes) { pending = onYes; sheet = { kind: "confirm", arg: o }; render(); }
  function askText(o, onSave) { pending = onSave; sheet = { kind: "text", arg: o }; render(); }
  function showText(o) { pending = null; sheet = { kind: "text", arg: o }; render(); }

  function confirmSheet(o) {
    return sheetShell(esc(o.title), esc(o.message || ""),
      '<div class="row" style="gap:8px;margin-top:4px">' +
        '<button class="btn ' + (o.danger ? 'danger' : 'primary') + '" data-act="confirmYes">' +
          esc(o.yes || "Confirm") + '</button>' +
        '<button class="btn ghost" data-act="closeSheet">Cancel</button>' +
      '</div>');
  }

  function textSheet(o) {
    const body = o.readonly
      ? '<textarea class="input mono" id="ask-input" data-focus-key="ask-input" rows="' + (o.rows || 10) + '" ' +
          'readonly style="font-size:12.5px">' + esc(o.value || "") + '</textarea>' +
        '<p class="muted" style="font-size:12.5px;margin-top:8px">' + esc(o.hint || "") + '</p>' +
        '<div class="row" style="gap:8px;margin-top:12px"><button class="btn primary" data-act="closeSheet">Done</button></div>'
      : '<input class="input" id="ask-input" data-focus-key="ask-input" value="' + esc(o.value || "") + '">' +
        '<div class="row" style="gap:8px;margin-top:12px">' +
          '<button class="btn primary" data-act="textYes">' + esc(o.yes || "Save") + '</button>' +
          '<button class="btn ghost" data-act="closeSheet">Cancel</button>' +
        '</div>';
    return sheetShell(esc(o.title), esc(o.message || ""), body);
  }
  function d8(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }
  function d8full(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function monthKey(iso) { return (iso || "").slice(0, 7); }
  function monthLabel(key) {
    const d = new Date(key + "-01T00:00:00");
    if (isNaN(d)) return key;
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  /* ---------------- saving a file ----------------
     Hosted, the viewer confirms the save through the platform;
     opened as a local file, an ordinary download link does the job. */
  let downloads;   // undefined = not asked yet, null = not available here
  async function saveFile(filename, text) {
    if (downloads === undefined) {
      downloads = null;
      if (typeof window !== "undefined" && window.claude && window.claude.use) {
        try { downloads = await window.claude.use("downloads"); } catch (e) { downloads = null; }
      }
    }
    if (downloads && downloads.save) {
      try { await downloads.save({ filename: filename, data: text }); toast("Saved " + filename); }
      catch (err) {
        toast(err && err.code === "declined" ? "Save cancelled" : "Couldn't save the file");
      }
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      toast("Saved " + filename);
    } catch (e) {
      showText({ title: "Your session file", message: "Select all of this and save it somewhere safe.",
                 value: text, readonly: true, rows: 12,
                 hint: "Downloads are blocked here, so copy the text instead." });
    }
  }

  /* ---------------- header ---------------- */
  function syncPill() {
    const s = Store.sync();
    if (s === "live") return '<span class="pill accent" title="Everyone with this link sees the same scoreboard">Shared</span>';
    if (s === "connecting") return '<span class="pill">Connecting…</span>';
    if (s === "readonly") return '<span class="pill">View only</span>';
    return '<span class="pill" title="Saved in this browser">This device</span>';
  }

  function header(st, sess) {
    const fmt = sess ? (sess.format === "mexicano" ? "Mexicano" : "Americano") : "";
    const meta = sess
      ? [esc(sess.date), fmt, plural(sess.courts, "court"), sess.mode === "singles" ? "singles" : "doubles",
         "to " + sess.target + (sess.winBy2 ? " · win by 2" : "")].join(" · ")
      : "";
    return '' +
      '<header class="topbar">' +
        '<div class="topbar-row">' +
          '<div class="brand"><span class="ball"></span>PickleStack</div>' +
          syncPill() +
          '<button class="icon-btn" data-act="sheet:sessions" aria-label="Switch session" title="Sessions">' + iconStack() + '</button>' +
          '<button class="icon-btn" data-act="sheet:settings" aria-label="Session settings" title="Settings">' + iconGear() + '</button>' +
        '</div>' +
        (sess ? '<div class="sess-line">' +
          '<button class="sess-name" data-act="sheet:settings" style="background:none;border:0;padding:0;cursor:pointer">' + esc(sess.name) + '</button>' +
          (sess.sample ? '<span class="pill sample">Sample data</span>' : '') +
          '<span class="sess-meta">' + meta + '</span>' +
        '</div>' : '') +
      '</header>';
  }

  function iconGear() {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/></svg>';
  }
  function iconStack() {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3 12.5 12 17l9-4.5"/><path d="M3 17 12 21.5 21 17"/></svg>';
  }

  /* ---------------- tab bar ---------------- */
  const SVG = function (d) {
    return '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };
  const GLYPH = {
    roster: SVG('<circle cx="9" cy="8" r="3"/><path d="M3.2 19.5a6 6 0 0 1 11.6 0"/><circle cx="17.5" cy="9.5" r="2.3"/><path d="M16 14.6a5 5 0 0 1 5 4.9"/>'),
    matches: SVG('<rect x="2.8" y="4.5" width="18.4" height="15" rx="1.4"/><path d="M12 4.5v15M2.8 12h18.4"/>'),
    standings: SVG('<path d="M4 20h4v-7H4zM10 20h4V6h-4zM16 20h4v-11h-4z"/>'),
    rotation: SVG('<path d="M4 9.5A8 8 0 0 1 18.6 7M20 14.5A8 8 0 0 1 5.4 17"/><path d="M18.9 3.4v3.8h-3.8M5.1 20.6v-3.8h3.8"/>'),
    history: SVG('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.2 4.4v4h4"/><path d="M12 7.6V12l3 1.8"/>')
  };
  function tabs(st, sess) {
    const items = [
      { id: "roster", label: "Roster", count: sess ? sess.players.filter(function (p) { return p.active !== false; }).length : 0 },
      { id: "matches", label: "Matches", count: sess ? sess.rounds.length : 0 },
      { id: "standings", label: "Table", count: null },
      { id: "rotation", label: "Rotation", count: null },
      { id: "history", label: "History", count: null }
    ];
    return '<nav class="tabbar" role="tablist">' + items.map(function (it) {
      return '<button role="tab" aria-selected="' + (st.view === it.id) + '" data-act="view:' + it.id + '">' +
        '<span class="glyph">' + GLYPH[it.id] + '</span>' +
        '<span>' + it.label + (it.count !== null && it.count > 0 ? ' <span class="tab-count">' + it.count + '</span>' : '') + '</span>' +
      '</button>';
    }).join("") + '</nav>';
  }

  /* ---------------- welcome ---------------- */
  function welcome() {
    return '<div class="hero">' +
      '<div class="court-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      '<h1>Every name in, every pairing out.</h1>' +
      '<p>Type in who showed up. PickleStack builds each round so people keep meeting new partners and new opponents, then keeps the table honest as the scores come in.</p>' +
      '<div class="row" style="margin-top:18px;gap:10px;flex-wrap:wrap">' +
        '<button class="btn primary" data-act="sheet:new">Start a session</button>' +
        '<button class="btn" data-act="sheet:import">Open a saved file</button>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- roster ---------------- */
  function rosterView(st, sess) {
    const cov = Sched.coverage(sess);
    const t = cov.tally;
    const inCount = sess.players.filter(function (p) { return p.active !== false; }).length;
    const outCount = sess.players.length - inCount;

    const list = sess.players.length ? '<div class="roster">' + sess.players.map(function (p) {
      const played = Store.isPlayed(p.id);
      const on = p.active !== false;
      return '<div class="ritem' + (on ? '' : ' out') + '">' +
        '<button class="toggle" aria-pressed="' + on + '" data-act="togglePlayer:' + p.id + '" ' +
          'aria-label="' + esc(p.name) + (on ? ' is checked in' : ' is out') + '"></button>' +
        '<button class="rname" data-act="renamePlayer:' + p.id + '" style="background:none;border:0;padding:0;text-align:left">' + esc(p.name) + '</button>' +
        '<span class="rstat">' + (t.games[p.id] || 0) + 'G · ' + (t.sits[p.id] || 0) + ' sat</span>' +
        '<button class="btn ghost sm" data-act="removePlayer:' + p.id + '" ' +
          'aria-label="Remove ' + esc(p.name) + '" title="Remove from this session">✕</button>' +
      '</div>';
    }).join("") + '</div>'
    : '<div class="empty">No one on the list yet. Add the names above — one per line is fastest.</div>';

    const regs = Store.regulars();
    const regularsBlock = regs.length
      ? '<div class="section-head"><h2>Regulars</h2>' +
          '<span class="hint">Anyone who has played before — tap to add them back</span></div>' +
        '<div class="row" style="flex-wrap:wrap;gap:6px">' + regs.slice(0, 60).map(function (r) {
          return '<button class="btn sm" data-act="addRegular:' + r.id + '">+ ' + esc(r.name) +
            (r.n > 1 ? ' <span class="mono muted" style="font-size:11px">' + r.n + '</span>' : '') + '</button>';
        }).join("") + '</div>'
      : '';

    const sampleBanner = sess.sample
      ? '<div class="sitout" style="margin-top:16px;border-color:var(--accent);color:var(--ink-2)">' +
          '<span style="flex:1;min-width:0">These are example names so the app opens with something to look at.</span>' +
          '<button class="btn primary sm" data-act="clearRoster">Clear and start my own</button>' +
        '</div>'
      : '';

    return '' +
      sampleBanner +
      '<div class="section-head"><h2>Who’s here</h2>' +
        '<span class="hint">' + inCount + ' checked in' + (outCount ? ' · ' + outCount + ' out' : '') + '</span></div>' +
      '<div class="card" style="padding:12px">' +
        '<div class="field">' +
          '<label class="label" for="addnames">Add players</label>' +
          '<textarea class="input" id="addnames" data-focus-key="addnames" rows="2" ' +
            'placeholder="Type a name and press Enter&#10;or paste a list, one per line"></textarea>' +
        '</div>' +
        '<div class="row" style="margin-top:10px">' +
          '<button class="btn primary" data-act="addPlayers">Add to roster</button>' +
          '<span class="muted" style="font-size:12.5px">One per line, or separated by commas.</span>' +
        '</div>' +
      '</div>' +
      regularsBlock +
      '<div class="section-head"><h2>Roster</h2><span class="hint">Toggle someone off when they take a break — they stop being drawn into rounds.</span></div>' +
      list +
      (sess.players.length
        ? '<div class="row" style="margin-top:10px;justify-content:flex-end">' +
            '<button class="btn danger sm" data-act="clearRoster">Clear the whole roster</button></div>'
        : '') +
      (sess.players.length >= (sess.mode === "singles" ? 2 : 4)
        ? '<div style="margin-top:14px"><button class="btn primary block" data-act="addRound">' +
            (sess.rounds.length ? 'Generate round ' + (sess.rounds.length + 1) : 'Generate round 1') + '</button></div>'
        : '');
  }

  /* ---------------- matches ---------------- */
  function teamRow(sess, m, roundIdx, side, editable) {
    const ids = side === "a" ? m.teamA : m.teamB;
    const mine = m[side], other = m[side === "a" ? "b" : "a"];
    const winner = mine !== null && other !== null && mine > other;
    const val = mine === null || mine === undefined ? "" : mine;
    return '<div class="team' + (winner ? ' winner' : '') + '">' +
      '<div class="team-names">' + ids.map(function (id) {
        return '<button class="pname" data-act="swap:' + id + ':' + roundIdx + '" title="Swap ' + esc(Store.playerName(id)) + ' with someone else">' +
          esc(Store.playerName(id)) + '</button>';
      }).join("") + '</div>' +
      (winner ? '<span class="pill win">W</span>' : '') +
      '<div class="score-box">' +
        (editable ? '<button class="step" data-act="bump:' + m.id + ':' + side + ':-1:' + roundIdx + '" aria-label="Minus one">−</button>' : '') +
        '<input class="score-val' + (val === "" ? ' dim' : '') + '" type="text" inputmode="numeric" pattern="[0-9]*" ' +
          'value="' + val + '" placeholder="–" aria-label="Score" ' +
          'data-focus-key="sc-' + m.id + '-' + side + '" data-score="' + m.id + ':' + side + ':' + roundIdx + '" ' +
          'style="width:3.1ch;background:transparent;border:0;padding:0">' +
        (editable ? '<button class="step" data-act="bump:' + m.id + ':' + side + ':1:' + roundIdx + '" aria-label="Plus one">+</button>' : '') +
      '</div>' +
    '</div>';
  }

  function courtCard(sess, m, roundIdx, cov) {
    const st = Store.scoreStatus(m, sess);
    const done = m.done;
    // flag any pairing this round that repeats an existing partnership
    let repeat = "";
    if (cov) {
      const t = cov.tally;
      const pk = function (x, y) { return (t.partner[Sched.key(x, y)] || 0); };
      const reps = [];
      [m.teamA, m.teamB].forEach(function (team) {
        if (team.length === 2 && pk(team[0], team[1]) > 1) {
          reps.push(Store.playerName(team[0]) + " & " + Store.playerName(team[1]));
        }
      });
      if (reps.length) repeat = '<span class="note" title="This pair has partnered before">↺ ' + esc(reps.join(", ")) + '</span>';
    }
    const clearBtn = (m.a !== null || m.b !== null)
      ? '<button class="btn ghost sm" data-act="clear:' + m.id + ':' + roundIdx + '">Clear</button>' : '';
    const footNote = st.msg
      ? '<span class="note" style="color:var(--warn)">' + esc(st.msg) + '</span>' : repeat;
    const foot = (footNote || clearBtn)
      ? '<div class="court-foot">' + footNote + '<span class="spacer"></span>' + clearBtn + '</div>' : '';
    return '<article class="court' + (done ? ' done' : '') + '">' +
      '<div class="court-head">' +
        '<span class="court-no">Court <b>' + m.court + '</b></span>' +
        (done ? '<span class="pill" style="margin-left:auto">Final</span>'
              : '<span class="pill live" style="margin-left:auto">On court</span>') +
      '</div>' +
      '<div class="teams">' +
        teamRow(sess, m, roundIdx, "a", true) +
        '<div class="vs-rule">VS</div>' +
        teamRow(sess, m, roundIdx, "b", true) +
      '</div>' +
      foot +
    '</article>';
  }

  function matchesView(st, sess) {
    if (!sess.players.length) {
      return '<div class="empty" style="margin-top:26px">' +
        '<p style="font-weight:600;color:var(--ink)">Start with the names</p>' +
        '<p style="margin-top:6px">Add everyone who showed up, then generate the first round.</p>' +
        '<button class="btn primary" style="margin-top:14px" data-act="view:roster">Go to roster</button></div>';
    }
    const need = sess.mode === "singles" ? 2 : 4;
    const activeN = sess.players.filter(function (p) { return p.active !== false; }).length;
    if (!sess.rounds.length) {
      return '<div class="empty" style="margin-top:26px">' +
        '<p style="font-weight:600;color:var(--ink)">No rounds yet</p>' +
        '<p style="margin-top:6px">' + activeN + ' checked in · ' +
          (activeN >= need ? Math.min(sess.courts, Math.floor(activeN / need)) + ' court(s) will run, ' +
            (activeN - Math.min(sess.courts, Math.floor(activeN / need)) * need) + ' sitting out'
           : 'need at least ' + need) + '</p>' +
        '<button class="btn primary" style="margin-top:14px" data-act="addRound"' +
          (activeN >= need ? '' : ' disabled') + '>Generate round 1</button></div>';
    }

    const i = Math.max(0, Math.min(st.round || 0, sess.rounds.length - 1));
    const round = sess.rounds[i];
    const cov = Sched.coverage(sess);
    const scored = round.matches.filter(function (m) { return m.done; }).length;
    const anyScore = round.matches.some(function (m) { return m.a !== null || m.b !== null; });

    const dots = sess.rounds.map(function (r, idx) {
      const full = r.matches.length && r.matches.every(function (m) { return m.done; });
      return '<button class="btn sm' + (idx === i ? ' primary' : '') + '" data-act="round:' + idx + '" ' +
        'style="min-width:34px;padding:4px 7px;font-family:var(--f-data)" ' +
        'title="Round ' + (idx + 1) + (full ? ' — complete' : '') + '">' + (idx + 1) + (full ? '' : '·') + '</button>';
    }).join("");

    return '' +
      '<div class="roundnav">' +
        '<button class="icon-btn" data-act="round:' + (i - 1) + '" ' + (i === 0 ? 'disabled' : '') + ' aria-label="Previous round">‹</button>' +
        '<div><div class="rtitle">Round ' + (i + 1) + '</div>' +
          '<div class="rsub">' + scored + '/' + round.matches.length + ' scored · ' + sess.rounds.length + ' rounds total</div></div>' +
        '<span class="spacer"></span>' +
        '<button class="icon-btn" data-act="round:' + (i + 1) + '" ' + (i >= sess.rounds.length - 1 ? 'disabled' : '') + ' aria-label="Next round">›</button>' +
      '</div>' +
      '<div class="scroll-x" style="padding-bottom:4px;margin-bottom:12px"><div class="row" style="gap:5px">' + dots + '</div></div>' +
      '<div class="courts">' + round.matches.map(function (m) { return courtCard(sess, m, i, cov); }).join("") + '</div>' +
      (round.sitting && round.sitting.length
        ? '<div class="sitout" style="margin-top:12px"><span class="label" style="letter-spacing:.08em">Sitting out</span>' +
          '<span class="who">' + round.sitting.map(function (id) {
            return '<span>' + esc(Store.playerName(id)) + '</span>'; }).join("") + '</span>' +
          '<span class="spacer"></span><span style="font-size:12px">Tap a name on court to swap</span></div>'
        : '') +
      '<div class="row" style="margin-top:16px;gap:8px;flex-wrap:wrap">' +
        '<button class="btn primary" data-act="addRound">Generate round ' + (sess.rounds.length + 1) + '</button>' +
        '<button class="btn" data-act="reshuffle:' + i + '"' + (anyScore ? ' disabled title="Clear the scores first"' : '') + '>Reshuffle this round</button>' +
        '<button class="btn danger sm" data-act="deleteRound:' + i + '">Delete round</button>' +
      '</div>';
  }

  /* ---------------- standings ---------------- */
  function formCell(form) {
    return form.map(function (r) {
      const c = r === "w" ? "var(--win)" : r === "l" ? "var(--loss)" : "var(--muted)";
      return '<span style="color:' + c + '">' + r.toUpperCase() + '</span>';
    }).join("") || '<span class="muted">–</span>';
  }

  function standingsView(st, sess) {
    const rows = Store.standings();
    const played = rows.filter(function (r) { return r.gp > 0; });
    if (!played.length) {
      return '<div class="empty" style="margin-top:26px">' +
        '<p style="font-weight:600;color:var(--ink)">Nothing to rank yet</p>' +
        '<p style="margin-top:6px">Enter a score on any court and the table fills in as you go.</p>' +
        '<button class="btn primary" style="margin-top:14px" data-act="view:matches">Go to matches</button></div>';
    }
    const byPoints = sess.rankBy !== "wins";
    const totalGames = sess.rounds.reduce(function (n, r) {
      return n + r.matches.filter(function (m) { return m.done; }).length; }, 0);

    return '' +
      '<div class="section-head"><h2>Standings</h2>' +
        '<span class="hint">' + plural(totalGames, "game") + ' recorded</span></div>' +
      '<div class="seg" style="margin-bottom:12px">' +
        '<button data-act="rankBy:points" aria-pressed="' + byPoints + '">Points scored</button>' +
        '<button data-act="rankBy:wins" aria-pressed="' + (!byPoints) + '">Wins</button>' +
      '</div>' +
      '<div class="card scroll-x" style="padding:12px 12px 4px">' +
      '<table class="table"><thead><tr>' +
        '<th>#</th><th>Player</th><th>GP</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>+/−</th><th>Win%</th><th style="text-align:right">Form</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        if (!r.gp && !r.active) return "";
        const cls = r.rank === 1 && r.gp ? ' class="lead"' : '';
        return '<tr' + cls + '>' +
          '<td>' + (r.gp ? r.rank : "–") + '</td>' +
          '<td>' + esc(r.name) + (r.active ? '' : ' <span class="pill" style="font-size:10px">out</span>') + '</td>' +
          '<td>' + r.gp + '</td><td>' + r.w + '</td><td>' + r.l + '</td>' +
          '<td>' + r.pf + '</td><td>' + r.pa + '</td>' +
          '<td class="' + (r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : '') + '">' + (r.diff > 0 ? '+' : '') + r.diff + '</td>' +
          '<td>' + (r.gp ? pct(r.pct) : '–') + '</td>' +
          '<td style="text-align:right;letter-spacing:.08em">' + formCell(r.form) + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody><tfoot><tr><td colspan="10" style="text-align:left">' +
        (byPoints ? 'Ranked by points scored, then point differential, then wins.'
                  : 'Ranked by wins, then point differential, then points scored.') +
      '</td></tr></tfoot></table></div>' +
      '<div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">' +
        '<button class="btn" data-act="copyStandings">Copy for the group chat</button>' +
        '<button class="btn ghost" data-act="export">Download session file</button>' +
      '</div>';
  }

  /* ---------------- rotation ---------------- */
  function rotationView(st, sess) {
    const cov = Sched.coverage(sess);
    const t = cov.tally;
    const ids = sess.players.map(function (p) { return p.id; });
    if (ids.length < 2) {
      return '<div class="empty" style="margin-top:26px">Add a few players to see how the rotation is spreading.</div>';
    }
    const games = ids.map(function (id) { return t.games[id] || 0; });
    const minG = Math.min.apply(null, games), maxG = Math.max.apply(null, games);
    const sits = ids.map(function (id) { return t.sits[id] || 0; });

    const tiles = '' +
      '<div class="statgrid">' +
        '<div class="stat"><div class="k">Partnerships used</div>' +
          '<div class="v">' + cov.uniquePartners + ' <small>of ' + cov.possiblePairs + '</small></div>' +
          '<div class="meter"><i style="width:' + Math.min(100, cov.partnerPct * 100) + '%"></i></div></div>' +
        '<div class="stat"><div class="k">Pairs who have met</div>' +
          '<div class="v">' + pct(cov.facedPct) + '</div>' +
          '<div class="meter"><i style="width:' + Math.min(100, cov.facedPct * 100) + '%"></i></div></div>' +
        '<div class="stat"><div class="k">Repeat partnerships</div>' +
          '<div class="v">' + cov.repeatPartners + '</div>' +
          '<div class="k" style="margin-top:7px;letter-spacing:0;text-transform:none;font-weight:400">' +
            (cov.repeatPartners ? 'Unavoidable once everyone has paired up' : 'No one has repeated a partner yet') + '</div></div>' +
        '<div class="stat"><div class="k">Games played</div>' +
          '<div class="v">' + minG + '–' + maxG + '</div>' +
          '<div class="k" style="margin-top:7px;letter-spacing:0;text-transform:none;font-weight:400">' +
            (maxG - minG <= 1 ? 'Even across the roster' : (maxG - minG) + ' game spread') + '</div></div>' +
      '</div>';

    const cell = function (n) {
      if (n === 0) return "c0";
      if (n === 1) return "c1";
      if (n === 2) return "c2";
      return "c3";
    };
    const matrix = '<div class="card scroll-x" style="padding:12px"><table class="matrix"><thead><tr><th></th>' +
      ids.map(function (id) { return '<th scope="col">' + esc(Store.playerName(id)) + '</th>'; }).join("") +
      '</tr></thead><tbody>' +
      ids.map(function (a) {
        return '<tr><th scope="row">' + esc(Store.playerName(a)) + '</th>' + ids.map(function (b) {
          if (a === b) return '<td class="self">·</td>';
          const n = cov.perPlayer[a].partners[b] || 0;
          const o = cov.perPlayer[a].opponents[b] || 0;
          return '<td class="' + cell(n) + '" title="' + esc(Store.playerName(a)) + ' + ' + esc(Store.playerName(b)) +
            ': partnered ' + n + ', opposed ' + o + '">' + (n || (o ? '·' : '')) + '</td>';
        }).join("") + '</tr>';
      }).join("") + '</tbody></table></div>';

    const waiting = ids.map(function (id) {
      const missing = cov.perPlayer[id].missing;
      if (!missing.length) return "";
      return '<div><b>' + esc(Store.playerName(id)) + '</b> hasn’t crossed paths with ' +
        missing.map(function (m) { return esc(Store.playerName(m)); }).join(", ") + '</div>';
    }).filter(Boolean).join("");

    return '' +
      '<div class="section-head"><h2>Rotation health</h2>' +
        '<span class="hint">Each new round picks the pairings that repeat the least</span></div>' +
      tiles +
      '<div class="section-head"><h2>Partner grid</h2>' +
        '<span class="hint">How many times each pair has played on the same side</span></div>' +
      matrix +
      '<div class="legend" style="margin-top:10px">' +
        '<span><i style="background:var(--sunk)"></i>never partnered</span>' +
        '<span><i style="background:var(--accent-soft)"></i>once</span>' +
        '<span><i style="background:var(--accent)"></i>twice or more</span>' +
        '<span>· = faced each other only</span>' +
      '</div>' +
      (waiting ? '<div class="section-head"><h2>Still to meet</h2></div><div class="pairlist">' + waiting + '</div>' : '') +
      '<div class="section-head"><h2>Sit-outs</h2><span class="hint">Rounds spent off court</span></div>' +
      '<div class="roster">' + ids.map(function (id, idx) {
        return '<div class="ritem"><span class="rname">' + esc(Store.playerName(id)) + '</span>' +
          '<span class="rstat">' + (t.games[id] || 0) + ' played · ' + sits[idx] + ' sat</span></div>';
      }).join("") + '</div>';
  }


  /* ---------------- history ---------------- */
  const SCOPES = [
    { id: "all", label: "All time" },
    { id: "year", label: "This year" },
    { id: "90", label: "90 days" },
    { id: "30", label: "30 days" }
  ];
  const SORTS = [
    { id: "points", label: "Points" },
    { id: "wins", label: "Wins" },
    { id: "pct", label: "Win %" }
  ];

  function historyView(st) {
    const scope = st.histScope || "all";
    const sum = Store.historySummary(scope);
    const sessions = Store.historySessions(scope);

    const scopeBar = '<div class="seg" style="margin-bottom:14px">' + SCOPES.map(function (o) {
      return '<button data-act="hscope:' + o.id + '" aria-pressed="' + (scope === o.id) + '">' + o.label + '</button>';
    }).join("") + '</div>';

    if (!sessions.length) {
      return '<div class="section-head"><h2>History</h2></div>' + scopeBar +
        '<div class="empty">' +
          '<p style="font-weight:600;color:var(--ink)">Nothing recorded ' +
            (scope === "all" ? "yet" : "in this window") + '</p>' +
          '<p style="margin-top:6px">Finished sessions are kept here for good — every match, score and date, however far back you need to look.</p>' +
        '</div>';
    }

    const span = sum.first === sum.last ? d8full(sum.first) : d8full(sum.first) + " – " + d8full(sum.last);
    const tiles = '<div class="statgrid" style="margin-bottom:4px">' +
      '<div class="stat"><div class="k">Sessions</div><div class="v">' + sum.sessions + '</div></div>' +
      '<div class="stat"><div class="k">Games played</div><div class="v">' + sum.games + '</div></div>' +
      '<div class="stat"><div class="k">Players seen</div><div class="v">' + sum.players + '</div></div>' +
      '<div class="stat"><div class="k">Covering</div><div class="v" style="font-size:15px;font-family:var(--f-body);font-weight:600;letter-spacing:0;line-height:1.3;margin-top:6px">' +
        esc(span) + '</div></div>' +
    '</div>';

    /* ---- all-time table ---- */
    const sort = st.histSort || "points";
    const board = Store.historyBoard(scope, sort);
    const sortBar = '<div class="seg" style="margin-bottom:12px;max-width:280px">' + SORTS.map(function (o) {
      return '<button data-act="hsort:' + o.id + '" aria-pressed="' + (sort === o.id) + '">' + o.label + '</button>';
    }).join("") + '</div>';

    const table = '<div class="card scroll-x" style="padding:12px 12px 4px">' +
      '<table class="table"><thead><tr>' +
        '<th>#</th><th>Player</th><th>Sess</th><th>GP</th><th>W</th><th>L</th>' +
        '<th>PF</th><th>+/−</th><th>Win%</th><th style="text-align:right">Last seen</th>' +
      '</tr></thead><tbody>' +
      board.map(function (r) {
        return '<tr' + (r.rank === 1 ? ' class="lead"' : '') + ' data-act="who:' + r.id + '" style="cursor:pointer">' +
          '<td>' + r.rank + '</td>' +
          '<td>' + esc(r.name) + '</td>' +
          '<td>' + r.sessions + '</td><td>' + r.gp + '</td><td>' + r.w + '</td><td>' + r.l + '</td>' +
          '<td>' + r.pf + '</td>' +
          '<td class="' + (r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : '') + '">' + (r.diff > 0 ? '+' : '') + r.diff + '</td>' +
          '<td>' + pct(r.pct) + '</td>' +
          '<td style="text-align:right;font-size:12px;color:var(--muted)">' + esc(d8(r.last)) + '</td>' +
        '</tr>';
      }).join("") +
      '</tbody><tfoot><tr><td colspan="10" style="text-align:left">Tap a player for every match they have played.</td></tr></tfoot></table></div>';

    /* ---- sessions, newest month first ---- */
    const months = [];
    const seen = {};
    sessions.forEach(function (s) {
      const k = monthKey(s.date);
      if (!seen[k]) { seen[k] = []; months.push(k); }
      seen[k].push(s);
    });

    const timeline = months.map(function (k) {
      const rows = seen[k].map(function (s) {
        return '<button class="ritem" data-act="log:' + s.id + '" style="width:100%;background:none;border:0;text-align:left;cursor:pointer">' +
          '<span style="flex:1;min-width:0">' +
            '<span class="rname" style="display:block">' + esc(s.name) +
              (s.isOpen ? ' <span class="pill accent" style="font-size:10px">Open</span>' : '') + '</span>' +
            '<span class="rstat" style="white-space:normal">' + esc(d8(s.date)) + ' · ' + plural(s.players, "player") + ' · ' +
              plural(s.rounds, "round") + ' · ' + plural(s.games, "game") +
              (s.winner ? ' · won by ' + esc(s.winner.name) : '') + '</span>' +
          '</span><span class="muted" aria-hidden="true">›</span>' +
        '</button>';
      }).join("");
      const mGames = seen[k].reduce(function (n, s) { return n + s.games; }, 0);
      return '<div class="section-head" style="margin-bottom:8px"><h2 style="font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)">' +
          esc(monthLabel(k)) + '</h2>' +
          '<span class="hint">' + plural(seen[k].length, "session") + ' · ' + plural(mGames, "game") + '</span></div>' +
        '<div class="roster">' + rows + '</div>';
    }).join("");

    return '' +
      '<div class="section-head"><h2>History</h2>' +
        '<span class="hint">Every session you have run, kept by date</span></div>' +
      scopeBar + tiles +
      '<div class="section-head"><h2>Across all sessions</h2></div>' +
      sortBar + table +
      '<div class="section-head"><h2>Session by session</h2>' +
        '<span class="hint">Tap one to read back every match</span></div>' +
      timeline +
      '<div class="section-head"><h2>Keep a copy</h2>' +
        '<span class="hint">History lives in this browser — a backup file is the safety net</span></div>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap">' +
        '<button class="btn primary" data-act="backup">Back up all sessions</button>' +
        '<button class="btn" data-act="sheet:import">Restore from a file</button>' +
      '</div>';
  }

  /* ---- one session, every match ---- */
  function logSheet(sessionId) {
    const st = Store.get();
    const sess = st.sessions[sessionId];
    if (!sess) return sheetShell("Session", "", "<p class='muted'>That session is gone.</p>");
    const recs = Store.sessionLog(sessionId);
    const byRound = [];
    const seen = {};
    recs.forEach(function (r) {
      if (!seen[r.round]) { seen[r.round] = []; byRound.push(r.round); }
      seen[r.round].push(r);
    });
    const body = byRound.length ? byRound.map(function (n) {
      return '<div class="label" style="margin:14px 0 6px">Round ' + n + '</div>' +
        seen[n].map(function (r) {
          const aWon = r.a > r.b, tie = r.a === r.b;
          const nm = function (t) { return t.map(function (p) { return esc(p.name); }).join(" & "); };
          return '<div class="ritem" style="border:1px solid var(--line-soft);border-radius:9px;margin-bottom:6px;gap:8px">' +
            '<span class="rstat" style="width:22px">C' + r.court + '</span>' +
            '<span style="flex:1;min-width:0">' +
              '<span style="font-weight:' + (aWon && !tie ? '700' : '400') + '">' + nm(r.teamA) + '</span>' +
              '<span class="muted" style="font-size:12px"> v </span>' +
              '<span style="font-weight:' + (!aWon && !tie ? '700' : '400') + '">' + nm(r.teamB) + '</span>' +
            '</span>' +
            '<span class="mono" style="font-weight:500">' + r.a + '–' + r.b + '</span>' +
          '</div>';
        }).join("");
    }).join("") : '<p class="muted">No completed matches in this session.</p>';

    return sheetShell(esc(sess.name), esc(d8full(sess.date)) + " · " + plural(recs.length, "game"),
      body +
      '<div class="row" style="margin-top:16px;gap:8px">' +
        '<button class="btn primary" data-act="openSession:' + sess.id + '">Open this session</button>' +
        '<button class="btn" data-act="closeSheet">Done</button>' +
      '</div>');
  }

  /* ---- one player, every match they have played ---- */
  function whoSheet(personId) {
    const st = Store.get();
    const person = Store.person(personId);
    const scope = st.histScope || "all";
    const log = Store.playerLog(personId, scope);
    const board = Store.historyBoard(scope, st.histSort || "points");
    const me = board.find(function (r) { return r.id === personId; });
    if (!person) return sheetShell("Player", "", "<p class='muted'>Not found.</p>");

    const head = me ? '<div class="statgrid" style="margin-bottom:14px">' +
      '<div class="stat"><div class="k">Record</div><div class="v">' + me.w + '–' + me.l + '</div></div>' +
      '<div class="stat"><div class="k">Win rate</div><div class="v">' + pct(me.pct) + '</div></div>' +
      '<div class="stat"><div class="k">Points</div><div class="v">' + me.pf + '</div></div>' +
      '<div class="stat"><div class="k">Sessions</div><div class="v">' + me.sessions + '</div></div>' +
    '</div>' : "";

    const months = [];
    const seen = {};
    log.forEach(function (r) {
      const k = monthKey(r.date);
      if (!seen[k]) { seen[k] = []; months.push(k); }
      seen[k].push(r);
    });

    const body = months.length ? months.map(function (k) {
      return '<div class="label" style="margin:14px 0 6px">' + esc(monthLabel(k)) + '</div>' +
        seen[k].map(function (r) {
          const col = r.result === "w" ? "var(--win)" : r.result === "l" ? "var(--loss)" : "var(--muted)";
          return '<div class="ritem" style="border:1px solid var(--line-soft);border-radius:9px;margin-bottom:6px;gap:8px">' +
            '<span class="mono" style="color:' + col + ';font-weight:500;width:14px">' + r.result.toUpperCase() + '</span>' +
            '<span style="flex:1;min-width:0">' +
              '<span style="font-size:13.5px">' +
                (r.partners.length ? 'with <b>' + esc(r.partners.join(" & ")) + '</b> ' : '') +
                'v ' + esc(r.opponents.join(" & ")) +
              '</span>' +
              '<span class="rstat" style="display:block">' + esc(d8(r.date)) + ' · ' + esc(r.sessionName) + ' · R' + r.round + '</span>' +
            '</span>' +
            '<span class="mono" style="font-weight:500">' + r.my + '–' + r.their + '</span>' +
          '</div>';
        }).join("");
    }).join("") : '<p class="muted">No matches recorded in this window.</p>';

    return sheetShell(esc(person.name),
      plural(log.length, "match", "matches") + " · " + SCOPES.filter(function (o) { return o.id === scope; })[0].label.toLowerCase(),
      head + body);
  }

  /* ---------------- sessions list ---------------- */
  function sessionsSheet(st) {
    const all = Object.keys(st.sessions).map(function (k) { return st.sessions[k]; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return sheetShell("Sessions", "Everything is kept on this device.",
      all.map(function (s) {
        const done = s.rounds.reduce(function (n, r) {
          return n + r.matches.filter(function (m) { return m.done; }).length; }, 0);
        return '<div class="row" style="gap:6px">' +
          '<button class="choice" style="flex:1;margin-bottom:7px" data-act="openSession:' + s.id + '">' +
            '<span style="flex:1"><span class="c-main">' + esc(s.name) + (s.sample ? ' · sample' : '') + '</span><br>' +
            '<span class="c-sub">' + esc(s.date) + ' · ' + plural(s.players.length, "player") + ' · ' +
              plural(s.rounds.length, "round") + ' · ' + done + ' games</span></span>' +
            (s.id === st.activeId ? '<span class="pill accent">Open</span>' : '') +
          '</button>' +
          '<button class="btn ghost sm" data-act="deleteSession:' + s.id + '" aria-label="Delete session" style="margin-bottom:7px">✕</button>' +
        '</div>';
      }).join("") +
      '<div class="row" style="margin-top:10px;gap:8px">' +
        '<button class="btn primary" data-act="sheet:new">New session</button>' +
        '<button class="btn" data-act="sheet:import">Open a file</button>' +
      '</div>');
  }

  function newSheet() {
    return sheetShell("New session", "You can change any of this later.",
      '<div class="stack">' +
        '<div class="field"><label class="label" for="ns-name">Session name</label>' +
          '<input class="input" id="ns-name" data-focus-key="ns-name" value="Pickleball Session"></div>' +
        '<div class="row" style="gap:10px">' +
          '<div class="field" style="flex:1"><label class="label" for="ns-date">Date</label>' +
            '<input class="input" id="ns-date" type="date" value="' + Store.todayISO() + '"></div>' +
          '<div class="field" style="flex:1"><label class="label" for="ns-courts">Courts</label>' +
            '<input class="input" id="ns-courts" type="number" min="1" max="12" value="2"></div>' +
        '</div>' +
        '<div class="row" style="gap:10px">' +
          '<div class="field" style="flex:1"><label class="label" for="ns-target">Games to</label>' +
            '<select class="input" id="ns-target"><option>11</option><option>15</option><option>21</option></select></div>' +
          '<div class="field" style="flex:1"><label class="label" for="ns-format">Format</label>' +
            '<select class="input" id="ns-format">' +
              '<option value="americano">Americano — max rotation</option>' +
              '<option value="mexicano">Mexicano — ranked courts</option>' +
            '</select></div>' +
        '</div>' +
        '<div class="field"><label class="label" for="ns-players">Players (optional)</label>' +
          '<textarea class="input" id="ns-players" rows="4" placeholder="One name per line"></textarea></div>' +
        '<button class="btn primary block" data-act="createSession">Create session</button>' +
      '</div>');
  }

  function settingsSheet(st, sess) {
    if (!sess) return sheetShell("Settings", "", '<p class="muted">Start a session first.</p>');
    const seg = function (act, val, cur, label) {
      return '<button data-act="' + act + ':' + val + '" aria-pressed="' + (cur === val) + '">' + label + '</button>';
    };
    return sheetShell("Session settings", esc(sess.name),
      '<div class="stack">' +
        '<div class="field"><label class="label" for="se-name">Name</label>' +
          '<input class="input" id="se-name" data-focus-key="se-name" data-setting="name" value="' + esc(sess.name) + '"></div>' +
        '<div class="row" style="gap:10px">' +
          '<div class="field" style="flex:1"><label class="label" for="se-date">Date</label>' +
            '<input class="input" id="se-date" type="date" data-setting="date" value="' + esc(sess.date) + '"></div>' +
          '<div class="field" style="flex:1"><label class="label" for="se-courts">Courts</label>' +
            '<input class="input" id="se-courts" type="number" min="1" max="12" data-setting="courts" value="' + sess.courts + '"></div>' +
        '</div>' +
        '<div class="field"><span class="label">Format</span><div class="seg">' +
          seg("set:format", "americano", sess.format, "Americano") +
          seg("set:format", "mexicano", sess.format, "Mexicano") +
        '</div><p class="muted" style="font-size:12.5px;margin-top:6px">' +
          (sess.format === "mexicano"
            ? "Courts are seeded by the table — the top four play court 1, 1&amp;4 against 2&amp;3."
            : "Pairings are chosen to repeat partners and opponents as little as possible.") +
        '</p></div>' +
        '<div class="field"><span class="label">Match type</span><div class="seg">' +
          seg("set:mode", "doubles", sess.mode, "Doubles") +
          seg("set:mode", "singles", sess.mode, "Singles") +
        '</div></div>' +
        '<div class="field"><span class="label">Games to</span><div class="seg">' +
          seg("set:target", "11", String(sess.target), "11") +
          seg("set:target", "15", String(sess.target), "15") +
          seg("set:target", "21", String(sess.target), "21") +
        '</div></div>' +
        '<div class="field"><span class="label">Rank the table by</span><div class="seg">' +
          seg("set:rankBy", "points", sess.rankBy, "Points") +
          seg("set:rankBy", "wins", sess.rankBy, "Wins") +
        '</div></div>' +
        '<label class="choice" style="cursor:pointer"><input type="checkbox" data-act="set:winBy2" ' +
          (sess.winBy2 ? "checked" : "") + '><span><span class="c-main">Win by 2</span><br>' +
          '<span class="c-sub">Flags finals that end on a one-point gap</span></span></label>' +
        '<label class="choice" style="cursor:pointer"><input type="checkbox" data-act="set:balance" ' +
          (sess.balance ? "checked" : "") + '><span><span class="c-main">Even out the teams</span><br>' +
          '<span class="c-sub">Nudges strong and weak players onto opposite sides</span></span></label>' +
        '<div class="field"><span class="label">Appearance</span><div class="seg">' +
          seg("theme", "auto", st.theme || "auto", "Auto") +
          seg("theme", "light", st.theme || "auto", "Light") +
          seg("theme", "dark", st.theme || "auto", "Dark") +
        '</div></div>' +
        '<div class="row" style="gap:8px;flex-wrap:wrap">' +
          '<button class="btn" data-act="export">This session</button>' +
          '<button class="btn" data-act="backup">Back up everything</button>' +
          '<button class="btn" data-act="sheet:import">Open a file</button>' +
          '<button class="btn danger" data-act="deleteSession:' + sess.id + '">Delete session</button>' +
        '</div>' +
        '<p class="mono muted" style="font-size:11.5px;text-align:center;margin-top:6px">' +
          'PickleStack · build ' + BUILD + '</p>' +
      '</div>');
  }

  function importSheet() {
    return sheetShell("Open a session file", "Paste the contents of a PickleStack file, or pick it from your device.",
      '<div class="stack">' +
        '<input type="file" accept="application/json,.json" class="input" id="imp-file" data-act="importFile">' +
        '<textarea class="input" id="imp-text" rows="6" data-focus-key="imp-text" placeholder="…or paste the JSON here"></textarea>' +
        '<button class="btn primary block" data-act="importText">Open session</button>' +
      '</div>');
  }

  function swapSheet(st, sess, arg) {
    const parts = arg.split(":");
    const pid = parts[0], ri = parseInt(parts[1], 10);
    const round = sess.rounds[ri];
    if (!round) return sheetShell("Swap", "", "<p>Round not found.</p>");
    const others = [];
    round.matches.forEach(function (m) {
      m.teamA.concat(m.teamB).forEach(function (id) {
        if (id !== pid) others.push({ id: id, where: "Court " + m.court });
      });
    });
    (round.sitting || []).forEach(function (id) { others.push({ id: id, where: "Sitting out" }); });
    return sheetShell("Swap " + esc(Store.playerName(pid)), "Pick who takes their place this round.",
      others.map(function (o) {
        return '<button class="choice" data-act="doSwap:' + pid + ':' + o.id + ':' + ri + '">' +
          '<span style="flex:1"><span class="c-main">' + esc(Store.playerName(o.id)) + '</span></span>' +
          '<span class="c-sub">' + o.where + '</span></button>';
      }).join(""));
  }

  function sheetShell(title, sub, body) {
    return '<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="row" style="align-items:flex-start"><div style="flex:1">' +
        '<h3>' + title + '</h3>' + (sub ? '<div class="sub">' + sub + '</div>' : '<div class="sub"></div>') +
      '</div><button class="icon-btn" data-act="closeSheet" aria-label="Close">✕</button></div>' +
      body + '</div></div>';
  }

  /* ---------------- render ---------------- */
  function render() {
    const st = Store.get();
    const sess = Store.session();

    // remember focus + caret so typing a score survives the re-render
    const act = document.activeElement;
    const fkey = act && act.getAttribute ? act.getAttribute("data-focus-key") : null;
    const caret = fkey && act.selectionStart !== undefined ? act.selectionStart : null;
    const scrollY = window.scrollY;

    document.documentElement.setAttribute("data-theme", st.theme && st.theme !== "auto" ? st.theme : "");
    if (!st.theme || st.theme === "auto") document.documentElement.removeAttribute("data-theme");

    let body;
    if (!sess && st.view === "history") body = historyView(st);
    else if (!sess) body = welcome();
    else if (st.view === "roster") body = rosterView(st, sess);
    else if (st.view === "standings") body = standingsView(st, sess);
    else if (st.view === "rotation") body = rotationView(st, sess);
    else if (st.view === "history") body = historyView(st);
    else body = matchesView(st, sess);

    let sheetHTML = "";
    if (sheet) {
      if (sheet.kind === "sessions") sheetHTML = sessionsSheet(st);
      else if (sheet.kind === "new") sheetHTML = newSheet();
      else if (sheet.kind === "settings") sheetHTML = settingsSheet(st, sess);
      else if (sheet.kind === "import") sheetHTML = importSheet();
      else if (sheet.kind === "swap") sheetHTML = swapSheet(st, sess, sheet.arg);
      else if (sheet.kind === "log") sheetHTML = logSheet(sheet.arg);
      else if (sheet.kind === "who") sheetHTML = whoSheet(sheet.arg);
      else if (sheet.kind === "confirm") sheetHTML = confirmSheet(sheet.arg);
      else if (sheet.kind === "text") sheetHTML = textSheet(sheet.arg);
    }

    root.innerHTML = header(st, sess) + '<main class="shell">' + body + '</main>' + tabs(st, sess) + sheetHTML;

    if (fkey) {
      const next = root.querySelector('[data-focus-key="' + fkey + '"]');
      if (next) {
        next.focus();
        if (caret !== null && next.setSelectionRange) {
          try { next.setSelectionRange(caret, caret); } catch (e) { /* not a text input */ }
        }
      }
    }
    window.scrollTo(0, scrollY);
  }

  /* ---------------- events ---------------- */
  function actOf(e) {
    let n = e.target;
    while (n && n !== root) {
      if (n.getAttribute && n.getAttribute("data-act")) return { act: n.getAttribute("data-act"), node: n };
      n = n.parentNode;
    }
    return null;
  }

  root.addEventListener("click", function (e) {
    const hit = actOf(e);
    if (!hit) return;
    const a = hit.act, node = hit.node;
    // clicking the scrim closes; clicking inside the sheet should not
    if (a === "closeSheet" && node.classList.contains("scrim") && e.target !== node) return;

    const st = Store.get(), sess = Store.session();
    const parts = a.split(":");
    const cmd = parts[0];

    if (cmd === "view") { Store.setView(parts[1]); return; }
    if (cmd === "round") { Store.setRound(parseInt(parts[1], 10)); return; }
    if (cmd === "sheet") { sheet = { kind: parts[1] }; render(); return; }
    if (cmd === "closeSheet") { sheet = null; pending = null; render(); return; }
    if (cmd === "confirmYes") {
      const fn = pending; pending = null; sheet = null;
      if (fn) fn();
      render(); return;
    }
    if (cmd === "textYes") {
      const box = document.getElementById("ask-input");
      const val = box ? box.value : "";
      const fn = pending; pending = null; sheet = null;
      if (fn) fn(val);
      render(); return;
    }

    if (cmd === "addPlayers") {
      const box = document.getElementById("addnames");
      const n = Store.addPlayers(box ? box.value : "");
      if (box) box.value = "";
      toast(n ? "Added " + plural(n, "player") : "Type a name first");
      render(); return;
    }
    if (cmd === "togglePlayer") { Store.togglePlayer(parts[1]); return; }
    if (cmd === "removePlayer") {
      const pid = parts[1];
      const n = Store.gamesFor(pid);
      const who = Store.playerName(pid);
      if (!n) { Store.removePlayer(pid); toast("Removed " + who); return; }
      askConfirm({
        title: "Remove " + who + "?",
        message: plural(n, "match", "matches") + " they played will be deleted too, so the standings stay correct.",
        yes: "Remove " + who, danger: true
      }, function () { Store.removePlayer(pid); toast("Removed " + who); });
      return;
    }
    if (cmd === "clearRoster") {
      const sess2 = Store.session(); if (!sess2) return;
      if (!sess2.players.length) return;
      const games = sess2.rounds.reduce(function (n, r) { return n + r.matches.length; }, 0);
      askConfirm(sess2.sample
        ? { title: "Clear the example names?", message: "You will get an empty roster ready for your own players.", yes: "Clear them" }
        : { title: "Clear the whole roster?",
            message: "This removes all " + plural(sess2.players.length, "player") +
              (games ? " and deletes " + plural(sess2.rounds.length, "round") + " of matches" : "") +
              ". The session name, date and settings stay. This cannot be undone.",
            yes: "Clear roster", danger: true },
        function () {
          Store.clearRoster(); Store.setView("roster");
          toast("Roster cleared — add your players");
        });
      return;
    }
    if (cmd === "renamePlayer") {
      const pid = parts[1];
      askText({ title: "Rename player", message: "This renames them in every session they appear in.",
                value: Store.playerName(pid), yes: "Save name" },
        function (name) { if (name && name.trim()) Store.renamePlayer(pid, name); });
      return;
    }

    if (cmd === "addRound") {
      const r = Store.addRound();
      if (r.error) { toast(r.error); return; }
      toast("Round " + Store.session().rounds.length + " is up");
      return;
    }
    if (cmd === "reshuffle") {
      const r = Store.reshuffleRound(parseInt(parts[1], 10));
      toast(r.error ? r.error : "Reshuffled");
      return;
    }
    if (cmd === "deleteRound") {
      const ri = parseInt(parts[1], 10);
      askConfirm({ title: "Delete round " + (ri + 1) + "?",
                   message: "Any scores recorded on it go too.", yes: "Delete round", danger: true },
        function () { Store.deleteRound(ri); toast("Round deleted"); });
      return;
    }
    if (cmd === "bump") {
      Store.bumpScore(parseInt(parts[4], 10), parts[1], parts[2], parseInt(parts[3], 10));
      return;
    }
    if (cmd === "clear") { Store.clearMatch(parseInt(parts[2], 10), parts[1]); return; }
    if (cmd === "swap") { sheet = { kind: "swap", arg: parts[1] + ":" + parts[2] }; render(); return; }
    if (cmd === "doSwap") {
      Store.swapPlayers(parseInt(parts[3], 10), parts[1], parts[2]);
      sheet = null; render(); toast("Swapped"); return;
    }

    if (cmd === "rankBy") { Store.updateSession({ rankBy: parts[1] }); return; }
    if (cmd === "hscope") { Store.setHist("histScope", parts[1]); return; }
    if (cmd === "hsort") { Store.setHist("histSort", parts[1]); return; }
    if (cmd === "log") { sheet = { kind: "log", arg: parts[1] }; render(); return; }
    if (cmd === "who") { sheet = { kind: "who", arg: parts[1] }; render(); return; }
    if (cmd === "addRegular") { Store.addRegular(parts[1]); return; }
    if (cmd === "set") {
      const k = parts[1], v = parts[2];
      if (k === "winBy2" || k === "balance") {
        const patch = {}; patch[k] = node.checked;
        Store.updateSession(patch); return;
      }
      const patch = {};
      patch[k] = k === "target" ? parseInt(v, 10) : v;
      Store.updateSession(patch); render(); return;
    }
    if (cmd === "theme") {
      Store.get().theme = parts[1];
      Store.setView(Store.get().view);
      render(); return;
    }

    if (cmd === "createSession") {
      const g = function (id) { const el = document.getElementById(id); return el ? el.value : ""; };
      Store.createSession({
        name: g("ns-name").trim() || "Pickleball Session",
        date: g("ns-date") || Store.todayISO(),
        courts: Math.max(1, parseInt(g("ns-courts"), 10) || 2),
        target: parseInt(g("ns-target"), 10) || 11,
        format: g("ns-format") || "americano"
      });
      const names = g("ns-players");
      if (names.trim()) Store.addPlayers(names);
      sheet = null; render(); toast("Session created"); return;
    }
    if (cmd === "openSession") { sheet = null; Store.openSession(parts[1]); return; }
    if (cmd === "deleteSession") {
      const sid = parts[1];
      const s2 = Store.get().sessions[sid];
      if (!s2) return;
      askConfirm({ title: "Delete " + s2.name + "?",
                   message: "Every round, score and result in this session is removed from your history for good.",
                   yes: "Delete session", danger: true },
        function () { Store.deleteSession(sid); toast("Session deleted"); });
      return;
    }

    if (cmd === "copyStandings") {
      const text = Store.shareText();
      const fallback = function () {
        showText({ title: "Standings", message: "Select the text below and copy it.",
                   value: text, readonly: true, rows: 12,
                   hint: "Your browser blocked the clipboard, so copy it by hand." });
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast("Standings copied"); }, fallback);
      } else { fallback(); }
      return;
    }
    if (cmd === "export") {
      const sess2 = Store.session();
      const fname = (sess2 ? sess2.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() : "picklestack") + ".json";
      saveFile(fname, Store.exportJSON());
      return;
    }
    if (cmd === "backup") {
      saveFile("picklestack-backup-" + Store.todayISO() + ".json", Store.exportAll());
      return;
    }
    if (cmd === "importText") {
      const box = document.getElementById("imp-text");
      const r = Store.importJSON(box ? box.value : "");
      if (r.error) { toast(r.error); return; }
      sheet = null; render(); toast('Opened "' + r.name + '"'); return;
    }
  });

  root.addEventListener("change", function (e) {
    const t = e.target;
    if (t.id === "imp-file" && t.files && t.files[0]) {
      const reader = new FileReader();
      reader.onload = function () {
        const r = Store.importJSON(String(reader.result));
        if (r.error) { toast(r.error); return; }
        sheet = null; render(); toast('Opened "' + r.name + '"');
      };
      reader.readAsText(t.files[0]);
      return;
    }
    const setting = t.getAttribute && t.getAttribute("data-setting");
    if (setting) {
      const patch = {};
      patch[setting] = setting === "courts" ? Math.max(1, Math.min(12, parseInt(t.value, 10) || 1)) : t.value;
      Store.updateSession(patch);
    }
  });

  root.addEventListener("input", function (e) {
    const sc = e.target.getAttribute && e.target.getAttribute("data-score");
    if (!sc) return;
    const parts = sc.split(":");
    const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
    if (e.target.value !== raw) e.target.value = raw;
    Store.setScore(parseInt(parts[2], 10), parts[0], parts[1], raw === "" ? null : raw);
  });

  root.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "addnames" && !e.shiftKey) {
      e.preventDefault();
      const n = Store.addPlayers(e.target.value);
      e.target.value = "";
      if (n) toast("Added " + plural(n, "player"));
      render();
    }
    if (e.key === "Enter" && e.target.id === "ask-input") {
      e.preventDefault();
      const fn = pending; pending = null;
      const val = e.target.value;
      sheet = null;
      if (fn) fn(val);
      render();
      return;
    }
    if (e.key === "Escape" && sheet) { sheet = null; pending = null; render(); }
  });

  /* ---------------- boot ---------------- */
  Store.init();
  Store.subscribe(render);
  render();
})();
