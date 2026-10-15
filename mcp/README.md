# LazyPO by voice — the MCP connector

Talk to LazyPO from the Claude app (phone or desktop, voice mode included): the
Dutch quiz by ear, « le point » on the day, the PI. A small Node server on the
Mac exposes a handful of tools over MCP; a tunnel makes it reachable; the Claude
app calls it through a custom connector.

```
  You speak
     │
     ▼
  Claude app ── HTTPS ──► Cloudflare tunnel ──► mcp/server.mjs (127.0.0.1:8787) ──► Supabase (as you, RLS)
  (connector)                                   ├── /mcp     the tools
                                                ├── /health  "ok"
                                                └── /        local page: dictated words to validate
```

No framework, no build step: `node server.mjs`. Three dependencies
(`@modelcontextprotocol/sdk`, `@supabase/supabase-js`, `zod`), installed in
`mcp/node_modules` (ignored by git). Everything else in this repo is untouched:
the server **reads** `quiz.html` (the `SRS-PURE` block) and `pi.js` at startup
and runs them under Node, so the voice channel can never drift from the web.

## The tools

| Tool | Column | What it does |
|---|---|---|
| `lazypo_point` | feeds | Everything to start, in one call: reviews due, new-word budget, what a daily series would look like, 7-day KPIs, XP & streak, last sessions, pending dictated words, PI headline, cockpit deadlines and open tasks. |
| `lazypo_serie` | feeds | Composes an **oral** series (`jour` · `revisions` · `nouveaux` · `flagges`) and returns it whole: questions, expected answers, articles, examples, tips, "after" info, the grading protocol. Writes nothing. |
| `lazypo_mot` | feeds | Looks a word up (NL or FR, article/accents ignored): card, stage, success rate, next review, flag, last answers. Says plainly when nothing matches. |
| `lazypo_pi` | feeds | Sprint grid, releases, features per release/sprint, days off, test windows. |
| `lazypo_resultats` | acts | Records the grades of a series: `quiz_progress` via `srsNext()`, one `quiz_answers` row per answer (`mode: 'voice'`), one `quiz_sessions` row (`lang: 'daily'` for a daily series, `'voice'` otherwise). |
| `lazypo_ajouter_mot` | acts | A dictated word goes to a **draft** on the Mac (default) — or straight into `vocabulary` with `vocabularyWrites: "direct"`. |
| `lazypo_marquer_mot` | acts | Puts a word into / out of « Étudier plus tard ». |

**What the voice channel may write — enforced by code, not by prose:**

- it only grades words *it* asked: `lazypo_resultats` needs the key of a series this server composed, less than `seriesTtlHours` (12) old and not yet graded; a word absent from the series, already graded today (first attempt only, like the web), or a grade outside 1–4 is refused and named in the answer;
- it never creates authoritative content on its own: a dictated word is a draft until you validate it on the local page (voice transcription mangles Dutch);
- everything else is read-only.

A series is **two round trips**: `lazypo_serie` once, the questions asked by
Claude from what it got, `lazypo_resultats` once. Voice latency punishes anything
chattier, so no tool is designed to be chained.

## Setup, once

```bash
cd mcp && npm install
node setup.mjs                 # ~/.config/lazypo-mcp/config.json + a 256-bit token (never printed)
node login.mjs                 # Supabase e-mail + password, typed here, never stored; keeps only the session
node server.mjs                # 127.0.0.1:8787 — the banner says how to get the token, not its value
```

`node token.mjs` prints the token when you create the connector; nothing else
ever does (no banner, no log). `node login.mjs --status` / `--logout`.

Files live in `~/.config/lazypo-mcp/` (0700): `config.json` (token, port,
options), `session.json` (Supabase access + refresh token, 0600, refreshed on
demand), `drafts.json` (dictated words), `series.json` (composed series).
`LAZYPO_MCP_DIR` overrides the directory (the tests use it).

Start at login with the launchd example in `launchd/` (logs in
`~/Library/Logs/lazypo-mcp.log`, token-free).

## The tunnel — take a stable URL from day one

Connector authentication **cannot be edited** in the Claude app: when the URL
changes you delete the connector and recreate it. With an ephemeral tunnel that
is every start. Use a named one.

**Cloudflare named tunnel** (recommended — `ndashiz.be` is already on Cloudflare,
and the config in `tunnel/cloudflared.example.yml` rewrites `Host` to the
loopback form, so the server needs no public hostname at all):

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create lazypo-mcp
cloudflared tunnel route dns lazypo-mcp lazypo-mcp.ndashiz.be
cp mcp/tunnel/cloudflared.example.yml ~/.cloudflared/config.yml   # fill in the UUID
cloudflared tunnel run lazypo-mcp                                   # or: sudo cloudflared service install
curl https://lazypo-mcp.ndashiz.be/health                           # "ok" — THROUGH the tunnel, not locally
```

Only `/mcp` and `/health` are routed; the rest answers 404 at Cloudflare.
A quick tunnel works for a first try (`cloudflared tunnel --url http://127.0.0.1:8787 --http-host-header 127.0.0.1:8787`)
but its URL changes at every start. Tailscale Funnel also works: enable Funnel on
the tailnet, `tailscale funnel 8787`, and add the `*.ts.net` name with
`node setup.mjs --host <name>.ts.net` (Funnel forwards the original `Host`).

The tunnel terminates TLS: it sees requests, token and answers in clear. With
Cloudflare that is a party already in front of `ndashiz.be`; with an anonymous
tunnel it is one more.

## The connector, in the Claude app

Settings → Connectors → **Add custom connector**:

- **URL**: `https://lazypo-mcp.ndashiz.be/mcp`
- **Authentication**: *No sign-in*
- **Request headers**: `authorization` = `Bearer <token>` (or `x-api-key` = `<token>`; the server accepts the token in any header, raw or `Bearer`)
- Transport: leave the default (streamable HTTP; the URL must not end in `/sse`).

Then enable the connector in a (voice) chat and say « LazyPO, le point ». Every
tool description tells the model to act only when you name LazyPO (or the Dutch
quiz, or the PI) — transcription variants included.

## The guard, in order

| | Control | Note |
|---|---|---|
| a | **Provenance** — `CF-Connecting-IP` / first `X-Forwarded-For` must be in Anthropic's outbound range `160.79.104.0/21`; a plain loopback call (no proxy header) is allowed for local tests | shared by all of Anthropic: a scanner repellent, not an identity. `provenance: "any"` turns it off |
| b | **Token** — 256 bits, compared in constant time, accepted in any header, raw or `Bearer` | |
| c | **Host** — `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>` plus `publicHosts` | closes CSRF from any web page and DNS rebinding against the local page |
| d | **Ceiling** — 60 calls per minute per address | |
| e | the token is written in one file, and printed only by `token.mjs` | |

Every refusal is a bare `404`. `GET`/`DELETE /mcp` answer `405`: the transport is
stateless (`sessionIdGenerator: undefined`), there is no stream to resume.
Only `POST /mcp` reaches the MCP SDK. The local page and its `/api` answer only
to a loopback browser with a loopback `Host` and no proxy header; its writes
need a JSON body from this origin.

## Tests

```bash
cd mcp && npm test
```

Node's test runner: the guard (CIDR, token, Host, ceiling, local face), the
`SRS-PURE` extraction and `pi.js` under Node, series composition and grading
refusals, « le point ». No network, no Supabase.

## Traps

- **Descriptions are the program.** A strange tool choice is almost always a
  sentence in `lib/tools.mjs`, not a bug in the code. Write them after using the
  tool for real; if two tools share a property, write it on both.
- **`pi.js` runs under Node with stand-ins for `window`, `document`,
  `localStorage`, `CustomEvent`.** A new browser global touched at load time in
  `pi.js` breaks the server at startup — `npm test` catches it.
- **Don't move the `SRS-PURE-BEGIN` / `SRS-PURE-END` markers** or add DOM /
  network calls between them: the server extracts that block verbatim.
- **Voice sessions count in the feed and for the streak** (they are posted to
  `quiz_sessions`), but the XP reconciliation runs in the web app: XP for a
  voice-only day is credited the next time `quiz.html` opens.
- **Missing migrations degrade, they don't break**: like the web, writes drop
  `recent` / `stage` / `lapses` / `first_tested` or the `quiz_answers` journal when
  the base says the column or table is absent.
