# AWS setup

Do this once per AWS account, then once per stage (`dev`, then `production`). Region is `eu-west-1`. Nothing in this list puts the DeepSeek key in git or GitHub.

You need an admin-capable AWS CLI session for the steps that create the OIDC provider and the deploy role. After that, day-to-day deploys use the role. Node 22 and Yarn are required locally.

```bash
aws sts get-caller-identity
export AWS_REGION=eu-west-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export GITHUB_REPO=AmoDinho/fx_chart_analyst
```

## 1. GitHub OIDC provider

GitHub Actions assumes a role. There is no long-lived access key in the repo.

Skip this if the provider already exists.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

The thumbprint is unused by AWS for this provider, but the API still requires one.

## 2. Deploy role

Trust is limited to this repo on `main`. Pull requests run tests only and do not assume the role. Scheduled capture checks also run from `main`, so they match the same subject.

```bash
cat > /tmp/fx-deploy-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:ref:refs/heads/main"
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name fx-chart-analyst-deploy \
  --assume-role-policy-document file:///tmp/fx-deploy-trust.json \
  --description "GitHub Actions deploy role for fx-chart-analyst"
```

SST creates Lambda roles, API Gateway, Cognito, S3, CloudFront, DynamoDB, EventBridge Scheduler, SNS, CloudWatch, and the Secrets Manager secret. A personal account can attach `AdministratorAccess` and stop here:

```bash
aws iam attach-role-policy \
  --role-name fx-chart-analyst-deploy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

If you want a tighter policy, use the one below instead of `AdministratorAccess`. `iam:PassRole` is limited to Lambda and Scheduler. If a later deploy fails with `AccessDenied`, add that one action rather than widening the trust policy.

```bash
cat > /tmp/fx-deploy-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DeployServices",
      "Effect": "Allow",
      "Action": [
        "apigateway:*",
        "cloudfront:*",
        "cloudwatch:*",
        "cognito-idp:*",
        "dynamodb:*",
        "events:*",
        "lambda:*",
        "logs:*",
        "s3:*",
        "scheduler:*",
        "secretsmanager:*",
        "sns:*",
        "ssm:*",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManageRolesThisAppCreates",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:ListInstanceProfilesForRole"
      ],
      "Resource": [
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/fx-chart-analyst-*",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/*-DailyAnalysis*",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/*-Capture*",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/*-Dispatch*",
        "arn:aws:iam::${AWS_ACCOUNT_ID}:role/*-ReadApi*"
      ]
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name fx-chart-analyst-deploy \
  --policy-name fx-chart-analyst-deploy \
  --policy-document file:///tmp/fx-deploy-policy.json
```

SST’s bootstrap bucket name is chosen on first deploy and may not match `fx-chart-analyst-*`. If the first deploy fails creating IAM roles, attach `AdministratorAccess` for that one account or widen `iam:*` on `arn:aws:iam::${AWS_ACCOUNT_ID}:role/*`.

Your laptop uses a separate identity, not this role, unless you assume it. The laptop identity needs the same deploy permissions to run `sst dev` and `sst secret set`.

## 3. GitHub secret

Repository → Settings → Secrets and variables → Actions → New repository secret.

- Name: `AWS_DEPLOY_ROLE_ARN`
- Value: `arn:aws:iam::${AWS_ACCOUNT_ID}:role/fx-chart-analyst-deploy`

That is the name in `.github/workflows/ci.yml` and `.github/workflows/capture-check.yml`. Do not add an AWS access key.

## 4. First deploy

From a laptop profile that can deploy, in this repo:

```bash
yarn install
npx sst deploy --stage dev
```

This creates the empty secret `fx-chart-analyst/dev/DeepseekApiKey` and prints `deepseekSecret`. It does not write the key. A later deploy will not overwrite a value you set, because `secretString` is ignored.

Repeat with `--stage production` when you want the weekday cron. Production and dev do not share data or secrets.

## 5. DeepSeek key in Secrets Manager

Create the key in the DeepSeek console. Then, for each stage:

```bash
aws secretsmanager put-secret-value \
  --region eu-west-1 \
  --secret-id fx-chart-analyst/dev/DeepseekApiKey \
  --secret-string 'YOUR_DEEPSEEK_KEY'
```

The secret string is the raw key, not JSON. Confirm it is current without printing it:

```bash
aws secretsmanager get-secret-value \
  --region eu-west-1 \
  --secret-id fx-chart-analyst/dev/DeepseekApiKey \
  --query '{name:Name,stage:VersionStages}' \
  --output table
```

Only the `DailyAnalysis` workflow role can call `secretsmanager:GetSecretValue` on that secret. It reads `AWSCURRENT` at the start of a run. A missing value fails the run and the error does not include the key.

Rotate by running `put-secret-value` again. No redeploy.

## 6. The other secrets

These stay in SST’s secret store. They are not in Secrets Manager.

```bash
npx sst secret set TelegramBotToken <token> --stage dev
npx sst secret set TelegramChatId <id> --stage dev
npx sst secret set ViewerAllowEmail <you@example.com> --stage dev
```

Missing Telegram secrets do not fail the morning run. The step logs `telegram.skipped`.

## 7. Cognito user

Self sign-up is off. MFA (TOTP) is required. After `sst deploy`, the output `pool` is the user pool id.

```bash
export POOL_ID=<pool id from deploy output>
export EMAIL=you@example.com

aws cognito-idp admin-create-user \
  --region eu-west-1 \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --region eu-west-1 \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --password '<a long temporary password>' \
  --permanent

aws cognito-idp create-group \
  --region eu-west-1 \
  --user-pool-id "$POOL_ID" \
  --group-name admins

aws cognito-idp admin-add-user-to-group \
  --region eu-west-1 \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --group-name admins
```

Hosted UI domain is `fx-analyst-<stage>.auth.eu-west-1.amazoncognito.com`. The first browser login enrolls the authenticator app. Without the `admins` group, Days and reports still open; Admin start buttons stay hidden.

`sst dev` uses `http://localhost:5173/auth/callback`. Production callbacks are the CloudFront origin plus that localhost URL.

## 8. Failure email

```bash
aws sns subscribe \
  --region eu-west-1 \
  --topic-arn <Alerts topic arn> \
  --protocol email \
  --notification-endpoint you@example.com
```

Confirm the email. The topic receives terminal failures, poor captures, empty citations, workflow errors, slow captures, and a missing-report check at 08:00 UTC on weekdays in production.

## 9. Run it

```bash
npx sst dev
```

Open `http://localhost:5173`, sign in, and use Admin → Full run. Cron is off in `dev`.

Production cron is `cron(0 7 ? * MON-FRI *)` UTC, which is 09:00 SAST. Push to `main` deploys production after tests, using the role from step 2.

The Monday 06:00 UTC capture check assumes the same role and runs against the `dev` stage. It does not call DeepSeek.
