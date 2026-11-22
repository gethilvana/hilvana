declare module 'tesseract-wasm' {
  export function createOCREngine(opts?: { wasmBinary?: Uint8Array | ArrayBuffer }): Promise<unknown>;
  export function supportsFastBuild(): boolean;
}
