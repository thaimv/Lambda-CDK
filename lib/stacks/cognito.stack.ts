import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { Environment } from '../constants/environment.constants';
import type { LoadedConfig } from '../types/config.types';
import { ResourceNaming } from '../utils/naming.utils';

export type CognitoStackProps = StackProps & {
  config: LoadedConfig;
};

export class CognitoStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly authenticatedRole: iam.Role;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const { config } = props;
    const naming = new ResourceNaming(config);

    const userPoolName = naming.resource(config.cognito.userPoolNameSuffix);
    const appClientName = naming.resource('app-client');
    const identityPoolName = naming.resource('identity-pool');

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName,
      selfSignUpEnabled: false,
      signInAliases: { email: true, username: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy:
        config.envName === Environment.Prd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('AppClient', {
      userPoolClientName: appClientName,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });

    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    const authenticatedRoleName = naming.iamRole(naming.resource('cognito-authenticated'));
    this.authenticatedRole = new iam.Role(this, 'CognitoAuthenticatedRole', {
      roleName: authenticatedRoleName,
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });

    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: this.authenticatedRole.roleArn,
      },
    });

    new CfnOutput(this, 'UserPoolId', {
      exportName: naming.resource(userPoolName, 'id'),
      value: this.userPool.userPoolId,
    });

    new CfnOutput(this, 'UserPoolClientId', {
      exportName: naming.resource(appClientName, 'id'),
      value: this.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, 'IdentityPoolId', {
      exportName: naming.resource(identityPoolName, 'id'),
      value: this.identityPool.ref,
    });

    new CfnOutput(this, 'CognitoLoginProvider', {
      exportName: naming.resource(userPoolName, 'login-provider'),
      value: this.userPool.userPoolProviderName,
    });

    new CfnOutput(this, 'CognitoAuthenticatedRoleArn', {
      exportName: naming.resource('cognito-authenticated', 'role-arn'),
      value: this.authenticatedRole.roleArn,
    });
  }
}
