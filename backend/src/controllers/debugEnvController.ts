import type { Request, Response } from 'express';
import { getGraphConfig } from '../services/msListsConfig';
import { getGraphAppToken } from '../services/graphAuth';
import { graphGet } from '../services/graphClient';
import { bearerFromHeader, publicDebugEndpointsEnabled } from '../middleware/entraAuth';

// Inspect the columns of any list on the configured site, by display or internal name.
//
// A sample row is real list data, so it is only returned to an authenticated caller.
// When PUBLIC_DEBUG_ENDPOINTS exposes this route anonymously, ?sample= is ignored and
// only column metadata comes back. Mirrors the guard in getListFieldsDebug.
export async function getEnvDebug(req: Request, res: Response) {
  const listName = String(req.query.list || '').trim();
  if (!listName) {
    return res.status(400).json({ ok: false, error: 'Missing ?list parameter' });
  }

  let allowSample = Boolean(req.query.sample);
  if (allowSample && publicDebugEndpointsEnabled() && !bearerFromHeader(req.headers.authorization)) {
    allowSample = false;
  }

  try {
    const graph = getGraphConfig();
    const token = await getGraphAppToken(graph);
    const site = encodeURIComponent(graph.siteId);

    const listsResp: any = await graphGet(
      `https://graph.microsoft.com/v1.0/sites/${site}/lists?$top=999`,
      token
    );
    const wanted = listName.toLowerCase();
    const found = (listsResp.value || []).find(
      (l: any) =>
        String(l.name || '').toLowerCase() === wanted ||
        String(l.displayName || '').toLowerCase() === wanted
    );
    if (!found) {
      return res.status(404).json({ ok: false, error: `List not found: ${listName}` });
    }

    const listId = encodeURIComponent(found.id);
    const columnsResp: any = await graphGet(
      `https://graph.microsoft.com/v1.0/sites/${site}/lists/${listId}/columns?$top=999`,
      token
    );

    let sample = null;
    if (allowSample) {
      const itemsResp: any = await graphGet(
        `https://graph.microsoft.com/v1.0/sites/${site}/lists/${listId}/items?$expand=fields&$top=1`,
        token
      );
      sample = itemsResp.value && itemsResp.value.length > 0 ? itemsResp.value[0] : null;
    }

    return res.json({
      ok: true,
      list: listName,
      listId: found.id,
      columns: columnsResp.value || [],
      sample,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
  }
}
