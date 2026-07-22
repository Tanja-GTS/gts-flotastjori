import { Router, type Request, type Response } from 'express';
import { listHydratedShifts, type HydratedShiftDto } from '../services/shiftInstancesService';
import { optionalEnv } from '../utils/env';

export const reportRouter = Router();

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function tomorrowIso(): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}
function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const LABEL: Record<string, string> = { morning: 'Morning', evening: 'Evening', single: 'Single' };

function scheduleLabel(shifts: HydratedShiftDto[]): string {
  const counts: Record<string, number> = {};
  for (const s of shifts) {
    const key = String(s.season || '').trim().toLowerCase();
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'Standard Schedule';
  const name = entries[0][0];
  return name.charAt(0).toUpperCase() + name.slice(1) + ' Schedule';
}

function seasonColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('summer')) return '#c2410c';
  if (l.includes('winter')) return '#1d4ed8';
  return '#374151';
}

const tableHeader = `<tr style="background:#f5f5f5">
  <th style="padding:8px 12px;text-align:left;font-size:13px">Route</th>
  <th style="padding:8px 12px;text-align:left;font-size:13px">Type</th>
  <th style="padding:8px 12px;text-align:left;font-size:13px">Time</th>
  <th style="padding:8px 12px;text-align:left;font-size:13px">Driver</th>
</tr>`;

function shiftRow(s: HydratedShiftDto, ok: boolean): string {
  const color = ok ? '#1a7f37' : '#b91c1c';
  return `<tr>
    <td style="padding:7px 12px;border-bottom:1px solid #eee;font-weight:600">${s.route}</td>
    <td style="padding:7px 12px;border-bottom:1px solid #eee;color:#555">${LABEL[s.shiftType] || s.shiftType}</td>
    <td style="padding:7px 12px;border-bottom:1px solid #eee;color:#555">${s.time || ''}</td>
    <td style="padding:7px 12px;border-bottom:1px solid #eee;color:${color};font-weight:${ok ? '400' : '700'}">${ok ? (s.driverName || '—') : '⚠️ Unassigned'}</td>
  </tr>`;
}

function daySection(label: string, date: string, shifts: HydratedShiftDto[], seasonLabel: string): string {
  const unassigned = shifts.filter((s) => !s.driverId);
  const allGood = unassigned.length === 0;
  const statusColor = allGood ? '#1a7f37' : '#b91c1c';
  const statusText = allGood
    ? `✅ All ${shifts.length} shifts assigned`
    : `⚠️ ${unassigned.length} unassigned out of ${shifts.length}`;
  const rows = [...unassigned, ...shifts.filter((s) => s.driverId)].map((s) => shiftRow(s, !!s.driverId)).join('');
  return `
    <h2 style="margin:36px 0 2px;font-size:22px">
      ${label} <span style="font-size:14px;font-weight:600;color:${seasonColor(seasonLabel)}">${seasonLabel}</span>
    </h2>
    <p style="color:#666;margin:0 0 6px;font-size:14px">${formatDate(date)}</p>
    <p style="font-weight:700;color:${statusColor};margin:0 0 10px;font-size:14px">${statusText}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${tableHeader}${rows}</table>`;
}

reportRouter.get('/preview', async (_req: Request, res: Response) => {
  try {
    const today    = todayIso();
    const tomorrow = tomorrowIso();
    const html     = buildHtml(today, tomorrow, [
      { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
      { route: '51A', shiftType: 'evening', time: '14:30–23:00', driverId: 'y', driverName: 'Anna Björk' },
      { route: '51B', shiftType: 'morning', time: '06:30–15:00', driverId: undefined, driverName: undefined },
    ] as HydratedShiftDto[], [
      { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
      { route: '51B', shiftType: 'evening', time: '14:35–23:00', driverId: 'y', driverName: 'Anna Björk' },
    ] as HydratedShiftDto[], 'Winter Schedule', 'Summer Schedule');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(`<pre>${err instanceof Error ? err.message : String(err)}</pre>`);
  }
});

function buildHtml(today: string, tomorrow: string, todayShifts: HydratedShiftDto[], tomorrowShifts: HydratedShiftDto[], todayLabel: string, tomorrowLabel: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:620px;margin:0 auto;padding:32px 24px">
  <p style="margin:0 0 28px">
    <a href="https://gts-flotastjori.onrender.com" style="color:#1d4ed8;font-size:14px;font-weight:600">See full schedule →</a>
  </p>
  <h1 style="margin:0 0 4px;font-size:28px">Shift Report</h1>
  ${daySection('Today', today, todayShifts, todayLabel)}
  ${daySection('Tomorrow', tomorrow, tomorrowShifts, tomorrowLabel)}
  <p style="color:#aaa;font-size:12px;margin-top:36px">Fleet Scheduler — automated daily report</p>
</div>
</body></html>`;
}

reportRouter.post('/daily', async (_req: Request, res: Response) => {
  try {
    const apiKey      = optionalEnv('MAILERLITE_API_KEY', '');
    const to          = optionalEnv('DAILY_REPORT_TO', '');
    const fromEmail   = optionalEnv('DAILY_REPORT_FROM_EMAIL', 'noreply@gts.is');
    const fromName    = optionalEnv('DAILY_REPORT_FROM_NAME', 'Fleet Scheduler');
    const workspaceId = optionalEnv('DAILY_REPORT_WORKSPACE', 'south');

    if (!apiKey || !to) {
      res.json({ ok: false, reason: 'MAILERLITE_API_KEY or DAILY_REPORT_TO not configured' });
      return;
    }
    console.log(`[report] sending from=${fromEmail} to=${to} apiKeyPrefix=${apiKey.slice(0, 8)}`);

    const today    = todayIso();
    const tomorrow = tomorrowIso();
    const months   = [...new Set([today.slice(0, 7), tomorrow.slice(0, 7)])];
    const allShifts = (await Promise.all(months.map((m) => listHydratedShifts({ workspaceId, month: m })))).flat();

    const shiftsFor = (date: string) =>
      allShifts.filter((s: any) => s.date?.slice(0, 10) === date)
               .sort((a: any, b: any) => (a.route + a.shiftType).localeCompare(b.route + b.shiftType));

    const todayShifts    = shiftsFor(today);
    const tomorrowShifts = shiftsFor(tomorrow);
    const totalUnassigned = [...todayShifts, ...tomorrowShifts].filter((s: any) => !s.driverId).length;

    const subject = totalUnassigned === 0
      ? `✅ All shifts assigned — ${formatDate(today)}`
      : `⚠️ ${totalUnassigned} unassigned — ${formatDate(today)}`;

    const html = buildHtml(today, tomorrow, todayShifts, tomorrowShifts, scheduleLabel(todayShifts), scheduleLabel(tomorrowShifts));

    const mailRes = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: { email: fromEmail, name: fromName },
        to: [{ email: to }],
        subject,
        html,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!mailRes.ok) {
      const body = await mailRes.text();
      res.status(500).json({ ok: false, reason: `MailerSend ${mailRes.status}: ${body}` });
      return;
    }

    console.log(`[report] Daily email sent to ${to} — ${subject}`);
    res.json({ ok: true, subject });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, reason: msg });
  }
});
