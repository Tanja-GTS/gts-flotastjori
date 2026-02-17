import type { Request, Response } from 'express';
import { getGraphConfig, getListIds, getShiftInstancesFieldNames } from '../services/msListsConfig';
import { getGraphAppToken } from '../services/graphAuth';
import { graphPatch } from '../services/graphClient';
import { sendApiError } from './apiError';

// Debug-only endpoint to experiment with patch payload shapes for confirmationStatus.
export async function postPatchConfirmationStatus(req: Request, res: Response) {
  try {
    const itemId = String(req.params.id || '').trim();
    const status = String((req.body as any)?.status || '').trim();
    const mode = String((req.body as any)?.mode || '').trim();

    if (!itemId || !status) {
      res.status(400).json({ ok: false, error: 'Required: :id and body.status' });
      return;
    }

    const graph = getGraphConfig();
    const lists = getListIds();
    const fInst = getShiftInstancesFieldNames();

    const token = await getGraphAppToken(graph);

    const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
      graph.siteId
    )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/items/${encodeURIComponent(
      itemId
    )}/fields`;

    let value: unknown = status;
    if (mode === 'array') value = [status];
    if (mode === 'object') value = { value: status };

    const body: Record<string, unknown> = { [fInst.confirmationStatus]: value };
    if (mode === 'typed-array') {
      body[`${fInst.confirmationStatus}@odata.type`] = 'Collection(Edm.String)';
      body[fInst.confirmationStatus] = [status];
    }

    await graphPatch(url, token, body);
    res.json({ ok: true, patched: body });
  } catch (err) {
    sendApiError(res, err);
  }
}
