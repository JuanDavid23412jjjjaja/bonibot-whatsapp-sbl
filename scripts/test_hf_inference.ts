import { BoniBotEngine } from '../src/bot/engine.js';

async function runBenchmark() {
  const engine = new BoniBotEngine();

  const fastPathQueries = [
    'Hola BoniBot',
    '¿A qué hora atiende a padres el profesor Juan David de TechnoScience?',
    '¿Cuál es el número de la póliza estudiantil y a qué clínica llevo a mi hijo en Ibagué?',
    '¿A qué hora entran y salen los estudiantes los viernes?',
    '¿Qué talleres Actívate hay por la tarde?',
    '¿Cuál es el menú del almuerzo de la semana?',
    '¿Qué requisitos hay para graduarse de grado once (IELTS y servicio social)?',
    '¿Qué pasa si un estudiante acumula llegadas tarde?',
    '¿Quién es la rectora del colegio?',
    '¿Cómo me uno al Plan Padrino del proyecto Carlo Acutis?',
  ];

  console.log('==================================================================');
  console.log('🚀 BENCHMARK DE VELOCIDAD Y PRECISIÓN ML — BONIBOT SBL');
  console.log('==================================================================\n');

  let totalFastMs = 0;

  for (let i = 0; i < fastPathQueries.length; i++) {
    const q = fastPathQueries[i];
    const t0 = Date.now();
    const res = await engine.handleMessage('573105872926', q);
    const dt = Date.now() - t0;
    totalFastMs += dt;

    console.log(`✅ Test #${i + 1}: "${q}"`);
    console.log(`   ⚡ Motor: ${res.providerUsed} | Modelo: ${res.modelUsed} | Latencia: ${dt} ms`);
    console.log(`   📝 Respuesta (extracto): ${res.replyText.replace(/\n+/g, ' ').slice(0, 110)}...\n`);
  }

  const avgMs = (totalFastMs / fastPathQueries.length).toFixed(1);
  console.log('------------------------------------------------------------------');
  console.log(`⚡ LATENCIA PROMEDIO TIER-0 (FastCache ML SBL): ${avgMs} ms por consulta`);
  console.log('------------------------------------------------------------------\n');

  // Test complex unseen article query (Routes to RAG + LLM Tier 1/2)
  const complexQuery =
    'Explícame detalladamente qué dice el Artículo 43 del Pacto de Convivencia sobre los derechos de los padres de familia y cómo se articula con el Consejo de Padres.';
  console.log(`🧠 Test Consulta Puntual Compleja (Ruta RAG + LLM):\n   "${complexQuery}"`);
  const tComplex = Date.now();
  const complexRes = await engine.handleMessage('573105872926', complexQuery);
  console.log(
    `   🤖 Motor Usado: ${complexRes.providerUsed} (${complexRes.modelUsed}) | Latencia: ${Date.now() - tComplex} ms`
  );
  console.log(`   📝 Respuesta:\n${complexRes.replyText.slice(0, 350)}...\n`);
  console.log('==================================================================');
}

runBenchmark().catch(console.error);
