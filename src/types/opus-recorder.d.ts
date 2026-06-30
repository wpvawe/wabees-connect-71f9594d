declare module "opus-recorder" {
  export interface RecorderOptions {
    encoderPath?: string;
    encoderApplication?: number;
    encoderFrameSize?: number;
    encoderSampleRate?: number;
    numberOfChannels?: number;
    streamPages?: boolean;
    [key: string]: unknown;
  }
  export default class Recorder {
    constructor(options?: RecorderOptions);
    static isRecordingSupported(): boolean;
    ondataavailable: (data: Uint8Array) => void;
    start(): Promise<void>;
    stop(): Promise<void>;
    close(): void;
  }
}
