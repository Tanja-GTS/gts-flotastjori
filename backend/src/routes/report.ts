import { Router, type Request, type Response } from 'express';
import { listHydratedShifts } from '../services/shiftInstancesService';
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
const tableHeader = `<tr style="background:#f5f5f5">
  <th style="padding:8px 12px;text-align:left">Route</th>
  <th style="padding:8px 12px;text-align:left">Type</th>
  <th style="padding:8px 12px;text-align:left">Time</th>
  <th style="padding:8px 12px;text-align:left">Driver</th></tr>`;

function shiftRow(s: any, ok: boolean): string {
  const color = ok ? '#1a7f37' : '#b91c1c';
  return `<tr>
    <td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${s.route}</td>
    <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${LABEL[s.shiftType] || s.shiftType}</td>
    <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${s.time || ''}</td>
    <td style="padding:6px 12px;border-bottom:1px solid #eee;color:${color};font-weight:${ok ? '400' : '700'}">${ok ? (s.driverName || '—') : '⚠️ Unassigned'}</td></tr>`;
}

function daySection(label: string, date: string, shifts: any[]): string {
  const unassigned = shifts.filter((s: any) => !s.driverId);
  const allGood = unassigned.length === 0;
  const statusColor = allGood ? '#1a7f37' : '#b91c1c';
  const statusText = allGood
    ? `✅ All ${shifts.length} shifts assigned`
    : `⚠️ ${unassigned.length} unassigned out of ${shifts.length}`;
  const rows = [...unassigned, ...shifts.filter((s: any) => s.driverId)].map((s) => shiftRow(s, !!s.driverId)).join('');
  return `<h2 style="margin-top:32px;margin-bottom:2px">${label}</h2>
    <p style="color:#666;margin:0 0 8px">${formatDate(date)}</p>
    <p style="font-weight:700;color:${statusColor};margin:0 0 12px">${statusText}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${tableHeader}${rows}</table>`;
}

reportRouter.post('/daily', async (_req: Request, res: Response) => {
  try {
    const apiKey    = optionalEnv('MAILERLITE_API_KEY', '');
    const to        = optionalEnv('DAILY_REPORT_TO', '');
    const fromEmail = optionalEnv('DAILY_REPORT_FROM_EMAIL', 'noreply@gts.is');
    const fromName  = optionalEnv('DAILY_REPORT_FROM_NAME', 'Fleet Scheduler');
    const workspaceId = optionalEnv('DAILY_REPORT_WORKSPACE', 'south');

    if (!apiKey || !to) {
      res.json({ ok: false, reason: 'MAILERLITE_API_KEY or DAILY_REPORT_TO not configured' });
      return;
    }

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

    const html = `<div style="font-family:system-ui,sans-serif;max-width:620px;margin:0 auto;color:#111">
      <h1 style="margin-bottom:0">Shift Report</h1>
      ${daySection('Today', today, todayShifts)}
      ${daySection('Tomorrow', tomorrow, tomorrowShifts)}
      <p style="color:#aaa;font-size:12px;margin-top:32px">Fleet Scheduler — automated daily report</p>
    </div>`;

    const mailRes = await fetch('https://connect.mailerlite.com/api/emails', {
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
      res.status(500).json({ ok: false, reason: `MailerLite ${mailRes.status}: ${body}` });
      return;
    }

    console.log(`[report] Daily email sent to ${to} — ${subject}`);
    res.json({ ok: true, subject });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, reason: msg });
  }
});
