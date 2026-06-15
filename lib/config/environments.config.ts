import { Environment, LOG_LEVEL } from '../constants/environment.constants';
import type { EnvironmentConfig, EnvironmentName } from '../types/config.types';

const baseConfig = (envName: EnvironmentName): EnvironmentConfig => ({
  nodeEnv: envName,
  logLevel: LOG_LEVEL[envName],
  vpc: {
    name: 'vpc',
    lambdaSecurityGroupName: 'lambda-sg',
  },
  // RDS DB subnet group requires ≥2 AZs (instance can still be single-AZ)
  maxAzs: 2,
  natGateways: 1,
  database: {
    enabled: true,
    databaseName: 'app',
    instanceType: 't4g.micro',
    engineVersion: '18',
    publiclyAccessible: false,
    rdsProxy: {
      enabled: false,
    },
  },
  cache: {
    enabled: true,
    engine: 'valkey',
    maxDataStorageGb: 1,
    maxEcpuPerSecond: 5000,
  },
  storage: {
    enabled: true,
    name: 'common',
    bucketNameSuffix: 'bucket',
    cloudFront: {
      enabled: false,
      cdnNameSuffix: 'cdn',
      commonDir: 'common',
    },
  },
  cognito: {
    enabled: true,
    userPoolNameSuffix: 'user-pool',
  },
  lambdas: {
    common: {
      nameSuffix: 'function',
      memoryMb: 256,
      timeoutSec: 30,
    },
    jwtAuthorizer: {
      enabled: true,
      name: 'jwt-authorizer',
    },
    authApi: {
      enabled: true,
      name: 'auth-api',
    },
    deleteUser: {
      enabled: true,
      name: 'delete-user',
      memoryMb: 512,
      timeoutSec: 15 * 60,
    },
    publicApi: {
      enabled: true,
      name: 'public-api',
    },
    appsyncApi: {
      enabled: true,
      name: 'appsync-api',
    },
  },
  stepFunctions: {
    common: {
      nameSuffix: 'sfn',
    },
    deleteUserBatch: {
      enabled: true,
      name: 'delete-user-batch',
      timeoutSec: 15 * 60,
    },
  },
  lambdaAliasName: 'live',
  apiGatewayStageName: 'v1',
  iamRoleNameSuffix: 'role',
  prismaLayerNameSuffix: 'prisma-layer',
  elasticacheLayerNameSuffix: 'elasticache-layer',
});

export const ENVIRONMENT_CONFIGS: Record<EnvironmentName, EnvironmentConfig> = {
  [Environment.Dev]: {
    ...baseConfig(Environment.Dev),
    database: {
      enabled: true,
      databaseName: 'app',
      instanceType: 't4g.micro',
      engineVersion: '18',
      publiclyAccessible: true,
      publicIngressCidrs: ['0.0.0.0/0'],
      rdsProxy: {
        enabled: false,
      },
    },
  },
  [Environment.Stg]: {
    ...baseConfig(Environment.Stg),
  },
  [Environment.Prd]: {
    ...baseConfig(Environment.Prd),
    maxAzs: 2,
    natGateways: 2,
    database: {
      enabled: true,
      databaseName: 'app',
      instanceType: 't4g.small',
      engineVersion: '18',
      publiclyAccessible: false,
      rdsProxy: {
        enabled: true,
      },
    },
    cache: {
      enabled: true,
      engine: 'valkey',
      maxDataStorageGb: 5,
      maxEcpuPerSecond: 10000,
    },
  },
};
