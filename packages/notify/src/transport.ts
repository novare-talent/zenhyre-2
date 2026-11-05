export interface OutgoingEmail { to: string; subject: string; text: string }
export interface Transport { send(mail: OutgoingEmail): Promise<void> }

export class MemoryTransport implements Transport {
  sent: OutgoingEmail[] = [];
  async send(mail: OutgoingEmail) { this.sent.push(mail); }
}

/** Dev only: nothing is delivered; each email (sign-in and invite links included) is printed to the server log. */
export class ConsoleTransport implements Transport {
  async send(mail: OutgoingEmail) { console.log(`[email] to ${mail.to} | ${mail.subject}\n${mail.text}`); }
}

export class ResendTransport implements Transport {
  constructor(private apiKey: string, private from: string) {}
  async send(mail: OutgoingEmail) {
    const { Resend } = await import("resend");
    const r = new Resend(this.apiKey);
    const res = await r.emails.send({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
    if (res.error) throw new Error(res.error.message);
  }
}
