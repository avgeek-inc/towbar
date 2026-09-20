export class NotificationProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly providerStatus?: string,
  ) {
    super(message);
    this.name = "NotificationProviderError";
  }
}
