import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { ELASTICACHE_DEFAULT_PORT, SERVICE_PRINCIPAL } from '../constants/app.constants';
import type { LoadedConfig } from '../types/config.types';
import { createLambdaExecutionRole, createServiceRole } from '../utils/iam-roles.utils';
import {
  createManagedLambdaLayers,
  dbLambdaEnvironment,
  elasticacheLambdaEnvironment,
  placeholderLambdaCode,
  resolveLambdaRuntimeProps,
} from '../utils/lambda-placeholder.utils';
import { ResourceNaming } from '../utils/naming.utils';

export type LambdasStackProps = StackProps & {
  config: LoadedConfig;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  rdsSecret?: secretsmanager.ISecret;
  rdsProxyEndpoint?: string;
  cacheEndpoint?: string;
  cachePort?: number;
  userPoolId?: string;
  userPoolClientId?: string;
  identityPoolId?: string;
  cognitoAuthenticatedRoleName?: string;
  s3CommonBucket?: s3.IBucket;
  cloudFrontUrl?: string;
  cloudFrontCommonDir?: string;
};

export class LambdasStack extends Stack {
  /** Alias for delete-user — exposed for Step Functions invoke permission. */
  public readonly deleteUserAlias?: lambda.Alias;

  constructor(scope: Construct, id: string, props: LambdasStackProps) {
    super(scope, id, props);

    const {
      config,
      vpc,
      lambdaSecurityGroup,
      rdsSecret,
      rdsProxyEndpoint,
      cacheEndpoint,
      cachePort = ELASTICACHE_DEFAULT_PORT,
      userPoolId,
      userPoolClientId,
      identityPoolId,
      cognitoAuthenticatedRoleName,
      s3CommonBucket,
      cloudFrontUrl,
      cloudFrontCommonDir,
    } = props;
    const naming = new ResourceNaming(config);
    const { lambdas } = config;
    const { common: lambdaCommon } = lambdas;

    const layers = createManagedLambdaLayers(this, naming, config);

    const grantS3Access = (fn: lambda.Function) => {
      s3CommonBucket?.grantReadWrite(fn);
    };

    const grantDbAccess = (fn: lambda.Function) => {
      rdsSecret?.grantRead(fn);
    };

    const lambdaVpcProps = {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSecurityGroup],
    };

    const notificationTable = new dynamodb.Table(this, 'UserNotificationTable', {
      tableName: naming.resource('user-notification'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const commonEnv: Record<string, string> = {
      NODE_ENV: config.nodeEnv,
      LOG_LEVEL: config.logLevel,
      DYNAMODB_USER_NOTIFICATION_TABLE: notificationTable.tableName,
      DYNAMODB_USER_NOTIFICATION_TABLE_LSI1: 'lsi1',
      DYNAMODB_USER_NOTIFICATION_TABLE_LSI2: 'lsi2',
    };

    if (userPoolId) {
      commonEnv.COGNITO_USER_POOL_ID = userPoolId;
      commonEnv.COGNITO_USER_POOL_CLIENT_ID = userPoolClientId ?? '';
      commonEnv.COGNITO_USER_POOL_REGION = config.region;
    }
    if (identityPoolId) {
      commonEnv.COGNITO_IDENTITY_POOL_ID = identityPoolId;
      commonEnv.TOKEN_DURATION_SECONDS = '86400';
    }
    if (s3CommonBucket) {
      commonEnv.S3_COMMON_BUCKET = s3CommonBucket.bucketName;
      commonEnv.CLOUD_FRONT_URL = cloudFrontUrl ?? '';
      commonEnv.CLOUD_FRONT_COMMON_DIR = cloudFrontCommonDir ?? 'common';
    }
    if (rdsSecret && rdsProxyEndpoint) {
      Object.assign(commonEnv, dbLambdaEnvironment(rdsProxyEndpoint, rdsSecret));
    }

    let jwtAuthorizerFunction: lambda.Function | undefined;
    let jwtAuthorizerAlias: lambda.Alias | undefined;
    let authApiFunction: lambda.Function | undefined;
    let authApiAlias: lambda.Alias | undefined;
    let deleteUserFunction: lambda.Function | undefined;

    if (lambdas.jwtAuthorizer.enabled) {
      const jwtAuthorizerFunctionName = naming.lambdaFunction(lambdas.jwtAuthorizer.name);
      const jwtAuthorizerRole = createLambdaExecutionRole(
        this,
        'JwtAuthorizerRole',
        naming.iamRole(jwtAuthorizerFunctionName),
      );

      jwtAuthorizerFunction = new lambda.Function(this, 'JwtAuthorizerFn', {
        role: jwtAuthorizerRole,
        functionName: jwtAuthorizerFunctionName,
        ...resolveLambdaRuntimeProps(lambdaCommon, lambdas.jwtAuthorizer),
        code: placeholderLambdaCode(),
        layers: [layers.prisma, layers.elasticache],
        environment: {
          ...commonEnv,
          ...elasticacheLambdaEnvironment(cacheEndpoint ?? 'localhost', cachePort),
        },
        ...lambdaVpcProps,
      });
      grantDbAccess(jwtAuthorizerFunction);
      grantS3Access(jwtAuthorizerFunction);

      jwtAuthorizerAlias = new lambda.Alias(this, 'JwtAuthorizerAlias', {
        aliasName: config.lambdaAliasName,
        version: jwtAuthorizerFunction.currentVersion,
      });

      new CfnOutput(this, 'JwtAuthorizerFnName', {
        exportName: naming.resource(jwtAuthorizerFunctionName, 'name'),
        value: jwtAuthorizerFunctionName,
      });
    }

    if (lambdas.authApi.enabled) {
      const authApiFunctionName = naming.lambdaFunction(lambdas.authApi.name);
      const authApiRole = createLambdaExecutionRole(
        this,
        'AuthApiRole',
        naming.iamRole(authApiFunctionName),
      );

      authApiFunction = new lambda.Function(this, 'AuthApiFn', {
        role: authApiRole,
        functionName: authApiFunctionName,
        ...resolveLambdaRuntimeProps(lambdaCommon, lambdas.authApi),
        code: placeholderLambdaCode(),
        environment: commonEnv,
        ...lambdaVpcProps,
      });
      grantS3Access(authApiFunction);

      authApiAlias = new lambda.Alias(this, 'AuthApiAlias', {
        aliasName: config.lambdaAliasName,
        version: authApiFunction.currentVersion,
      });

      new CfnOutput(this, 'AuthApiFnName', {
        exportName: naming.resource(authApiFunctionName, 'name'),
        value: authApiFunctionName,
      });
    }

    if (authApiAlias && jwtAuthorizerAlias) {
      const authApiName = naming.resource('auth-api');
      const authApi = new apigateway.RestApi(this, 'AuthRestApi', {
        restApiName: authApiName,
        deployOptions: { stageName: config.apiGatewayStageName },
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
          allowHeaders: ['Content-Type', 'Authorization', 'Cookie', 'x-api-key'],
        },
      });

      const authorizer = new apigateway.RequestAuthorizer(this, 'JwtRequestAuthorizer', {
        handler: jwtAuthorizerAlias,
        identitySources: [apigateway.IdentitySource.header('Cookie')],
        resultsCacheTtl: Duration.minutes(5),
      });

      authApi.root
        .addResource('auth')
        .addResource('credential')
        .addMethod('POST', new apigateway.LambdaIntegration(authApiAlias), {
          authorizer,
          authorizationType: apigateway.AuthorizationType.CUSTOM,
          apiKeyRequired: true,
        });

      const apiKey = authApi.addApiKey('AuthApiKey', {
        apiKeyName: naming.resource('auth-api-key'),
      });
      const usagePlan = authApi.addUsagePlan('AuthUsagePlan', {
        name: naming.resource('auth-usage-plan'),
      });
      usagePlan.addApiKey(apiKey);
      usagePlan.addApiStage({ stage: authApi.deploymentStage });

      new CfnOutput(this, 'AuthApiUrl', {
        exportName: naming.resource(authApiName, 'url'),
        value: authApi.url,
      });
    }

    if (lambdas.deleteUser.enabled) {
      const deleteUserFunctionName = naming.lambdaFunction(lambdas.deleteUser.name);
      const deleteUserRole = createLambdaExecutionRole(
        this,
        'DeleteUserRole',
        naming.iamRole(deleteUserFunctionName),
      );

      deleteUserFunction = new lambda.Function(this, 'DeleteUserFn', {
        role: deleteUserRole,
        functionName: deleteUserFunctionName,
        ...resolveLambdaRuntimeProps(lambdaCommon, lambdas.deleteUser),
        code: placeholderLambdaCode(),
        layers: [layers.prisma],
        environment: {
          ...commonEnv,
          DELETE_USER_SOFT_DELETE_RETENTION_YEARS: '1',
        },
        ...lambdaVpcProps,
      });
      grantDbAccess(deleteUserFunction);
      grantS3Access(deleteUserFunction);

      this.deleteUserAlias = new lambda.Alias(this, 'DeleteUserAlias', {
        aliasName: config.lambdaAliasName,
        version: deleteUserFunction.currentVersion,
      });

      if (config.stepFunctions.deleteUserBatch.enabled) {
        const stateMachineName = naming.stepFunction(config.stepFunctions.deleteUserBatch.name);
        this.deleteUserAlias.addPermission('AllowDeleteUserBatchSfnInvoke', {
          principal: new iam.ServicePrincipal(SERVICE_PRINCIPAL.STATES),
          action: 'lambda:InvokeFunction',
          sourceArn: Stack.of(this).formatArn({
            service: 'states',
            resource: 'stateMachine',
            resourceName: stateMachineName,
          }),
        });
      }

      new CfnOutput(this, 'DeleteUserFnName', {
        exportName: naming.resource(deleteUserFunctionName, 'name'),
        value: deleteUserFunctionName,
      });
    }

    if (lambdas.publicApi.enabled) {
      const publicApiFunctionName = naming.lambdaFunction(lambdas.publicApi.name);
      const publicApiRole = createLambdaExecutionRole(
        this,
        'PublicApiRole',
        naming.iamRole(publicApiFunctionName),
      );

      const publicApiFunction = new lambda.Function(this, 'PublicApiFn', {
        role: publicApiRole,
        functionName: publicApiFunctionName,
        ...resolveLambdaRuntimeProps(lambdaCommon, lambdas.publicApi),
        code: placeholderLambdaCode(),
        layers: [layers.prisma],
        environment: commonEnv,
        ...lambdaVpcProps,
      });
      grantDbAccess(publicApiFunction);
      notificationTable.grantReadWriteData(publicApiFunction);
      grantS3Access(publicApiFunction);

      const publicApiAlias = new lambda.Alias(this, 'PublicApiAlias', {
        aliasName: config.lambdaAliasName,
        version: publicApiFunction.currentVersion,
      });

      const publicApiName = naming.resource('public-api');
      const publicApi = new apigateway.RestApi(this, 'PublicApi', {
        restApiName: publicApiName,
        deployOptions: { stageName: config.apiGatewayStageName },
      });

      publicApi.root
        .addResource('{proxy+}')
        .addMethod('ANY', new apigateway.LambdaIntegration(publicApiAlias), {
          authorizationType: apigateway.AuthorizationType.IAM,
          apiKeyRequired: true,
        });

      const publicApiKey = publicApi.addApiKey('PublicApiKey', {
        apiKeyName: naming.resource('public-api-key'),
      });
      const publicUsagePlan = publicApi.addUsagePlan('PublicUsagePlan', {
        name: naming.resource('public-usage-plan'),
      });
      publicUsagePlan.addApiKey(publicApiKey);
      publicUsagePlan.addApiStage({ stage: publicApi.deploymentStage });

      if (cognitoAuthenticatedRoleName) {
        new iam.CfnPolicy(this, 'CognitoPublicApiInvokePolicy', {
          policyName: naming.resource('cognito-public-api-invoke'),
          roles: [cognitoAuthenticatedRoleName],
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'execute-api:Invoke',
                Resource: publicApi.arnForExecuteApi('*', '/*', config.apiGatewayStageName),
              },
            ],
          },
        });
      }

      new CfnOutput(this, 'PublicApiUrl', {
        exportName: naming.resource(publicApiName, 'url'),
        value: publicApi.url,
      });

      new CfnOutput(this, 'PublicApiFnName', {
        exportName: naming.resource(publicApiFunctionName, 'name'),
        value: publicApiFunctionName,
      });
    }

    if (lambdas.appsyncApi.enabled) {
      const appsyncApiFunctionName = naming.lambdaFunction(lambdas.appsyncApi.name);
      const appsyncApiRole = createLambdaExecutionRole(
        this,
        'AppsyncApiRole',
        naming.iamRole(appsyncApiFunctionName),
      );

      const appsyncApiFunction = new lambda.Function(this, 'AppsyncApiFn', {
        role: appsyncApiRole,
        functionName: appsyncApiFunctionName,
        ...resolveLambdaRuntimeProps(lambdaCommon, lambdas.appsyncApi),
        code: placeholderLambdaCode(),
        layers: [layers.prisma],
        environment: commonEnv,
        ...lambdaVpcProps,
      });
      grantDbAccess(appsyncApiFunction);
      notificationTable.grantReadWriteData(appsyncApiFunction);
      grantS3Access(appsyncApiFunction);

      const appsyncApiAlias = new lambda.Alias(this, 'AppsyncApiAlias', {
        aliasName: config.lambdaAliasName,
        version: appsyncApiFunction.currentVersion,
      });

      const appsyncApiName = naming.resource('appsync-api');
      const cfnGraphqlApi = new appsync.CfnGraphQLApi(this, 'GraphqlApi', {
        name: appsyncApiName,
        authenticationType: 'AWS_IAM',
      });

      if (cognitoAuthenticatedRoleName) {
        new iam.CfnPolicy(this, 'CognitoAppSyncGraphqlPolicy', {
          policyName: naming.resource('cognito-appsync-graphql'),
          roles: [cognitoAuthenticatedRoleName],
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'appsync:GraphQL',
                Resource: `${cfnGraphqlApi.attrArn}/*`,
              },
            ],
          },
        });
      }

      const graphqlApi = appsync.GraphqlApi.fromGraphqlApiAttributes(this, 'GraphqlApiRef', {
        graphqlApiId: cfnGraphqlApi.attrApiId,
      });

      const appsyncLambdaDsName = naming.resource('appsync-lambda-ds');
      const appsyncLambdaDsRole = createServiceRole(
        this,
        'AppsyncLambdaDsRole',
        naming.iamRole(appsyncLambdaDsName),
        SERVICE_PRINCIPAL.APPSYNC,
      );
      appsyncApiAlias.grantInvoke(appsyncLambdaDsRole);

      new appsync.LambdaDataSource(this, 'AppsyncLambdaDs', {
        api: graphqlApi,
        lambdaFunction: appsyncApiAlias,
        serviceRole: appsyncLambdaDsRole,
      });

      new CfnOutput(this, 'AppsyncApiId', {
        exportName: naming.resource(appsyncApiName, 'id'),
        value: cfnGraphqlApi.attrApiId,
      });

      new CfnOutput(this, 'AppsyncGraphqlUrl', {
        exportName: naming.resource(appsyncApiName, 'graphql-url'),
        value: cfnGraphqlApi.attrGraphQlUrl,
      });

      new CfnOutput(this, 'AppsyncApiFnName', {
        exportName: naming.resource(appsyncApiFunctionName, 'name'),
        value: appsyncApiFunctionName,
      });
    }

    const lambdaAliasName = naming.resource('lambda-alias');
    new CfnOutput(this, 'LambdaAliasName', {
      exportName: naming.resource(lambdaAliasName, 'name'),
      value: config.lambdaAliasName,
    });

    const prismaLayerName = naming.resource(config.prismaLayerNameSuffix);
    new CfnOutput(this, 'PrismaLayerName', {
      exportName: naming.resource(prismaLayerName, 'name'),
      value: prismaLayerName,
    });

    const elasticacheLayerName = naming.resource(config.elasticacheLayerNameSuffix);
    new CfnOutput(this, 'ElastiCacheLayerName', {
      exportName: naming.resource(elasticacheLayerName, 'name'),
      value: elasticacheLayerName,
    });
  }
}
