import { Router } from 'express';
import { optionalEnv } from '../utils/env';
import { getShiftInstancesFieldNames, getShiftPatternsFieldNames, getGraphConfig } from '../services/msListsConfig';
import { graphGet } from '../services/graphClient';

const router = Router();

// /api/debug/list-fields?list=<listName>&sample=1
router.get('/list-fields', async (req, res) => {
  // Allow in dev or if explicitly enabled
  const allowDebug = process.env.ALLOW_DEBUG === '1' || process.env.NODE_ENV === 'development';
  // If you have custom auth, check here
  // if (!allowDebug && !req.auth) return res.status(401).json({ error: 'Unauthorized' });

  const listName = String(req.query.list || '').trim();
  if (!listName) {
    return res.status(400).json({ ok: false, error: 'Missing ?list parameter' });
  }
  try {
    const graph = getGraphConfig();
    // Try to find the list by name
    const listsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists?$top=999`;
    const listsResp: any = await graphGet(listsUrl, await import('../services/graphAuth.js').then(m => m.getGraphAppToken(graph)));
    const found = (listsResp.value || []).find((l: any) => (l.name || '').toLowerCase() === listName.toLowerCase() || (l.displayName || '').toLowerCase() === listName.toLowerCase());
    if (!found) return res.status(404).json({ ok: false, error: `List not found: ${listName}` });
    // Get columns
    const columnsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists/${encodeURIComponent(found.id)}/columns?$top=999`;
    const columnsResp: any = await graphGet(columnsUrl, await import('../services/graphAuth.js').then(m => m.getGraphAppToken(graph)));
    let sample = null;
    if (req.query.sample) {
      const itemsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists/${encodeURIComponent(found.id)}/items?$expand=fields&$top=1`;
      const itemsResp: any = await graphGet(itemsUrl, await import('../services/graphAuth.js').then(m => m.getGraphAppToken(graph)));
      sample = itemsResp.value && itemsResp.value.length > 0 ? itemsResp.value[0] : null;
    }
    res.json({
      ok: true,
      list: listName,
      listId: found.id,
      columns: columnsResp.value || [],
      sample,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
});

// Add a new generic debug endpoint for any list name
import type { Request, Response } from 'express';

export async function getEnvDebug(req: Request, res: Response) {
  // Allow in dev or if explicitly enabled
  const allowDebug = process.env.ALLOW_DEBUG === '1' || process.env.NODE_ENV === 'development';
  // If you have custom auth, check here
  // if (!allowDebug && !req.auth) return res.status(401).json({ error: 'Unauthorized' });

  const listName = String(req.query.list || '').trim();
  if (!listName) {
    return res.status(400).json({ ok: false, error: 'Missing ?list parameter' });
  }
  try {
    const graph = getGraphConfig();
    // Try to find the list by name
    const listsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists?$top=999`;
    const listsResp: any = await graphGet(listsUrl, await import('../services/graphAuth.js').then(m => m.getGraphAppToken(graph)));
    const found = (listsResp.value || []).find((l: any) => (l.name || '').toLowerCase() === listName.toLowerCase() || (l.displayName || '').toLowerCase() === listName.toLowerCase());
    if (!found) return res.status(404).json({ ok: false, error: `List not found: ${listName}` });
    // Get columns
    const columnsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists/${encodeURIComponent(found.id)}/columns?$top=999`;
    const columnsResp: any = await graphGet(columnsUrl, await import('../services/graphAuth.js').then(m => m.getGraphAppToken(graph)));
    let sample = null;
    if (req.query.sample) {
      const itemsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists/${encodeURIComponent(found.id)}/items?$expand=fields&$top=1`;
      const itemsResp: any = await graphGet(itemsUrl, await import('../services/graphAuth.js').then(m => m.getGraphAppToken(graph)));
      sample = itemsResp.value && itemsResp.value.length > 0 ? itemsResp.value[0] : null;
    }
    res.json({
      ok: true,
      list: listName,
      listId: found.id,
      columns: columnsResp.value || [],
      sample,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
}

// Export a handler for the generic endpoint for use in the router


export default router;
