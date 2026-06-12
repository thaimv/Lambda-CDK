import { PROJECT_ID_MAX_LENGTH } from '../constants/app.constants';
import { ENVIRONMENT_NAMES } from '../constants/environment.constants';
import { ENVIRONMENT_CONFIGS } from './environments.config';
import type { EnvironmentName, LoadedConfig } from '../types/config.types';

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

  return {
    ...config,
    region: awsRegion,
    accountId: account,
    projectId: id,
    envName,
    stackPrefix,
  };
};
