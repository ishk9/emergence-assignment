# Startup Triage Pipeline — Plan

## Context

Partners spend ~10 hrs/week manually scanning Product Hunt, YC, HN, Twitter/X, Crunchbase for
promising startups, then hand-writing memos. Most candidates get passed on. Goal: automate the
**triage layer** so partners only spend time on the top ~10%.

This v1 is a **real internal tool**. Sources for v1: **Hacker News + Y Combinator** (both accessible
without paid API keys). Ships the **full pipeline end-to-end** (source → memo) with a scored,
cited recommendation. The learning **feedback loop + eval are scaffolded but NOT wired** this round.

Built on **Eve** (Vercel agent framework). Key correction from the original design: the flow is a
**fixed DAG**, not an autonomous LLM orchestrator. Eve's primitives absorb most of the originally-
proposed design patterns; only two LLD patterns survive as real code (**Adapter** for sources,
**Strategy** for scoring). LLM runs *inside* pipeline nodes via **AI Gateway** (provider-agnostic,
default Claude); it never decides control flow and never computes the score.

## Architecture — the DAG

```
              ┌─ team ───┐
HN + YC  →  normalize  →  enrich  ─┼─ product ┼→  score  →  recommend  →  memo
adapters    + dedup      (site,    ├─ market  │   (algo,     (verdict +   (cited
            (domain key) github)   └─ risk ───┘    weighted)  3-4 counter) markdown)
                                   (parallel LLM subagents, each cited)
```

- **Deterministic pipeline** (Eve Workflow) — declared graph, per-node retry/resume, reproducible.
- **Analysis fans out** to 4 independent LLM subagents, fans back into the scorer.
- **Score is pure algorithm** (no LLM). Its *inputs* are LLM-extracted structured features.
- **Every claim carries a source URL + confidence.** Uncited numbers (e.g. TAM) are omitted or flagged.

## What Eve provides — do NOT hand-build

| Originally planned | Use instead | Dropped pattern |
|---|---|---|
| AI orchestrator + Chain of Responsibility | Eve **Workflows** (durable DAG, checkpoint/resume) | CoR, custom orchestrator |
| Factory for agents | Eve directory structure (`instructions.md` + `tools/`) | Factory |
| Singleton | Eve-managed lifecycle + state persistence | Singleton |
| Adapter/Strategy for LLM providers | Eve **AI Gateway** (swap model by config) | LLM adapter |
| Parallel analysis subagents | Eve **subagent delegation** | — (keep) |
| Partner approval / feedback capture | Eve **human-in-the-loop** (scaffold only this round) | — |

> Confirm exact Eve API surface (Workflows, subagent, AI Gateway calls) against current Eve docs
> during implementation — names below are the intent, not verified signatures.

## Surviving LLD patterns (only two)

1. **Adapter — sources.** `Source` interface: `fetch(query) → Candidate[]`. Each source (HN, YC) is one
   adapter that hits its own API/HTML and normalizes to the common `Candidate` type. Adding Product
   Hunt/Crunchbase later = one new adapter, zero pipeline change.
2. **Strategy — scoring.** `Scorer` interface: `score(features) → Score`. v1 = hand-tuned weighted-sum
   strategy. Later = feedback-tuned weights, swapped in without touching the pipeline.

Everything else (Singleton/Factory/CoR/Specification) is intentionally omitted — Eve or YAGNI covers it.

## Data model (core types)

- `Candidate` = `{ domain (canonical key), name, website, oneLiner, sources: SourceRef[], freshness: Signal[] }`
- `SourceRef` = `{ source, url, discoveredAt }` — dedup merges multiple sources onto one domain.
- `Signal` = `{ kind: 'launch'|'funding'|'hn_traction'|'github_activity', value, url, at }`
- `DimensionResult` = `{ dimension, findings, claims: Claim[], features: Record<string, number|string> }`
- `Claim` = `{ text, sourceUrl, confidence: 'low'|'med'|'high' }`  ← provenance is mandatory
- `Score` = `{ total: 0-100, subscores: {team,product,market,risk,freshness}, weightsVersion, explanation }`
- `Recommendation` = `{ verdict: 'Pass'|'Watch'|'Meeting', rationale, counterPoints: string[] }` (3-4)

## Scoring (algorithmic, deterministic)

- LLM analysis nodes emit **structured features** (enums→numbers, counts, confidences), not prose scores.
  e.g. team: `priorExits`, `technicalDepth (low/med/high)`, `founderMarketFit`; freshness: `recencyDays`,
  `tractionMagnitude`.
- `weighted-sum` scorer combines features with **transparent, versioned weights** → 0-100 + per-dimension
  breakdown + human-readable `explanation`.
- Thresholds suggest a verdict band, but the recommendation node writes the final verdict + counter-points.
- **Determinism check:** same candidate → same score on repeat runs (features cached by domain).

## Proposed project structure (greenfield, Eve conventions)

```
instructions.md            orchestrator agent playbook (triage persona, tone, rules)
eve.config.*               Eve config — AI Gateway default model (Claude), channels
skills/
  analysis.md              per-dimension analysis playbook (require citations)
  recommendation.md        verdict + 3-4 "change my mind" counter-points playbook
tools/
  sources/
    types.ts               Candidate, Source interface  ← Adapter contract
    hackernews.ts          HN Algolia API adapter → Candidate[]
    ycombinator.ts         YC directory adapter → Candidate[]
    normalize.ts           dedup by domain + merge SourceRefs/Signals
  enrich/
    website.ts             fetch site → description, tech signals
    github.ts              repo activity → freshness Signal
workflows/
  triage.ts                the DAG: source→normalize→enrich→analyze→score→recommend→memo
scoring/
  index.ts                 Scorer interface (Strategy) + weighted-sum impl
  weights.ts               versioned weight config
  features.ts              extract feature vector from DimensionResult[]
memo/
  render.ts                assemble memo markdown with inline citations
feedback/
  schema.ts                partner-verdict capture schema  — SCAFFOLD, not wired
eval/
  golden.ts                small labeled set + precision@k  — SCAFFOLD, not wired
```

## Build order

1. **Types + Adapter contract** (`tools/sources/types.ts`) — `Candidate`, `Source`, `Claim`.
2. **HN adapter** (`hackernews.ts`) — Algolia API, map Show HN / launches → `Candidate` w/ traction Signal.
3. **YC adapter** (`ycombinator.ts`) — public directory → `Candidate` w/ batch/freshness Signal.
4. **Normalize/dedup** (`normalize.ts`) — canonical domain key, merge multi-source hits. Target 10-20 candidates.
5. **Enrichment** (`website.ts`, `github.ts`) — fill product/tech + github activity signal.
6. **Analysis subagents** (`skills/analysis.md` + workflow nodes) — team/product/market/risk, parallel,
   each returns `DimensionResult` with **cited claims** via AI Gateway structured output.
7. **Scoring** (`scoring/`) — feature extraction → weighted-sum Strategy → `Score` + explanation. No LLM.
8. **Recommendation** (`skills/recommendation.md`) — verdict + 3-4 counter-points, grounded in analysis + score.
9. **Memo render** (`memo/render.ts`) — markdown, every claim shows its source URL.
10. **Wire the DAG** (`workflows/triage.ts`) — connect nodes, parallel fan-out for analysis, checkpointed.
11. **Scaffolds** (`feedback/schema.ts`, `eval/golden.ts`) — types + TODO only, not wired.

## Self-correcting retry (subagent failure handling)

Every LLM subagent node (the 4 analysis dimensions, recommendation) is wrapped in a **corrective
retry**: on failure, capture the error + the prior bad output, feed both back into a re-dispatch so
the next attempt fixes the specific mistake. Bounded, not infinite. Full design in
`plans/self-correcting-retry.md` — summary:

- `withCorrectiveRetry(fn, { maxAttempts=3, validate })` wraps each subagent call.
- **Classify failure**: *transient* (API/timeout/rate-limit) → backoff + retry same prompt;
  *validation* (schema invalid, missing citations, bad verdict) or *usable error message* →
  re-dispatch with a **corrective prompt** = original + "Attempt N failed. Error: <msg>. Your
  previous output: <output>. Fix these issues, return valid output."
- **Bounded**: after `maxAttempts`, mark that node `degraded`, return partial/null, **pipeline
  continues** — one failed dimension doesn't kill the whole memo. Logged for eval.
- Analysis nodes are pure reads → retry has no duplicate side effects. Eve Workflow checkpoints mean
  retries never redo upstream nodes.

## Cost / trust guardrails

- Cache source fetches + enrichment + analysis **by domain** — never re-derive facts across runs.
- Provenance mandatory: memo claims without a source URL are dropped or flagged low-confidence.
- Market-size / market-share numbers: cite or omit — LLMs hallucinate these.

## Deferred (explicitly out of v1)

- Feedback loop wired to tune weights (schema scaffolded — this is the highest-value *next* step).
- Eval precision@k measurement (golden set scaffolded).
- Product Hunt / Twit-X / Crunchbase adapters (add as new adapters — pipeline unchanged).

## Verification

1. Run the triage workflow on a query (e.g. `"AI devtools"`): confirm **10-20 deduped candidates**,
   each with name/website/one-liner/≥1 freshness signal.
2. Confirm the **same startup from HN + YC merges** to one candidate (dedup by domain works).
3. Open a generated memo: **every claim shows a source URL**; no uncited market numbers.
4. **Determinism:** run the same candidate twice → identical `Score` (features cached).
5. Confirm each recommendation has a verdict ∈ {Pass, Watch, Meeting} **plus 3-4 counter-points**.
6. Kill the process mid-run, resume: Eve Workflow **checkpoints**, doesn't redo completed nodes.
