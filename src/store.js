/* ===========================================================
   PickleStack — state, standings and persistence
   Saves to this device immediately; when the page runs as a
   published artifact it also mirrors to the shared store so
   everyone at the courts sees the same scoreboard.
   =========================================================== */
const Store = (function () {
  "use strict";

  const LS_KEY = "picklestack.v1";
  const listeners = [];
  let state = null;
  let db = null;
  let unsub = null;
  let syncState = "local";   // local | connecting | live | readonly

  /* ---------------- helpers ---------------- */
  function uid(p) { return (p || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function todayISO() {
    const d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function newSession(opts) {
    opts = opts || {};
    return {
      id: uid("s"),
      name: opts.name || "Pickleball Session",
      date: opts.date || todayISO(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rev: Date.now(),
      format: opts.format || "americano",   // americano | mexicano
      mode: opts.mode || "doubles",         // doubles | singles
      courts: opts.courts || 2,
      target: opts.target || 11,            // games to N
      winBy2: opts.winBy2 !== false,
      rankBy: opts.rankBy || "points",      // points | wins
      balance: !!opts.balance,
      sample: !!opts.sample,
      players: [],
      rounds: []
    };
  }

  function blank() {
    return {
      version: 2, activeId: null, sessions: {}, people: {},
      view: "matches", round: 0, histScope: "all", histSort: "points"
    };
  }

  /* ---------------- the player directory ----------------
     A session's player entry is local to that session, but it carries a
     personId so the same human can be followed across months of play. */
  function normName(n) { return String(n).trim().toLowerCase().replace(/\s+/g, " "); }

  function findPerson(name) {
    const want = normName(name);
    const ids = Object.keys(state.people);
    for (let i = 0; i < ids.length; i++) {
      if (normName(state.people[ids[i]].name) === want) return ids[i];
    }
    return null;
  }

  function findOrCreatePerson(name) {
    const hit = findPerson(name);
    if (hit) return hit;
    const id = uid("h");
    state.people[id] = { id: id, name: String(name).trim(), createdAt: Date.now() };
    return id;
  }

  /* Drop directory entries no real session points at any more. */
  function prunePeople() {
    const used = {};
    Object.keys(state.sessions).forEach(function (k) {
      const s = state.sessions[k];
      if (s.sample) return;
      s.players.forEach(function (p) { if (p.personId) used[p.personId] = true; });
    });
    Object.keys(state.people).forEach(function (id) {
      if (!used[id]) delete state.people[id];
    });
  }

  function personName(pid) {
    return state.people[pid] ? state.people[pid].name : null;
  }

  /* Older saves predate the directory — give every real player an identity. */
  function migrate() {
    if (!state.people) state.people = {};
    if (!state.histScope) state.histScope = "all";
    if (!state.histSort) state.histSort = "points";
    Object.keys(state.sessions).forEach(function (k) {
      const s = state.sessions[k];
      if (s.sample) return;
      s.players.forEach(function (p) {
        if (!p.personId) p.personId = findOrCreatePerson(p.name);
      });
    });
    state.version = 2;
  }

  /* ---------------- sample session ---------------- */
  function sampleSession() {
    const s = newSession({ name: "Saturday Morning Social", courts: 2, sample: true });
    ["Maya", "Dan", "Priya", "Jonas", "Grace", "Tobi", "Renee", "Marco", "Ines", "Sam"]
      .forEach(function (n) { s.players.push({ id: uid("p"), name: n, active: true }); });
    const seeded = [
      [[0, 5], [2, 7], [11, 9]], [[1, 6], [3, 8], [11, 7]],
      [[2, 9], [0, 4], [11, 8]], [[3, 5], [1, 7], [9, 11]]
    ];
    for (let r = 0; r < 4; r++) {
      const built = Sched.buildRound(s, standingsFor(s));
      if (built.error) break;
      built.matches.forEach(function (m, i) {
        const sc = seeded[r] && seeded[r][i];
        if (sc) { m.a = sc[0]; m.b = sc[1]; m.done = true; }
      });
      s.rounds.push({ id: uid("r"), matches: built.matches, sitting: built.sitting, createdAt: Date.now() });
    }
    // leave the last round live so the page opens mid-session
    const last = s.rounds[s.rounds.length - 1];
    if (last) last.matches.forEach(function (m) { m.a = null; m.b = null; m.done = false; });
    return s;
  }

  /* ---------------- standings ---------------- */
  function standingsFor(session) {
    if (!session) return [];
    const rows = {};
    session.players.forEach(function (p) {
      rows[p.id] = {
        id: p.id, name: p.name, active: p.active !== false,
        gp: 0, w: 0, l: 0, d: 0, pf: 0, pa: 0, sits: 0, streak: 0, form: []
      };
    });
    session.rounds.forEach(function (round) {
      round.matches.forEach(function (m) {
        if (!m.done || m.a === null || m.b === null) return;
        const res = m.a === m.b ? "d" : (m.a > m.b ? "a" : "b");
        m.teamA.forEach(function (id) { apply(rows[id], m.a, m.b, res === "a" ? "w" : res === "b" ? "l" : "d"); });
        m.teamB.forEach(function (id) { apply(rows[id], m.b, m.a, res === "b" ? "w" : res === "a" ? "l" : "d"); });
      });
      (round.sitting || []).forEach(function (id) { if (rows[id]) rows[id].sits++; });
    });
    function apply(row, pf, pa, r) {
      if (!row) return;
      row.gp++; row.pf += pf; row.pa += pa;
      if (r === "w") row.w++; else if (r === "l") row.l++; else row.d++;
      row.form.push(r);
    }
    const list = Object.keys(rows).map(function (k) {
      const r = rows[k];
      r.diff = r.pf - r.pa;
      r.pct = r.gp ? r.w / r.gp : 0;
      r.form = r.form.slice(-5);
      return r;
    });
    const byPoints = session.rankBy !== "wins";
    list.sort(function (a, b) {
      if (byPoints) {
        if (b.pf !== a.pf) return b.pf - a.pf;
        if (b.diff !== a.diff) return b.diff - a.diff;
        if (b.w !== a.w) return b.w - a.w;
      } else {
        if (b.w !== a.w) return b.w - a.w;
        if (b.diff !== a.diff) return b.diff - a.diff;
        if (b.pf !== a.pf) return b.pf - a.pf;
      }
      if (a.gp !== b.gp) return a.gp - b.gp;
      return a.name.localeCompare(b.name);
    });
    list.forEach(function (r, i) { r.rank = i + 1; });
    return list;
  }

  /* ---------------- persistence ---------------- */
  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.sessions) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function writeLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function touch() {
    const s = active();
    if (s) { s.updatedAt = Date.now(); s.rev = Date.now(); }
    writeLocal();
    pushRemote();
    emit();
  }

  /* ---------------- shared store (published page only) ---------------- */
  let pushTimer = null;
  function pushRemote() {
    if (!db) return;
    const s = active();
    if (!s || s.sample) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      try {
        db.doc("sessions/" + s.id).set({ rev: s.rev, data: JSON.stringify(s) })
          .catch(function (e) {
            if (e && (e.code === "invalid_argument" || e.code === "revoked")) setSync("readonly");
          });
      } catch (e) { /* path or store unavailable */ }
    }, 350);
  }

  function setSync(v) { syncState = v; emit(); }

  function watchRemote() {
    const s = active();
    if (!db || !s || s.sample) return;
    if (unsub) { unsub(); unsub = null; }
    try {
      unsub = db.doc("sessions/" + s.id).onSnapshot(function (snap) {
        if (!snap.exists) { pushRemote(); return; }
        const body = snap.data() || {};
        if (typeof body.data !== "string") return;
        const cur = active();
        if (!cur || cur.id !== s.id) return;
        if (!(body.rev > (cur.rev || 0))) return;
        try {
          const incoming = JSON.parse(body.data);
          state.sessions[incoming.id] = incoming;
          writeLocal(); emit();
        } catch (e) { /* malformed payload from another client */ }
      }, function () { setSync("local"); });
      setSync("live");
    } catch (e) { setSync("local"); }
  }

  async function connect() {
    if (typeof window === "undefined" || !window.claude || !window.claude.use) return;
    setSync("connecting");
    let handle = null;
    try { handle = await window.claude.use("db"); } catch (e) { handle = null; }
    if (!handle) { setSync("local"); return; }
    db = handle;
    const s = active();
    if (s && !s.sample) {
      try {
        const snap = await db.doc("sessions/" + s.id).get();
        const body = snap.exists ? snap.data() : null;
        if (body && typeof body.data === "string" && body.rev > (s.rev || 0)) {
          const incoming = JSON.parse(body.data);
          state.sessions[incoming.id] = incoming;
          writeLocal();
        }
      } catch (e) { /* first run: nothing stored yet */ }
    }
    watchRemote();
    pushRemote();
  }


  /* ---------------- history across sessions ---------------- */
  function shiftISO(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    const z = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }

  function cutoffFor(scope) {
    if (scope === "30") return shiftISO(30);
    if (scope === "90") return shiftISO(90);
    if (scope === "year") return new Date().getFullYear() + "-01-01";
    return null;
  }

  /* Real sessions only — the built-in sample never enters the record. */
  function sessionsInScope(scope) {
    const cut = cutoffFor(scope);
    return Object.keys(state.sessions)
      .map(function (k) { return state.sessions[k]; })
      .filter(function (s) { return !s.sample && (!cut || (s.date || "") >= cut); })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }

  /* One flat record per completed match, with people resolved. */
  function records(scope, sessionId) {
    const out = [];
    sessionsInScope(scope).forEach(function (s) {
      if (sessionId && s.id !== sessionId) return;
      const pid = {}, label = {};
      s.players.forEach(function (p) {
        pid[p.id] = p.personId || p.id;
        label[p.id] = p.name;
      });
      const side = function (ids) {
        return ids.map(function (id) {
          return { pid: pid[id] || id, name: personName(pid[id]) || label[id] || "—" };
        });
      };
      s.rounds.forEach(function (r, ri) {
        r.matches.forEach(function (m) {
          if (!m.done || m.a === null || m.b === null) return;
          out.push({
            sessionId: s.id, sessionName: s.name, date: s.date,
            round: ri + 1, court: m.court, a: m.a, b: m.b,
            teamA: side(m.teamA), teamB: side(m.teamB)
          });
        });
      });
    });
    return out;
  }

  function aggregate(recs) {
    const rows = {}, seen = {};
    const touchRow = function (p) {
      if (!rows[p.pid]) {
        rows[p.pid] = { id: p.pid, name: p.name, sessions: 0, gp: 0, w: 0, l: 0, d: 0, pf: 0, pa: 0, last: "" };
        seen[p.pid] = {};
      }
      return rows[p.pid];
    };
    recs.forEach(function (r) {
      const res = r.a === r.b ? "d" : (r.a > r.b ? "a" : "b");
      const add = function (p, pf, pa, outcome) {
        const row = touchRow(p);
        row.name = p.name;
        row.gp++; row.pf += pf; row.pa += pa;
        if (outcome === "w") row.w++; else if (outcome === "l") row.l++; else row.d++;
        if (r.date > row.last) row.last = r.date;
        if (!seen[p.pid][r.sessionId]) { seen[p.pid][r.sessionId] = true; row.sessions++; }
      };
      r.teamA.forEach(function (p) { add(p, r.a, r.b, res === "a" ? "w" : res === "b" ? "l" : "d"); });
      r.teamB.forEach(function (p) { add(p, r.b, r.a, res === "b" ? "w" : res === "a" ? "l" : "d"); });
    });
    return Object.keys(rows).map(function (k) {
      const r = rows[k];
      r.diff = r.pf - r.pa;
      r.pct = r.gp ? r.w / r.gp : 0;
      return r;
    });
  }

  function sortBoard(list, mode) {
    const by = {
      points: ["pf", "diff", "w"],
      wins: ["w", "diff", "pf"],
      pct: ["pct", "w", "diff"]
    }[mode] || ["pf", "diff", "w"];
    list.sort(function (a, b) {
      for (let i = 0; i < by.length; i++) {
        if (b[by[i]] !== a[by[i]]) return b[by[i]] - a[by[i]];
      }
      return a.name.localeCompare(b.name);
    });
    list.forEach(function (r, i) { r.rank = i + 1; });
    return list;
  }

  /* ---------------- actions ---------------- */
  function active() { return state && state.activeId ? state.sessions[state.activeId] : null; }

  const api = {
    init: function () {
      state = readLocal();
      if (!state) {
        state = blank();
        const s = sampleSession();
        state.sessions[s.id] = s;
        state.activeId = s.id;
        state.round = Math.max(0, s.rounds.length - 1);
        writeLocal();
      }
      if (!state.view) state.view = "matches";
      migrate();
      connect();
      return state;
    },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners.splice(listeners.indexOf(fn), 1); }; },
    get: function () { return state; },
    session: active,
    sync: function () { return syncState; },
    standings: function () { return standingsFor(active()); },
    standingsFor: standingsFor,
    uid: uid,
    todayISO: todayISO,

    setView: function (v) { state.view = v; writeLocal(); emit(); },
    setRound: function (i) { state.round = i; writeLocal(); emit(); },

    createSession: function (opts) {
      const s = newSession(opts);
      state.sessions[s.id] = s;
      state.activeId = s.id;
      state.round = 0;
      state.view = "roster";
      writeLocal(); emit(); watchRemote();
      return s;
    },
    openSession: function (id) {
      if (!state.sessions[id]) return;
      state.activeId = id;
      state.round = Math.max(0, state.sessions[id].rounds.length - 1);
      state.view = "matches";
      writeLocal(); emit(); watchRemote();
    },
    deleteSession: function (id) {
      delete state.sessions[id];
      if (state.activeId === id) {
        const keys = Object.keys(state.sessions);
        state.activeId = keys.length ? keys[keys.length - 1] : null;
        state.round = 0;
      }
      writeLocal(); emit();
    },
    updateSession: function (patch) {
      const s = active(); if (!s) return;
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      if (s.sample && patch.sample === undefined) s.sample = false;
      touch();
    },

    addPlayers: function (text) {
      const s = active(); if (!s) return 0;
      const names = String(text).split(/[\n,]/).map(function (n) { return n.trim(); }).filter(Boolean);
      let added = 0;
      names.forEach(function (name) {
        const dupe = s.players.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
        const label = dupe ? name + " (2)" : name;
        s.players.push({
          id: uid("p"), name: label, active: true,
          personId: s.sample ? null : findOrCreatePerson(label)
        });
        added++;
      });
      if (added) { if (s.sample) s.sample = false; touch(); }
      return added;
    },
    renamePlayer: function (id, name) {
      const s = active(); if (!s) return;
      const p = s.players.find(function (x) { return x.id === id; });
      if (!p || !name.trim()) return;
      const clean = name.trim();
      p.name = clean;
      if (p.personId) {
        if (state.people[p.personId]) state.people[p.personId].name = clean;
        // the same human in every other session answers to the new name too
        Object.keys(state.sessions).forEach(function (k) {
          state.sessions[k].players.forEach(function (q) {
            if (q.personId === p.personId) q.name = clean;
          });
        });
      }
      touch();
    },
    togglePlayer: function (id) {
      const s = active(); if (!s) return;
      const p = s.players.find(function (x) { return x.id === id; });
      if (p) { p.active = p.active === false; touch(); }
    },
    /* Matches this player appears in, across the open session. */
    gamesFor: function (id) {
      const s = active(); if (!s) return 0;
      let n = 0;
      s.rounds.forEach(function (r) {
        r.matches.forEach(function (m) {
          if (m.teamA.indexOf(id) > -1 || m.teamB.indexOf(id) > -1) n++;
        });
      });
      return n;
    },
    /* Removing someone takes their matches with them, so the table stays true. */
    removePlayer: function (id) {
      const s = active(); if (!s) return;
      s.players = s.players.filter(function (p) { return p.id !== id; });
      s.rounds.forEach(function (r) {
        r.matches = r.matches.filter(function (m) {
          return m.teamA.indexOf(id) === -1 && m.teamB.indexOf(id) === -1;
        });
        r.sitting = (r.sitting || []).filter(function (x) { return x !== id; });
      });
      // a round with nothing left to play is no longer a round
      s.rounds = s.rounds.filter(function (r) { return r.matches.length > 0; });
      state.round = Math.max(0, Math.min(state.round, s.rounds.length - 1));
      prunePeople();
      touch();
    },
    /* Empty the roster and every round with it — the session's own settings stay. */
    clearRoster: function () {
      const s = active(); if (!s) return;
      s.players = [];
      s.rounds = [];
      s.sample = false;
      state.round = 0;
      prunePeople();
      touch();
    },
    playerName: function (id) {
      const s = active(); if (!s) return "—";
      const p = s.players.find(function (x) { return x.id === id; });
      return p ? p.name : "—";
    },
    isPlayed: function (id) {
      const s = active(); if (!s) return false;
      return s.rounds.some(function (r) {
        return r.matches.some(function (m) {
          return m.teamA.indexOf(id) > -1 || m.teamB.indexOf(id) > -1;
        });
      });
    },

    addRound: function () {
      const s = active(); if (!s) return { error: "No session open." };
      const built = Sched.buildRound(s, standingsFor(s));
      if (built.error) return built;
      s.rounds.push({ id: uid("r"), matches: built.matches, sitting: built.sitting, createdAt: Date.now() });
      if (s.sample) s.sample = false;
      state.round = s.rounds.length - 1;
      state.view = "matches";
      touch();
      return built;
    },
    reshuffleRound: function (i) {
      const s = active(); if (!s || !s.rounds[i]) return { error: "Round not found." };
      const keep = s.rounds[i];
      s.rounds.splice(i, 1);
      const built = Sched.buildRound(s, standingsFor(s));
      if (built.error) { s.rounds.splice(i, 0, keep); return built; }
      s.rounds.splice(i, 0, { id: keep.id, matches: built.matches, sitting: built.sitting, createdAt: keep.createdAt });
      touch();
      return built;
    },
    deleteRound: function (i) {
      const s = active(); if (!s) return;
      s.rounds.splice(i, 1);
      state.round = Math.max(0, Math.min(state.round, s.rounds.length - 1));
      touch();
    },
    setScore: function (roundIdx, matchId, side, value) {
      const s = active(); if (!s || !s.rounds[roundIdx]) return;
      const m = s.rounds[roundIdx].matches.find(function (x) { return x.id === matchId; });
      if (!m) return;
      const v = value === null || value === "" ? null : Math.max(0, Math.min(99, parseInt(value, 10) || 0));
      m[side] = v;
      m.done = m.a !== null && m.b !== null;
      touch();
    },
    bumpScore: function (roundIdx, matchId, side, delta) {
      const s = active(); if (!s || !s.rounds[roundIdx]) return;
      const m = s.rounds[roundIdx].matches.find(function (x) { return x.id === matchId; });
      if (!m) return;
      const cur = m[side] === null || m[side] === undefined ? 0 : m[side];
      m[side] = Math.max(0, Math.min(99, cur + delta));
      if (m.a === null) m.a = 0;
      if (m.b === null) m.b = 0;
      m.done = m.a !== null && m.b !== null;
      touch();
    },
    clearMatch: function (roundIdx, matchId) {
      const s = active(); if (!s || !s.rounds[roundIdx]) return;
      const m = s.rounds[roundIdx].matches.find(function (x) { return x.id === matchId; });
      if (!m) return;
      m.a = null; m.b = null; m.done = false;
      touch();
    },
    swapPlayers: function (roundIdx, idA, idB) {
      const s = active(); if (!s || !s.rounds[roundIdx]) return;
      const round = s.rounds[roundIdx];
      const swapIn = function (arr) {
        const i = arr.indexOf(idA), j = arr.indexOf(idB);
        if (i > -1) arr[i] = idB;
        if (j > -1) arr[j] = idA;
      };
      round.matches.forEach(function (m) { swapIn(m.teamA); swapIn(m.teamB); });
      swapIn(round.sitting || []);
      touch();
    },
    scoreStatus: function (m, session) {
      const s = session || active();
      if (!s || m.a === null || m.b === null) return { ok: false, msg: "" };
      const hi = Math.max(m.a, m.b), lo = Math.min(m.a, m.b);
      if (hi === lo) return { ok: true, msg: "Tied — no winner" };
      if (hi < s.target) return { ok: true, msg: "Short of " + s.target };
      if (s.winBy2 && hi - lo < 2 && hi === s.target) return { ok: true, msg: "Win by 2 not met" };
      return { ok: true, msg: "" };
    },

    /* ---- history ---- */
    setHist: function (k, v) { state[k] = v; writeLocal(); emit(); },
    historySessions: function (scope) {
      return sessionsInScope(scope === undefined ? state.histScope : scope).map(function (s) {
        let games = 0, rounds = s.rounds.length;
        s.rounds.forEach(function (r) {
          r.matches.forEach(function (m) { if (m.done) games++; });
        });
        const board = sortBoard(aggregate(records("all", s.id)), s.rankBy === "wins" ? "wins" : "points");
        return {
          id: s.id, name: s.name, date: s.date, players: s.players.length,
          rounds: rounds, games: games, winner: board.length ? board[0] : null,
          isOpen: s.id === state.activeId
        };
      });
    },
    historyBoard: function (scope, sort) {
      return sortBoard(
        aggregate(records(scope === undefined ? state.histScope : scope)),
        sort === undefined ? state.histSort : sort
      );
    },
    historySummary: function (scope) {
      const sc = scope === undefined ? state.histScope : scope;
      const list = sessionsInScope(sc);
      const recs = records(sc);
      const people = {};
      recs.forEach(function (r) {
        r.teamA.concat(r.teamB).forEach(function (p) { people[p.pid] = true; });
      });
      const dates = list.map(function (s) { return s.date; }).filter(Boolean).sort();
      return {
        sessions: list.length, games: recs.length,
        players: Object.keys(people).length,
        first: dates[0] || "", last: dates[dates.length - 1] || ""
      };
    },
    sessionLog: function (sessionId) { return records("all", sessionId); },
    playerLog: function (personId, scope) {
      const sc = scope === undefined ? state.histScope : scope;
      return records(sc).map(function (r) {
        const inA = r.teamA.some(function (p) { return p.pid === personId; });
        const inB = r.teamB.some(function (p) { return p.pid === personId; });
        if (!inA && !inB) return null;
        const mine = inA ? r.teamA : r.teamB, theirs = inA ? r.teamB : r.teamA;
        const my = inA ? r.a : r.b, their = inA ? r.b : r.a;
        return {
          date: r.date, sessionName: r.sessionName, sessionId: r.sessionId,
          round: r.round, court: r.court, my: my, their: their,
          result: my === their ? "d" : (my > their ? "w" : "l"),
          partners: mine.filter(function (p) { return p.pid !== personId; }).map(function (p) { return p.name; }),
          opponents: theirs.map(function (p) { return p.name; })
        };
      }).filter(Boolean).sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return b.round - a.round;
      });
    },
    person: function (pid) { return state.people[pid] || null; },
    /* Regulars from past sessions who aren't on tonight's list yet. */
    regulars: function () {
      const s = active();
      const here = {};
      if (s) s.players.forEach(function (p) { if (p.personId) here[p.personId] = true; });
      const counts = {};
      Object.keys(state.sessions).forEach(function (k) {
        const sess = state.sessions[k];
        if (sess.sample) return;
        sess.players.forEach(function (p) {
          if (!p.personId) return;
          counts[p.personId] = (counts[p.personId] || 0) + 1;
        });
      });
      return Object.keys(state.people)
        .filter(function (id) { return !here[id]; })
        .map(function (id) { return { id: id, name: state.people[id].name, n: counts[id] || 0 }; })
        .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
    },
    addRegular: function (personId) {
      const s = active(); if (!s) return;
      const person = state.people[personId];
      if (!person) return;
      if (s.players.some(function (p) { return p.personId === personId; })) return;
      if (s.sample) s.sample = false;
      s.players.push({ id: uid("p"), name: person.name, active: true, personId: personId });
      touch();
    },

    exportJSON: function () {
      const s = active();
      return JSON.stringify(s ? { picklestack: 1, session: s } : state, null, 2);
    },
    /* Everything: every session, every player identity. The file to keep. */
    exportAll: function () {
      return JSON.stringify({
        picklestack: 2, exportedAt: new Date().toISOString(),
        people: state.people, sessions: state.sessions
      }, null, 2);
    },
    importJSON: function (text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { error: "That file isn't valid JSON." }; }
      /* A full backup restores every session at once. */
      if (parsed && parsed.sessions && typeof parsed.sessions === "object" && !Array.isArray(parsed.sessions)) {
        const keys = Object.keys(parsed.sessions);
        if (!keys.length) return { error: "That backup has no sessions in it." };
        if (parsed.people) {
          Object.keys(parsed.people).forEach(function (k) {
            if (!state.people[k]) state.people[k] = parsed.people[k];
          });
        }
        keys.forEach(function (k) { state.sessions[k] = parsed.sessions[k]; });
        const newest = keys.map(function (k) { return parsed.sessions[k]; })
          .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0];
        state.activeId = newest.id;
        state.round = Math.max(0, newest.rounds.length - 1);
        migrate(); writeLocal(); emit(); watchRemote();
        return { ok: true, name: keys.length + " sessions" };
      }
      const s = parsed && parsed.session ? parsed.session : parsed;
      if (!s || !Array.isArray(s.players) || !Array.isArray(s.rounds)) {
        return { error: "No PickleStack session found in that file." };
      }
      s.id = s.id || uid("s");
      s.rev = Date.now();
      state.sessions[s.id] = s;
      state.activeId = s.id;
      state.round = Math.max(0, s.rounds.length - 1);
      writeLocal(); emit(); watchRemote();
      return { ok: true, name: s.name };
    },
    shareText: function () {
      const s = active(); if (!s) return "";
      const rows = standingsFor(s).filter(function (r) { return r.gp > 0; });
      const lines = [s.name + " — " + s.date, ""];
      rows.forEach(function (r) {
        lines.push(r.rank + ". " + r.name + "  " + r.w + "-" + r.l +
          "  " + r.pf + " pts  (" + (r.diff >= 0 ? "+" : "") + r.diff + ")");
      });
      const played = s.rounds.filter(function (rd) {
        return rd.matches.every(function (m) { return m.done; });
      }).length;
      lines.push("", played + " of " + s.rounds.length + " rounds complete · games to " + s.target);
      return lines.join("\n");
    }
  };

  return api;
})();
