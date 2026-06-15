/** Max length for CDK_PROJECT_ID — keeps derived AWS resource names within service limits */
export const PROJECT_ID_MAX_LENGTH = 10;

export const ELASTICACHE_DEFAULT_PORT = 6379;

export const STEPFUNCTION = {
  STANDARD: 'STANDARD',
} as const;

export const SERVICE_PRINCIPAL = {
  LAMBDA: 'lambda.amazonaws.com',
  RDS: 'rds.amazonaws.com',
  APPSYNC: 'appsync.amazonaws.com',
  SCHEDULER: 'scheduler.amazonaws.com',
  STATES: 'states.amazonaws.com',
} as const;
