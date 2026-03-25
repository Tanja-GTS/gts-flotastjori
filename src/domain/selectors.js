// Domain selectors (pure functions) to keep UI logic simple and backend-ready.

function parseRouteSortParts(route) {
  const raw = String(route || '').trim();
  const normalized = raw.replace(/\s+/g, '').toUpperCase();
  const match = normalized.match(/^(\d+)([A-Z]*)(.*)$/);

  if (!match) {
    return {
      number: Number.POSITIVE_INFINITY,
      suffix: normalized,
      remainder: '',
      normalized,
    };
  }

  return {
    number: Number(match[1]),
    suffix: match[2] || '',
    remainder: match[3] || '',
    normalized,
  };
}

export function compareRoutes(a, b) {
  const left = parseRouteSortParts(a);
  const right = parseRouteSortParts(b);

  if (left.number !== right.number) return left.number - right.number;
  if (left.suffix !== right.suffix) return left.suffix.localeCompare(right.suffix, undefined, { sensitivity: 'base' });
  if (left.remainder !== right.remainder) {
    return left.remainder.localeCompare(right.remainder, undefined, { numeric: true, sensitivity: 'base' });
  }
  return left.normalized.localeCompare(right.normalized, undefined, { numeric: true, sensitivity: 'base' });
}

export function selectWorkspaceShifts(shifts, workspaceId) {
  return shifts.filter((s) => s.workspaceId === workspaceId);
}

// Timeline rows should sort routes numerically so 51A, 51B, 51C, 52A read naturally.
export function selectRoutesForWorkspace(shifts, workspaceId) {
  const seen = new Set();
  const routes = [];

  for (const shift of shifts) {
    if (shift.workspaceId !== workspaceId) continue;
    if (!shift.route) continue;
    if (seen.has(shift.route)) continue;
    seen.add(shift.route);
    routes.push(shift.route);
  }

  return routes.sort(compareRoutes);
}

export function selectVisibleShifts(shifts, workspaceId, routes) {
  const routeSet = new Set(routes);
  return shifts.filter((s) => s.workspaceId === workspaceId && routeSet.has(s.route));
}
