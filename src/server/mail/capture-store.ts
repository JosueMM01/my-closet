import type { CapturedMailMessage } from './types';

const MAX_CAPTURED_MESSAGES = 100;
const messages: CapturedMailMessage[] = [];

export function appendCapturedMessage(message: CapturedMailMessage): void {
  messages.push({ ...message });
  if (messages.length > MAX_CAPTURED_MESSAGES) {
    messages.splice(0, messages.length - MAX_CAPTURED_MESSAGES);
  }
}

export function readCapturedMessages(): CapturedMailMessage[] {
  return messages.map((message) => ({ ...message }));
}

export function resetCapturedMessages(): void {
  messages.length = 0;
}
