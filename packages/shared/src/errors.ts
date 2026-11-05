export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "DomainError";
  }
}
export class NotFound extends DomainError {
  constructor(what: string) { super("not_found", `${what} not found`, 404); }
}
export class Forbidden extends DomainError {
  constructor(msg = "forbidden") { super("forbidden", msg, 403); }
}
export class Invalid extends DomainError {
  constructor(msg: string) { super("invalid", msg, 400); }
}
export class IllegalTransition extends DomainError {
  constructor(from: string, to: string) { super("illegal_transition", `${from} -> ${to}`, 409); }
}
