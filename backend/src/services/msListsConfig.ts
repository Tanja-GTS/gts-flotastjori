import { optionalEnv, requireEnv } from '../utils/env';

export function getGraphConfig() {
  return {
    bearerToken: optionalEnv('GRAPH_BEARER_TOKEN', '').trim(),

    // For delegated/device-code auth, tenant can be a real tenant ID or a shortcut like "organizations".
    tenantId: optionalEnv('AZURE_TENANT_ID', 'organizations'),

    // Optional when using GRAPH_BEARER_TOKEN.
    clientId: optionalEnv('AZURE_CLIENT_ID', ''),

    // Optional: when present we use client_credentials (app-only). When absent, we use device-code flow.
    clientSecret: optionalEnv('AZURE_CLIENT_SECRET', ''),
    siteId: requireEnv('MS_SITE_ID'),
  };
}

export function getListIds() {
  return {
    shiftInstancesListId: requireEnv('MS_SHIFT_INSTANCES_LIST_ID'),
    shiftPatternsListId: requireEnv('MS_SHIFT_PATTERNS_LIST_ID'),
  };
}

export function getShiftInstancesFieldNames() {
  return {
    workspaceId: optionalEnv('LIST_FIELD_WORKSPACE_ID', 'workspaceId'),
    date: optionalEnv('LIST_FIELD_DATE', 'date'),
    templateId: optionalEnv('LIST_FIELD_TEMPLATE_ID', 'templateId'),
    patternId: optionalEnv('LIST_FIELD_PATTERN_ID', 'patternId'),
    driverId: optionalEnv('LIST_FIELD_DRIVER_ID', 'driverId'),
    busId: optionalEnv('LIST_FIELD_BUS_ID', 'busId'),
    confirmationStatus: optionalEnv('LIST_FIELD_CONFIRMATION_STATUS', 'confirmationStatus'),
    notes: optionalEnv('LIST_FIELD_NOTES', 'notes'),
    generated: optionalEnv('LIST_FIELD_GENERATED', 'generated'),
    manualOverride: optionalEnv('LIST_FIELD_MANUAL_OVERRIDE', 'manualOverride'),
  };
}

export function getShiftPatternsFieldNames() {
  return {
    route: optionalEnv('PATTERN_FIELD_ROUTE', 'route'),
    routeName: optionalEnv('PATTERN_FIELD_ROUTE_NAME', 'routeName'),
    shiftType: optionalEnv('PATTERN_FIELD_SHIFT_TYPE', 'shiftType'),
    // Optional: "weekdays" / "weekend" (or similar) to distinguish workdays vs weekend patterns.
    // If not set, code will also try common internal names like "ShiftType".
    weekPart: optionalEnv('PATTERN_FIELD_WEEK_PART', ''),
    dayOfWeek: optionalEnv('PATTERN_FIELD_DAY_OF_WEEK', 'dayOfWeek'),
    startTime: optionalEnv('PATTERN_FIELD_START_TIME', 'startTime'),
    endTime: optionalEnv('PATTERN_FIELD_END_TIME', 'endTime'),

    // Optional if you have it (not in your list yet)
    workspaceId: optionalEnv('PATTERN_FIELD_WORKSPACE_ID', ''),
    templateId: optionalEnv('PATTERN_FIELD_TEMPLATE_ID', ''),
  };
}
