export const Z = {
  DESKTOP: 1,
  WINDOW: 10,
  // Floating panels belong to a window but live above it, free of its frame —
  // party.webp's tool windows drift anywhere on the desktop. Still under the
  // taskbar so Start always wins.
  FLOATING: 500,
  TASKBAR: 1000,
  START_MENU: 2000,
  START_SUBMENU: 3000,
} as const;
