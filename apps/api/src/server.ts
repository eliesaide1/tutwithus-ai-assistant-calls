import { errorName } from './lib/logger.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { connectWithRetry, disconnectDb } from './db/connect.js';
import { createApp } from './http/app.js';
import { loadConfig as loadWhatsAppConfig } from './whatsapp/config.js';
import { startWhatsAppAgent } from './whatsapp/whatsapp-process.js';

const config = loadConfig();
const whatsappConfig = loadWhatsAppConfig();
const { deps, close } = createContainer(config);
const { logger } = deps;

const server = createApp(deps).listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port }, 'API server listening');
});
const mongo = connectWithRetry(config.mongoUri, logger);
const whatsappAgent = startWhatsAppAgent(whatsappConfig, logger);

let isShuttingDown = false;

function shutdown(signal: string): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  mongo.stop();
  logger.info({ signal }, 'API shutdown started');

  // Stop accepting connections, let in-flight requests finish, then close clients.
  server.close(async (closeError) => {
    if (closeError) {
      logger.error(
        {
          source: 'server',
          errorName: closeError.name,
        },
        'HTTP server failed to close cleanly',
      );
      process.exitCode = 1;
    }

    try {
      await whatsappAgent.close();
      await disconnectDb();
      await close();
    } catch (error) {
      logger.error(
        {
          source: 'server',
          errorName: errorName(error),
        },
        'Client shutdown failed',
      );
      process.exitCode = 1;
    } finally {
      try {
        await logger.close?.();
      } catch (error) {
        process.exitCode = 1;
        process.stderr.write(
          `${new Date().toISOString()} | ERROR | Logger shutdown failed | ${errorName(error)}\n`,
        );
      }
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
