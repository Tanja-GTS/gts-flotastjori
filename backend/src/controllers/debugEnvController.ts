import type { Request, Response } from 'express';
import { optionalEnv } from '../utils/env';
import { getShiftInstancesFieldNames, getShiftPatternsFieldNames } from '../services/msListsConfig';

export function getEnvDebug(_req: Request, res: Response) {
  const instances = getShiftInstancesFieldNames();
  const patterns = getShiftPatternsFieldNames();

  const mailSenderUpn = optionalEnv('MAIL_SENDER_UPN', '').trim();
  const appOrigin = optionalEnv('APP_ORIGIN', '').trim();

  const azureTenantId = optionalEnv('AZURE_TENANT_ID', '').trim();
  const azureClientId = optionalEnv('AZURE_CLIENT_ID', '').trim();
  const azureClientSecret = optionalEnv('AZURE_CLIENT_SECRET', '').trim();

  const siteId = optionalEnv('MS_SITE_ID', '').trim();
  const shiftInstancesListId = optionalEnv('MS_SHIFT_INSTANCES_LIST_ID', '').trim();
  const shiftPatternsListId = optionalEnv('MS_SHIFT_PATTERNS_LIST_ID', '').trim();

  res.json({
    ok: true,
    mailSenderUpn: mailSenderUpn || null,
    mailSenderUpnSet: Boolean(mailSenderUpn),
    appOrigin: appOrigin || null,

    graph: {
      azureTenantIdSet: Boolean(azureTenantId),
      azureClientIdSet: Boolean(azureClientId),
      azureClientSecretSet: Boolean(azureClientSecret),
      appOnlyConfigured: Boolean(azureClientId && azureClientSecret),
      siteIdSet: Boolean(siteId),
      shiftInstancesListIdSet: Boolean(shiftInstancesListId),
      shiftPatternsListIdSet: Boolean(shiftPatternsListId),
    },

    effectiveFieldNames: {
      shiftInstances: {
        ...instances,
        templateIdLookupIdKey: instances.templateId ? `${instances.templateId}LookupId` : null,
        patternIdLookupIdKey: instances.patternId ? `${instances.patternId}LookupId` : null,
        driverIdLookupIdKey: instances.driverId ? `${instances.driverId}LookupId` : null,
        busIdLookupIdKey: instances.busId ? `${instances.busId}LookupId` : null,
      },
      shiftPatterns: patterns,
    },
  });
}
