// Every failure a user can fix by editing their script, their flags, or their
// environment extends this. cli.ts maps it to exit code 1; anything else is an
// internal fault and exits 2. Keeping the distinction in one place is what lets
// CI consumers key off the exit code, and stops a typo'd --preset from being
// reported as a bug in flowreel.
//
// The message *is* the user interface: write it in plain language, name the
// fix, and never let a stack trace stand in for it.
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
