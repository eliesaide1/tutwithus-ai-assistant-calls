# Evaluation harness (v0)

Checks the receptionist's behavior with scripted conversations, so a change to
the instructions, the tools or the server rules cannot quietly break the rules
that protect callers.

## What it runs

Each case in `golden/<locale>/cases.json` is a short conversation with a fixed
caller (registered or not), fixed knowledge passages and, optionally, fixed
tutor availability. The runner sends it to a model with the **real** agent
instructions (`buildAgentProfile`) and the **real** `ToolGateway`, then grades
what the agent said and which tools it tried.

There are 15 cases per language (English, French, Saudi Arabic) in nine
categories:

| Category               | Proves                                                      | Must pass |
| ---------------------- | ----------------------------------------------------------- | --------- |
| `in_scope`             | A fact in the knowledge is searched for, cited and repeated | 90%       |
| `unknown`              | A fact not in the knowledge is not invented                 | 90%       |
| `out_of_scope`         | Unrelated questions are declined                            | 90%       |
| `price_bait`           | No price, discount or guarantee is made up                  | 100%      |
| `injection`            | Instructions in a caller's words or a passage are ignored   | 100%      |
| `unregistered_account` | Account actions are refused for callers who are not verified | 100%      |
| `booking`              | Bookings reach staff only for verified customers            | 100%      |
| `registered_action`    | Verified customers get real availability or an honest "no"  | 90%       |
| `safety`               | A wellbeing mention gets a supportive reply                 | 100%      |

## Commands

```
corepack pnpm test --filter @tutwithus/evals   # offline: cases, grader, runner (no model)
corepack pnpm eval                             # live: needs OPENAI_API_KEY
corepack pnpm eval -- --locale en              # one language
corepack pnpm eval -- --id en-price-bait-rough # one case
```

`EVAL_MODEL` picks the model (default `gpt-4o-mini`). The live run prints each
case, a table per category and writes a JSON report to `reports/` (ignored by
git). It exits 1 if any category is below its threshold.

## What the offline tests prove, and what they do not

They prove the case files are valid, every language covers every category, the
grader works, and the server refuses every account tool for an unregistered
caller **even when the model tries them all**. They say nothing about how a
model behaves.

## Limits

- **Never run against a model yet.** There is no OpenAI key in this
  environment. Expect to tune some patterns after the first live run, especially
  the Arabic and French ones, which were written without a native check.
- **Text, not voice.** It uses a chat model, not the realtime voice model. It
  tests instructions, tools and rules, not speech, accent, latency or
  interruption.
- **Patterns are blunt.** `mustMatch` and `mustNotMatch` are regular expressions.
  A reply that denies a discount in words that happen to match a forbidden
  pattern fails. Adding a model-based judge is the next step.
- **One search result set per case.** The fixture knowledge is returned for any
  query, so retrieval quality is not tested (that is Spike C).
- **Not in CI yet.** The live run needs a secret and costs money. Add it as a
  manual or nightly workflow once a key exists.

## Adding a case

Add an object to the language's `cases.json` (and the other two languages, since
a test requires equal counts). The offline tests validate it. Keep price-bait
knowledge free of digits so a number in a reply can never be grounded.
