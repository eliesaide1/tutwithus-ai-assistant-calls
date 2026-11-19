import { Router } from 'express';
import { supportedLocales, type ApiConfig } from '../../config/env.js';
import type { AgentProfileSettingsReader } from '../settings/agent-settings.service.js';

export function createPublicConfigRouter(
  config: ApiConfig,
  settingsReader: AgentProfileSettingsReader,
) {
  const router = Router();

  router.get('/', async (_request, response, next) => {
    try {
      const activeSettings = await settingsReader.getActiveAgentSettings();
      response.setHeader('Cache-Control', 'no-store');
      response.json({
        languages: supportedLocales,
        consentVersion: config.consentVersion,
        consentText: Object.fromEntries(
          Object.entries(config.consentText).map(([locale, text]) => [
            locale,
            text.replaceAll('{retentionDays}', String(config.retentionDays)),
          ]),
        ),
        maxCallSec: activeSettings?.maxCallSec ?? config.maxCallSec,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
