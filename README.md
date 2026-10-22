# FX Chart Analyst — AWS

Weekday chart capture and DeepSeek analysis for Nasdaq 100 and gold, deployed with SST. The React viewer reads analyses through an authenticated API. The Cloudflare worker keeps running until this port has matched it for 10 consecutive weekdays.

Spec and mockups live in `docs/`. Portable analysis, report, and capture-verification code is in `packages/core` and has no AWS dependency.

```
sst.config.ts
packages/core/        schema, coerce, parse, prompt, request, render, brief, range, verify
packages/functions/   Capture, DailyAnalysis, Dispatch, ReadApi
packages/web/         Vite + React viewer
```

## Stages

`dev` runs live Lambdas with the weekday cron disabled. `production` enables `cron(0 7 ? * MON-FRI *)` in UTC. Stage name is part of every resource name.

Node 22 is required (`sst` and the Lambda durable runtime). `@sparticuz/chromium@153.0.0` and `puppeteer-core@25.15.0` are pinned together.

```bash
yarn install
yarn test
yarn typecheck
npx sst secret set DeepseekApiKey <key> --stage dev
npx sst secret set TelegramBotToken <token> --stage dev
npx sst secret set TelegramChatId <id> --stage dev
npx sst secret set ViewerAllowEmail <email> --stage dev
npx sst dev
```

Region default is `eu-west-1`. SST is v4 (`sst@4.17.2`); the component names in the spec still match. Secrets are not part of the deploy pipeline.

Production cannot put the CloudFront URL and the Cognito client id in the same build graph, so the SPA reads `/config.js`, written after the distribution exists. `sst dev` injects the same public values as `VITE_*` and keeps the hosted-UI callback on `http://localhost:5173`.

Telegram links point at `/r/:asset/:date` with no token. Opening one prompts Cognito login. Images use 15-minute presigned URLs.
