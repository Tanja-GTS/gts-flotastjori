import type { Request, Response } from 'express';
import { getListFieldDiagnostics } from '../services/debugListsService';
import { sendApiError } from './apiError';

export async function getInstancesMeta(req: Request, res: Response) {
  try {
    const diagnostics = await getListFieldDiagnostics({ list: 'instances', sample: 0 });

    const required = diagnostics.columns
      .filter((c) => c.required)
      .map((c) => ({ name: c.name, displayName: c.displayName, type: c.type }));

    const workspaceCol = diagnostics.columns.find((c) => c.displayName === 'workspaceId');
    const confirmationCol = diagnostics.columns.find((c) => c.displayName === 'confirmationStatus');

    res.json({
      ok: true,
      required,
      workspaceChoices: (workspaceCol?.raw as any)?.choice?.choices ?? null,
      confirmationChoices: (confirmationCol?.raw as any)?.choice?.choices ?? null,
      notes: {
        workspaceInternalName: workspaceCol?.name ?? null,
        dateInternalName: diagnostics.columns.find((c) => c.displayName === 'date')?.name ?? null,
      },
    });
  } catch (err) {
    sendApiError(res, err);
  }
}
