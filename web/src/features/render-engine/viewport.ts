export interface ViewTransform { scale: number; x: number; y: number }
export const FIT: ViewTransform = { scale: 1, x: 0, y: 0 }

/** Zoom about a point relative to the viewport centre. */
export function zoomAt(view: ViewTransform, scale: number, x = 0, y = 0): ViewTransform {
  const next = Math.max(1, Math.min(8, scale))
  const ratio = next / view.scale
  return { scale: next, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio }
}
export function constrain(view: ViewTransform, image: { width: number; height: number }, viewport: { width: number; height: number }): ViewTransform {
  const limitX = Math.max(0, (image.width * view.scale - viewport.width) / 2)
  const limitY = Math.max(0, (image.height * view.scale - viewport.height) / 2)
  return { scale: view.scale, x: Math.max(-limitX, Math.min(limitX, view.x)), y: Math.max(-limitY, Math.min(limitY, view.y)) }
}
