# Lambda Base CDK

Infrastructure for all Lambda functions in the project:

```
{project-id}-{env}-{resource}
```

Example: `CDK_PROJECT_ID=acme` (max 10 characters), `CDK_ENV=dev` → `acme-dev-jwt-authorizer-function`

## Project structure

```
cdk/
├── bin/
│   └── app.ts                 # CDK entry — creates 4 stacks, wires dependencies
├── lib/
│   ├── config/
│   │   ├── environments.config.ts    # dev / stg / prd sizing + lambdas.*
│   │   ├── load.config.ts            # CDK_PROJECT_ID + CDK_ENV + AWS_REGION → LoadedConfig
│   │   └── load-dotenv.config.ts     # Loads cdk/.env (local synth/diff)
│   ├── types/
│   │   └── config.types.ts           # EnvironmentConfig, LoadedConfig
│   ├── constants/
│   │   ├── app.constants.ts          # SERVICE_PRINCIPAL, ports, limits
│   │   └── environment.constants.ts  # Environment, ENVIRONMENT_NAMES, DEFAULT_ENVIRONMENT
│   ├── utils/
│   │   ├── naming.utils.ts          # {project-id}-{env}-{suffix}
│   │   ├── iam-roles.utils.ts
│   │   └── lambda-placeholder.utils.ts
│   └── stacks/
│       ├── vpc.stack.ts              # VPC + Lambda SG
│       ├── database.stack.ts         # RDS + Proxy
│       ├── cache.stack.ts            # Valkey
│       ├── storage.stack.ts          # S3 + CloudFront
│       ├── cognito.stack.ts          # User Pool, Identity Pool
│       ├── lambdas.stack.ts          # Lambda, API GW, AppSync, DynamoDB
│       └── step-functions.stack.ts   # Step Functions
├── assets/
│   ├── placeholder-lambda/    # Stub handler (503) — CI deploys real code
│   └── placeholder-layer/     # Stub layer — CI publishes real layer
├── .github/workflows/
│   └── cd.yml                 # Deploy infra (push develop / staging)
├── .env.example               # CDK_PROJECT_ID, CDK_ENV (local)
├── cdk.json                   # app entry, context flags
├── package.json
└── tsconfig.json
```

### Config flow

```
.env (local) or GitHub vars (CD)
    → bin/app.ts
    → load.config.ts
    → ResourceNaming
    → stacks/*
```

| File | Role |
|------|------|
| `environments.config.ts` | Infra sizing (`maxAzs`, `natGateways`, RDS, cache) + enable/disable `lambdas.*` |
| `.env` / `cd.yml` vars | `CDK_PROJECT_ID`, `CDK_ENV`, `AWS_REGION`, `AWS_ACCOUNT_ID` — selects deploy environment |
| `lambdas.stack.ts` | Single stack containing **all** Lambdas + APIs |

### Stacks

```
app.ts
 ├── VpcStack
 ├── DatabaseStack      (if database.enabled)
 ├── CacheStack         (if cache.enabled)
 ├── StorageStack       (if storage.enabled)
 ├── CognitoStack       (if cognito.enabled)
 ├── LambdasStack       (depends on Vpc + optional stacks)
 └── StepFunctionsStack (depends on LambdasStack)
```

### Lambdas in `lambdas.stack.ts`

| `lambdas.<name>.enabled` | Resource |
|--------------------------|----------|
| `jwtAuthorizer` | `jwt-authorizer-function` + Valkey env |
| `authApi` | `auth-api-function` |
| `jwtAuthorizer` + `authApi` | `auth-api` (API Gateway) |
| `deleteUser` | `delete-user-function` (RDS) |
| `publicApi` | `public-api-function` + REST API |
| `appsyncApi` | `appsync-api-function` + GraphQL API |

Lambda memory / timeout: `lambdas.common` (defaults), override per Lambda via `memoryMb` / `timeoutSec`.

### Step Functions in `step-functions.stack.ts`

| `stepFunctions.<name>.enabled` | Resource |
|----------------------------------|----------|
| `deleteUserBatch` | `delete-user-batch-sfn` + execution role (bootstrap ASL) |

CDK only creates the state machine + IAM. Real workflow: LambdaEvents CI → `update-state-machine`.

### Generated (do not commit logic)

| Directory | Description |
|---------|-------------|
| `dist/` | `tsc` output |
| `cdk.out/` | CloudFormation templates after `cdk synth` |
| `node_modules/` | Dependencies |

## Deploy (CD — GitHub Actions)

**Single path:** push branch → `cdk/.github/workflows/cd.yml`

```
push develop  →  GitHub Environment cdk-develop  →  CDK_ENV=dev
push staging  →  GitHub Environment cdk-staging  →  CDK_ENV=stg
```

Or: **Actions → CDK CD → Run workflow**

### GitHub Environment setup (first time)

Create `cdk-develop`, `cdk-staging`:

| Var / Secret | Description |
|--------------|-------------|
| `CDK_PROJECT_ID` | `{project-id}` — e.g. `acme` |
| `AWS_ACCOUNT_ID` | AWS account |
| `AWS_REGION` | e.g. `us-east-1` |
| `AWS_ROLE_TO_ASSUME` (secret) | OIDC role for CDK deploy |

Bootstrap (once per account / region) — **required before first deploy**:

Error `SSM parameter /cdk-bootstrap/hnb659fds/version not found` means bootstrap was not run for the correct account + region (`AWS_REGION` on the GitHub Environment).

Run **locally** with admin credentials (not the OIDC role):

```bash
cd cdk
# Replace ACCOUNT_ID, REGION, OIDC_ROLE_ARN to match your GitHub Environment
npx cdk bootstrap aws://ACCOUNT_ID/REGION \
  --trust arn:aws:iam::ACCOUNT_ID:role/OIDC_ROLE_NAME \
  --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

- `OIDC_ROLE_ARN` = value of secret `AWS_ROLE_TO_ASSUME` on environment `cdk-develop` / `cdk-staging`
- `--trust` lets GitHub Actions assume the `cdk-hnb659fds-*` roles (avoids warning *could not be used to assume ... lookup/file-publishing/deploy role*)
- Repeat for each account + region pair (bootstrap separately if dev/stg use different accounts)

### After CDK deploy

Copy stack outputs into GitHub Environment vars for the Lambda **code** deploy pipelines (see section at the end).

---

## Local (synth / diff only)

```bash
cd cdk
npm install
cp .env.example .env
npx cdk synth
npx cdk diff
```

## Stacks

| Stack | Contents |
|-------|----------|
| `{project-id}-{env}-Vpc` | VPC, NAT, Lambda SG |
| `{project-id}-{env}-Database` | RDS + Proxy (if `database.enabled`) |
| `{project-id}-{env}-Cache` | Valkey (if `cache.enabled`) |
| `{project-id}-{env}-Storage` | S3 + CloudFront (if `storage.enabled`) |
| `{project-id}-{env}-Cognito` | User Pool, Identity Pool |
| `{project-id}-{env}-Lambdas` | Lambda, API Gateway, AppSync, DynamoDB |
| `{project-id}-{env}-StepFunctions` | Step Functions |

Enable/disable Lambdas: `environments.config.ts` → `lambdas.<name>.enabled`  
Enable/disable Step Functions: `environments.config.ts` → `stepFunctions.<name>.enabled`

## Naming convention

| Type | Example (`acme`, `dev`) |
|------|------------------------|
| Lambda | `acme-dev-jwt-authorizer-function` |
| Auth API Gateway | `acme-dev-auth-api` |
| Public API | `acme-dev-public-api` |
| AppSync | `acme-dev-appsync-api` |
| S3 | `acme-dev-common` |

## CDK vs code — who deploys what?

CDK **only creates infra** with minimal bootstrap when CloudFormation creates resources. It does **not** deploy application code or real schemas.

| Component | CDK (infra CD) | Code CD (`LambdaAPIs` / `LambdaEvents`) |
|------------|----------------|-------------------------------------------|
| Lambda zip / handler | Stub `app.js` + `app.handler` | `update-function-code` (bundle outputs `app.js`) |
| Lambda layers | Bootstrap layer v1 in CDK; CI publishes new versions | `publish-layer-version` + attach |
| AppSync API + data source | `CfnGraphQLApi` (no schema) + Lambda data source | `start-schema-creation` + resolvers from `schema.graphql` |
| Lambda layers | Outputs layer name only | Publish layer zip |
| API Gateway routes, IAM, VPC, env | CDK | — |

**Redeploy CDK** (template unchanged for stub/bootstrap) → does **not** overwrite code or schema deployed by CI. Updates only when you change stub/bootstrap in CDK or `cdk diff` reports a change to the corresponding property.

First-time flow:

```
1. push develop → CDK deploy (infra + stub)
2. set GitHub vars from stack outputs
3. push LambdaAPIs/LambdaEvents → CI deploys code + schema
4. CDK deploy again (VPC, env changes, …) → CI code/schema remains intact
```

## Lambda code deploy (child repos)

**Code** pipelines live in `LambdaAPIs/` and `LambdaEvents/` — environment is selected by branch (`develop` / `staging`), vars come from the matching GitHub Environment.

After `cdk deploy`, set the **same output set** into vars required by the code pipeline:

| GitHub var | Example value |
|------------|---------------|
| `LAMBDA_FUNCTION_JWT_AUTHORIZER_NAME` | `acme-dev-jwt-authorizer-function` | `event-develop` / `event-staging` |
| `LAMBDA_FUNCTION_AUTH_API_NAME` | `acme-dev-auth-api-function` | `api-develop` / `api-staging` |
| `LAMBDA_FUNCTION_DELETE_USER_NAME` | `acme-dev-delete-user-function` | `event-develop` / `event-staging` |
| `LAMBDA_FUNCTION_PUBLIC_API_NAME` | `acme-dev-public-api-function` | `api-develop` / `api-staging` |
| `LAMBDA_FUNCTION_APPSYNC_NAME` | `acme-dev-appsync-api-function` |
| `APPSYNC_API_ID` | `xxxxxxxx` |
| `LAMBDA_ALIAS_NAME` | `live` |
| `STEP_FUNCTION_DELETE_USER_BATCH_NAME` | `acme-dev-delete-user-batch-sfn` |
