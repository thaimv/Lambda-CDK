#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { loadEnvironmentConfig } from '../lib/config/load.config';
import { DEFAULT_ENVIRONMENT } from '../lib/constants/environment.constants';
import { loadDotenv } from '../lib/config/load-dotenv.config';
import { ResourceNaming } from '../lib/utils/naming.utils';
import { CacheStack } from '../lib/stacks/cache.stack';
import { CognitoStack } from '../lib/stacks/cognito.stack';
import { DatabaseStack } from '../lib/stacks/database.stack';
import { LambdasStack } from '../lib/stacks/lambdas.stack';
import { StepFunctionsStack } from '../lib/stacks/step-functions.stack';
import { StorageStack } from '../lib/stacks/storage.stack';
import { VpcStack } from '../lib/stacks/vpc.stack';

loadDotenv();

const envName = process.env.CDK_ENV?.trim() ?? DEFAULT_ENVIRONMENT;
const projectId = process.env.CDK_PROJECT_ID?.trim() ?? '';
const awsRegion = process.env.AWS_REGION?.trim() ?? '';
const awsAccountId = process.env.AWS_ACCOUNT_ID?.trim() ?? '';
const config = loadEnvironmentConfig(envName, projectId, awsRegion, awsAccountId);
const naming = new ResourceNaming(config);
const app = new cdk.App();

const awsEnv: cdk.Environment = {
  account: config.accountId,
  region: config.region,
};

const vpc = new VpcStack(app, naming.resource('Vpc'), {
  config,
  env: awsEnv,
  description: `${config.stackPrefix} VPC`,
});

let database: DatabaseStack | undefined;
if (config.database.enabled) {
  database = new DatabaseStack(app, naming.resource('Database'), {
    config,
    vpc: vpc.vpc,
    lambdaSecurityGroup: vpc.lambdaSecurityGroup,
    env: awsEnv,
    description: `${config.stackPrefix} RDS + Proxy`,
  });
  database.addDependency(vpc);
}

let cache: CacheStack | undefined;
if (config.cache.enabled) {
  cache = new CacheStack(app, naming.resource('Cache'), {
    config,
    vpc: vpc.vpc,
    lambdaSecurityGroup: vpc.lambdaSecurityGroup,
    env: awsEnv,
    description: `${config.stackPrefix} Valkey`,
  });
  cache.addDependency(vpc);
}

let storage: StorageStack | undefined;
if (config.storage.enabled) {
  storage = new StorageStack(app, naming.resource('Storage'), {
    config,
    env: awsEnv,
    description: `${config.stackPrefix} S3${config.storage.cloudFront.enabled ? ' + CloudFront' : ''}`,
  });
}

let cognito: CognitoStack | undefined;
if (config.cognito.enabled) {
  cognito = new CognitoStack(app, naming.resource('Cognito'), {
    config,
    env: awsEnv,
    description: `${config.stackPrefix} Cognito User Pool + Identity Pool`,
  });
}

const lambdas = new LambdasStack(app, naming.resource('Lambdas'), {
  config,
  vpc: vpc.vpc,
  lambdaSecurityGroup: vpc.lambdaSecurityGroup,
  rdsSecret: database?.secret,
  rdsProxyEndpoint: database?.proxyEndpoint,
  cacheEndpoint: cache?.cacheEndpoint,
  cachePort: cache?.cachePort,
  userPoolId: cognito?.userPool.userPoolId,
  userPoolClientId: cognito?.userPoolClient.userPoolClientId,
  identityPoolId: cognito?.identityPool.ref,
  cognitoAuthenticatedRoleName: cognito
    ? naming.iamRole(naming.resource('cognito-authenticated'))
    : undefined,
  s3CommonBucket: storage?.s3CommonBucket,
  cloudFrontUrl: storage?.cloudFrontUrl,
  cloudFrontCommonDir: storage?.cloudFrontCommonDir,
  env: awsEnv,
  description: `${config.stackPrefix} Lambdas`,
});
lambdas.addDependency(vpc);
if (database) lambdas.addDependency(database);
if (cache) lambdas.addDependency(cache);
if (storage) lambdas.addDependency(storage);
if (cognito) lambdas.addDependency(cognito);

const stepFunctions = new StepFunctionsStack(app, naming.resource('StepFunctions'), {
  config,
  deleteUserAlias: lambdas.deleteUserAlias,
  env: awsEnv,
  description: `${config.stackPrefix} Step Functions`,
});
stepFunctions.addDependency(lambdas);

app.synth();
