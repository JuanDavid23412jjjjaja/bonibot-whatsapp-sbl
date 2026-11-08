import * as fs from 'node:fs';
import * as path from 'node:path';

interface ChatMessage {
  role: string;
  content: string;
}

interface DatasetRow {
  messages: ChatMessage[];
  metadata?: {
    source: string;
    category: string;
  };
}

function validateDataset(): void {
  const filePath = path.resolve(process.cwd(), 'data', 'sbl_training_dataset.jsonl');
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo de dataset: ${filePath}`);
  }

  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let validCount = 0;
  let maxChars = 0;
  let totalChars = 0;
  const categories: Record<string, number> = {};
  const sources: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const row: DatasetRow = JSON.parse(lines[i]);
    if (!Array.isArray(row.messages) || row.messages.length !== 3) {
      throw new Error(`Fila ${i + 1}: Se esperaban exactamente 3 mensajes (system, user, assistant).`);
    }

    const [sys, usr, ast] = row.messages;
    if (sys.role !== 'system' || usr.role !== 'user' || ast.role !== 'assistant') {
      throw new Error(`Fila ${i + 1}: Roles inválidos (${sys.role}, ${usr.role}, ${ast.role}).`);
    }

    if (!usr.content.trim() || !ast.content.trim()) {
      throw new Error(`Fila ${i + 1}: Contenido vacío en user o assistant.`);
    }

    const charLen = sys.content.length + usr.content.length + ast.content.length;
    if (charLen > maxChars) maxChars = charLen;
    totalChars += charLen;

    const cat = row.metadata?.category || 'Sin categoría';
    const src = row.metadata?.source || 'Sin fuente';
    categories[cat] = (categories[cat] || 0) + 1;
    sources[src] = (sources[src] || 0) + 1;
    validCount++;
  }

  const approxAvgTokens = Math.round(totalChars / validCount / 4);
  const approxMaxTokens = Math.round(maxChars / 4);

  console.log('==================================================================');
  console.log('🔍 VALIDACIÓN DE CALIDAD DEL DATASET SBL (ChatML JSONL)');
  console.log('==================================================================');
  console.log(`✅ Filas válidas verificadas: ${validCount} / ${lines.length}`);
  console.log(`📏 Promedio estimado tokens/ejemplo: ~${approxAvgTokens} tokens`);
  console.log(`📐 Máximo estimado tokens/ejemplo:   ~${approxMaxTokens} tokens (Límite Qwen/SmolLM: 2048)`);
  console.log('\n📚 Distribución por Categoría:');
  for (const [k, v] of Object.entries(categories)) {
    console.log(`   • ${k}: ${v} ejemplos`);
  }
  console.log('==================================================================');
}

validateDataset();
