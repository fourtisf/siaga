import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/db.js';
import { redis } from './lib/redis.js';

const app = await buildApp();

const shutdown = async (sig: string) => {
  app.log.info(`${sig}: berhenti`);
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.api.host, port: config.api.port });
