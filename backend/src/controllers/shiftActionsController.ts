import type { Request, Response } from 'express';
import {
  assignDriverToShiftInstance,
  getHydratedWeekShiftsForAnchor,
  getHydratedShiftById,
  setShiftInstanceConfirmationStatus,
} from '../services/shiftInstancesService';
import { resolveDrivers } from '../services/driversService';
import { sendConfirmationEmail } from '../services/mailService';
import { cacheInvalidatePrefix } from '../services/simpleCache';
import { sendApiError } from './apiError';
import { optionalEnv } from '../utils/env';

function getOrigin(req: Request): string {
  const origin = String(req.get('origin') || '').trim();
  if (origin) return origin;

  const referer = String(req.get('referer') || '').trim();
  try {
    if (referer) return new URL(referer).origin;
  } catch {
    // ignore
  }

  return optionalEnv('APP_ORIGIN', 'http://localhost:5174').trim() || 'http://localhost:5174';
}

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function isoToUtcDate(isoDate: string): Date {
  return new Date(`${String(isoDate).slice(0, 10)}T00:00:00Z`);
}

function utcDateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekStartMonday(isoDate: string): string {
  const d = isoToUtcDate(isoDate);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - diff);
  return utcDateToIso(d);
}

function addDaysIso(isoDate: string, days: number): string {
  const d = isoToUtcDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateToIso(d);
}

function formatWeekRangeLabel(weekStartIso: string): string {
  const weekEndIso = addDaysIso(weekStartIso, 6);
  const fmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
  const start = fmt.format(isoToUtcDate(weekStartIso));
  const end = fmt.format(isoToUtcDate(weekEndIso));
  return `${start} – ${end}`;
}

function normalizeWeekPartLabel(weekPartRaw: unknown): string {
  const s = String(weekPartRaw || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'weekdays' || s === 'weekday' || s === 'workdays' || s === 'workday' || s === 'work days') return 'Work days';
  if (s === 'weekend' || s === 'weekends') return 'Weekend';
  return String(weekPartRaw).trim();
}

async function runWithConcurrency<T>(params: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<void>;
}): Promise<void> {
  const concurrency = Math.max(1, Math.min(12, Math.floor(params.concurrency || 1)));
  let idx = 0;

  async function next(): Promise<void> {
    const cur = idx;
    idx += 1;
    if (cur >= params.items.length) return;
    await params.worker(params.items[cur], cur);
    return next();
  }

  const runners = Array.from({ length: Math.min(concurrency, params.items.length) }, () => next());
  await Promise.all(runners);
}

export async function postAssignAndEmail(req: Request, res: Response) {
  try {
    const itemId = String(req.params.id || '').trim();
    const driverId = asString((req.body as any)?.driverId).trim();

    if (!itemId || !driverId) {
      res.status(400).json({ ok: false, error: 'Required: :id and body.driverId' });
      return;
    }

    // Load shift details once (no trips needed for confirmation email).
    const shiftBefore = await getHydratedShiftById(itemId, { includeTrips: false });
    if (!shiftBefore) {
      res.status(404).json({ ok: false, error: 'Shift not found' });
      return;
    }

    const selectedDriver = (await resolveDrivers({ driverIds: [driverId] })).get(driverId);

    await assignDriverToShiftInstance({ itemId, driverId });

    // Try setting pending; if SharePoint rejects it, still proceed with email.
    try {
      await setShiftInstanceConfirmationStatus({ itemId, status: 'pending' });
    } catch {
      // ignore
    }

    cacheInvalidatePrefix('shifts|');

    const to = selectedDriver?.email || '';
    let mailOk = true;
    let mailError = '';
    if (!to) {
      mailOk = false;
      mailError = 'Selected driver does not have an email in the Drivers list';
    }

    const origin = getOrigin(req);
    const confirmUrl = `${origin}/confirm-shift?token=${encodeURIComponent(itemId)}`;

    const weekStart = weekStartMonday(shiftBefore.date);
    const weekRange = formatWeekRangeLabel(weekStart);

    const routeDisplay = shiftBefore.routeName || shiftBefore.route;
    const routeCodePart =
      shiftBefore.routeName && shiftBefore.routeName !== shiftBefore.route ? ` (${shiftBefore.route})` : '';
    const weekPartLabel = normalizeWeekPartLabel((shiftBefore as any).weekPart);
    const weekPartText = weekPartLabel ? ` ${weekPartLabel}` : '';

    const subject = `Please confirm: ${routeDisplay}${routeCodePart} (${shiftBefore.time})${weekPartText} — week ${weekRange}`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.4">
        <p>Hi ${selectedDriver?.name || 'Driver'},</p>
        <p>
          You have been assigned for <strong>${routeDisplay}${routeCodePart}</strong>
          <strong>(${shiftBefore.time})</strong>${weekPartText} for the week <strong>${weekRange}</strong>.
        </p>
        <p>Shift details:</p>
        <ul>
          <li><strong>Date:</strong> ${shiftBefore.date}</li>
          <li><strong>Route:</strong> ${routeDisplay}${routeCodePart}</li>
          <li><strong>Shift type:</strong> ${shiftBefore.shiftType}</li>
          ${weekPartLabel ? `<li><strong>Week group:</strong> ${weekPartLabel}</li>` : ''}
          <li><strong>Time:</strong> ${shiftBefore.time}</li>
        </ul>
        <p>
          <a href="${confirmUrl}" style="display:inline-block;padding:10px 14px;background:#1971c2;color:#fff;text-decoration:none;border-radius:6px">
            Confirm / Decline shift
          </a>
        </p>
        <p>If the button doesn't work, open this link:</p>
        <p><a href="${confirmUrl}">${confirmUrl}</a></p>
      </div>
    `;

    if (to) {
      try {
        await sendConfirmationEmail({ to, subject, html, workspaceId: shiftBefore.workspaceId });
      } catch (e) {
        mailOk = false;
        mailError = e instanceof Error ? e.message : String(e);
      }
    }

    const shift = {
      ...shiftBefore,
      driverId,
      driverName: selectedDriver?.name,
      driverEmail: selectedDriver?.email,
      confirmationStatus: 'pending',
    };

    res.json({ ok: true, mailedTo: to || null, mailOk, mailError: mailError || null, shift });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function postAssignWeekAndEmail(req: Request, res: Response) {
  try {
    const anchorItemId = String(req.params.id || '').trim();
    const driverId = asString((req.body as any)?.driverId).trim();

    if (!anchorItemId || !driverId) {
      res.status(400).json({ ok: false, error: 'Required: :id and body.driverId' });
      return;
    }

    const weekInfo = await getHydratedWeekShiftsForAnchor({ anchorItemId });
    if (!weekInfo || weekInfo.shifts.length === 0) {
      res.status(404).json({ ok: false, error: 'No shifts found for that group/week' });
      return;
    }

    const concurrency = Math.max(1, Math.min(12, Number(optionalEnv('ASSIGN_CONCURRENCY', '6')) || 6));
    await runWithConcurrency({
      items: weekInfo.shifts,
      concurrency,
      worker: async (s) => {
        await assignDriverToShiftInstance({ itemId: s.id, driverId });
        try {
          await setShiftInstanceConfirmationStatus({ itemId: s.id, status: 'pending' });
        } catch {
          // ignore
        }
      },
    });

    cacheInvalidatePrefix('shifts|');

    const selectedDriver = (await resolveDrivers({ driverIds: [driverId] })).get(driverId);
    const to = selectedDriver?.email || '';
    let mailOk = true;
    let mailError = '';
    if (!to) {
      mailOk = false;
      mailError = 'Selected driver does not have an email in the Drivers list';
    }

    const routeDisplay = weekInfo.anchor.routeName || weekInfo.anchor.route;
    const routeCodePart =
      weekInfo.anchor.routeName && weekInfo.anchor.routeName !== weekInfo.anchor.route
        ? ` (${weekInfo.anchor.route})`
        : '';

    const weekPartLabel = normalizeWeekPartLabel((weekInfo.anchor as any).weekPart);
    const weekPartText = weekPartLabel ? ` ${weekPartLabel}` : '';
    const weekRange = formatWeekRangeLabel(weekInfo.weekStart);

    const origin = getOrigin(req);
    const weekToken = `week:${anchorItemId}`;
    const confirmUrl = `${origin}/confirm-shift?token=${encodeURIComponent(weekToken)}`;

    const subject = `Please confirm: ${routeDisplay}${routeCodePart} (${weekInfo.anchor.time})${weekPartText} — week ${weekRange}`;

    const rowsHtml = weekInfo.shifts
      .map((s) => {
        return `
          <tr>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${s.date}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${s.routeName || s.route}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #eee">${s.time}</td>
          </tr>
        `;
      })
      .join('');

    const driverName = selectedDriver?.name || 'Driver';

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.4">
        <p>Hi ${driverName},</p>
        <p>
          You have been assigned for <strong>${routeDisplay}${routeCodePart}</strong>
          <strong>(${weekInfo.anchor.time})</strong>${weekPartText} for the week <strong>${weekRange}</strong>.
        </p>
        <p>Shifts included:</p>
        <table style="border-collapse:collapse;width:100%;max-width:720px">
          <thead>
            <tr>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd">Date</th>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd">Route</th>
              <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd">Time</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        <p style="margin-top:12px">
          Please confirm whether you can take <strong>all</strong> shifts listed above:
        </p>
        <p>
          <a href="${confirmUrl}" style="display:inline-block;padding:10px 14px;background:#1971c2;color:#fff;text-decoration:none;border-radius:6px">
            Confirm / Decline
          </a>
        </p>
        <p>If the button doesn't work, open this link:</p>
        <p><a href="${confirmUrl}">${confirmUrl}</a></p>
      </div>
    `;

    if (to) {
      try {
        await sendConfirmationEmail({ to, subject, html, workspaceId: weekInfo.anchor.workspaceId });
      } catch (e) {
        mailOk = false;
        mailError = e instanceof Error ? e.message : String(e);
      }
    }

    const shift = {
      ...weekInfo.anchor,
      driverId,
      driverName: selectedDriver?.name,
      driverEmail: selectedDriver?.email,
      confirmationStatus: 'pending',
    };

    res.json({
      ok: true,
      mailedTo: to || null,
      mailOk,
      mailError: mailError || null,
      updatedIds: weekInfo.shifts.map((s) => s.id),
      weekStart: weekInfo.weekStart,
      weekEnd: weekInfo.weekEnd,
      shift,
    });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function getShiftById(req: Request, res: Response) {
  try {
    const itemId = String(req.params.id || '').trim();
    if (!itemId) {
      res.status(400).json({ ok: false, error: 'Missing :id' });
      return;
    }

    if (itemId.startsWith('week:')) {
      const anchorItemId = itemId.slice('week:'.length).trim();
      const weekInfo = await getHydratedWeekShiftsForAnchor({ anchorItemId });
      if (!weekInfo || weekInfo.shifts.length === 0) {
        res.status(404).json({ ok: false, error: 'Week not found' });
        return;
      }

      // Use the assigned driver from the hydrated anchor.
      const anchor = weekInfo.anchor;

      const shift = {
        kind: 'week' as const,
        id: itemId,
        token: itemId,
        workspaceId: weekInfo.anchor.workspaceId,
        route: weekInfo.anchor.route,
        routeName: weekInfo.anchor.routeName,
        shiftType: weekInfo.anchor.shiftType,
        weekPart: (weekInfo.anchor as any).weekPart,
        name: `${weekInfo.anchor.route} ${weekInfo.anchor.shiftType}`,
        time: '',
        date: weekInfo.weekStart,
        weekStart: weekInfo.weekStart,
        weekEnd: weekInfo.weekEnd,
        driverId: anchor?.driverId,
        driverName: anchor?.driverName,
        driverEmail: anchor?.driverEmail,
        confirmationStatus: 'pending',
        shifts: weekInfo.shifts.map((s) => ({
          id: s.id,
          date: s.date,
          route: s.route,
          shiftType: s.shiftType,
          time: s.time,
          confirmationStatus: s.confirmationStatus,
        })),
      };

      res.json({ ok: true, shift });
      return;
    }

    // Confirm page doesn't need trips; keep it lean.
    const shift = await getHydratedShiftById(itemId, { includeTrips: false });
    if (!shift) {
      res.status(404).json({ ok: false, error: 'Shift not found' });
      return;
    }

    res.json({ ok: true, shift });
  } catch (err) {
    sendApiError(res, err);
  }
}

export async function postConfirmShift(req: Request, res: Response) {
  try {
    const itemId = String(req.params.id || '').trim();
    const status = asString((req.body as any)?.status).trim();

    if (!itemId || !status) {
      res.status(400).json({ ok: false, error: 'Required: :id and body.status' });
      return;
    }

    if (itemId.startsWith('week:')) {
      const anchorItemId = itemId.slice('week:'.length).trim();
      const weekInfo = await getHydratedWeekShiftsForAnchor({ anchorItemId });
      if (!weekInfo || weekInfo.shifts.length === 0) {
        res.status(404).json({ ok: false, error: 'Week not found' });
        return;
      }

      const concurrency = Math.max(1, Math.min(12, Number(optionalEnv('CONFIRM_CONCURRENCY', '6')) || 6));
      await runWithConcurrency({
        items: weekInfo.shifts,
        concurrency,
        worker: async (s) => {
          await setShiftInstanceConfirmationStatus({ itemId: s.id, status });
        },
      });

      cacheInvalidatePrefix('shifts|');

      res.json({
        ok: true,
        updatedIds: weekInfo.shifts.map((s) => s.id),
        shift: {
          kind: 'week' as const,
          id: itemId,
          token: itemId,
          workspaceId: weekInfo.anchor.workspaceId,
          route: weekInfo.anchor.route,
          shiftType: weekInfo.anchor.shiftType,
          weekPart: (weekInfo.anchor as any).weekPart,
          name: `${weekInfo.anchor.route} ${weekInfo.anchor.shiftType}`,
          time: '',
          date: weekInfo.weekStart,
          weekStart: weekInfo.weekStart,
          weekEnd: weekInfo.weekEnd,
          driverId: weekInfo.anchor.driverId,
          driverName: weekInfo.anchor.driverName,
          driverEmail: weekInfo.anchor.driverEmail,
          confirmationStatus: status,
          shifts: weekInfo.shifts.map((s) => ({
            id: s.id,
            date: s.date,
            route: s.route,
            shiftType: s.shiftType,
            time: s.time,
            confirmationStatus: status,
          })),
        },
      });
      return;
    }

    await setShiftInstanceConfirmationStatus({ itemId, status });

    cacheInvalidatePrefix('shifts|');

    res.json({ ok: true, updatedIds: [itemId] });
  } catch (err) {
    sendApiError(res, err);
  }
}
