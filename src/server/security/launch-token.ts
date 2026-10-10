import { randomBytes, timingSafeEqual } from "node:crypto";


export function createLaunchToken(): string {
  return randomBytes(32).toString("base64url");
}


export function verifyLaunchToken(expected: string, received: string | undefined): boolean {
  if (!received) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  if (expectedBytes.length !== receivedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, receivedBytes);
}
