import workletUrl from './pcm-worklet.ts?worker&url';

export interface Capture {
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Stops the mic tracks and closes audio processing. Safe to call more than once. */
  stop(): void;
}

/**
 * Opens the microphone (this triggers the browser permission prompt) and calls `onFrame` with
 * 100 ms PCM16 frames. Pause suspends processing but keeps the mic open; stop releases it.
 */
export async function startCapture(onFrame: (frame: Int16Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };

  try {
    await context.audioWorklet.addModule(workletUrl);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'pcm16-framer', { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (event: MessageEvent<Int16Array>) => {
      if (!stopped) onFrame(event.data);
    };
    source.connect(node);
  } catch (err) {
    stop();
    throw err;
  }

  return {
    pause: () => context.suspend(),
    resume: () => context.resume(),
    stop,
  };
}
