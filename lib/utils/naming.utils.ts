import type { LoadedConfig } from '../types/config.types';

/**
 * Central naming: {project-id}-{env}-{...parts}
 *
 * Formats:
 *   resource(...)          → acme-dev-{parts}     (kebab-case)
 *   resourceLowercase(...) → acmedev{parts}       (no separators)
 *
 * Patterns:
 *   s3Bucket / lambdaFunction / stepFunction / cdnDistribution / iamRole
 *   Export: resource(fullResourceName, 'name')
 */
export class ResourceNaming {
  constructor(private readonly config: LoadedConfig) {}

  /** acme-dev-{...parts} (kebab-case), or {fullResourceName}-{suffix} when first part already has prefix */
  resource(...parts: string[]): string {
    const [first, ...rest] = parts;
    if (rest.length > 0 && first.startsWith(`${this.config.stackPrefix}-`)) {
      return [first, ...rest].join('-');
    }
    return [this.config.stackPrefix, ...parts].join('-');
  }

  /** acme-dev-{parts} → acmedev{parts} */
  resourceLowercase(...parts: string[]): string {
    return this.resource(...parts).replace(/-/g, '');
  }

  /** acme-dev-{name}-{lambdaSuffix} */
  lambdaFunction(name: string): string {
    return this.resource(name, this.config.lambdas.common.nameSuffix);
  }

  /** acme-dev-{name}-{sfnSuffix} */
  stepFunction(name: string): string {
    return this.resource(name, this.config.stepFunctions.common.nameSuffix);
  }

  /** acme-dev-{name}-{accountId}-bucket */
  s3Bucket(name: string): string {
    return this.resource(name, this.config.accountId, this.config.storage.bucketNameSuffix);
  }

  /** acme-dev-{name}-{cdnSuffix} */
  cdnDistribution(name: string): string {
    return this.resource(name, this.config.storage.cloudFront.cdnNameSuffix);
  }

  /** {resourceName}-{roleSuffix}, e.g. iamRole(stepFunction(name)) */
  iamRole(resourceName: string): string {
    return `${resourceName}-${this.config.iamRoleNameSuffix}`;
  }

}
