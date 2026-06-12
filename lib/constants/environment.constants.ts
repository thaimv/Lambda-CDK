export const Environment = {
  Dev: 'dev',
  Stg: 'stg',
  Prd: 'prd',
} as const;

export const ENVIRONMENT_NAMES = Object.values(Environment);

export const DEFAULT_ENVIRONMENT = Environment.Dev;

export const LOG_LEVEL = {
  [Environment.Dev]: 'DEBUG',
  [Environment.Stg]: 'INFO',
  [Environment.Prd]: 'INFO',
} as const;
