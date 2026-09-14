# PickleStack

A pickleball session manager: type in who showed up, generate rounds that keep
rotating partners and opponents, record scores, and watch the standings update
as each game finishes.

**Live app:** https://claude.ai/code/artifact/c4021853-9b14-4a05-ad14-df93c828f08b

## Putting it on the web

The whole app is one static file with no dependencies and no server, so any
static host will serve it, free. `index.html` is at the repo root, which is
exactly what GitHub Pages expects.

```bash
git remote add origin https://github.com/<you>/picklestack.git
git push -u origin main
```

Then on github.com: **Settings → Pages → Source → Deploy from a branch →
`main` / `(root)` → Save.** A minute later it is live at
`https://<you>.github.io/picklestack/`, public, no sign-in, on any device.

To ship a change:

```bash
python3 build.py && git commit -am "what changed" && git push
```

Pages redeploys on push. Netlify, Cloudflare Pages and Vercel all work the same
way — point them at the repo, leave the build command empty and the publish
directory as the root.

## QR code

`qr/picklestack-card.png` is a printable card for the noticeboard at the courts,
and `qr/picklestack-qr.png` is the bare code for putting in a chat or a poster.
Both point at the Pages URL.

If the site ever moves, edit `URL` at the top of `qr/make_qr.py` and re-run it:

```bash
python3 qr/make_qr.py
```

## No accounts, by design

There is no sign-up, no login and no server holding anyone's data. Each person
who opens the page gets their own copy in their own browser, and the backup file
is how a session moves between devices or people.

That is the right trade for a club running its own sessions: nothing to
administer, nothing to pay for, no personal data to look after, and the app
keeps working with no signal at the courts. The cost is that a phone and a
laptop do not see the same data, and your history lives in one browser — so take
backups.

Adding accounts would mean adding a backend (Supabase and Firebase both have
free tiers that suit this shape of app), at which point sign-in, hosting costs
and privacy obligations all arrive together. Worth it only if you actually need
several people writing scores into one live scoreboard.

## Running it

No build tools, no dependencies, no server required.

```bash
open index.html
```

`index.html` is a single self-contained page. It works offline, and everything
is saved in the browser it's opened in.

## Editing it

`index.html` and `dist/artifact.html` are **generated** — edit the files in
`src/` and rebuild:

```bash
python3 build.py
```

| File | What it holds |
| --- | --- |
| `src/head.html` | title and web-font links |
| `src/app.css` | design tokens, light and dark themes, all layout |
| `src/scheduler.js` | the rotation engine — round building and coverage stats |
| `src/store.js` | session state, the player directory, standings and history maths, saving |
| `src/app.js` | every screen and interaction |
| `src/body.html` | the page shell |

`build.py` inlines all of it twice: into `index.html` (a full standalone
document) and `dist/artifact.html` (the same page without the outer document
wrapper, which is the form the hosted version is published in).

## How the rotation works

`Sched.buildRound` runs in two stages each round.

1. **Who plays.** Everyone checked in is scored by games played, then by how
   many rounds they've sat out and whether they sat out last round. The lowest
   scores fill the courts, so playing time and sit-outs even themselves out
   without anyone tracking it.

2. **Who plays with whom.** Every pairing carries a cost: partnering someone
   you've already partnered costs 14, facing someone you've already faced costs
   4. The engine runs randomised restarts with a pairwise local search over the
   selected players, keeping the arrangement with the lowest total cost, and
   picks the cheapest of the three team splits on each court. The practical
   effect is that nobody repeats a partner until everyone has had one, and the
   same goes for opponents.

Switching a session to **Mexicano** replaces stage 2: players are seeded by the
current table, the top four take court 1, and each court plays 1 & 4 against
2 & 3. Stage 1 is unchanged, so the fairness rules still hold.

The **Rotation** tab reports on all of this — partnerships used out of the total
possible, the share of pairs who have met at all, repeat partnerships, the
spread between the most and least games played, a partner grid, and who still
hasn't crossed paths with whom.

## Players carry across sessions

A session's player row is local to that session, but it carries a `personId`
pointing at a directory entry in `state.people`. Add "Maya" to a new session and
she is matched to the existing Maya by name (case- and whitespace-insensitive),
so her record follows her from week to week. Renaming a player renames the
person everywhere, past sessions included.

The **Regulars** row on the Roster tab is that directory minus whoever is
already on tonight's list — one tap each to build the night's roster instead of
retyping names.

Removing people is consistent rather than convenient: **✕** on a player who has
already played deletes their matches too (and any round left empty), because
leaving half a scoreline behind would quietly corrupt the standings. The confirm
says so before it happens. **Clear the whole roster** empties the players and the
rounds together, keeping the session's name, date and settings. Either way,
directory entries no session points at any more are pruned, so a name you delete
stops appearing under Regulars.

## History

The **History** tab reads across every session ever recorded, scoped to all
time, this year, the last 90 days or the last 30.

- **Summary** — sessions, games, distinct players and the date range covered.
- **Across all sessions** — an all-time table of sessions played, GP, W, L,
  points for, differential, win rate and last seen, ranked by points, wins or
  win percentage. Tap a player for every match they have played: month by month,
  with the partner, the opponents, the score, the date and which session and
  round it came from.
- **Session by session** — every session grouped by month, with its date, size
  and winner. Tap one to read back every completed match in it, round by round,
  or reopen it to keep playing.

The built-in sample session is excluded from all of it, so the record only ever
contains real play.

## Dialogs

The app never calls `window.confirm` or `window.prompt`. The hosted viewer runs
the page in a sandbox that suppresses both — `confirm` returns `false`
immediately, so anything gated behind one silently does nothing. Every question
the app asks (remove, clear, delete, rename, and the copy/save fallbacks) is a
sheet rendered by `askConfirm` / `askText` in `src/app.js`, with the follow-up
action held in `pending` until the user answers.

If you add a destructive action, use those helpers. A browser dialog will look
fine in a desktop tab and fail silently everywhere it matters.

## Scoring and standings

A match counts the moment both scores are entered — the standings, the rotation
stats and the shared copy all update on the spot. Scores that don't match the
session format (short of the target, or a one-point win with *win by 2* on) are
flagged rather than blocked, because real sessions end games early.

The table ranks by points scored or by wins; the tiebreak chain is shown beneath
it either way.

## Data

Everything lives in `localStorage` under `picklestack.v1` — sessions, the player
directory and your history. That is per-browser, so it survives reloads and
phone restarts but not clearing site data.

**Back up all sessions** (bottom of the History tab, or in settings) writes the
whole record — every session and every player identity — to one JSON file, and
**Restore from a file** reads it back, merging by id so a restore never
duplicates what is already there. **This session** exports just the open session
if you only want to hand one night's results to someone.

Take a backup periodically. It is the only thing standing between months of
history and a cleared browser.

### Optional: one shared scoreboard across phones

`src/store.js` already speaks the hosted shared store — one scorekeeper enters a
score and every other phone updates live. It is switched off deliberately: that
store is only available to pages that are restricted to your own Claude
organisation, so a publicly shared link can't use it. Enable it by republishing
the artifact with `capabilities: {"db": {}}`; the app detects the store on its
own and the header pill changes from *This device* to *Shared*. Without it,
every device keeps its own copy and you move sessions with the file export.
