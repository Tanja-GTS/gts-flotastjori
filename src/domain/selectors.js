// Domain selectors (pure functions) to keep UI logic simple and backend-ready.

export function selectWorkspaceShifts(shifts, workspaceId) {
  return shifts.filter((s) => s.workspaceId === workspaceId);
}

// IMPORTANT: Do not sort alphabetically unless explicitly requested.
// This preserves the order routes first appear in the data.
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

  return routes;
}

export function selectVisibleShifts(shifts, workspaceId, routes) {
  const routeSet = new Set(routes);
  return shifts.filter((s) => s.workspaceId === workspaceId && routeSet.has(s.route));
}
