// Voice: the customer's last words, until their transcript is stored.
//
// A save is checked on the server against what the customer last said
// (confirm before write, src/lib/agent/confirm.ts), and transcription often
// finishes after the model has already called the tool. So a tool call waits
// until the latest item's transcript is reported, at most `waitMs` (without
// it the server just asks the model to confirm again). Pure, so it's tested.
export interface LastWords {
  // The customer started a new item (conversation.item.added).
  spoken(itemId: string): void;
  // Its transcript was reported, or transcription failed.
  transcribed(itemId: string): void;
  // Resolves once the latest item is transcribed, or after waitMs. One shared
  // wait per item, so tool calls that wait on it keep their order.
  ready(): Promise<void>;
  reset(): void;
}

// Transcripts that came before their item, remembered this many at most.
const EARLY_LIMIT = 20;

export function lastWords(waitMs: number): LastWords {
  let latest: { itemId: string; transcribed: Promise<void>; done: () => void; wait?: Promise<void> } | null = null;
  // Realtime doesn't promise that an item is announced before its transcript.
  const early = new Set<string>();

  return {
    spoken(itemId) {
      let done = () => {};
      const transcribed = new Promise<void>((resolve) => (done = resolve));
      latest = { itemId, transcribed, done };
      if (early.delete(itemId)) done();
    },
    transcribed(itemId) {
      if (latest?.itemId === itemId) return latest.done();
      early.add(itemId);
      if (early.size > EARLY_LIMIT) early.delete(early.values().next().value!);
    },
    ready() {
      const words = latest;
      if (!words) return Promise.resolve();
      words.wait ??= Promise.race([words.transcribed, new Promise<void>((resolve) => setTimeout(resolve, waitMs))]);
      return words.wait;
    },
    reset() {
      latest = null;
      early.clear();
    },
  };
}
