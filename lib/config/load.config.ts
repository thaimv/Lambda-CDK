import { PROJECT_ID_MAX_LENGTH } from '../constants/app.constants';
import { Environment, ENVIRONMENT_NAMES } from '../constants/environment.constants';
import { ENVIRONMENT_CONFIGS } from './environments.config';
import type { DatabaseScheduleConfig, EnvironmentName, LoadedConfig } from '../types/config.types';

const DEFAULT_RDS_SCHEDULE: Omit<DatabaseScheduleConfig, 'enabled'> = {
  timezone: 'Asia/Ho_Chi_Minh',
  stopCron: '0 20 * * ? *',
  startCron: '0 8 * * ? *',
};

const loadDevDatabaseSchedule = (envName: EnvironmentName): DatabaseScheduleConfig | undefined => {
  if (envName !== Environment.Dev) {
    return undefined;
  }

  const enabled = process.env.RDS_SCHEDULE_ENABLED?.trim().toLowerCase() === 'true';
  if (!enabled) {
    return { enabled: false, ...DEFAULT_RDS_SCHEDULE };
  }

  return {
    enabled: true,
    timezone: process.env.RDS_SCHEDULE_TIMEZONE?.trim() || DEFAULT_RDS_SCHEDULE.timezone,
    stopCron: process.env.RDS_SCHEDULE_STOP_CRON?.trim() || DEFAULT_RDS_SCHEDULE.stopCron,
    startCron: process.env.RDS_SCHEDULE_START_CRON?.trim() || DEFAULT_RDS_SCHEDULE.startCron,
  };
};

const isEnvironmentName = (value: string): value is EnvironmentName =>
  (ENVIRONMENT_NAMES as readonly string[]).includes(value);

export const loadEnvironmentConfig = (
  envName: string,
  projectId: string,
  region: string,
  accountId: string,
): LoadedConfig => {
  if (!isEnvironmentName(envName)) {
    throw new Error(
      `Invalid CDK_ENV "${envName}". Use ${ENVIRONMENT_NAMES.join(', ')} in .env`,
    );
  }

  const id = projectId.trim();
  if (!id) {
    throw new Error('CDK_PROJECT_ID is required (.env local or GitHub Environment var for CD)');
  }
  if (id.length > PROJECT_ID_MAX_LENGTH) {
    throw new Error(
      `CDK_PROJECT_ID "${id}" is ${id.length} chars (max ${PROJECT_ID_MAX_LENGTH})`,
    );
  }

  const awsRegion = region.trim();
  if (!awsRegion) {
    throw new Error('AWS_REGION is required (.env local or GitHub Environment var for CD)');
  }

  const config = ENVIRONMENT_CONFIGS[envName];
  const stackPrefix = `${id}-${envName}`;
  const account = accountId.trim();

  if (!account) {
    throw new Error('AWS_ACCOUNT_ID is required (.env local or GitHub Environment var for CD)');
  }

  const schedule = loadDevDatabaseSchedule(envName);

  return {
    ...config,
    database: schedule ? { ...config.database, schedule } : config.database,
    region: awsRegion,
    accountId: account,
    projectId: id,
    envName,
    stackPrefix,
  };
};
