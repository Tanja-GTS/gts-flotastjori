import type { Request, Response } from 'express';
import { listWorkspaces } from '../services/workspacesService';
import { cacheGetOrSet, cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';
import { getListFieldDiagnostics } from '../services/debugListsService';

const WORKSPACES_TTL_MS = Number(process.env.CACHE_WORKSPACES_TTL_MS || 5 * 60 * 1000);

export async function getWorkspaces(_req: Request, res: Response) {
  try {
    const refresh = String((_req.query as any)?.refresh || '').trim();
    if (refresh === '1' || refresh.toLowerCase() === 'true') {
      cacheInvalidatePrefix('workspaces');
    }

    const workspaces = await cacheGetOrSet({
      key: 'workspaces',
      ttlMs: WORKSPACES_TTL_MS,
      factory: async () => {
        const fromList = await listWorkspaces();

        // Safety net: include any workspace IDs that exist in the ShiftInstances workspaceId choices.
        // This prevents shifts from being "nowhere" when the Workspaces list is missing a row.
        // (Example: instances have workspaceId='airport', but Workspaces list only has 'south' + 'school'.)
        try {
          const diagnostics = await getListFieldDiagnostics({ list: 'instances', sample: 0 });
          const wsCol = diagnostics.columns.find(
            (c) => String(c.displayName || '').trim().toLowerCase() === 'workspaceid'
          );
          const choices: string[] = ((wsCol?.raw as any)?.choice?.choices ?? []) as string[];

          const existing = new Set(fromList.map((w) => String(w.id || '').trim()).filter(Boolean));
          const extras = choices
            .map((c) => String(c || '').trim())
            .filter(Boolean)
            .filter((id) => !existing.has(id))
            .map((id) => ({ id, name: id }));

          return [...fromList, ...extras];
        } catch {
          return fromList;
        }
      },
    });

    res.json({ ok: true, workspaces });
  } catch (err) {
    sendApiError(res, err);
  }
}
