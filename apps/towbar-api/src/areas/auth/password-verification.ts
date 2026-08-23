import { verifyPassword } from "@workspace/towbar-core/security";

import { getEnv } from "../../env.js";
import { HttpError } from "../../http/errors.js";

export class PasswordVerificationGate {
  readonly #maximumActive: number;
  readonly #maximumWaiting: number;
  #active = 0;
  #waiting: Array<() => void> = [];

  constructor(maximumActive: number, maximumWaiting: number) {
    this.#maximumActive = maximumActive;
    this.#maximumWaiting = maximumWaiting;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await operation();
    } finally {
      this.#release();
    }
  }

  async #acquire() {
    if (this.#active < this.#maximumActive) {
      this.#active += 1;
      return;
    }
    if (this.#waiting.length >= this.#maximumWaiting) {
      throw new HttpError(
        503,
        "AUTHENTICATION_BUSY",
        "Sign-in is busy. Try again shortly",
      );
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
  }

  #release() {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#active -= 1;
  }
}

let gate: PasswordVerificationGate | undefined;

export async function verifyPasswordWithCapacityLimit(
  password: string,
  encodedHash: string,
) {
  return await runPasswordOperationWithCapacityLimit(() =>
    verifyPassword(password, encodedHash),
  );
}

export async function runPasswordOperationWithCapacityLimit<T>(
  operation: () => Promise<T>,
) {
  const env = getEnv();
  gate ??= new PasswordVerificationGate(
    env.TOWBAR_PASSWORD_VERIFY_CONCURRENCY,
    env.TOWBAR_PASSWORD_VERIFY_QUEUE_LIMIT,
  );
  return await gate.run(operation);
}
