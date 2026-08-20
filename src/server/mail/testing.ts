import 'server-only';

import { readCapturedMessages, resetCapturedMessages } from './capture-store';

function assertTestEnvironment(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Los mensajes capturados solo están disponibles en pruebas del servidor');
  }
}

export function readCapturedMessagesForTests() {
  assertTestEnvironment();
  return readCapturedMessages();
}

export function resetCapturedMessagesForTests(): void {
  assertTestEnvironment();
  resetCapturedMessages();
}
