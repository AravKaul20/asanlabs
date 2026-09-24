/**
 * Speech. The same text goes to the voice and to the screen, always.
 *
 * Browsers gate speechSynthesis behind a user gesture, so `unlock` is called
 * from the Start button: without it the first cue of a session is silently
 * dropped and the screen and voice fall out of step.
 */

/** The narrow surface a session needs, so it can be driven without a browser. */
export interface Speaker {
  say(text: string): void;
  cancel(): void;
}

export class Voice implements Speaker {
  private enabled = true;
  private unlocked = false;

  get available(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  get muted(): boolean {
    return !this.enabled;
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted;
    if (muted) this.cancel();
  }

  /** Call from a click handler, once, to satisfy the browser's gesture rule. */
  unlock(): void {
    if (!this.available || this.unlocked) return;
    const primer = new SpeechSynthesisUtterance("");
    primer.volume = 0;
    window.speechSynthesis.speak(primer);
    this.unlocked = true;
  }

  say(text: string): void {
    if (!this.available || !this.enabled || text.length === 0) return;
    // One cue at a time: drop anything still queued rather than talking over it.
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.available) window.speechSynthesis.cancel();
  }
}
