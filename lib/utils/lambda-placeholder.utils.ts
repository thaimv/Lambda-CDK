import * as path from 'path';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Duration } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { LambdaCommonConfig, LambdaFunctionConfig, LoadedConfig } from '../types/config.types';
import { ResourceNaming } from './naming.utils';

export const LAMBDA_HANDLER = 'app.handler';

/** Immutable stub — only used when CloudFormation creates the function. CI owns real code. */
export const placeholderLambdaCode = (): lambda.Code =>
  lambda.Code.fromAsset(path.join(__dirname, '../../assets/placeholder-lambda'));

export const defaultLambdaProps = (memoryMb: number, timeoutSec: number) => ({
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: LAMBDA_HANDLER,
  memorySize: memoryMb,
  timeout: Duration.seconds(timeoutSec),
});

export const resolveLambdaRuntimeProps = (
  common: LambdaCommonConfig,
  fn: LambdaFunctionConfig,
) =>
  defaultLambdaProps(fn.memoryMb ?? common.memoryMb, fn.timeoutSec ?? common.timeoutSec);

export const dbLambdaEnvironment = (
  rdsProxyEndpoint: string,
  rdsSecret: secretsmanager.ISecret,
): Record<string, string> => ({
  RDS_PROXY_ENDPOINT: rdsProxyEndpoint,
  RDS_PROXY_ENDPOINT_REPLICA: rdsProxyEndpoint,
  RDS_SECRET_ARN: rdsSecret.secretArn,
});

export const elasticacheLambdaEnvironment = (
  cacheEndpoint: string,
  cachePort: number,
): Record<string, string> => ({
  ELASTICACHE_HOST: cacheEndpoint,
  ELASTICACHE_PORT: String(cachePort),
  ELASTICACHE_CLUSTER_MODE: 'false',
  ELASTICACHE_USE_TLS: 'true',
  ELASTICACHE_TTL: '86400',
  ELASTICACHE_SLIDING_EXPIRATION: 'true',
  ELASTICACHE_CONNECTION_TIMEOUT_MS: '10000',
});

export type ManagedLambdaLayers = {
  prisma: lambda.ILayerVersion;
  elasticache: lambda.ILayerVersion;
};

export const createManagedLambdaLayers = (
  scope: Construct,
  naming: ResourceNaming,
  config: LoadedConfig,
): ManagedLambdaLayers => {
  const placeholderLayerCode = lambda.Code.fromAsset(
    path.join(__dirname, '../../assets/placeholder-layer'),
  );

  const prisma = new lambda.LayerVersion(scope, 'PrismaLayer', {
    layerVersionName: naming.resource(config.prismaLayerNameSuffix),
    code: placeholderLayerCode,
    compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
    description: 'Bootstrap — CI publishes real Prisma layer versions',
  });

  const elasticache = new lambda.LayerVersion(scope, 'ElastiCacheLayer', {
    layerVersionName: naming.resource(config.elasticacheLayerNameSuffix),
    code: placeholderLayerCode,
    compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
    description: 'Bootstrap — CI publishes real ElastiCache layer versions',
  });

  return { prisma, elasticache };
};
