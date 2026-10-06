export const Z = {
  DESKTOP: 1,
  // fluid.exe's ink, spilled out as wallpaper: on the desktop, but under
  // anything else that has got loose of its window — party.webp's crowd
  // wanders at 5 and should be seen walking over it.
  WALLPAPER: 2,
  WINDOW: 10,
  // Floating panels belong to a window but live above it, free of its frame —
  // party.webp's tool windows drift anywhere on the desktop. Still under the
  // taskbar so Start always wins.
  FLOATING: 500,
  TASKBAR: 1000,
  START_MENU: 2000,
  START_SUBMENU: 3000,
  // paint.exe's Grab: a sheet of glass over the whole page, menus and all,
  // for as long as it takes to drag a box round something.
  GRAB: 4000,
} as const;
