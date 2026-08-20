export type MailDelivery = 'disabled' | 'captured' | 'sent';

export interface OutboundMailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailProvider {
  readonly kind: 'disabled' | 'capture' | 'smtp';
  send(message: OutboundMailMessage): Promise<MailDelivery>;
}

export interface CapturedMailMessage extends OutboundMailMessage {
  from: string;
  capturedAt: string;
}
