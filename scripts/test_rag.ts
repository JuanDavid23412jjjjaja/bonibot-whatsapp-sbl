import { HybridRetriever } from '../src/rag/retriever.js';

async function main() {
  const retriever = new HybridRetriever();
  const stats = await retriever.getStats();

  console.log('==================================================================');
  console.log('🧪 PRUEBA AUTOMÁTICA DE PRECISIÓN RAG — COLEGIO SAN BONIFACIO SBL');
  console.log(`📦 Fragmentos cargados: ${stats.totalChunks} | Modo: ${stats.mode}`);
  console.log('==================================================================\n');

  const sampleQuestions = [
    '¿Cuál es el número de la póliza de seguro estudiantil y a qué clínicas puedo llevar a mi hijo en Ibagué?',
    '¿Cuánto cuesta la matrícula y la pensión para grado quinto en 2026 y qué recargo hay si pago el día 15?',
    '¿Qué requisitos especiales deben cumplir los estudiantes de grado once para graduarse (IELTS y servicio social)?',
    '¿A qué hora entran y salen los niños del Ciclo Exploratorio y Conceptual los viernes?',
    '¿Qué pasa si un estudiante acumula 3 llegadas tarde o usa el celular en clase?',
    '¿A qué hora atiende a padres el profesor Juan David de TechnoScience y cuándo hay taller Actívate de robótica?',
  ];

  for (let i = 0; i < sampleQuestions.length; i++) {
    const q = sampleQuestions[i];
    console.log(`❓ Pregunta ${i + 1}: "${q}"`);
    const results = await retriever.retrieve(q, 3);
    for (const r of results) {
      console.log(`   🎯 [Score: ${r.score.toFixed(1)}] ${r.source} ➔ ${r.section}`);
    }
    console.log('');
  }
}

main().catch(console.error);
