import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register()

// Happy DOM keeps MutationObserver listeners only through WeakRef, so GC can silently kill them.
// The only WeakRef it builds inside observe() holds the listener callback; its query and
// computed-style caches hold DOM nodes and must stay collectable, hence the function filter.
// Reading listeners back via PropertySymbol.mutationListeners would be more direct, but it needs a
// declared happy-dom dep and breaks if that ever resolves to a second copy. Swap WeakRef instead.
const pinnedMutationCallbacks = new WeakMap<MutationObserver, Function[]>()
const nativeMutationObserve = MutationObserver.prototype.observe
MutationObserver.prototype.observe = function (target: Node, options?: MutationObserverInit) {
  const pinned = pinnedMutationCallbacks.get(this) ?? []
  pinnedMutationCallbacks.set(this, pinned)
  const NativeWeakRef = globalThis.WeakRef
  globalThis.WeakRef = class<T extends WeakKey> extends NativeWeakRef<T> {
    constructor(value: T) {
      super(value)
      if (typeof value === "function") pinned.push(value)
    }
  }
  try {
    return nativeMutationObserve.call(this, target, options)
  } finally {
    globalThis.WeakRef = NativeWeakRef
  }
}

const originalGetContext = HTMLCanvasElement.prototype.getContext
// @ts-expect-error - we're overriding with a simplified mock
HTMLCanvasElement.prototype.getContext = function (contextType: string, _options?: unknown) {
  if (contextType === "2d") {
    return {
      canvas: this,
      fillStyle: "#000000",
      strokeStyle: "#000000",
      font: "12px monospace",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      imageSmoothingEnabled: true,
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 10,
      shadowBlur: 0,
      shadowColor: "rgba(0, 0, 0, 0)",
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: (text: string) => ({ width: text.length * 8 }),
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
      rotate: () => {},
      translate: () => {},
      transform: () => {},
      setTransform: () => {},
      resetTransform: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createPattern: () => null,
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
      arcTo: () => {},
      ellipse: () => {},
      rect: () => {},
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      isPointInPath: () => false,
      isPointInStroke: () => false,
      getTransform: () => ({}),
      getImageData: () => ({
        data: new Uint8ClampedArray(0),
        width: 0,
        height: 0,
      }),
      putImageData: () => {},
      createImageData: () => ({
        data: new Uint8ClampedArray(0),
        width: 0,
        height: 0,
      }),
    } as unknown as CanvasRenderingContext2D
  }
  return originalGetContext.call(this, contextType as "2d", _options)
}
