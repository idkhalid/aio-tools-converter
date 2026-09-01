declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      imageData: { data: Uint8ClampedArray; width: number; height: number },
      callback: (data: unknown) => void,
    ): void;
    free?(): void;
  }

  interface HeifModule {
    HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
  }

  const libheifFactory: () => Promise<HeifModule>;
  export default libheifFactory;
}
