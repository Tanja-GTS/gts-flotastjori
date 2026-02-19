import { Router } from 'express';
import type { Request, Response } from 'express';
import { optionalEnv } from '../utils/env';
import { getShiftInstancesFieldNames, getShiftPatternsFieldNames } from '../services/msListsConfig';

const router = Router();

function isDev() {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined;
}
const allowDebug = isDev();

// /api/debug/env
router.get('/env', (req, res) => {
  if (!allowDebug && req.auth === undefined) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Inline the debug logic here
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
});


// /api/debug/list-fields?list=<listName>&sample=1
import { getGraphConfig } from '../services/msListsConfig';
import { graphGet } from '../services/graphClient';

router.get('/list-fields', async (req, res) => {
  if (!allowDebug && req.auth === undefined) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const listName = String(req.query.list || '').trim();
  if (!listName) {
    return res.status(400).json({ ok: false, error: 'Missing ?list parameter' });
  }
  try {
    const graph = getGraphConfig();
    // Try to find the list by name
    const listsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists?$top=999`;
    const listsResp = await graphGet(listsUrl, await import('../services/graphAuth').then(m => m.getGraphAppToken(graph)));
    const found = (listsResp.value || []).find(l => (l.name || '').toLowerCase() === listName.toLowerCase() || (l.displayName || '').toLowerCase() === listName.toLowerCase());
    if (!found) return res.status(404).json({ ok: false, error: `List not found: ${listName}` });
    // Get columns
    const columnsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists/${encodeURIComponent(found.id)}/columns?$top=999`;
    const columnsResp = await graphGet(columnsUrl, await import('../services/graphAuth').then(m => m.getGraphAppToken(graph)));
    // Optionally get a sample item
    let sample = null;
    if (req.query.sample) {
      const itemsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists/${encodeURIComponent(found.id)}/items?$expand=fields&$top=1`;
      const itemsResp = await graphGet(itemsUrl, await import('../services/graphAuth').then(m => m.getGraphAppToken(graph)));
      sample = (itemsResp.value && itemsResp.value.length) ? itemsResp.value[0] : null;
    }
    res.json({
      ok: true,
      list: listName,
      listId: found.id,
      columns: columnsResp.value || [],
      sample,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
});

export default router;
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
