import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { SERVICE_PRINCIPAL, STEPFUNCTION } from '../constants/app.constants';
import type { LoadedConfig } from '../types/config.types';
import { createServiceRole } from '../utils/iam-roles.utils';
import { ResourceNaming } from '../utils/naming.utils';

/** Bootstrap ASL only — LambdaEvents CI deploys the real workflow via update-state-machine. */
const BOOTSTRAP_DEFINITION = JSON.stringify({
  Comment: 'Bootstrap — deploy workflow via CI',
  StartAt: 'Placeholder',
  States: {
    Placeholder: { Type: 'Pass', End: true },
  },
});

export type StepFunctionsStackProps = StackProps & {
  config: LoadedConfig;
  /** Real alias from LambdasStack — grantInvoke adds AWS::Lambda::Permission on the function. */
  deleteUserAlias?: lambda.IAlias;
};

export class StepFunctionsStack extends Stack {
  constructor(scope: Construct, id: string, props: StepFunctionsStackProps) {
    super(scope, id, props);

    const { config, deleteUserAlias } = props;
    const naming = new ResourceNaming(config);

    const deleteUserBatch = config.stepFunctions.deleteUserBatch;
    const deleteUserLambda = config.lambdas.deleteUser;
    if (deleteUserBatch.enabled && deleteUserLambda.enabled) {
      if (!deleteUserAlias) {
        throw new Error(
          'deleteUserAlias is required when deleteUserBatch and deleteUser are enabled',
        );
      }

      const stateMachineName = naming.stepFunction(deleteUserBatch.name);

      const role = createServiceRole(
        this,
        'DeleteUserBatchSmRole',
        naming.iamRole(stateMachineName),
        SERVICE_PRINCIPAL.STATES,
      );

      deleteUserAlias.grantInvoke(role);

      new sfn.CfnStateMachine(this, 'DeleteUserBatchSm', {
        stateMachineName,
        roleArn: role.roleArn,
        definitionString: BOOTSTRAP_DEFINITION,
        stateMachineType: STEPFUNCTION.STANDARD,
      });

      new CfnOutput(this, 'DeleteUserBatchSfnName', {
        exportName: naming.resource(stateMachineName, 'name'),
        value: stateMachineName,
      });
    }
  }
}
