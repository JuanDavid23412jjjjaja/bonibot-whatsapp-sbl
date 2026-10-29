import readline from 'readline';
import { BoniBotEngine } from '../src/bot/engine.js';
import { getConfiguredLLMProviders } from '../src/config/env.js';

async function main() {
  const bot = new BoniBotEngine();
  const providers = getConfiguredLLMProviders();
  const testPhone = '573001234567';

  console.log('\n======================================================================');
  console.log('🦊 SIMULADOR WHATSAPP — BONIBOT (COLEGIO SAN BONIFACIO DE LAS LANZAS)');
  console.log('======================================================================');
  console.log(
    `🔌 Proveedores LLM en .env: ${
      providers.length > 0
        ? providers.join(' ➔ ')
        : '⚠️ Ninguno aún (Funcionando en Modo Vista Previa RAG Extractivo)'
    }`
  );
  console.log('💡 Comandos útiles: /estado | /reset | salir');
  console.log('======================================================================\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = () => {
    rl.question('\n📱 Tú (WhatsApp): ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        promptUser();
        return;
      }
      if (/^(salir|exit|quit)$/i.test(trimmed)) {
        console.log('\n👋 ¡Hasta luego! Cerrando simulador de BoniBot.');
        rl.close();
        return;
      }

      try {
        process.stdout.write('⏳ BoniBot consultando documentos oficiales SBL y redactando respuesta...\r');
        const res = await bot.handleMessage(testPhone, trimmed);
        process.stdout.write('                                                                               \r');
        console.log(`\n🦊 BoniBot [${res.providerUsed} | ${res.latencyMs}ms]:`);
        console.log('----------------------------------------------------------------------');
        console.log(res.replyText);
        console.log('----------------------------------------------------------------------');
        if (res.retrievedChunks.length > 0) {
          console.log(
            `📚 Fuentes RAG usadas: ${res.retrievedChunks
              .slice(0, 3)
              .map((c) => `${c.section}`)
              .join(' | ')}`
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n❌ Error: ${msg}`);
      }

      promptUser();
    });
  };

  promptUser();
}

main().catch(console.error);
