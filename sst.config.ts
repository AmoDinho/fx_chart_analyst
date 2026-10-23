/// <reference path="./.sst/platform/config.d.ts" />

/**
 * SST 4 app for the AWS port. Component names follow the current sst.dev
 * reference (Workflow, CronV2, ApiGatewayV2, CognitoUserPool). eu-west-1 is
 * the default because durable functions may be missing in af-south-1.
 *
 * Production Vite env and the Cognito callback cannot reference each other,
 * so the SPA reads /config.js written after the CloudFront URL exists. Dev
 * injects the same public values as VITE_* and keeps the callback on localhost.
 */
export default $config({
  app(input) {
    return {
      name: "fx-chart-analyst-aws",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: { region: "eu-west-1" },
      },
    };
  },
  async run() {
    const production = $app.stage === "production";
    const region = aws.getRegionOutput().name;
    const devOrigin = "http://localhost:5173";

    const telegramToken = new sst.aws.Secret("TelegramBotToken");
    const telegramChat = new sst.aws.Secret("TelegramChatId");
    new sst.aws.Secret("ViewerAllowEmail");

    const bucket = new sst.aws.Bucket("Artifacts", {
      versioning: false,
      cors: false,
      lifecycle: [
        { id: "expire-drafts", prefix: "drafts/", expiresIn: "7 days" },
        { id: "expire-screenshots", prefix: "tmp/screenshots/", expiresIn: "1 day" },
      ],
    });
    const table = new sst.aws.Dynamo("Analyses", {
      fields: {
        pk: "string",
        sk: "string",
        gsi1pk: "string",
        gsi1sk: "string",
        gsi2pk: "string",
        gsi2sk: "string",
      },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
      globalIndexes: {
        gsi1: { hashKey: "gsi1pk", rangeKey: "gsi1sk" },
        gsi2: { hashKey: "gsi2pk", rangeKey: "gsi2sk" },
      },
      transform: {
        table: (args) => {
          args.billingMode = "PAY_PER_REQUEST";
        },
      },
    });
    const alerts = new sst.aws.SnsTopic("Alerts");
    const deepseekSecret = new aws.secretsmanager.Secret(
      "DeepseekApiKey",
      {
        name: $interpolate`fx-chart-analyst/${$app.stage}/DeepseekApiKey`,
        description: "DeepSeek API key. Set with put-secret-value. Deploys do not write or rotate the value.",
        recoveryWindowInDays: production ? 7 : 0,
      },
      { ignoreChanges: ["secretString"] },
    );
    const pool = new sst.aws.CognitoUserPool("Viewers", {
      usernames: ["email"],
      mfa: "on",
      softwareToken: true,
      domain: { prefix: `fx-analyst-${$app.stage}` },
      transform: {
        userPool: (args) => {
          args.adminCreateUserConfig = { allowAdminCreateUserOnly: true };
        },
      },
    });

    const capture = new sst.aws.Function("Capture", {
      handler: "packages/functions/src/capture/handler.handler",
      architecture: "x86_64",
      memory: "2048 MB",
      timeout: "3 minutes",
      storage: "1024 MB",
      link: [bucket],
      nodejs: { install: ["@sparticuz/chromium"] },
      logging: { format: "json", retention: "1 month" },
      permissions: [
        {
          actions: ["s3:GetObject", "s3:PutObject", "s3:HeadObject", "s3:CopyObject"],
          resources: [
            $interpolate`${bucket.arn}/nasdaq100/*`,
            $interpolate`${bucket.arn}/gold/*`,
            $interpolate`${bucket.arn}/tmp/*`,
          ],
        },
      ],
    });

    const site = production ? viewerSite(region, devOrigin) : undefined;
    const client = pool.addClient("Web", {
      callbackUrls: production ? [devOrigin, $interpolate`${site!.url}/auth/callback`] : [devOrigin],
      transform: {
        client: (args) => {
          args.generateSecret = false;
          args.allowedOauthFlowsUserPoolClient = true;
          args.allowedOauthFlows = ["code"];
          args.allowedOauthScopes = ["openid", "email", "profile"];
          args.supportedIdentityProviders = ["COGNITO"];
          args.explicitAuthFlows = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"];
          args.logoutUrls = production ? [devOrigin, site!.url] : [devOrigin];
        },
      },
    });

    const api = new sst.aws.ApiGatewayV2("ReadApi", {
      cors: {
        allowOrigins: production ? [site!.url] : [devOrigin],
        allowMethods: ["GET", "POST"],
        allowHeaders: ["authorization", "content-type", "accept"],
        allowCredentials: true,
      },
      transform: {
        stage: (args) => {
          args.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };
        },
      },
    });
    const authorizer = api.addAuthorizer({
      name: "Viewers",
      jwt: {
        issuer: $interpolate`https://cognito-idp.${region}.amazonaws.com/${pool.id}`,
        audiences: [client.id],
      },
    });

    const viewer = site ?? viewerSite(region, devOrigin, {
      VITE_API_URL: api.url,
      VITE_USER_POOL_ID: pool.id,
      VITE_USER_POOL_CLIENT_ID: client.id,
      VITE_REGION: region,
    });

    const workflow = new sst.aws.Workflow("DailyAnalysis", {
      handler: "packages/functions/src/daily/handler.handler",
      memory: "1024 MB",
      timeout: { invocation: "15 minutes", execution: "2 hours" },
      logging: { format: "json", retention: "1 month" },
      link: [bucket, table, capture, alerts, telegramToken, telegramChat],
      environment: { VIEWER_ORIGIN: viewer.url, DEEPSEEK_SECRET_ID: deepseekSecret.arn },
      permissions: [
        {
          actions: ["secretsmanager:GetSecretValue"],
          resources: [deepseekSecret.arn],
        },
      ],
      nodejs: { loader: { ".md": "text" } },
    });
    const dispatch = new sst.aws.Function("Dispatch", {
      handler: "packages/functions/src/dispatch/handler.handler",
      link: [workflow],
      timeout: "30 seconds",
      logging: { format: "json", retention: "1 month" },
    });
    new sst.aws.CronV2("Weekday0700", {
      schedule: "cron(0 7 ? * MON-FRI *)",
      timezone: "UTC",
      function: dispatch,
      enabled: production,
    });
    const morning = new sst.aws.Function("MorningCheck", {
      handler: "packages/functions/src/check/morning.handler",
      link: [table, alerts],
      environment: { ALERTS_TOPIC_ARN: alerts.arn },
      logging: { format: "json", retention: "1 month" },
    });
    new sst.aws.CronV2("Morning0800", {
      schedule: "cron(0 8 ? * MON-FRI *)",
      timezone: "UTC",
      function: morning,
      enabled: production,
    });

    const auth = { jwt: { authorizer: authorizer.id } };
    const readDeny = {
      effect: "deny" as const,
      actions: ["s3:PutObject", "s3:DeleteObject", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"],
      resources: ["*"],
    };
    const read = { link: [bucket, table], permissions: [readDeny], logging: { format: "json" as const, retention: "1 month" as const } };
    const routes: Array<[string, string, object]> = [
      ["GET /days", "packages/functions/src/api/days.handler", read],
      ["GET /days/{date}", "packages/functions/src/api/day.handler", read],
      ["GET /reports/{asset}/{date}", "packages/functions/src/api/report.handler", read],
      ["GET /reports/{asset}/{date}/markdown", "packages/functions/src/api/markdown.handler", read],
      ["GET /assets/{asset}/history", "packages/functions/src/api/history.handler", read],
      ["GET /runs/{date}", "packages/functions/src/api/runs.handler", read],
      ["POST /admin/run", "packages/functions/src/api/admin.run", { link: [bucket, table, dispatch], logging: read.logging }],
      ["POST /admin/analyse", "packages/functions/src/api/admin.analyse", { link: [bucket, table, dispatch], logging: read.logging }],
      ["POST /admin/screenshot", "packages/functions/src/api/admin.screenshot", { link: [bucket, table, capture], logging: read.logging }],
      ["GET /admin/screenshot/{id}", "packages/functions/src/api/admin.screenshotGet", read],
      ["GET /admin/status", "packages/functions/src/api/admin.status", { link: [bucket, table, workflow], logging: read.logging }],
    ];
    for (const [route, handler, extra] of routes) api.route(route, { handler, ...extra }, { auth });

    if (viewer.nodes.assets) {
      new aws.s3.BucketObjectv2("ViewerConfig", {
        bucket: viewer.nodes.assets.name,
        key: "config.js",
        contentType: "application/javascript",
        content: $interpolate`window.__FX_CONFIG__ = {"apiUrl":"${api.url}","userPoolId":"${pool.id}","userPoolClientId":"${client.id}","region":"${region}"};`,
      });
    }

    new aws.cloudwatch.MetricAlarm("WorkflowErrors", {
      alarmDescription: "DailyAnalysis workflow errors",
      namespace: "AWS/Lambda",
      metricName: "Errors",
      dimensions: { FunctionName: workflow.name },
      statistic: "Sum",
      period: 86400,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      alarmActions: [alerts.arn],
      treatMissingData: "notBreaching",
    });
    new aws.cloudwatch.MetricAlarm("CaptureSlow", {
      alarmDescription: "Capture p95 duration above 150s",
      namespace: "AWS/Lambda",
      metricName: "Duration",
      dimensions: { FunctionName: capture.name },
      extendedStatistic: "p95",
      period: 86400,
      evaluationPeriods: 1,
      threshold: 150000,
      comparisonOperator: "GreaterThanThreshold",
      alarmActions: [alerts.arn],
      treatMissingData: "notBreaching",
    });

    return { api: api.url, viewer: viewer.url, pool: pool.id, deepseekSecret: deepseekSecret.name };
  },
});

function viewerSite(region: $util.Output<string>, devOrigin: string, environment?: Record<string, $util.Input<string>>) {
  const csp = $interpolate`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://*.s3.${region}.amazonaws.com https://*.s3.amazonaws.com; connect-src 'self' https://*.execute-api.${region}.amazonaws.com https://cognito-idp.${region}.amazonaws.com https://*.amazoncognito.com; frame-src https://*.amazoncognito.com; object-src 'none'; base-uri 'self'`;
  return new sst.aws.StaticSite("Viewer", {
    path: "packages/web",
    build: { command: "yarn build", output: "dist" },
    dev: { command: "yarn dev", url: devOrigin },
    errorPage: "index.html",
    environment,
    edge: {
      viewerRequest: {
        injection: `var uri = event.request.uri; if (uri !== "/" && !uri.includes(".")) { event.request.uri = "/index.html"; }`,
      },
      viewerResponse: {
        injection: $interpolate`
          event.response.headers["content-security-policy"] = { value: "${csp}" };
          event.response.headers["x-content-type-options"] = { value: "nosniff" };
          event.response.headers["referrer-policy"] = { value: "no-referrer" };
        `,
      },
    },
  });
}
