import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

import { SERVICE_PRINCIPAL } from '../constants/app.constants';

export const createLambdaExecutionRole = (
  scope: Construct,
  id: string,
  roleName: string,
): iam.Role =>
  new iam.Role(scope, id, {
    roleName,
    assumedBy: new iam.ServicePrincipal(SERVICE_PRINCIPAL.LAMBDA),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
    ],
  });

export const createServiceRole = (
  scope: Construct,
  id: string,
  roleName: string,
  servicePrincipal: string,
): iam.Role =>
  new iam.Role(scope, id, {
    roleName,
    assumedBy: new iam.ServicePrincipal(servicePrincipal),
  });
