import { env } from '../src/config/env.js';
import { BoniBotEngine } from '../src/bot/engine.js';
import { MetaWhatsAppClient } from '../src/whatsapp/metaClient.js';

const bot = new BoniBotEngine();
const whatsapp = new MetaWhatsAppClient();

interface VercelRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  body: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  send: (body: any) => void;
  json: (body: any) => void;
}

/**
 * Serverless Webhook Handler for Meta WhatsApp Cloud API (Vercel / Node compatible).
 * - GET /api/webhook: Verifies the webhook challenge from Meta.
 * - POST /api/webhook: Processes incoming WhatsApp messages within the free 24h Service Window.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // 1. Webhook Verification (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === env.whatsapp.verifyToken) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden: Invalid Verify Token');
    return;
  }

  // 2. Incoming WhatsApp Messages (POST)
  if (req.method === 'POST') {
    try {
      const entry = req.body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      // Ignore status updates (sent/delivered/read notifications)
      if (!message) {
        res.status(200).json({ status: 'ignored_no_message' });
        return;
      }

      const fromPhone: string = message.from;
      const messageId: string = message.id;
      const messageType: string = message.type;

      // Mark message as read (blue checks)
      await whatsapp.markAsRead(messageId);

      if (messageType !== 'text') {
        await whatsapp.sendTextMessage(
          fromPhone,
          '🦊 ¡Hola! Soy *BoniBot*, el asistente virtual del *Colegio San Bonifacio de las Lanzas*. Por el momento solo puedo leer mensajes de texto. ¿En qué te puedo colaborar?'
        );
        res.status(200).json({ status: 'non_text_handled' });
        return;
      }

      const userText: string = message.text?.body || '';
      const result = await bot.handleMessage(fromPhone, userText);

      await whatsapp.sendTextMessage(fromPhone, result.replyText);
      res.status(200).json({
        status: 'ok',
        provider: result.providerUsed,
        chunksUsed: result.retrievedChunks.length,
      });
    } catch (error: unknown) {
      console.error('Error en Webhook WhatsApp:', error);
      // Always return 200 to Meta so it doesn't retry infinitely on transient LLM errors
      res.status(200).json({ status: 'error_logged' });
    }
    return;
  }

  res.status(405).send('Method Not Allowed');
}
