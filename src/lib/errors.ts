export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  issues?: unknown;
  constructor(message: string, issues?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}
