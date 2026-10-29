import { BoniBotEngine } from '../src/bot/engine.js';

async function testBot() {
  const bot = new BoniBotEngine();
  const testPhone = '573001234567';

  console.log('--- Probando BoniBot con pregunta de incumplimiento leve ---');
  const res = await bot.handleMessage(testPhone, 'Hola, dime un ejemplo de incumplimiento leve');
  console.log(`\n🦊 Proveedor usado: ${res.providerUsed} (${res.modelUsed}) en ${res.latencyMs}ms`);
  console.log('\n--- Respuesta: ---');
  console.log(res.replyText);
  console.log('\n--- Chunks RAG usados: ---');
  res.retrievedChunks.forEach((c, i) => console.log(`${i + 1}. [${c.source}] ${c.section}`));
}

testBot().catch(console.error);
