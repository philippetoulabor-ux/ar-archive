/// <reference types="vite/client" />

interface XRSystem {
  isSessionSupported(mode: string): Promise<boolean>
  requestSession(
    mode: string,
    options?: XRSessionInit,
  ): Promise<XRSession>
}

declare global {
  interface Navigator {
    xr?: XRSystem
  }

  class ImageCapture {
    constructor(videoTrack: MediaStreamTrack)
    takePhoto(photoSettings?: PhotoSettings): Promise<Blob>
  }
}

export {}
