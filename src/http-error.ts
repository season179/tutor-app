export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly payload?: JsonValue
  ) {
    super(message);
  }
}
