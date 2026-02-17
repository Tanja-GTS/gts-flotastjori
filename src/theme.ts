// src/theme.ts
import { createTheme, type ButtonProps } from '@mantine/core';
import { createElement } from 'react';
import { IconChevronDown } from '@tabler/icons-react';

export const theme = createTheme({
  fontFamily: "'Space Grotesk', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 6 },
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
  },
  defaultRadius: 'sm',

  // Neutral-first UI, readable, businesslike.
  colors: {
    // Primary brand color used by default for filled buttons and other primary controls.
    // Shade 6 is the base shade in both light/dark mode.
    brand: [
      '#e6f2ef',
      '#cfe5e0',
      '#a1ccc2',
      '#73b2a4',
      '#459986',
      '#1f6f60',
      '#06211A',
      '#041a14',
      '#03130f',
      '#020c0a',
    ],
  },

  components: {
    Button: {
      defaultProps: { radius: 'sm' },
      vars: (_theme: unknown, _props: ButtonProps) => ({
        root: {
          '--button-radius': '6px',
        },
      }),
    },
    Drawer: {
      defaultProps: { radius: 0 },
    },
    Select: {
      defaultProps: {
        radius: 'sm',
        rightSection: createElement(IconChevronDown, {
          className: 'app-select-chev',
          size: 20,
          'aria-hidden': true,
        }),
        rightSectionWidth: 40,
        rightSectionPointerEvents: 'none',
      },
    },
    MultiSelect: {
      defaultProps: {
        radius: 'sm',
        rightSection: createElement(IconChevronDown, {
          className: 'app-select-chev',
          size: 20,
          'aria-hidden': true,
        }),
        rightSectionWidth: 40,
        rightSectionPointerEvents: 'none',
      },
    },
    Checkbox: {
      defaultProps: { radius: 'sm' },
    },
  },
});
