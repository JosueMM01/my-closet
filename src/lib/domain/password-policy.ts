/** Shared policy for NEW passwords only. Never normalize the stored credential. */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_HINT = 'Entre 15 y 128 caracteres. Puedes usar una frase; evita contraseñas comunes.';

// A small local denylist, not a complete breach-corpus lookup. No password is
// sent to a third party. Compare whole values, never words inside a passphrase.
const COMMON_PASSWORDS = new Set([
  'password123456789',
  'qwertyuiopasdfgh',
  'qwertyuiopasdfghjkl',
  'abcdefghijklmnopqrstuvwxyz',
  '123456789012345',
  '1234567890123456',
  '12345678901234567890',
  '0123456789012345',
  '9876543210987654',
  'mycloset123456789',
  'myclosetmycloset',
]);
const REPEATED_CHARACTER = /^(.)\1+$/u;
const REPEATED_COMMON_PATTERN = /^(?:password|contraseña|contrasena|qwerty|letmein|1234567890|0123456789|12345678|87654321|1234|abcd)+$/i;

function repeatsShortPattern(value: string): boolean {
  for (let length = 1; length <= 4 && value.length >= length * 3; length++) {
    const prefix = value.slice(0, length);
    if (prefix.repeat(Math.ceil(value.length / length)).slice(0, value.length) === value) return true;
  }
  return false;
}

export function newPasswordPolicyError(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `La contraseña no puede superar ${PASSWORD_MAX_LENGTH} caracteres`;
  }
  // Trimming/case-folding is ONLY for the denylist; return the original value
  // unchanged so whitespace and case remain significant when authenticating.
  const candidate = value.trim().toLowerCase();
  if (!candidate || candidate.length === 1 || COMMON_PASSWORDS.has(candidate) || REPEATED_CHARACTER.test(candidate)
    || REPEATED_COMMON_PATTERN.test(candidate) || repeatsShortPattern(candidate)) {
    return 'Esta contraseña es demasiado común o predecible. Elige una frase diferente.';
  }
  return null;
}
