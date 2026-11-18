/** Emscripten module built by scripts/espeak/build.sh. */
export interface EspeakModule {
  ccall(name: 'kr_init', returnType: 'number', argTypes: ['string', 'string'], args: [string, string]): number;
  ccall(name: 'kr_phonemize', returnType: 'string', argTypes: ['string'], args: [string]): string;
}

export default function createEspeak(options?: { locateFile?: (path: string, prefix: string) => string }): Promise<EspeakModule>;
