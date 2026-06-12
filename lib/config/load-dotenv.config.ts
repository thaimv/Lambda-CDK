import * as fs from 'fs';
import * as path from 'path';

import { config as loadEnvFile } from 'dotenv';

/** Load `cdk/.env` if present. Does not override existing process.env. */
export const loadDotenv = (): void => {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    loadEnvFile({ path: envPath });
  }
};
