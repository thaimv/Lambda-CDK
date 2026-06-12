import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { LoadedConfig } from '../types/config.types';
import { ResourceNaming } from '../utils/naming.utils';

export type StorageStackProps = StackProps & {
  config: LoadedConfig;
};

export class StorageStack extends Stack {
  public readonly s3CommonBucket: s3.IBucket;
  public readonly cloudFrontUrl: string;
  public readonly cloudFrontCommonDir: string;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;
    const naming = new ResourceNaming(config);
    const { cloudFront: cloudFrontConfig } = config.storage;

    const commonBucketName = naming.s3Bucket(config.storage.name);
    const bucket = new s3.Bucket(this, 'CommonBucket', {
      bucketName: commonBucketName.toLowerCase(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.s3CommonBucket = bucket;
    this.cloudFrontUrl = '';
    this.cloudFrontCommonDir = cloudFrontConfig.commonDir;

    new CfnOutput(this, 'S3CommonBucketName', {
      exportName: naming.resource(commonBucketName, 'name'),
      value: bucket.bucketName,
    });

    if (cloudFrontConfig.enabled) {
      const commonCdnName = naming.cdnDistribution(config.storage.name);
      const distribution = new cloudfront.Distribution(this, 'CommonCdn', {
        comment: `${commonCdnName} shared assets`,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      });

      this.cloudFrontUrl = `https://${distribution.distributionDomainName}`;

      new CfnOutput(this, 'CloudFrontUrl', {
        exportName: naming.resource(commonCdnName, 'url'),
        value: this.cloudFrontUrl,
      });

      new CfnOutput(this, 'CloudFrontCommonDir', {
        exportName: naming.resource(commonCdnName, 'common-dir'),
        value: this.cloudFrontCommonDir,
      });
    }
  }
}
