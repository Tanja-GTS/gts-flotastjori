import { Router } from 'express';
import { verifyConfirmLink } from '../utils/confirmLinks';
import {
  getHydratedShiftById,
  getHydratedWeekShiftsForAnchor,
  setShiftInstanceConfirmationStatus,
} from '../services/shiftInstancesService';
import { cacheInvalidatePrefix } from '../services/simpleCache';
import { optionalEnv } from '../utils/env';

export const confirmRouter = Router();

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(params: { title: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(params.title)}</title>
  </head>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; padding: 24px; background: #f8f9fa; color: #212529;">
    <div style="max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e9ecef; border-radius: 12px; padding: 20px;">
      ${params.bodyHtml}
    </div>
  </body>
</html>`;
}

function checkBadge(params: { label: string }): string {
  return `
    <div style="display:flex;align-items:center;gap:10px;margin:0 0 12px 0">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="#2f9e44" />
        <path d="M7 12.5l3.2 3.2L17.5 8.4" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div style="font-size:18px;font-weight:700;color:#2f9e44">${esc(params.label)}</div>
    </div>
  `;
}

async function loadShiftPreview(
  shiftId: string
): Promise<{ title: string; detailsHtml: string; alreadyConfirmed: boolean } | null> {
  if (shiftId.startsWith('week:')) {
    const anchorItemId = shiftId.slice('week:'.length).trim();
    const weekInfo = await getHydratedWeekShiftsForAnchor({ anchorItemId });
    if (!weekInfo || weekInfo.shifts.length === 0) return null;

    const anchor = weekInfo.anchor;
    const routeDisplay = anchor.routeName || anchor.route;

    const rows = weekInfo.shifts
      .map(
        (s) => `
          <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(s.date)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(s.routeName || s.route)}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(s.time)}</td>
          </tr>`
      )
      .join('');

    const alreadyConfirmed = weekInfo.shifts.every((s) => {
      const v = String(s.confirmationStatus || '').toLowerCase();
      return v === 'assigned' || v === 'accepted';
    });

    return {
      title: `Confirm shifts — ${routeDisplay}`,
      detailsHtml: `
        <h2 style="margin:0 0 8px 0">Confirm shifts</h2>
        <p style="margin:0 0 12px 0;color:#495057">Route: <strong>${esc(routeDisplay)}</strong></p>
        <p style="margin:0 0 16px 0;color:#495057">This confirms all shifts in this week group.</p>
        <table style="border-collapse:collapse;width:100%;max-width:680px">
          <thead>
            <tr>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd">Date</th>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd">Route</th>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd">Time</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `,
      alreadyConfirmed,
    };
  }

  const shift = await getHydratedShiftById(shiftId, { includeTrips: false });
  if (!shift) return null;

  const routeDisplay = shift.routeName || shift.route;
  return {
    title: `Confirm shift — ${routeDisplay}`,
    detailsHtml: `
      <h2 style="margin:0 0 8px 0">Confirm shift</h2>
      <ul style="margin: 0; padding-left: 18px; color:#495057">
        <li><strong>Date:</strong> ${esc(shift.date)}</li>
        <li><strong>Route:</strong> ${esc(routeDisplay)}</li>
        <li><strong>Shift type:</strong> ${esc(shift.shiftType)}</li>
        <li><strong>Time:</strong> ${esc(shift.time)}</li>
      </ul>
    `,
    alreadyConfirmed: (() => {
      const v = String(shift.confirmationStatus || '').toLowerCase();
      return v === 'assigned' || v === 'accepted';
    })(),
  };
}

async function confirmShiftId(shiftId: string): Promise<string[]> {
  const status = 'assigned';

  if (shiftId.startsWith('week:')) {
    const anchorItemId = shiftId.slice('week:'.length).trim();
    const weekInfo = await getHydratedWeekShiftsForAnchor({ anchorItemId });
    if (!weekInfo || weekInfo.shifts.length === 0) throw new Error('Week not found');

    const concurrency = Math.max(1, Math.min(12, Number(optionalEnv('CONFIRM_CONCURRENCY', '6')) || 6));
    // Simple concurrency runner
    let idx = 0;
    const items = weekInfo.shifts;
    async function next(): Promise<void> {
      const cur = idx;
      idx += 1;
      if (cur >= items.length) return;
      await setShiftInstanceConfirmationStatus({ itemId: items[cur].id, status });
      return next();
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));

    cacheInvalidatePrefix('shifts|');
    return weekInfo.shifts.map((s) => s.id);
  }

  await setShiftInstanceConfirmationStatus({ itemId: shiftId, status });
  cacheInvalidatePrefix('shifts|');
  return [shiftId];
}

confirmRouter.get('/:token', async (req, res) => {
  try {
    const payload = verifyConfirmLink(String(req.params.token || ''));
    const preview = await loadShiftPreview(payload.shiftId);
    if (!preview) {
      res.status(404).send(
        page({
          title: 'Shift not found',
          bodyHtml: `<h2 style="margin:0 0 8px 0">Invalid or expired link</h2><p style="color:#495057">This shift could not be found.</p>`,
        })
      );
      return;
    }

    if (preview.alreadyConfirmed) {
      res
        .status(200)
        .send(
          page({
            title: 'Shift confirmed',
            bodyHtml: `
              ${checkBadge({ label: 'Shift confirmed' })}
              ${preview.detailsHtml}
              <p style="margin-top:16px;color:#495057">This shift is already confirmed. You can close this tab.</p>
            `,
          })
        );
      return;
    }

    res
      .status(200)
      .send(
        page({
          title: preview.title,
          bodyHtml: `
            ${preview.detailsHtml}
            <p style="margin-top:16px;color:#495057">Tap the button below to confirm.</p>
            <form method="post" style="margin-top:16px">
              <button type="submit" style="display:inline-block;padding:10px 14px;background:#1971c2;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer">Confirm shift</button>
            </form>
            <p style="margin-top:16px;color:#495057">If you want to decline the shift, call your fleet manager.</p>
          `,
        })
      );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid link';
    res
      .status(400)
      .send(
        page({
          title: 'Invalid link',
          bodyHtml: `<h2 style="margin:0 0 8px 0">Invalid or expired link</h2><p style="color:#495057">${esc(msg)}</p>`,
        })
      );
  }
});

confirmRouter.post('/:token', async (req, res) => {
  try {
    const payload = verifyConfirmLink(String(req.params.token || ''));
    const updatedIds = await confirmShiftId(payload.shiftId);

    const preview = await loadShiftPreview(payload.shiftId);
    const detailsHtml = preview?.detailsHtml || '';

    res
      .status(200)
      .send(
        page({
          title: 'Shift confirmed',
          bodyHtml: `
            ${checkBadge({ label: 'Shift confirmed' })}
            <p style="margin:0;color:#495057">Thanks — your response has been saved.</p>
            ${detailsHtml}
            <p style="margin-top:10px;color:#868e96;font-size:12px">Updated: ${esc(updatedIds.join(', '))}</p>
          `,
        })
      );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to confirm';
    res
      .status(400)
      .send(
        page({
          title: 'Could not confirm',
          bodyHtml: `<h2 style="margin:0 0 8px 0">Could not confirm</h2><p style="color:#495057">${esc(msg)}</p>`,
        })
      );
  }
});
