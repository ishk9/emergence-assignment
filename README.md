# Emergence — AI startup-triage pipeline

An internal tool for a seed-stage VC. Point it at a topic, a few URLs, or the
latest Hacker News / Y Combinator batch and it returns **scored, cited one-page
memos**, each ending in a clear call: **Pass / Watch / Take a meeting**. The
point isn't to make the investment decision — it's to clear the obvious no's off
a partner's desk so their time goes to the few worth reading closely.

Built on [eve](https://eve.dev) (agent framework), TypeScript, the AI SDK.

**▶ [Walkthrough video (~5 min)](https://www.loom.com/share/a9ebd637f398445d9feaeb85ab5eb8a5)** — one startup, end to end.

---

## Read the docs

Start here — each file exists for a reason:

- **[docs/SUMMARY.txt](docs/SUMMARY.txt)** — the human overview. What was built,
  the decisions that shaped it (DAG over orchestrator, deterministic scoring,
  thesis-as-data), and the trade-offs. **Read this first.**
- **[docs/PROMPTS.md](docs/PROMPTS.md)** — the actual prompts that drove the
  build, in order. The trail of how the work happened and how AI was used.
- **[docs/PROVIDERS.md](docs/PROVIDERS.md)** — LLM provider config: Anthropic vs
  Bedrock, the AWS credential/inference-profile setup, and why web search is
  decoupled from the analysis provider.
- **[plans/startup-triage-pipeline.md](plans/startup-triage-pipeline.md)** — the
  original design plan: architecture, data model, scoring, build order.
- **[plans/self-correcting-retry.md](plans/self-correcting-retry.md)** — design
  for the retry logic that re-runs a failed step with the error as context.
- **[memos/](memos/)** — committed sample output. Open one to see the format a
  partner reads: verdict, cited analysis, per-founder bios, sources.

---

## How it works (60 seconds)

A fixed, replayable pipeline — not an autonomous orchestrator:

```
source (HN + YC / URLs) → dedup by domain → enrich → analyze → score → recommend → memo
```

- **Analysis** runs one web-research pass per company (team / product / market /
  risk), each finding carrying a **source URL** — uncited claims are dropped.
- **Score** is a deterministic weighted sum over features the LLM extracts. The
  LLM never picks the number, so the score is reproducible and shows its math.
- **Thesis is data, not code.** A *profile* sets the dimension weights + a risk
  appetite. The score is computed from it; the verdict is written by the LLM but
  handed the profile, so it judges like that partner. Same company under
  different profiles → different score and verdict.

---

## Requirements

- **Node 24.x** (uses native TypeScript type-stripping — no build step to run).
- An **`ANTHROPIC_API_KEY`** (default provider; also powers web search).
- *(Optional)* AWS credentials for Amazon Bedrock — see [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Setup

```sh
npm install
cp /dev/null .env   # then add your key:
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env
```

`.env` is gitignored. If `npm run typecheck` reports missing Node types, run
`npm install --include=dev` (some environments prune dev deps).

---

## Usage

### CLI — one command, memos out
```sh
# a company you paste
node --env-file=.env scripts/triage.ts --urls https://www.cursor.com

# the latest HN + YC batch
node --env-file=.env scripts/triage.ts

# a topic, capped, judged by a specific thesis
node --env-file=.env scripts/triage.ts --limit 5 --profile aggressive "AI devtools"
```
Memos are written to `memos/<domain>.md` plus a ranked `memos/index.md`.

### Interactive (TUI)
```sh
npm run dev
```
Then just talk to it:
```
analyze https://www.cursor.com using the conservative profile
what thesis profiles are available?
create a profile "fintech" — I back fintech infra, technical founders, low risk appetite
```

### Choosing the LLM provider
Default is Anthropic direct. To run analysis + verdict on **Bedrock**, set the
provider in `.env` (`LLM_PROVIDER=bedrock`, model, `AWS_PROFILE`, `AWS_REGION`).
Web search stays on Anthropic regardless. Full matrix + gotchas in
[docs/PROVIDERS.md](docs/PROVIDERS.md).

---

## Thesis profiles

Built-ins: `balanced` (default), `conservative`, `aggressive`. Add your own as
`profiles/<name>.json` (hand-written or via the `create_profile` tool):

```json
{
  "name": "fintech-conservative",
  "description": "Fintech infra, technical founders, regulatory moat first.",
  "weights": { "team": 3, "product": 2, "market": 2, "risk": 4, "freshness": 1 },
  "riskAppetite": "low"
}
```
Weights need not sum to 1 (normalized on load). Pass with `--profile <name>` or
name it in a TUI prompt.

---

## Tests

```sh
npm test          # node --test over agent/**/*.test.ts
npm run typecheck  # tsc
```

---

## Project layout

```
agent/
  agent.ts              chat/orchestration agent (eve)
  instructions.md       triage-analyst persona
  tools/                triage, create_profile, list_profiles
  lib/
    sources/            HN + YC adapters (+ URL input)   ← Adapter pattern
    normalize.ts        dedup/merge by canonical domain
    enrich/             website + GitHub signals
    analysis/           research pass + structured extraction
    scoring/            features → subscores, weighted scorer, thesis profiles  ← Strategy
    recommend/          LLM verdict, framed by the profile
    memo/               markdown memo (every claim cited)
    retry/              self-correcting retry (transient / validation / terminal)
    llm/                pluggable provider + web tools
scripts/triage.ts       CLI entrypoint
profiles/               thesis profiles (JSON)
memos/                  committed sample outputs
plans/                  design docs written before implementation
docs/                   overview, prompt trail, provider config (see top)
```
