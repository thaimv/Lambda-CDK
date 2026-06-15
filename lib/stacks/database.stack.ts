import * as path from 'path';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { CfnOutput, Duration, RemovalPolicy, Stack, TimeZone, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { SERVICE_PRINCIPAL } from '../constants/app.constants';
import { Environment } from '../constants/environment.constants';
import type { DatabaseScheduleConfig, LoadedConfig } from '../types/config.types';
import { createServiceRole } from '../utils/iam-roles.utils';
import { ResourceNaming } from '../utils/naming.utils';

const resolvePostgresEngineVersion = (version: string): rds.PostgresEngineVersion => {
  switch (version) {
    case '18':
      return rds.PostgresEngineVersion.VER_18;
    case '17':
      return rds.PostgresEngineVersion.VER_17;
    case '16':
      return rds.PostgresEngineVersion.VER_16;
    default:
      throw new Error(`Unsupported PostgreSQL engine version: ${version}`);
  }
};

const createRdsSchedule = (
  scope: Construct,
  config: LoadedConfig,
  naming: ResourceNaming,
  instanceIdentifier: string,
  schedule: DatabaseScheduleConfig,
): void => {
  const schedulerFunctionName = naming.resource('rds-scheduler');
  const schedulerRole = new iam.Role(scope, 'RdsSchedulerRole', {
    roleName: naming.iamRole(schedulerFunctionName),
    assumedBy: new iam.ServicePrincipal(SERVICE_PRINCIPAL.LAMBDA),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    ],
  });
  schedulerRole.addToPolicy(
    new iam.PolicyStatement({
      actions: ['rds:DescribeDBInstances', 'rds:StopDBInstance', 'rds:StartDBInstance'],
      resources: [
        Stack.of(scope).formatArn({
          service: 'rds',
          resource: 'db',
          resourceName: instanceIdentifier,
        }),
      ],
    }),
  );

  const schedulerFn = new lambda.Function(scope, 'RdsSchedulerFn', {
    functionName: schedulerFunctionName,
    runtime: lambda.Runtime.PYTHON_3_12,
    handler: 'handler.handler',
    code: lambda.Code.fromAsset(path.join(__dirname, '../../assets/rds-scheduler')),
    role: schedulerRole,
    memorySize: 128,
    timeout: Duration.seconds(30),
    architecture: lambda.Architecture.ARM_64,
    environment: {
      DB_INSTANCE_ID: instanceIdentifier,
    },
  });

  const scheduleRole = createServiceRole(
    scope,
    'RdsScheduleInvokeRole',
    naming.iamRole(naming.resource('rds-schedule')),
    SERVICE_PRINCIPAL.SCHEDULER,
  );
  schedulerFn.grantInvoke(scheduleRole);

  const timeZone = TimeZone.of(schedule.timezone);
  const scheduleTarget = (action: 'stop' | 'start') =>
    new schedulerTargets.LambdaInvoke(schedulerFn, {
      input: scheduler.ScheduleTargetInput.fromObject({ action }),
      role: scheduleRole,
    });

  new scheduler.Schedule(scope, 'RdsStopSchedule', {
    scheduleName: naming.resource('rds-stop-schedule'),
    description: `Stop ${instanceIdentifier} (${config.stackPrefix})`,
    schedule: scheduler.ScheduleExpression.expression(`cron(${schedule.stopCron})`, timeZone),
    target: scheduleTarget('stop'),
  });

  new scheduler.Schedule(scope, 'RdsStartSchedule', {
    scheduleName: naming.resource('rds-start-schedule'),
    description: `Start ${instanceIdentifier} (${config.stackPrefix})`,
    schedule: scheduler.ScheduleExpression.expression(`cron(${schedule.startCron})`, timeZone),
    target: scheduleTarget('start'),
  });
};

export type DatabaseStackProps = StackProps & {
  config: LoadedConfig;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
};

export class DatabaseStack extends Stack {
  public readonly secret: secretsmanager.ISecret;
  /** Host for Lambda DB connection — RDS Proxy endpoint or instance hostname */
  public readonly proxyEndpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc, lambdaSecurityGroup } = props;
    const naming = new ResourceNaming(config);

    const databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
      vpc,
      securityGroupName: naming.resource('database-sg'),
      allowAllOutbound: false,
    });

    databaseSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      config.database.rdsProxy.enabled ? 'Lambda to RDS Proxy' : 'Lambda to RDS',
    );

    for (const cidr of config.database.publicIngressCidrs ?? []) {
      databaseSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(5432),
        `PostgreSQL from ${cidr}`,
      );
    }

    const rdsSecretName = naming.resource('rds-credentials');
    const credentials = new secretsmanager.Secret(this, 'RdsSecret', {
      secretName: rdsSecretName,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'dbadmin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
      },
    });
    this.secret = credentials;

    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      onePerAz: true,
    });
    const publicSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PUBLIC,
      onePerAz: true,
    });
    // Include all subnets in the DB subnet group so toggling public access does not
    // try to remove in-use private subnets from an existing group.
    const dbSubnetSelection = config.database.publiclyAccessible
      ? { subnets: [...publicSubnets.subnets, ...privateSubnets.subnets] }
      : privateSubnets;

    const instanceIdentifier = naming.resource('postgres');

    const instance = new rds.DatabaseInstance(this, 'Postgres', {
      instanceIdentifier,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: resolvePostgresEngineVersion(config.database.engineVersion),
      }),
      vpc,
      vpcSubnets: dbSubnetSelection,
      publiclyAccessible: config.database.publiclyAccessible,
      securityGroups: [databaseSecurityGroup],
      credentials: rds.Credentials.fromSecret(credentials),
      databaseName: config.database.databaseName,
      instanceType: new ec2.InstanceType(config.database.instanceType),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      removalPolicy:
        config.envName === Environment.Prd ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      deletionProtection: config.envName === Environment.Prd,
    });

    if (config.database.rdsProxy.enabled) {
      const rdsProxyName = naming.resource('rds-proxy');
      const rdsProxyRole = createServiceRole(
        this,
        'RdsProxyRole',
        naming.iamRole(rdsProxyName),
        SERVICE_PRINCIPAL.RDS,
      );

      const proxy = new rds.DatabaseProxy(this, 'RdsProxy', {
        dbProxyName: rdsProxyName,
        proxyTarget: rds.ProxyTarget.fromInstance(instance),
        secrets: [credentials],
        role: rdsProxyRole,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [databaseSecurityGroup],
        requireTLS: true,
        idleClientTimeout: Duration.minutes(30),
      });
      this.proxyEndpoint = proxy.endpoint;

      new CfnOutput(this, 'RdsProxyEndpoint', {
        exportName: naming.resource(rdsProxyName, 'endpoint'),
        value: proxy.endpoint,
      });
    } else {
      this.proxyEndpoint = instance.dbInstanceEndpointAddress;

      new CfnOutput(this, 'RdsInstanceEndpoint', {
        exportName: naming.resource('postgres', 'endpoint'),
        value: instance.dbInstanceEndpointAddress,
      });
    }

    new CfnOutput(this, 'RdsSecretArn', {
      exportName: naming.resource(rdsSecretName, 'arn'),
      value: credentials.secretArn,
    });

    if (config.database.schedule?.enabled) {
      createRdsSchedule(this, config, naming, instanceIdentifier, config.database.schedule);
    }
  }
}
