import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { LoadedConfig } from '../types/config.types';
import { ResourceNaming } from '../utils/naming.utils';

export type VpcStackProps = StackProps & {
  config: LoadedConfig;
};

export class VpcStack extends Stack {
  public readonly vpc: ec2.IVpc;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    const { config } = props;
    const naming = new ResourceNaming(config);
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: naming.resource(config.vpc.name),
      maxAzs: config.maxAzs,
      natGateways: config.natGateways,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      securityGroupName: naming.resource(config.vpc.lambdaSecurityGroupName),
      allowAllOutbound: true,
    });
  }
}
