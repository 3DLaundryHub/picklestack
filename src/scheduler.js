/* ===========================================================
   House of Picklers — rotation engine
   Builds rounds that maximise how many different people each
   player partners with and plays against, while keeping games
   played and sit-outs even across the roster.
   =========================================================== */
const Sched = (function () {
  "use strict";

  const W_PARTNER = 14;   // repeating a partner is the costliest repeat
  const W_OPPONENT = 4;   // repeating an opponent costs less
  const W_BALANCE = 1.2;  // mild pull toward even team strength

  function key(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

  /* ---- counters over every round already on the board ---- */
  function tally(session) {
    const t = {
      games: {}, sits: {}, lastPlayed: {}, lastSat: {},
      partner: {}, opponent: {}, roundsCount: session.rounds.length
    };
    session.players.forEach(function (p) {
      t.games[p.id] = 0; t.sits[p.id] = 0;
      t.lastPlayed[p.id] = -99; t.lastSat[p.id] = -99;
    });
    session.rounds.forEach(function (round, ri) {
      round.matches.forEach(function (m) {
        const all = m.teamA.concat(m.teamB);
        all.forEach(function (id) {
          if (t.games[id] === undefined) return;
          t.games[id]++; t.lastPlayed[id] = ri;
        });
        [m.teamA, m.teamB].forEach(function (team) {
          for (let i = 0; i < team.length; i++)
            for (let j = i + 1; j < team.length; j++) {
              const k = key(team[i], team[j]);
              t.partner[k] = (t.partner[k] || 0) + 1;
            }
        });
        m.teamA.forEach(function (a) {
          m.teamB.forEach(function (b) {
            const k = key(a, b);
            t.opponent[k] = (t.opponent[k] || 0) + 1;
          });
        });
      });
      (round.sitting || []).forEach(function (id) {
        if (t.sits[id] === undefined) return;
        t.sits[id]++; t.lastSat[id] = ri;
      });
    });
    return t;
  }

  function partnerCount(t, a, b) { return t.partner[key(a, b)] || 0; }
  function opponentCount(t, a, b) { return t.opponent[key(a, b)] || 0; }

  /* ---- who gets on court this round ---- */
  function pickPlayers(session, t, need, ratings) {
    const pool = session.players.filter(function (p) { return p.active !== false; });
    if (pool.length <= need) return pool.map(function (p) { return p.id; });
    const scored = pool.map(function (p) {
      return {
        id: p.id,
        // fewest games first; among equals, whoever sat most (and most recently)
        score: t.games[p.id] * 1000
             - t.sits[p.id] * 60
             - (t.lastSat[p.id] === t.roundsCount - 1 ? 40 : 0)
             + Math.random() * 12
      };
    });
    scored.sort(function (a, b) { return a.score - b.score; });
    return scored.slice(0, need).map(function (s) { return s.id; });
  }

  /* ---- cost of one court ---- */
  function courtCost(t, group, split, ratings) {
    const A = [group[split[0]], group[split[1]]];
    const B = [group[split[2]], group[split[3]]];
    let c = W_PARTNER * (partnerCount(t, A[0], A[1]) + partnerCount(t, B[0], B[1]));
    for (let i = 0; i < A.length; i++)
      for (let j = 0; j < B.length; j++) c += W_OPPONENT * opponentCount(t, A[i], B[j]);
    if (ratings) {
      const sa = (ratings[A[0]] || 0) + (ratings[A[1]] || 0);
      const sb = (ratings[B[0]] || 0) + (ratings[B[1]] || 0);
      c += W_BALANCE * Math.abs(sa - sb);
    }
    return c;
  }

  const SPLITS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]];

  function bestSplit(t, group, ratings) {
    let best = null;
    SPLITS.forEach(function (s) {
      const c = courtCost(t, group, s, ratings);
      if (!best || c < best.cost) best = { cost: c, split: s };
    });
    return best;
  }

  function singlesCost(t, pair, ratings) {
    let c = W_OPPONENT * 3 * opponentCount(t, pair[0], pair[1]);
    if (ratings) c += W_BALANCE * Math.abs((ratings[pair[0]] || 0) - (ratings[pair[1]] || 0));
    return c;
  }

  function totalCost(t, order, size, ratings) {
    let sum = 0;
    for (let i = 0; i < order.length; i += size) {
      const group = order.slice(i, i + size);
      sum += size === 4 ? bestSplit(t, group, ratings).cost : singlesCost(t, group, ratings);
    }
    return sum;
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const x = a[i]; a[i] = a[j]; a[j] = x;
    }
    return a;
  }

  /* ---- randomised restarts + pairwise local search ---- */
  function optimise(ids, t, size, ratings) {
    let bestOrder = null, bestCost = Infinity;
    const restarts = ids.length > 16 ? 14 : 30;
    for (let r = 0; r < restarts; r++) {
      let order = shuffled(ids);
      let cost = totalCost(t, order, size, ratings);
      let improved = true, guard = 0;
      while (improved && guard++ < 60) {
        improved = false;
        for (let i = 0; i < order.length; i++) {
          for (let j = i + 1; j < order.length; j++) {
            if (Math.floor(i / size) === Math.floor(j / size)) continue; // same court: split handles it
            const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
            const c = totalCost(t, order, size, ratings);
            if (c < cost - 1e-9) { cost = c; improved = true; }
            else { order[j] = order[i]; order[i] = tmp; }
          }
        }
      }
      if (cost < bestCost) { bestCost = cost; bestOrder = order; }
      if (bestCost === 0) break;
    }
    return { order: bestOrder, cost: bestCost };
  }

  /* ---- Mexicano: rank-seeded courts, 1&4 v 2&3 ---- */
  function mexicanoOrder(ids, standings) {
    const rank = {};
    standings.forEach(function (s, i) { rank[s.id] = i; });
    return ids.slice().sort(function (a, b) {
      return (rank[a] === undefined ? 999 : rank[a]) - (rank[b] === undefined ? 999 : rank[b]);
    });
  }

  /* ---- public: build the next round ---- */
  function buildRound(session, standings) {
    const size = session.mode === "singles" ? 2 : 4;
    const active = session.players.filter(function (p) { return p.active !== false; });
    if (active.length < size) {
      return { error: "Need at least " + size + " checked-in players for " + (size === 2 ? "singles" : "doubles") + "." };
    }
    const t = tally(session);
    const capacity = Math.min(session.courts * size, Math.floor(active.length / size) * size);
    const ratings = session.balance ? ratingMap(standings) : null;

    const chosen = pickPlayers(session, t, capacity, ratings);
    const chosenSet = {};
    chosen.forEach(function (id) { chosenSet[id] = true; });

    let order, cost;
    if (session.format === "mexicano" && standings && standings.length) {
      order = mexicanoOrder(chosen, standings);
      cost = totalCost(t, order, size, null);
    } else {
      const r = optimise(chosen, t, size, ratings);
      order = r.order; cost = r.cost;
    }

    const matches = [];
    let court = 1;
    for (let i = 0; i < order.length; i += size) {
      const group = order.slice(i, i + size);
      let teamA, teamB;
      if (size === 2) { teamA = [group[0]]; teamB = [group[1]]; }
      else if (session.format === "mexicano") {
        teamA = [group[0], group[3]]; teamB = [group[1], group[2]];   // 1&4 v 2&3
      } else {
        const s = bestSplit(t, group, ratings).split;
        teamA = [group[s[0]], group[s[1]]];
        teamB = [group[s[2]], group[s[3]]];
      }
      matches.push({
        id: "m" + Date.now().toString(36) + court + Math.random().toString(36).slice(2, 6),
        court: court++, teamA: teamA, teamB: teamB, a: null, b: null, done: false
      });
    }
    const sitting = active.filter(function (p) { return !chosenSet[p.id]; }).map(function (p) { return p.id; });
    return { matches: matches, sitting: sitting, repeatCost: cost };
  }

  function ratingMap(standings) {
    if (!standings || !standings.length) return null;
    const m = {};
    standings.forEach(function (s) {
      m[s.id] = s.gp ? (s.pf - s.pa) / s.gp : 0;
    });
    return m;
  }

  /* ---- rotation coverage report ---- */
  function coverage(session) {
    const t = tally(session);
    const ids = session.players.map(function (p) { return p.id; });
    const n = ids.length;
    const possible = n * (n - 1) / 2;
    let uniqPartners = 0, uniqOpponents = 0, repeatPartners = 0;
    const perPlayer = {};
    ids.forEach(function (id) { perPlayer[id] = { partners: {}, opponents: {}, missing: [] }; });

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const p = partnerCount(t, ids[i], ids[j]);
        const o = opponentCount(t, ids[i], ids[j]);
        if (p > 0) { uniqPartners++; repeatPartners += p - 1; }
        if (o > 0) uniqOpponents++;
        if (p === 0 && o === 0) {
          perPlayer[ids[i]].missing.push(ids[j]);
          perPlayer[ids[j]].missing.push(ids[i]);
        }
        perPlayer[ids[i]].partners[ids[j]] = p;
        perPlayer[ids[j]].partners[ids[i]] = p;
        perPlayer[ids[i]].opponents[ids[j]] = o;
        perPlayer[ids[j]].opponents[ids[i]] = o;
      }
    }
    return {
      tally: t, perPlayer: perPlayer, possiblePairs: possible,
      uniquePartners: uniqPartners, uniqueOpponents: uniqOpponents,
      repeatPartners: repeatPartners,
      partnerPct: possible ? uniqPartners / possible : 0,
      facedPct: possible ? (function () {
        let faced = 0;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
          if (partnerCount(t, ids[i], ids[j]) + opponentCount(t, ids[i], ids[j]) > 0) faced++;
        return faced / possible;
      })() : 0
    };
  }

  return { buildRound: buildRound, tally: tally, coverage: coverage, key: key };
})();
