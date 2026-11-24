// Server entry point. Dev: `node --watch server/src/index.ts` (Node 24 strips types natively).
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = await buildApp(config);

const shutdown = (signal: string): void => {
  app.log.info({ signal }, 'shutting down');
  app.close().then(
    () => process.exit(0),
    (err: unknown) => {
      app.log.error(err, 'error during shutdown');
      process.exit(1);
    },
  );
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err, 'failed to start');
  process.exit(1);
}
