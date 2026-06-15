import { Environment } from '../constants/environment.constants';

export type EnvironmentName = (typeof Environment)[keyof typeof Environment];

export type LambdaCommonConfig = {
  /** Resource name suffix, e.g. jwt-authorizer → {prefix}-jwt-authorizer-function */
  nameSuffix: string;
  memoryMb: number;
  timeoutSec: number;
};

export type LambdaFunctionConfig = {
  enabled: boolean;
  /** AWS name segment: {prefix}-{name}-function */
  name: string;
  memoryMb?: number;
  timeoutSec?: number;
};

export type LambdasConfig = {
  common: LambdaCommonConfig;
  jwtAuthorizer: LambdaFunctionConfig;
  authApi: LambdaFunctionConfig;
  deleteUser: LambdaFunctionConfig;
  publicApi: LambdaFunctionConfig;
  appsyncApi: LambdaFunctionConfig;
};

export type StepFunctionsCommonConfig = {
  /** Resource name suffix, e.g. delete-user-batch → {prefix}-delete-user-batch-sfn */
  nameSuffix: string;
};

export type StepFunctionConfig = {
  enabled: boolean;
  /** State machine name segment, e.g. delete-user-batch → {prefix}-delete-user-batch-sfn */
  name: string;
  timeoutSec?: number;
};

export type StepFunctionsConfig = {
  common: StepFunctionsCommonConfig;
  deleteUserBatch: StepFunctionConfig;
};

export type DatabaseScheduleConfig = {
  enabled: boolean;
  /** IANA timezone, e.g. Asia/Ho_Chi_Minh */
  timezone: string;
  /** EventBridge cron fields, e.g. 0 20 * * ? * */
  stopCron: string;
  startCron: string;
};

export type DatabaseEngine = 'rds' | 'aurora-serverless-v2';

export type DatabaseConfig = {
  enabled: boolean;
  /** `rds` = dev (provisioned instance); `aurora-serverless-v2` = stg/prd */
  engine: DatabaseEngine;
  databaseName: string;
  /** PostgreSQL major version — RDS/Aurora 16–18 (Aurora 18 → 18.3) */
  engineVersion: string;
  /** Provisioned RDS only */
  instanceType?: string;
  /** Aurora Serverless v2 only — ACU min/max */
  serverlessV2?: {
    minCapacity: number;
    maxCapacity: number;
  };
  /** Provisioned RDS only — Aurora is always private in VPC */
  publiclyAccessible: boolean;
  /** Security group ingress CIDRs for PostgreSQL, e.g. dev `['0.0.0.0/0']` for DBeaver/psql */
  publicIngressCidrs?: string[];
  rdsProxy: {
    enabled: boolean;
  };
  /** Aurora only — enables RDS Query Editor via Data API */
  dataApi?: {
    enabled: boolean;
  };
  /** Dev-only — loaded from .env (RDS_SCHEDULE_*). Omitted on stg/prd. */
  schedule?: DatabaseScheduleConfig;
};

export type EnvironmentConfig = {
  account?: string;
  nodeEnv: EnvironmentName;
  logLevel: string;
  vpc: {
    /** AWS name segment → {prefix}-vpc */
    name: string;
    lambdaSecurityGroupName: string;
  };
  /** VPC spans this many Availability Zones (1 = cheaper dev, 2 = HA) */
  maxAzs: number;
  natGateways: number;
  database: DatabaseConfig;
  cache: {
    enabled: boolean;
    engine: 'valkey' | 'redis';
    /** Serverless cache max storage GB */
    maxDataStorageGb: number;
    /** Serverless cache max ECPU */
    maxEcpuPerSecond: number;
  };
  storage: {
    enabled: boolean;
    /** Bucket name segment, e.g. common → {prefix}-common-bucket */
    name: string;
    bucketNameSuffix: string;
    cloudFront: {
      enabled: boolean;
      /** CDN name segment, e.g. common → {prefix}-common-cdn */
      cdnNameSuffix: string;
      /** Prefix path on CloudFront for shared assets (CLOUD_FRONT_COMMON_DIR) */
      commonDir: string;
    };
  };
  cognito: {
    enabled: boolean;
    userPoolNameSuffix: string;
  };
  lambdas: LambdasConfig;
  stepFunctions: StepFunctionsConfig;
  lambdaAliasName: string;
  /** API Gateway deployment stage in URL path, e.g. /v1/auth/credential */
  apiGatewayStageName: string;
  /** IAM role name suffix, e.g. jwt-authorizer-function → {prefix}-jwt-authorizer-function-role */
  iamRoleNameSuffix: string;
  prismaLayerNameSuffix: string;
  elasticacheLayerNameSuffix: string;
};

export type LoadedConfig = EnvironmentConfig & {
  /** From AWS_REGION in .env / GitHub vars */
  region: string;
  /** From AWS_ACCOUNT_ID / CDK_DEFAULT_ACCOUNT — used in S3 bucket naming */
  accountId: string;
  /** From CDK_PROJECT_ID in .env, e.g. acme → acme-dev-public-api-function */
  projectId: string;
  envName: EnvironmentName;
  stackPrefix: string;
};
