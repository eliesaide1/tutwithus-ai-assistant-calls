import {
  ActivateSettingsRequestSchema,
  AdminSettingsResponseSchema,
  AgentSettingsDraftRequestSchema,
  AgentSettingsSchema,
} from '@tutwithus/contracts/admin';
import express, { Router, type RequestHandler } from 'express';
import { ApiError } from '../../http/errors.js';
import { parseInput } from '../../http/validation.js';
import { authorize } from '../admin-auth/admin-auth.authorize.js';
import {
  getAdminPrincipal,
  requireAdminCsrf,
} from '../admin-auth/admin-auth.middleware.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { AgentSettingsRecord } from './agent-settings.model.js';
import type { AgentSettingsRepository } from './agent-settings.repository.js';

function toSettingsResponse(settings: AgentSettingsRecord) {
  return {
    ...settings,
    name: settings.name || `Settings v${settings.version}`,
    activatedAt: settings.activatedAt?.toISOString(),
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export function createAgentSettingsRouter(
  authenticate: RequestHandler,
  settings: AgentSettingsRepository,
  writeAudit: AuditWriter,
) {
  const router = Router();
  router.use(authenticate, authorize(...ADMIN_ROLE_POLICIES.administrators));

  router.get('/', async (_request, response) => {
    const current = await settings.getSettings();
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      AdminSettingsResponseSchema.parse({
        active: current.active ? toSettingsResponse(current.active) : null,
        drafts: current.drafts.map(toSettingsResponse),
      }),
    );
  });

  router.put(
    '/draft',
    requireAdminCsrf,
    // Instruction templates (8,000 chars) may be Arabic, so allow multi-byte text.
    express.json({ limit: '64kb', strict: true }),
    async (request, response) => {
      const draftInput = parseInput(
        AgentSettingsDraftRequestSchema,
        request.body,
        'The agent settings are invalid.',
      );
      const principal = getAdminPrincipal(response);
      const draft = await settings.saveSettingsDraft(draftInput);
      await writeAudit(request, principal.id, {
        action: 'settings.draft_saved',
        entity: 'agent_settings',
        entityId: String(draft.version),
        diff: { version: draft.version },
      });
      response
        .status(201)
        .json(AgentSettingsSchema.parse(toSettingsResponse(draft)));
    },
  );

  router.put(
    '/draft/:version',
    requireAdminCsrf,
    express.json({ limit: '64kb', strict: true }),
    async (request, response) => {
      const version = Number(request.params.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'The settings version is invalid.',
        );
      }
      const draftInput = parseInput(
        AgentSettingsDraftRequestSchema,
        request.body,
        'The agent settings are invalid.',
      );
      const principal = getAdminPrincipal(response);
      const draft = await settings.updateSettingsDraft(version, draftInput);
      if (!draft) {
        throw new ApiError(
          409,
          'SETTINGS_NOT_DRAFT',
          'Only a saved draft can be edited.',
        );
      }
      await writeAudit(request, principal.id, {
        action: 'settings.draft_updated',
        entity: 'agent_settings',
        entityId: String(version),
        diff: { version, name: draft.name },
      });
      response.json(AgentSettingsSchema.parse(toSettingsResponse(draft)));
    },
  );

  router.delete(
    '/draft/:version',
    requireAdminCsrf,
    async (request, response) => {
      const version = Number(request.params.version);
      if (!Number.isSafeInteger(version) || version < 1) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'The settings version is invalid.',
        );
      }
      const principal = getAdminPrincipal(response);
      const deleted = await settings.deleteSettingsDraft(version);
      if (!deleted) {
        throw new ApiError(
          404,
          'SETTINGS_NOT_FOUND',
          'Settings version not found.',
        );
      }
      await writeAudit(request, principal.id, {
        action: 'settings.draft_deleted',
        entity: 'agent_settings',
        entityId: String(version),
        diff: { version },
      });
      response.json({ status: 'deleted', version });
    },
  );

  router.post(
    '/activate',
    requireAdminCsrf,
    express.json({ limit: '1kb', strict: true }),
    async (request, response) => {
      const { version } = parseInput(
        ActivateSettingsRequestSchema,
        request.body,
        'The settings version is invalid.',
      );
      const principal = getAdminPrincipal(response);
      const activated = await settings.activateSettings(
        version,
        principal.id,
        new Date(),
      );
      if (!activated) {
        throw new ApiError(
          409,
          'SETTINGS_NOT_FOUND',
          'The settings version cannot be activated.',
        );
      }
      await writeAudit(request, principal.id, {
        action: 'settings.activated',
        entity: 'agent_settings',
        entityId: String(version),
        diff: { version },
      });
      response.json({ status: 'active', version });
    },
  );

  return router;
}
