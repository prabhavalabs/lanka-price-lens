/**
 * The height of a control, in one place.
 *
 * Anything a person can type in, choose from, or press — an input, a select, a button, a toggle —
 * takes its height from here, so a row of them lines up without anyone measuring. A control that
 * sets its own `h-…` breaks that row for every reader, which is why the primitives interpolate
 * these and pages do not pass heights of their own.
 *
 * sm is for a control sitting inside a table row or a card's corner; default is the one a toolbar
 * uses; lg is for a form a page is built around.
 */
export const controlHeight = { sm: "h-8", default: "h-9", lg: "h-10" } as const;

export type ControlSize = keyof typeof controlHeight;
