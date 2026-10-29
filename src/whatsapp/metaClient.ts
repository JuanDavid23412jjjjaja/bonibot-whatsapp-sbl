import { env } from '../config/env.js';

/**
 * Sends a text message or marks a message as read using Meta's official WhatsApp Cloud API (v21.0).
 */
export class MetaWhatsAppClient {
  private get baseUrl(): string {
    return `https://graph.facebook.com/v21.0/${env.whatsapp.phoneNumberId}/messages`;
  }

  public async markAsRead(messageId: string): Promise<void> {
    if (!env.whatsapp.accessToken || !env.whatsapp.phoneNumberId) return;

    try {
      await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.whatsapp.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
    } catch {
      // Non-critical if read receipt fails
    }
  }

  public async sendTextMessage(toPhone: string, bodyText: string): Promise<void> {
    if (!env.whatsapp.accessToken || !env.whatsapp.phoneNumberId) {
      throw new Error('Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.');
    }

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.whatsapp.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: bodyText.slice(0, 4096),
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Error enviando mensaje a WhatsApp (${res.status}): ${errText}`);
    }
  }
}
