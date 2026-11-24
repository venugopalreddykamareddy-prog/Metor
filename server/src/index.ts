import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const app = await buildApp(config);

const SHUTDOWN_TIMEOUT_MS = 5000;

const shutdown = (signal: string): void => {
  app.log.info({ signal }, 'shutting down');
  // app.close() also closes open WebSockets; don't let a stuck connection block exit.
  setTimeout(() => {
    app.log.error('shutdown timed out, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
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
