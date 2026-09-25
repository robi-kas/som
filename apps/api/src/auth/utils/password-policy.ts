import { BadRequestException } from '@nestjs/common';

// Short passwords are OK here because the account locks for 15 minutes after 5 wrong tries,
// so guessing is slow. Very common passwords are still refused.
export const MIN_PASSWORD_LENGTH = 6;
const TOO_COMMON = new Set(['123456', '1234567', '12345678', '123456789', 'password', 'qwerty', '111111', '000000', 'abc123', 'admin123', 'cafe123', 'letmein']);

export function enforcePasswordPolicy(password: string) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > 128) {
    throw new BadRequestException('Password must be at most 128 characters');
  }
  if (TOO_COMMON.has(password.toLowerCase())) {
    throw new BadRequestException('That password is too easy to guess — pick something else');
  }
}
