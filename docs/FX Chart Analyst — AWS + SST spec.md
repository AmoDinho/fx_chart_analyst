# FX Chart Analyst — AWS + SST spec

Oct 21, 2026 · @Amogelang

## Purpose and scope

This spec defines `fx-chart-analyst-aws`: a separate AWS port of the Cloudflare pipeline, built entirely with SST v3 for infrastructure and the AWS SDK for JavaScript v3 for runtime calls, plus a React viewer that reads analyses through its own API. The Cloudflare Worker keeps running until the AWS version has matched it for 10 consecutive weekdays.

What stays the same, by design:

- Same two assets (`nasdaq100`, `gold`), same livecharts.co.uk pages, same weekday 07:00 UTC (09:00 SAST) schedule.
- Same capture rules: interval readback, 600×300 minimum, 1200×700 clip cap, SHA-256 duplicate check, `3h` → `30m` fallback policy.
- Same DeepSeek contract: raw Chat Completions, `deepseek-flash` only, images only in the user message with `detail: "original"`, `json_object` plus Zod, byte-stable system prompt.
- Same `knowledge/methodology.md` and `knowledge/context.md`, same schema v2, same coercion layer, same report, brief and Telegram output.

What changes:

- Orchestration moves from Cloudflare Workflows to AWS Step Functions (Standard).
- Browser Rendering is replaced by headless Chromium inside Lambda (`@sparticuz/chromium` + `puppeteer-core`), one browser launch per asset instead of per timeframe.
- KV is replaced by S3 (bytes: PNGs, Markdown, briefs, drafts) and DynamoDB (index, run logs, idempotency).
- The token-in-query-string viewer is replaced by a read API behind auth and a React SPA on S3 + CloudFront.
- No unauthenticated operational routes. `/status`, `/cleanup`, `/screenshot` and `/latest` either move behind auth or are dropped.

Non-goals: changing the trading method, adding price or news feeds, multi-user accounts, or fixing the chart-role mismatch (gap #1 in the Cloudflare doc). The frame set stays a single config constant so that fix lands in one place later.

## Architecture

A weekday schedule starts one durable workflow per day that captures, analyses, stores and notifies; a separate authenticated read path serves the React viewer. Nothing on the read path can start browser work except the authenticated admin routes.

&#91;embedded content: fx-chart-analyst-aws · write path and read path\]

The workflow is the only writer. `ReadApi` has read-only access to storage, and its admin routes call `Dispatch` to start runs, so manual and scheduled runs share one entry point and one idempotency scheme.

## SST app layout

Everything is declared in one `sst.config.ts` with SST components and resource linking; no hand-written CloudFormation, CDK or Terraform. Runtime code talks to AWS through modular AWS SDK v3 clients (`@aws-sdk/client-s3`, `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-lambda`, `@aws-sdk/s3-request-presigner`) and reads names via `Resource.*` from `sst`, never hardcoded ARNs.

Components, all on the [SST component reference](https://sst.dev/docs/component/aws/step-functions/):

| Component | Name | Purpose |
| --- | --- | --- |
| `aws.secretsmanager.Secret` | `DeepseekApiKey` | Created empty by deploy. Value is set with `aws secretsmanager put-secret-value`. The workflow reads it at runtime. Not an `sst secret`. |
| `sst.aws.Secret` | `TelegramBotToken`, `TelegramChatId`, `ViewerAllowEmail` | Set with `sst secret set`, linked only to functions that need them |
| `sst.aws.Bucket` | `Artifacts` | Private bucket for PNGs, Markdown, briefs, drafts. No public access |
| `sst.aws.Dynamo` | `Analyses` | Single table: report index, run logs, idempotency, failures |
| `sst.aws.Function` | `Capture` | Chromium capture, 2048 MB, 3 min timeout, `nodejs.install: ["@sparticuz/chromium"]` |
| `sst.aws.Workflow` | `DailyAnalysis` | Durable orchestrator (Lambda durable functions). Mirrors the Cloudflare workflow step for step |
| `sst.aws.Function` | `Dispatch` | Starts `DailyAnalysis` with a deterministic execution name |
| `sst.aws.CronV2` | `Weekday0700` | `cron(0 7 ? * MON-FRI *)`, `timezone: "UTC"`, invokes `Dispatch` |
| `sst.aws.ApiGatewayV2` | `ReadApi` | Read API for the viewer + authenticated admin routes |
| `sst.aws.CognitoUserPool` | `Viewers` | One user (you). JWT authorizer on `ReadApi` |
| `sst.aws.StaticSite` | `Viewer` | Vite + React build, served from S3 through CloudFront |
| `sst.aws.SnsTopic` | `Alerts` | Failure and grounding-warning notifications (replaces `FAILURE_WEBHOOK_URL`) |

Repo layout (new repo `fx-chart-analyst-aws`, Yarn workspaces):

```
sst.config.ts
packages/
  core/        # ported unchanged: schema, coerce, parse, prompt, request, render, brief, range, verify
    knowledge/ # methodology.md, context.md (copied, imported as text)
  functions/   # Lambda handlers: capture, dispatch, workflow, api/*
  web/         # Vite + React viewer
```

`packages/core` holds everything in the Cloudflare `src/analysis`, `src/report` and `src/capture/verify.ts` that has no platform binding. It must build and test with no AWS dependency, so the existing `test/*.ts` suites port with only import-path changes. Markdown in `knowledge/` is bundled via `nodejs.loader: { ".md": "text" }`.

Stages: `dev` (personal, `sst dev` live Lambdas, cron `enabled: false`) and `production` (cron enabled). Stage name is part of every resource name, so stages never share data.

## Workflow

Orchestration uses `sst.aws.Workflow`, which wraps [AWS Lambda durable functions](https://sst.dev/docs/component/aws/workflow/). Its `ctx.step(name, fn)` model matches Cloudflare's `step.do`, so `src/workflow.ts` ports almost line for line. Step Functions (`sst.aws.StepFunctions`, still beta in SST) is the fallback if durable functions misbehave; the step table below maps onto it unchanged.

Rules carried over from Cloudflare:

- Step results stay small. No image bytes in step results; steps pass S3 keys only.
- Replays re-run the handler from the top, so all side effects (S3 writes, DeepSeek calls, timestamps) live inside `ctx.step`.
- Per-asset independence: an asset's failure is caught, recorded, and the loop continues.
- `notify-morning` always runs, even when every asset failed.

Capture runs in the separate `Capture` function, called from the workflow with `ctx.invoke`, so the workflow function stays small and never bundles Chromium.

| Step | Runs in | Retries | Timeout | Notes |
| --- | --- | --- | --- | --- |
| `capture-{asset}` | `Capture` via `ctx.invoke` | 2, 20 s exponential | 3 min | One browser, all three frames. Fatal errors (bad asset, empty frame list) are not retried |
| `analyse-prepare-{asset}` | Workflow | 1 | 2 min | Skip if report exists and `force` is false. Loads PNG keys, sets `hintPoor` |
| `analyse-chat-{asset}` | Workflow | 1 on 429/5xx, 30 s | 10 min | Reads PNGs from S3, base64 in-step, writes raw completion to `drafts/` |
| `analyse-chat-retry-{asset}` | Workflow | 0 | 10 min | Only if content empty or `finish_reason: length` |
| `analyse-parse-{asset}` | Workflow | 1, 10 s | 2 min | Fence strip, coerce, Zod, stamp, write JSON + Markdown + Dynamo index |
| `analyse-chat-correct-{asset}` | Workflow | 0 | 10 min | One correction turn on JSON/schema failure |
| `analyse-parse-retry-{asset}` | Workflow | 0 | 2 min | Second failure is terminal |
| `brief-{asset}` | Workflow | 1, 10 s | 1 min | Writes phone HTML to S3 |
| `notify-morning` | Workflow | 2, 20 s | 1 min | One Telegram message for both assets |

The workflow function sets `timeout.invocation: "15 minutes"` (the default is 5 minutes, below a slow DeepSeek reasoning call) and `timeout.execution: "2 hours"`.

Idempotency uses the durable execution name, which AWS treats as an idempotency key for starts. `Dispatch` calls `InvokeCommand` from `@aws-sdk/client-lambda` with `DurableExecutionName` set, using the same ids as Cloudflare:

| Call | Execution name |
| --- | --- |
| Weekday cron, or `POST /admin/run` both assets without `force` | `cron-YYYY-MM-DD` |
| `POST /admin/analyse` one asset, no force | `analyse-{asset}-{date}` |
| `POST /admin/analyse` both assets, no force | `analyse-{date}` |
| Anything with `force` | `run-{date}-{Date.now()}` |

A run id starting `cron-` cannot carry `force: true`; `normalizeParams` ports unchanged into `packages/core`. Unlike Cloudflare, a failed cron execution can be re-driven from the admin route with `force`, and the viewer shows the failed execution so it is no longer hidden.

## Capture Lambda

`Capture` launches one headless Chromium per asset and captures all three frames in that session, cutting launches from 6 to 2 per morning. It uses `puppeteer-core` with `@sparticuz/chromium`, x86\_64, 2048 MB memory (the package README recommends 1600 MB or more), 3 minute timeout, 1024 MB `/tmp`.

Input: `{ asset, date, timeframes, force, store }`. Output: `{ stored: [{ timeframe, key, hash, width, height, verified }], notes, quality, fatal? }`. No bytes in the output.

Behaviour, ported from `src/capture/browser.ts`:

1. Skip frames already in S3 when `force` is false, but read the object's `x-amz-meta-hash`, width and height and re-check them. This closes Cloudflare gap #4 (cache hits trusted without metadata).
2. Viewport 1440×900, `domcontentloaded` with a 30 s timeout, inject the overlay-hiding stylesheet, wait 3 s.
3. For each frame: select the interval in the TradingView frame (radio, then menu), read it back, check the box is at least 600×300, clip at most 1200×700, check the PNG IHDR, check the SHA-256 against earlier frames in this session.
4. One in-page reselect on failure, then mark that frame missed and move on to the next frame in the same browser.
5. `3h` falls back to `30m` only if `30m` was not already stored.
6. Write `{asset}/{tf}/{date}.png` with metadata `hash`, `width`, `height`, `verified`, and copy to `{asset}/{tf}/latest.png`.

Version pinning: `@sparticuz/chromium` and `puppeteer-core` versions must match the Chromium release Puppeteer supports. Both are pinned exactly in `packages/functions/package.json` and bumped together. A weekly scheduled CI job runs the capture against the live pages in the `dev` stage to catch selector drift before it fails at 07:00 (Cloudflare gap #9).

The manual live screenshot route becomes `POST /admin/screenshot`, behind auth, calling `Capture` with `store: false` and writing a temp object under `tmp/screenshots/` that the viewer polls for, because a capture outlasts API Gateway's 30 s integration timeout.

## Analysis

The analysis logic ports unchanged; only storage calls change from KV to S3 and DynamoDB. `client.ts`, `request.ts`, `prompt.ts`, `schema.ts`, `parse.ts`, `coerce.ts` and `sections.ts` move to `packages/core` as-is, keeping `PROMPT_VERSION = "2"` and `SCHEMA_VERSION = "2"`.

Unchanged contract:

- Raw `fetch` to `https://api.deepseek.com/chat/completions`. No SDK, no tools, no `json_schema`, no temperature.
- Model locked to `deepseek-flash`; effort `high`, with `medium` and unknown values coerced to `high`.
- System message: methodology, context, output rules, example JSON. Byte-stable for DeepSeek's prompt cache.
- User message: `Image i of n — {label}`, PNG data URL with `detail: "original"`, run context last.
- `response_format: json_object`, `thinking: enabled`, `max_tokens: 16384`.
- 429 and 5xx retry; other 4xx, missing key and refused model throw a non-retryable error.

What changes:

| Concern | Cloudflare | AWS |
| --- | --- | --- |
| API key | `env.DEEPSEEK_API_KEY` | Secrets Manager `fx-chart-analyst/${stage}/DeepseekApiKey`, read with `GetSecretValue` |
| Non-retryable errors | `NonRetryableError` | Error class excluded by the step's `retryStrategy` |
| Drafts | KV `drafts/...` | S3 `drafts/{asset}/{date}/completion.json`, lifecycle-expired after 7 days |
| Report write | KV JSON + Markdown | S3 JSON + Markdown, plus a `REPORT` item in DynamoDB |
| Run log | KV `runs/...` | DynamoDB `RUN` item, never served raw to the viewer |
| Failure webhook | Optional `FAILURE_WEBHOOK_URL` | `Alerts` SNS topic, always deployed |

The stamper still overwrites `schema_version`, `prompt_version`, `model`, `generated_at_utc`, `asset` and the capture block after parse. A poor capture still withholds bias and verdict in the rendered Markdown; the JSON keeps them so the viewer can show them behind a clear poor-capture warning.

`analyseAsset()` (the non-workflow path) is dropped. One code path is enough.

## Storage

S3 holds bytes; DynamoDB holds the read model the API queries. The API never lists S3 to answer a query, which is what made Cloudflare's report listing paginate KV keys.

### S3 bucket `Artifacts`

Private, block-public-access on, SSE-S3, versioning off. Same key shapes as the KV layout so the port is mechanical.

| Key | Body | Lifecycle |
| --- | --- | --- |
| `{asset}/{tf}/{date}.png` | Dated screenshot. Metadata: `hash`, `width`, `height`, `verified` | Keep |
| `{asset}/{tf}/latest.png` | Copy of the newest stored frame | Overwritten |
| `reports/{asset}/{date}.json` | Stamped `ChartAnalysis`, archival copy | Keep |
| `reports/{asset}/{date}.md` | Rendered Markdown report | Keep |
| `briefs/{asset}/{date}.html` | Phone brief | Keep |
| `drafts/{asset}/{date}/completion.json` | In-flight model output | Deleted after parse; expire after 7 days |
| `tmp/screenshots/{uuid}.png` | Admin live screenshots | Expire after 1 day |

### DynamoDB table `Analyses`

One table, on-demand billing, keys `pk` / `sk`, two GSIs. Items are written by the workflow only; the API has read-only IAM.

| Item | `pk` | `sk` | GSI keys | Holds |
| --- | --- | --- | --- | --- |
| Day summary | `DAY#{date}` | `SUMMARY` | `gsi1pk = DAYS`, `gsi1sk = {date}` | Per-asset direction, grade, ok flag, execution name, overall status |
| Report | `DAY#{date}` | `REPORT#{asset}` | `gsi2pk = ASSET#{asset}`, `gsi2sk = {date}` | Full stamped analysis JSON (about 10–30 KB) plus S3 keys for PNGs, Markdown, brief |
| Run log | `DAY#{date}` | `RUN#{asset}` | none | Timings, token usage, cache hit/miss, finish reason, errors, step names |
| Failure | `DAY#{date}` | `FAIL#{asset}` | none | Terminal failure record (replaces `recordTerminalFailure`) |

Access patterns:

| Viewer need | Query |
| --- | --- |
| Calendar or day list, newest first | `gsi1`: `gsi1pk = DAYS`, `ScanIndexForward: false`, paged by `LastEvaluatedKey` |
| Everything for one day | Base: `pk = DAY#{date}` (summary, both reports, run logs, failures) |
| One asset on one day | `GetItem` `DAY#{date}` / `REPORT#{asset}` |
| One asset's history in a date range | `gsi2`: `gsi2pk = ASSET#{asset}`, `gsi2sk BETWEEN from AND to` |

The day summary is updated with a conditional `UpdateCommand` in the parse step and again in `notify-morning`, so a day that failed entirely still appears in the calendar with its error. The `GSI1` partition `DAYS` gets about 260 items a year; one partition is fine at that scale.

## Read API

`ReadApi` is an `sst.aws.ApiGatewayV2` HTTP API with a Cognito JWT authorizer on every route. The viewer is its only client. Each route is a small Lambda linked read-only to `Analyses` and `Artifacts`; admin routes are additionally linked to `Dispatch` and `Capture`.

Images are never proxied through Lambda. The API returns presigned S3 `GetObject` URLs (`@aws-sdk/s3-request-presigner`, 15 minute expiry), so the viewing token never sits in an image URL.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/days?limit=30&cursor=` | Day summaries, newest first, plus `nextCursor` |
| GET | `/days/{date}` | Summary, both reports, run status and failures for that date |
| GET | `/reports/{asset}/{date}` | One full analysis JSON plus presigned chart URLs |
| GET | `/reports/{asset}/{date}/markdown` | Rendered Markdown (for parity with the old report page) |
| GET | `/assets/{asset}/history?from=&to=` | Compact per-day rows for trend views |
| GET | `/runs/{date}` | Redacted run logs: timings, tokens, cache hit rate, errors. No raw completion text |
| POST | `/admin/run` | Body `{ date?, asset?, force? }`. Starts `full` phase. `202 { executionName, created }` |
| POST | `/admin/analyse` | Same body. Starts `analyse` phase (no browser) |
| POST | `/admin/screenshot` | Body `{ asset, timeframe }`. Invokes `Capture` asynchronously, returns `202 { id }`; `GET /admin/screenshot/{id}` returns the presigned temp URL when ready |
| GET | `/admin/status` | Recent durable executions via the SST `workflow.list` SDK |

Response shapes are Zod schemas in `packages/core/api.ts`, shared by the Lambdas and the React app, so a field rename breaks the build instead of the page.

```ts
type DaySummary = {
  date: string;                       // YYYY-MM-DD
  status: "ok" | "partial" | "failed" | "running";
  executionName: string;
  assets: Record<"nasdaq100" | "gold", {
    ok: boolean;
    direction?: "long" | "short" | "stand_aside";
    grade?: "A+" | "B" | "NO TRADE";
    confidence?: "low" | "medium" | "high";
    captureQuality?: "ok" | "poor";
    checklist?: { pass: number; fail: number; notVisible: number };
    error?: string;
  }>;
};

type ReportResponse = {
  analysis: ChartAnalysis;            // schema v2, unchanged
  charts: { timeframe: string; url: string; width: number; height: number }[];
  briefUrl?: string;
};
```

Pagination uses an opaque base64 cursor wrapping DynamoDB's `LastEvaluatedKey`. Bad dates or assets return 400; a missing report returns 404 with a real 401/403 for auth failures, since the endpoint is no longer hiding behind a shared secret. CORS allows only the viewer's CloudFront origin.

## React viewer

The viewer is a Vite + React + TypeScript single-page app in `packages/web`, deployed with `sst.aws.StaticSite` to a private S3 bucket behind CloudFront. It reads only from `ReadApi` and replaces the token-gated `/reports` and `/brief` pages. Telegram links point at its report route.

Stack: React Router for routes, TanStack Query for fetching and caching, Zod response types imported from `packages/core/api.ts`, `oidc-client-ts` for the Cognito hosted-UI login (authorization code + PKCE), plain CSS variables for light and dark themes, Recharts for every data chart (chart screenshots stay plain images). Mobile-first, because the morning read happens on a phone, but every page also works on desktop: below 900 px navigation is a bottom tab bar, at 900 px and up it becomes a left sidebar, and page cards reflow from one column into two or three.

| Route | Page | Shows |
| --- | --- | --- |
| `/` | Days | Month calendar plus a list, newest first. Each day shows two chips (Nasdaq, Gold) coloured by direction, with grade and a failed/partial marker. Infinite scroll on `nextCursor` |
| `/d/:date` | Day | Both assets side by side: verdict, grade, confidence, checklist counts as a pass / fail / not-visible stacked bar, reason, thumbnails, links to each report. Failed assets show the error and a re-run button |
| `/r/:asset/:date` | Report | Verdict card; checklist with PASS / FAIL / NOT VISIBLE badges; chart gallery with tap-to-zoom at original resolution; bias and dealing-range rail; timeframes; confluence and conflicts; invalidation; method citations; caveats; disclaimer. Tabs for Markdown and raw JSON |
| `/a/:asset` | History | Strip of direction and grade per day over a selectable range, a direction-mix donut, and a bar chart of how often each checklist item was NOT VISIBLE. Makes the frame-mismatch problem visible over time |
| `/runs/:date` | Runs | Step-duration bar chart coloured by outcome, token-usage chart (cached, uncached, completion), cache hit rate, finish reason, errors |
| `/admin` | Admin | Start a run or analyse for a date and asset, with or without force, showing the execution name the start will use; recent executions; live screenshot |

Behaviour:

- Poor captures show bias and verdict behind a visible warning banner, not hidden, so you can judge them yourself.
- An ok capture with no method citations shows a grounding warning above the verdict, same as the Markdown report.
- The range rail reuses `extractRange` from `packages/core`; if it can't parse, the rail is absent and nothing else changes.
- Presigned image URLs expire after 15 minutes; TanStack Query refetches the report on focus when they are older than 10.
- Routes are deep-linkable and survive reload through the StaticSite SPA fallback to `index.html`.

Build-time config comes from SST links: `environment: { VITE_API_URL: api.url, VITE_USER_POOL_ID: pool.id, VITE_USER_POOL_CLIENT_ID: client.id, VITE_REGION: aws.getRegionOutput().name }`. No secrets ship in the bundle.

## Auth and security

Every HTTP route requires a Cognito JWT; there are no public operational routes. This closes Cloudflare gaps #6 (four public routes) and #7 (viewer token in query strings, Telegram and inline script).

- `Viewers` user pool: self sign-up off, one admin-created user, MFA (TOTP) required, hosted UI with the viewer's CloudFront URL as the only callback.
- `ReadApi` uses an `ApiGatewayV2` JWT authorizer against that pool. Admin routes additionally check the `admins` group claim, so a read-only user can be added later without code changes.
- Telegram messages carry plain links to `/r/:asset/:date`. Opening one prompts login if the session has expired; no token is ever in a URL.
- Images use short-lived presigned URLs scoped to one object.
- IAM by SST linking: route Lambdas get read-only access to `Analyses` and `Artifacts`; only the workflow writes. `Capture` can write only under `{asset}/` and `tmp/` prefixes (`permissions` with key-prefix conditions).
- Secrets live in `sst.aws.Secret` (SSM-backed), linked per function. Telegram error bodies still have the bot token redacted before logging.
- CloudFront serves the SPA with `Content-Security-Policy` allowing scripts from self only, `connect-src` to `ReadApi` and Cognito, `img-src` to the bucket's regional S3 domain. Also `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- An `ApiGatewayV2` default route throttle (10 requests per second, burst 20) caps runaway cost even if a credential leaks.

Cheaper alternative if Cognito feels heavy: `sst.aws.Auth` (OpenAuth) with a code-by-email provider. Cognito is the default here because the JWT authorizer needs no custom Lambda.

## Notifications and observability

Telegram stays the morning channel; failures and warnings also go to an SNS topic so alerting no longer depends on an optional secret.

- `notify-morning` ports `src/notify.ts` unchanged: heading in `Africa/Johannesburg`, one block per asset, 3,900-character cap, previews off, failed assets marked `no brief` with the error. Links point at the viewer instead of `/brief?token=`.
- Missing Telegram secrets log `telegram.skipped` and do not fail the run, as today.
- `Alerts` (`sst.aws.SnsTopic`) receives terminal failures, poor captures and empty-citation grounding warnings. Subscribe an email address; this replaces `FAILURE_WEBHOOK_URL` and is always deployed (Cloudflare gap #10).
- Logs are structured JSON (required by durable functions) with one `runId`, `asset` and `step` field on every line, 30-day retention.
- CloudWatch alarms, declared in `sst.config.ts` through the Pulumi `aws.cloudwatch.MetricAlarm` resource, publish to `Alerts`:
  - workflow function errors ≥ 1 in a day
  - no `REPORT` item written for today by 08:00 UTC (a small check Lambda on a second `CronV2`)
  - `Capture` duration p95 above 150 s, an early sign of selector or page-load drift

## Cost and limits

Expected AWS bill is under $1 a month, almost all of it inside the always-free tiers; DeepSeek tokens remain the main variable cost and are unchanged. Estimates assume 22 weekdays, us-east-1 or eu-west-1 list prices, and one viewer.

| Item | Monthly usage | Cost |
| --- | --- | --- |
| Lambda compute | \~16,000 GB-s (capture 2 × 90 s × 2 GB, chat waits 2 × 3 min × 1 GB, per weekday) | $0, within the 400,000 GB-s free tier |
| Durable operations | \~550 (about 25 per run) | < $0.01 at $8 per million |
| DynamoDB on-demand | A few thousand reads and writes | < $0.05 |
| S3 | \~50 MB new PNGs and reports, small request counts | < $0.05 |
| API Gateway HTTP, CloudFront, Cognito, SSM, CloudWatch | One user, light traffic | \~$0, within free tiers |

One design difference from Cloudflare: Lambda bills wall-clock time, so waiting on DeepSeek costs GB-seconds where a Cloudflare Workflow wait cost nothing. At 1 GB and a few minutes a day this is noise, but the workflow function stays at 1024 MB rather than the capture function's 2048 MB.

Limits that shape the design:

| Limit | Value | Consequence |
| --- | --- | --- |
| Lambda max duration | 15 min | Each step fits; workflow invocation timeout set to 15 min |
| Workflow execution timeout | 2 h (set; default 14 days) | A stuck run fails the same morning |
| Lambda sync response payload | 6 MB | `Capture` returns S3 keys, never PNG bytes |
| API Gateway HTTP integration timeout | 30 s | `/admin/screenshot`, `/admin/run` and `/admin/analyse` start work asynchronously and return 202; the viewer polls |
| DynamoDB item size | 400 KB | Full analysis JSON (10–30 KB) fits in the `REPORT` item |
| Durable step results | Keep small | Steps exchange keys and summaries, not images |

## Testing, deploy and migration

### Tests

- `packages/core`: the existing `node:test` suites (schema, coercion, parse, prompt split, report and brief rendering, digest, `normalizeParams`) port with import-path changes only. These remain the main safety net.
- `packages/functions`: unit tests for S3 and DynamoDB adapters using `aws-sdk-client-mock`, and for workflow step ordering using the durable execution testing SDK, which runs durable handlers locally without deploying.
- `packages/web`: Vitest + Testing Library for the report page (poor capture banner, grounding warning, checklist badges), and contract tests that parse recorded API fixtures with the shared Zod schemas.
- Live checks in the `dev` stage, weekly: one real capture per asset against livecharts.co.uk, asserting interval readback and size. No DeepSeek call, to keep it free.

### Deploy

GitHub Actions on push to `main`: Node 22, frozen lockfile, typecheck, test, then `sst deploy --stage production`. AWS credentials come from GitHub OIDC assuming a deploy role; no long-lived keys in GitHub. Secrets are set once per stage with `sst secret set` and are not part of the pipeline.

### Migration plan

1. Create the repo, move portable code into `packages/core`, get its tests green.
2. Build `Capture`, `Artifacts` and `Analyses`; run captures manually in `dev`.
3. Build the workflow, dispatch and Telegram on a separate test chat; enable cron in `dev` only.
4. Build `ReadApi`, Cognito and the viewer against `dev` data.
5. Deploy `production` with cron enabled and Telegram pointed at a second chat. Run both systems in parallel.
6. After 10 consecutive weekdays where verdicts, grades and checklist results match within the model's normal variance, switch Telegram to the main chat and disable the Cloudflare cron.
7. Optional: one-off script copies historical `reports/` JSON and PNGs from KV into S3 and backfills DynamoDB, so the viewer's history starts before the cut-over.

### Open questions

- [ ] Confirm the SST major version when scaffolding; the docs now carry a "Migrate From v3" guide, so component names may differ slightly from this spec.
- [ ] Lambda durable functions are new: confirm `ctx.invoke` and per-step `retryStrategy` behave as needed in a spike before committing; Step Functions is the fallback.
- [ ] Region: Cape Town (`af-south-1`) is closer to you but is opt-in and may lack durable functions; `eu-west-1` is the default assumption.
- [ ] Do AWS egress IPs get blocked or served a different consent wall by livecharts.co.uk or TradingView? Test in step 2.
- [ ] Keep the phone brief HTML at all, or let the viewer's report route replace it?
- [ ] Fix the chart-role mismatch (Cloudflare gap #1) during the port or after cut-over?
