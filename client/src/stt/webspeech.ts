import { TECH_TERMS } from '../../../shared/vocabulary.ts';

// TypeScript's DOM lib doesn't include speech recognition; these cover what Metor uses.
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  phrases?: unknown[];
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** Chrome 135+ and Firefox 160+ accept a track; older browsers ignore it and open the default mic. */
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;
type PhraseCtor = new (phrase: string, boost: number) => unknown;

export function speechRecognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export interface WebSpeechHandlers {
  onPartial(text: string): void;
  /**
   * Raw final text. `startedAt`: when the first interim result for it arrived (≈ speech start);
   * `delayMs`: time from the last interim result to this final.
   */
  onFinal(text: string, startedAt: number, delayMs: number): void;
  /** Fatal errors stop recognition; the caller should release the mic. */
  onFatal(message: string): void;
}

export interface WebSpeech {
  pause(): void;
  resume(): void;
  stop(): void;
}

const FATAL_ERRORS: Record<string, string> = {
  'not-allowed': 'The browser blocked speech recognition. Allow the microphone and try again.',
  'service-not-allowed': 'This browser does not allow its speech service here. Try Chrome or Edge, or another mode.',
  'audio-capture': 'Speech recognition could not read the microphone.',
  'language-not-supported': 'Speech recognition does not support English (US) in this browser.',
};
const MAX_NETWORK_ERRORS = 3;
const MAX_RESTARTS_PER_10S = 5;

/**
 * Continuous recognition that restarts itself when the browser ends it (Chrome stops after
 * silence or about a minute). Fatal errors and restart loops are reported once via onFatal.
 */
export function startWebSpeech(track: MediaStreamTrack, handlers: WebSpeechHandlers): WebSpeech {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) throw new Error('Speech recognition is not available in this browser.');
  const Phrase = (window as unknown as { SpeechRecognitionPhrase?: PhraseCtor }).SpeechRecognitionPhrase;

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  let usePhrases = Boolean(Phrase);
  let listening = true; // should be recognizing (not paused or stopped)
  let running = false; // the browser has started and not yet ended
  let stopped = false;
  let networkErrors = 0;
  let restarts: number[] = [];
  let lastInterimAt = Date.now();
  let fragmentStartedAt: number | null = null;

  const fail = (message: string) => {
    if (stopped) return;
    stopped = true;
    listening = false;
    recognition.abort();
    handlers.onFatal(message);
  };

  const begin = () => {
    // Boosting technical terms helps where supported (Chrome 142+); some setups reject it.
    recognition.phrases = usePhrases && Phrase ? TECH_TERMS.map((term) => new Phrase(term, 3)) : [];
    try {
      recognition.start(track);
      running = true;
    } catch (err) {
      fail(`Speech recognition failed to start: ${(err as Error).message}`);
    }
  };

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result?.[0]?.transcript ?? '';
      if (result?.isFinal) {
        const final = text.trim();
        const now = Date.now();
        if (final) handlers.onFinal(final, fragmentStartedAt ?? now, now - lastInterimAt);
        fragmentStartedAt = null;
      } else {
        interim += text;
      }
    }
    networkErrors = 0;
    if (interim.trim()) {
      lastInterimAt = Date.now();
      fragmentStartedAt ??= lastInterimAt;
      handlers.onPartial(interim.trim());
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return; // silence; onend restarts
    if (event.error === 'phrases-not-supported') {
      usePhrases = false;
      return;
    }
    if (event.error === 'network') {
      networkErrors += 1;
      if (networkErrors >= MAX_NETWORK_ERRORS) fail("Can't reach the browser's speech service. Check the connection or switch modes.");
      return;
    }
    fail(FATAL_ERRORS[event.error] ?? `Speech recognition error: ${event.error}`);
  };

  recognition.onend = () => {
    running = false;
    if (!listening || stopped) return;
    const now = Date.now();
    restarts = [...restarts.filter((t) => now - t < 10_000), now];
    if (restarts.length > MAX_RESTARTS_PER_10S) {
      fail('Speech recognition keeps stopping. Try reloading the page or another mode.');
      return;
    }
    begin();
  };

  begin();

  return {
    pause() {
      listening = false;
      recognition.stop(); // delivers any pending final
    },
    resume() {
      if (stopped || listening) return;
      listening = true;
      if (!running) begin(); // otherwise onend restarts it
    },
    stop() {
      stopped = true;
      listening = false;
      recognition.stop();
    },
  };
}
