export const translations = {
  en: {
    lang: {
      label: 'Language',
      en: 'English',
      is: 'Icelandic',
    },
    common: {
      workspace: 'Workspace',
      month: 'Month',
      year: 'Year',
      go: 'Go',
      cancel: 'Cancel',
      today: 'Today',
      print: 'Print',
      back: 'Back',
      driver: 'Driver',
      unassigned: 'Unassigned',
      unassignedUpper: 'UNASSIGNED',
      loading: 'Loading…',
    },
    timeline: {
      generateMonth: 'Generate month',
      addShift: '+ Add shift',
      saveShift: 'Save shift',
      showUnassignedOnly: 'Unassigned shifts',
      loadingShifts: 'Loading shifts…',
      noShiftToday: 'No shift today',
      noBusAssigned: 'No bus assigned',
      view1Week: '1 Week',
      view2Weeks: '2 Weeks',
    },
    printDay: {
      titleHint: 'Daily driving overview',
      noTrips: 'No trips for this day',
    },
    confirm: {
      title: 'Shift confirmation',
      loadingShift: 'Loading shift…',
      invalidLink: 'Invalid or expired link',
      acceptShift: 'Accept shift',
      declineShift: 'Decline shift',
      acceptWeek: 'Accept week',
      declineWeek: 'Decline week',
      promptShift: 'Please confirm or decline this shift.',
      promptWeek: 'Please confirm or decline the whole week.',
      weekAccepted: 'Week accepted',
      weekDeclined: 'Week declined',
      shiftAccepted: 'Shift accepted',
      shiftDeclined: 'Shift declined',
      responseSaved: 'Your response has been saved.',
      couldNotUpdate: 'Could not update',
      failedToUpdate: 'Failed to update shift',
      currentStatus: 'Current status:',
      tokenLabel: 'Token:',
      shiftsInWeek: 'Shifts in this week',
      greeting: 'Hey, {name}!',
      assignedWeek:
        'You have been assigned shifts for {routeName}{routeCodePart} ({shiftType}){weekPartPart} for the week {weekRange}.',
      assignedShift:
        'You have been assigned for {routeName}{routeCodePart} ({time}){weekPartPart} for the week {weekRange}.',
    },
    errors: {
      failedLoadShifts: 'Failed to load shifts',
      failedGenerateShifts: 'Failed to generate shifts',
      failedLoadShift: 'Failed to load shift',
      somethingWentWrong: 'Something went wrong.',
    },
  },

  // Fill these in when ready. Any missing keys automatically fall back to English.
  is: {
    lang: {
      label: 'Tungumál',
      en: 'Enska',
      is: 'Íslenska',
    },
  },
};
