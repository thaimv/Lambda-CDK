import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { ELASTICACHE_DEFAULT_PORT } from '../constants/app.constants';
import type { LoadedConfig } from '../types/config.types';
import { ResourceNaming } from '../utils/naming.utils';

export type CacheStackProps = StackProps & {
  config: LoadedConfig;
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
};

export class CacheStack extends Stack {
  public readonly cacheEndpoint: string;
  public readonly cachePort = ELASTICACHE_DEFAULT_PORT;

  constructor(scope: Construct, id: string, props: CacheStackProps) {
    super(scope, id, props);

    const { config, vpc, lambdaSecurityGroup } = props;
    const naming = new ResourceNaming(config);

    const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSg', {
      vpc,
      securityGroupName: naming.resource('cache-sg'),
      allowAllOutbound: true,
    });

    cacheSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(ELASTICACHE_DEFAULT_PORT),
      'Lambda to Valkey',
    );

    const valkeyName = naming.resource('valkey');
    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      cacheSubnetGroupName: naming.resource('cache-subnets'),
      description: `Subnet group for ${valkeyName}`,
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
    });

    const serverlessCache = new elasticache.CfnServerlessCache(this, 'ValkeyCache', {
      engine: config.cache.engine,
      serverlessCacheName: naming.resourceLowercase('valkey'),
      securityGroupIds: [cacheSecurityGroup.securityGroupId],
      subnetIds: subnetGroup.subnetIds,
      cacheUsageLimits: {
        dataStorage: { maximum: config.cache.maxDataStorageGb, unit: 'GB' },
        ecpuPerSecond: { maximum: config.cache.maxEcpuPerSecond },
      },
    });
    serverlessCache.addDependency(subnetGroup);

    this.cacheEndpoint = serverlessCache.attrEndpointAddress;

    new CfnOutput(this, 'CacheEndpoint', {
      exportName: naming.resource(valkeyName, 'host'),
      value: this.cacheEndpoint,
    });
  }
}
