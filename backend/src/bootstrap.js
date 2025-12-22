// import dotenv from 'dotenv';
// import path from 'path';
// import { fileURLToPath } from 'url';
// import fs from 'fs';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// dotenv.config();

// const envPath = path.resolve(__dirname, '../.env');
// if (fs.existsSync(envPath)) {
//   dotenv.config({ path: envPath, override: true });
// }

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env deterministically before any other imports that read process.env
dotenv.config();

// Your logic to handle specific .env paths
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

// Ensure NODE_ENV is set before moving to imports
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

if (process.env.NODE_ENV === 'development' && typeof process.env.REDIS_DISABLED === 'undefined') {
  process.env.REDIS_DISABLED = 'true';
}

// Use dynamic imports to ensure they run AFTER the config above
const { assertRedisModeDefinedInDev, logBootDiagnostics } = await import('./redisAvailability.js');
assertRedisModeDefinedInDev();
logBootDiagnostics();

await import('./index.js');