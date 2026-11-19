import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorName, type Logger } from '../lib/logger.js';
import type { WhatsAppWorkerConfig } from './config.js';

export type WhatsAppProcessManager = {
  close(): Promise<void>;
};

function agentCommand(): { args: string[]; entry: string } {
  const modulePath = fileURLToPath(import.meta.url);
  if (basename(modulePath) === 'server.mjs') {
    const entry = join(dirname(modulePath), 'whatsapp-agent.mjs');
    if (existsSync(entry)) {
      return { args: [entry, 'start'], entry };
    }
  }

  const entry = fileURLToPath(new URL('./whatsapp-agent.ts', import.meta.url));
  return { args: ['--import', 'tsx', entry, 'dev'], entry };
}

export function startWhatsAppAgent(
  config: Pick<WhatsAppWorkerConfig, 'whatsappCallingEnabled'>,
  logger: Logger,
): WhatsAppProcessManager {
  if (!config.whatsappCallingEnabled) {
    return { close: async () => undefined };
  }

  const { args, entry } = agentCommand();
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  });
  let stopping = false;
  child.once('spawn', () => {
    logger.info({ entry }, 'WhatsApp agent process started');
  });
  child.on('error', (error) => {
    logger.error(
      { source: 'whatsapp-process', entry, errorName: errorName(error) },
      'Could not start the WhatsApp agent process',
    );
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      logger.error(
        { source: 'whatsapp-process', entry, code, signal },
        'WhatsApp agent process exited unexpectedly',
      );
    }
  });
  return {
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }

        stopping = true;
        const timeout = setTimeout(() => {
          child.kill();
        }, 10_000);
        const finish = () => {
          clearTimeout(timeout);
          resolve();
        };
        child.once('exit', finish);
        child.once('close', finish);
        child.kill('SIGTERM');
      }),
  };
}
