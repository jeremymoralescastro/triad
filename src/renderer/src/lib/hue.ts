/** Wraps a color so it follows the accent hue slider (--hue, in degrees, set on <html>). Blues in, shifted colors out. */
export const hueShift = (c: string) => `hsl(from ${c} calc(h + var(--hue, 0)) s l)`
/** the hue of Triad's original accent blue (#4c8dff), used to draw the slider's rainbow */
export const BASE_HUE = 218
