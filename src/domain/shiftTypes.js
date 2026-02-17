export const SHIFT_TYPES_ORDERED = ['morning', 'single', 'evening'];

export const SHIFT_TYPE_LABELS = {
  morning: 'Morning',
  single: 'Single',
  evening: 'Evening',
};

export function isShiftType(value) {
  return SHIFT_TYPES_ORDERED.includes(value);
}
