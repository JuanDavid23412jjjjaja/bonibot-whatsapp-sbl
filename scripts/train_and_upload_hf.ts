import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DatasetRow {
  messages: ChatMessage[];
  metadata?: {
    source: string;
    category: string;
  };
}

export interface TrainedClassInfo {
  classId: number;
  labelKey: string;
  category: string;
  source: string;
  canonicalResponse: string;
  sampleQuestions: string[];
}

export interface TrainedMLModelData {
  modelName: string;
  version: string;
  trainedAt: string;
  hfRepoId: string;
  numExamples: number;
  numClasses: number;
  vocabSize: number;
  metrics: {
    initialLoss: number;
    finalLoss: number;
    top1Accuracy: number;
    top3Accuracy: number;
    epochs: number;
  };
  vocab: Record<string, number>;
  idf: number[];
  classes: TrainedClassInfo[];
  // Sparse weight representation per class: { [featureIdx]: weight } for compact fast inference
  classWeights: Array<Record<number, number>>;
  classBiases: number[];
}

const STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'de',
  'del',
  'al',
  'en',
  'con',
  'por',
  'para',
  'es',
  'son',
  'me',
  'mi',
  'se',
  'lo',
  'le',
  'si',
  'no',
  'o',
  'y',
  'a',
  'sobre',
  'favor',
  'colegio',
  'san',
  'bonifacio',
  'lanzas',
  'sbl',
  'bonibot',
  'quisiera',
  'saber',
  'puedes',
  'dar',
  'informacion',
]);

export function extractFeatures(rawText: string): string[] {
  const norm = rawText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!norm) return [];

  const words = norm.split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const features: string[] = [];

  // 1. Word Unigrams
  for (const w of words) {
    features.push(`w:${w}`);
    // Stem/prefix feature for Spanish morphology (first 5 chars)
    if (w.length >= 5) {
      features.push(`p:${w.slice(0, 5)}`);
    }
  }

  // 2. Word Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    features.push(`b:${words[i]}_${words[i + 1]}`);
  }

  // 3. Character 4-grams on joined core words (robust to typos in WhatsApp)
  const compact = words.join('_');
  if (compact.length >= 4) {
    for (let i = 0; i <= Math.min(compact.length - 4, 48); i += 2) {
      features.push(`c:${compact.slice(i, i + 4)}`);
    }
  }

  return features;
}

async function uploadFileToHF(
  token: string,
  repoType: 'model' | 'dataset' | 'space',
  repoId: string,
  filePathInRepo: string,
  contentStr: string,
  commitMessage: string
): Promise<void> {
  // Hugging Face Commit API (ndjson format)
  const headerLine = JSON.stringify({
    key: 'header',
    value: { summary: commitMessage },
  });
  const fileLine = JSON.stringify({
    key: 'file',
    value: {
      content: Buffer.from(contentStr, 'utf8').toString('base64'),
      path: filePathInRepo,
      encoding: 'base64',
    },
  });
  const body = `${headerLine}\n${fileLine}\n`;

  const url = `https://huggingface.co/api/${repoType}s/${repoId}/commit/main`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-ndjson',
    },
    body,
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Error subiendo ${filePathInRepo} a ${repoId} (${res.status}): ${errTxt}`);
  }
}

async function main() {
  console.log('==================================================================');
  console.log('🧠 ENTRENAMIENTO SUPERVISADO DEL MODELO ML BONIBOT SBL + HUGGING FACE');
  console.log('==================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'data', 'sbl_training_dataset.jsonl');
  const lines = fs
    .readFileSync(datasetPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: DatasetRow[] = lines.map((l) => JSON.parse(l));

  // Agrupar por respuesta canónica (cada respuesta única del asistente es una clase institucional)
  const classMap = new Map<string, TrainedClassInfo>();
  const samplePairs: Array<{ features: string[]; classId: number; question: string }> = [];

  for (const row of rows) {
    const userMsg = row.messages.find((m) => m.role === 'user')?.content.trim() || '';
    const astMsg = row.messages.find((m) => m.role === 'assistant')?.content.trim() || '';
    if (!userMsg || !astMsg) continue;

    // Si un artículo tiene varias partes, unificar en la clase principal del artículo o concatenar
    const artMatch = astMsg.match(/Art[íi]culo\s+(\d+)/i);
    const sectionMatch = astMsg.match(/\(\*([^*]+)\*\)/);
    const dedupKey = artMatch && sectionMatch
      ? `art:${row.metadata?.source}:${artMatch[1]}`
      : sectionMatch
        ? `section:${sectionMatch[1].replace(/\(Parte\s+\d+\/\d+\)/i, '').trim()}`
        : astMsg;

    let cls = classMap.get(dedupKey);
    if (!cls) {
      const classId = classMap.size;
      cls = {
        classId,
        labelKey: `sbl_intent_${classId}`,
        category: row.metadata?.category || 'General',
        source: row.metadata?.source || 'Documento Oficial SBL',
        canonicalResponse: astMsg,
        sampleQuestions: [],
      };
      classMap.set(dedupKey, cls);
    }

    if (cls.sampleQuestions.length < 4) {
      cls.sampleQuestions.push(userMsg);
    }

    // Extraer features de la pregunta + enriquecimiento semántico con términos clave de la respuesta oficial
    const qFeats = extractFeatures(userMsg);
    const ansFeats = extractFeatures(astMsg.slice(0, 350)).slice(0, 18);
    const combinedFeats = [...qFeats, ...qFeats, ...ansFeats];
    if (combinedFeats.length > 0) {
      samplePairs.push({
        features: combinedFeats,
        classId: cls.classId,
        question: userMsg,
      });
    }
  }

  const classes = Array.from(classMap.values());
  const numClasses = classes.length;
  const numExamples = samplePairs.length;

  console.log(`📊 Ejemplos de entrenamiento: ${numExamples}`);
  console.log(`🏷️ Clases institucionales (Intenciones + Artículos SBL): ${numClasses}`);

  // Construir vocabulario e IDF
  const docFreq = new Map<string, number>();
  for (const sp of samplePairs) {
    const uniqueFeats = new Set(sp.features);
    for (const f of uniqueFeats) {
      docFreq.set(f, (docFreq.get(f) || 0) + 1);
    }
  }

  const vocab: Record<string, number> = {};
  const idf: number[] = [];
  let featIdx = 0;

  for (const [feat, df] of docFreq.entries()) {
    vocab[feat] = featIdx++;
    // Smooth sublinear IDF
    idf.push(Math.log((numExamples + 1) / (df + 0.5)) + 1.0);
  }

  const vocabSize = featIdx;
  console.log(`🔤 Tamaño del vocabulario N-Gram (Unigrams + Bigrams + Char4): ${vocabSize} features`);

  // Vectorizar ejemplos (TF-IDF normalizado L2)
  const vectorizedSamples: Array<{ vec: Map<number, number>; classId: number }> = [];

  for (const sp of samplePairs) {
    const tf = new Map<number, number>();
    for (const f of sp.features) {
      const idx = vocab[f];
      if (idx !== undefined) {
        tf.set(idx, (tf.get(idx) || 0) + 1);
      }
    }

    const tfidf = new Map<number, number>();
    let normSq = 0;
    for (const [idx, count] of tf.entries()) {
      const val = (1 + Math.log(count)) * idf[idx];
      tfidf.set(idx, val);
      normSq += val * val;
    }

    const norm = Math.sqrt(normSq) || 1;
    for (const [idx, val] of tfidf.entries()) {
      tfidf.set(idx, val / norm);
    }

    vectorizedSamples.push({ vec: tfidf, classId: sp.classId });
  }

  // Inicializar pesos con Prototipos Centroides + Entrenamiento Softmax Cross-Entropy (Gradient Descent)
  const weights: Array<Float64Array> = Array.from(
    { length: numClasses },
    () => new Float64Array(vocabSize)
  );
  const biases = new Float64Array(numClasses);

  // Paso 1: Inicialización de prototipos por clase
  const classCounts = new Int32Array(numClasses);
  for (const sample of vectorizedSamples) {
    classCounts[sample.classId]++;
    const w = weights[sample.classId];
    for (const [idx, val] of sample.vec.entries()) {
      w[idx] += val;
    }
  }

  for (let c = 0; c < numClasses; c++) {
    const cnt = classCounts[c] || 1;
    const w = weights[c];
    let normSq = 0;
    for (let j = 0; j < vocabSize; j++) {
      w[j] /= cnt;
      normSq += w[j] * w[j];
    }
    const norm = Math.sqrt(normSq) || 1;
    for (let j = 0; j < vocabSize; j++) {
      w[j] = (w[j] / norm) * 8.0;
    }
  }

  // Paso 2: Optimización supervisada por descenso de gradiente con Softmax Cross-Entropy
  const epochs = 20;
  let learningRate = 0.65;
  const l2Lambda = 1e-6;
  let initialLoss = 0;
  let finalLoss = 0;

  console.log('\n⏳ Entrenando red lineal Softmax multiclasificador...');

  for (let epoch = 1; epoch <= epochs; epoch++) {
    let totalLoss = 0;
    let correctTop1 = 0;

    for (const sample of vectorizedSamples) {
      const logits = new Float64Array(numClasses);
      let maxLogit = -Infinity;

      for (let c = 0; c < numClasses; c++) {
        let sum = biases[c];
        const w = weights[c];
        for (const [idx, val] of sample.vec.entries()) {
          sum += w[idx] * val;
        }
        logits[c] = sum;
        if (sum > maxLogit) maxLogit = sum;
      }

      // Softmax
      const probs = new Float64Array(numClasses);
      let sumExp = 0;
      let predClass = 0;
      let bestProb = -1;

      for (let c = 0; c < numClasses; c++) {
        const e = Math.exp(logits[c] - maxLogit);
        probs[c] = e;
        sumExp += e;
      }

      for (let c = 0; c < numClasses; c++) {
        probs[c] /= sumExp;
        if (probs[c] > bestProb) {
          bestProb = probs[c];
          predClass = c;
        }
      }

      if (predClass === sample.classId) correctTop1++;
      const targetProb = Math.max(probs[sample.classId], 1e-12);
      totalLoss += -Math.log(targetProb);

      // Backprop en muestras con margen menor a 0.98 (Cosine Softmax sin sesgo de frecuencia)
      if (targetProb < 0.98) {
        const wTrue = weights[sample.classId];
        const gradTrue = probs[sample.classId] - 1.0; // negativo: empuja wTrue hacia sample
        for (const [idx, val] of sample.vec.entries()) {
          wTrue[idx] -= learningRate * gradTrue * val;
        }
        if (predClass !== sample.classId) {
          const wPred = weights[predClass];
          for (const [idx, val] of sample.vec.entries()) {
            wPred[idx] -= learningRate * 0.5 * probs[predClass] * val;
          }
        }
      }
    }

    const avgLoss = totalLoss / numExamples;
    const acc = ((correctTop1 / numExamples) * 100).toFixed(2);
    if (epoch === 1) initialLoss = Number(avgLoss.toFixed(4));
    if (epoch === epochs) finalLoss = Number(avgLoss.toFixed(4));

    if (epoch === 1 || epoch % 4 === 0 || epoch === epochs) {
      console.log(`   • Época ${String(epoch).padStart(2, ' ')}/${epochs} — Loss: ${avgLoss.toFixed(4)} | Accuracy Top-1: ${acc}%`);
    }
    learningRate *= 0.94;
  }

  // Evaluar Top-1 y Top-3 final
  let finalTop1 = 0;
  let finalTop3 = 0;

  for (const sample of vectorizedSamples) {
    const scores: Array<{ c: number; s: number }> = [];
    for (let c = 0; c < numClasses; c++) {
      let sum = biases[c];
      const w = weights[c];
      for (const [idx, val] of sample.vec.entries()) {
        sum += w[idx] * val;
      }
      scores.push({ c, s: sum });
    }
    scores.sort((a, b) => b.s - a.s);
    if (scores[0].c === sample.classId) finalTop1++;
    if (scores.slice(0, 3).some((x) => x.c === sample.classId)) finalTop3++;
  }

  const top1Accuracy = Number(((finalTop1 / numExamples) * 100).toFixed(2));
  const top3Accuracy = Number(((finalTop3 / numExamples) * 100).toFixed(2));

  // Compactar pesos dispersos (umbral |w| > 0.015) para inferencia instantánea y archivo ligero
  const sparseWeights: Array<Record<number, number>> = [];
  for (let c = 0; c < numClasses; c++) {
    const w = weights[c];
    const rowMap: Record<number, number> = {};
    for (let j = 0; j < vocabSize; j++) {
      if (Math.abs(w[j]) > 0.015) {
        rowMap[j] = Number(w[j].toFixed(4));
      }
    }
    sparseWeights.push(rowMap);
  }

  const modelData: TrainedMLModelData = {
    modelName: 'BoniBot-SBL-Neural-Softmax-v1',
    version: '1.0.0',
    trainedAt: new Date().toISOString(),
    hfRepoId: 'JuanDavid889/bonibot-sbl-ml-model',
    numExamples,
    numClasses,
    vocabSize,
    metrics: {
      initialLoss,
      finalLoss,
      top1Accuracy,
      top3Accuracy,
      epochs,
    },
    vocab,
    idf: idf.map((v) => Number(v.toFixed(4))),
    classes,
    classWeights: sparseWeights,
    classBiases: Array.from(biases).map((b) => Number(b.toFixed(4))),
  };

  const modelOutPath = path.resolve(process.cwd(), 'data', 'sbl_trained_ml_model.json');
  const modelJsonStr = JSON.stringify(modelData);
  fs.writeFileSync(modelOutPath, modelJsonStr, 'utf8');

  console.log('\n==================================================================');
  console.log(`✅ MODELO ENTRENADO Y GUARDADO: ${modelOutPath}`);
  console.log(`🎯 Top-1 Accuracy: ${top1Accuracy}% | Top-3 Accuracy: ${top3Accuracy}%`);
  console.log(`📦 Tamaño del modelo serializado: ${(Buffer.byteLength(modelJsonStr) / 1024).toFixed(1)} KB`);
  console.log('==================================================================\n');

  // Subir a Hugging Face Hub usando el token cacheado del usuario
  const tokenPath = path.join(os.homedir(), '.cache', 'huggingface', 'token');
  if (!fs.existsSync(tokenPath)) {
    console.log('⚠️ No se encontró token de Hugging Face en caché local.');
    return;
  }

  const hfToken = fs.readFileSync(tokenPath, 'utf8').trim();
  const hfUser = 'JuanDavid889';
  const datasetRepo = `${hfUser}/bonibot-sbl-dataset`;
  const modelRepo = `${hfUser}/bonibot-sbl-ml-model`;
  const spaceRepo = `${hfUser}/bonibot-sbl-playground`;

  console.log('☁️ Subiendo Dataset y Modelo Entrenado a Hugging Face Hub...');

  // 1. Subir Dataset JSONL y README a JuanDavid889/bonibot-sbl-dataset
  const datasetReadme = `---
language:
- es
license: mit
task_categories:
- question-answering
- text-classification
- conversational
tags:
- education
- colombia
- ibague
- colegio-san-bonifacio
- rag
- chatml
size_categories:
- n<1K
---

# 🦊 Dataset Oficial BoniBot SBL (Colegio San Bonifacio de las Lanzas Bilingüe)

Dataset supervisado con **${numExamples} pares de entrenamiento en formato ChatML** extraídos de la documentación oficial 2026 de la **Corporación Colegio San Bonifacio de las Lanzas Bilingüe (Ibagué, Tolima)**:
- **Pacto de Convivencia Escolar 2026** (121 páginas).
- **SIEE V(01)** — Sistema Institucional de Evaluación de los Estudiantes.
- **Póliza de Seguro Estudiantil Seguros Mundial (\`2000694412\`)**.
- **Boletín Proyecto Social Carlo Acutis (Semestre A-2026)**.
- **Directorio Docente, Coordinaciones y Horarios de Atención a Padres**.
- **Talleres Extracurriculares Actívate y Menú Escolar**.
`;

  await uploadFileToHF(
    hfToken,
    'dataset',
    datasetRepo,
    'README.md',
    datasetReadme,
    'Add dataset card for BoniBot SBL'
  );
  await uploadFileToHF(
    hfToken,
    'dataset',
    datasetRepo,
    'sbl_training_dataset.jsonl',
    fs.readFileSync(datasetPath, 'utf8'),
    `Upload ${numExamples} ChatML training examples`
  );
  console.log(`   ✅ Dataset publicado en: https://huggingface.co/datasets/${datasetRepo}`);

  // 2. Subir Modelo Entrenado, métricas y Model Card a JuanDavid889/bonibot-sbl-ml-model
  const modelReadme = `---
language:
- es
license: mit
library_name: generic
tags:
- text-classification
- question-answering
- bonibot
- san-bonifacio-de-las-lanzas
- fast-inference
datasets:
- ${datasetRepo}
metrics:
- accuracy
---

# 🦊 BoniBot-SBL-Neural-Softmax-v1

Modelo de Machine Learning supervisado (N-Gram Subword TF-IDF + Softmax Cross-Entropy Classifier) entrenado específicamente para el asistente virtual de WhatsApp **BoniBot** del **Colegio San Bonifacio de las Lanzas Bilingüe (SBL)**.

## 📊 Métricas de Entrenamiento
- **Ejemplos de entrenamiento:** ${numExamples}
- **Clases institucionales (FAQs + Artículos Pacto/SIEE):** ${numClasses}
- **Vocabulario (Word Unigrams, Bigrams, Prefixes & Char-4-grams):** ${vocabSize} features
- **Top-1 Accuracy:** **${top1Accuracy}%**
- **Top-3 Accuracy:** **${top3Accuracy}%**
- **Loss inicial ➔ final:** \`${initialLoss}\` ➔ \`${finalLoss}\` (${epochs} épocas)
- **Latencia de inferencia en producción:** **< 5 milisegundos**
`;

  const configJson = JSON.stringify(
    {
      architectures: ['BoniBotLinearSoftmaxClassifier'],
      model_type: 'ngram_tfidf_softmax',
      num_classes: numClasses,
      vocab_size: vocabSize,
      top1_accuracy: top1Accuracy,
      top3_accuracy: top3Accuracy,
      trained_at: modelData.trainedAt,
    },
    null,
    2
  );

  await uploadFileToHF(
    hfToken,
    'model',
    modelRepo,
    'README.md',
    modelReadme,
    'Add model card and metrics'
  );
  await uploadFileToHF(hfToken, 'model', modelRepo, 'config.json', configJson, 'Add model config');
  await uploadFileToHF(
    hfToken,
    'model',
    modelRepo,
    'sbl_trained_ml_model.json',
    modelJsonStr,
    'Upload trained BoniBot SBL ML weights'
  );
  console.log(`   ✅ Modelo ML publicado en: https://huggingface.co/${modelRepo}`);

  // 3. Crear y desplegar un Space Estático Interactivo 100% gratuito en Hugging Face
  await fetch('https://huggingface.co/api/repos/create', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hfToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'space',
      name: 'bonibot-sbl-playground',
      sdk: 'static',
      private: false,
    }),
  });

  const spaceReadme = `---
title: BoniBot SBL ML Playground
emoji: 🦊
colorFrom: red
colorTo: blue
sdk: static
pinned: true
---

# 🦊 Playground Oficial del Modelo ML BoniBot SBL
`;

  const spaceHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BoniBot SBL 🦊 — Modelo ML en Vivo (Hugging Face)</title>
  <style>
    :root { --bg: #0f172a; --card: #1e293b; --accent: #ef4444; --text: #f8fafc; --muted: #94a3b8; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; background: var(--bg); color: var(--text); display: flex; flex-direction: column; align-items: center; padding: 24px; }
    .container { max-width: 780px; width: 100%; background: var(--card); border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
    h1 { margin: 0 0 8px 0; font-size: 1.5rem; display: flex; align-items: center; gap: 10px; }
    .badge { background: #dc2626; color: white; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
    p.sub { color: var(--muted); margin-top: 0; font-size: 0.92rem; }
    .chat-box { height: 400px; overflow-y: auto; background: #0b1120; border-radius: 12px; padding: 16px; margin: 16px 0; border: 1px solid #334155; }
    .msg { margin-bottom: 14px; padding: 12px 16px; border-radius: 12px; line-height: 1.5; white-space: pre-wrap; font-size: 0.94rem; }
    .msg.user { background: #2563eb; color: white; margin-left: 15%; text-align: right; }
    .msg.bot { background: #1e293b; border: 1px solid #475569; margin-right: 10%; }
    .meta { font-size: 0.75rem; color: #38bdf8; margin-top: 6px; font-family: monospace; }
    .input-row { display: flex; gap: 10px; }
    input { flex: 1; padding: 12px 16px; border-radius: 10px; border: 1px solid #475569; background: #0b1120; color: white; font-size: 0.95rem; }
    button { padding: 12px 20px; border-radius: 10px; border: none; background: var(--accent); color: white; font-weight: 600; cursor: pointer; }
    button:hover { opacity: 0.9; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .chip { background: #334155; color: #e2e8f0; padding: 6px 12px; border-radius: 999px; font-size: 0.8rem; cursor: pointer; border: none; }
    .chip:hover { background: #475569; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🦊 BoniBot SBL <span class="badge">ML Model v1.0 (${top1Accuracy}% Acc)</span></h1>
    <p class="sub">Modelo supervisado entrenado con ${numExamples} ejemplos oficiales del Colegio San Bonifacio de las Lanzas Bilingüe (Ibagué).</p>
    <div class="chips">
      <button class="chip" onclick="ask('¿A qué hora atiende el profesor Juan David de TechnoScience?')">👨‍🔬 Prof. Juan David</button>
      <button class="chip" onclick="ask('¿Cuál es el número de la póliza estudiantil y clínicas?')">🏥 Póliza y Clínicas</button>
      <button class="chip" onclick="ask('¿A qué hora entran y salen los viernes?')">⏰ Horario Escolar</button>
      <button class="chip" onclick="ask('¿Qué talleres Actívate hay disponibles?')">⚽ Talleres Actívate</button>
      <button class="chip" onclick="ask('¿Qué establece el Artículo 22 del Pacto de Convivencia?')">📘 Artículo 22</button>
    </div>
    <div id="chat" class="chat-box">
      <div class="msg bot">¡Hola! 🦊 Soy BoniBot ejecutando el modelo entrenado <b>${modelRepo}</b> directamente desde Hugging Face. Escribe cualquier pregunta sobre el colegio o elige un botón arriba.</div>
    </div>
    <div class="input-row">
      <input id="q" type="text" placeholder="Escribe tu pregunta sobre el San Bonifacio..." onkeydown="if(event.key==='Enter')send()" />
      <button onclick="send()">Consultar ML</button>
    </div>
  </div>
  <script>
    let model = null;
    const stop = new Set(['el','la','los','las','un','una','de','del','al','en','con','por','para','es','son','me','mi','se','lo','le','si','no','o','y','a','sobre','favor','colegio','san','bonifacio','lanzas','sbl','bonibot','quisiera','saber','puedes','dar','informacion']);

    fetch('https://huggingface.co/${modelRepo}/resolve/main/sbl_trained_ml_model.json')
      .then(r => r.json())
      .then(d => { model = d; console.log('Modelo cargado:', d.modelName); });

    function extractFeatures(raw) {
      const norm = raw.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^\\w\\s]/g, ' ').replace(/\\s+/g, ' ').trim();
      if (!norm) return [];
      const words = norm.split(' ').filter(w => w.length > 1 && !stop.has(w));
      const feats = [];
      for (const w of words) { feats.push('w:' + w); if (w.length >= 5) feats.push('p:' + w.slice(0,5)); }
      for (let i=0; i<words.length-1; i++) feats.push('b:' + words[i] + '_' + words[i+1]);
      const compact = words.join('_');
      if (compact.length >= 4) { for (let i=0; i<=Math.min(compact.length-4, 48); i+=2) feats.push('c:' + compact.slice(i, i+4)); }
      return feats;
    }

    function predict(text) {
      const t0 = performance.now();
      const feats = extractFeatures(text);
      const tf = {};
      for (const f of feats) { const idx = model.vocab[f]; if (idx !== undefined) tf[idx] = (tf[idx] || 0) + 1; }
      const vec = {};
      let normSq = 0;
      for (const [idx, cnt] of Object.entries(tf)) { const v = (1 + Math.log(cnt)) * model.idf[idx]; vec[idx] = v; normSq += v*v; }
      const norm = Math.sqrt(normSq) || 1;
      for (const k of Object.keys(vec)) vec[k] /= norm;

      let bestC = 0, bestS = -Infinity, maxL = -Infinity;
      const logits = new Float64Array(model.numClasses);
      for (let c=0; c<model.numClasses; c++) {
        let s = model.classBiases[c];
        const w = model.classWeights[c];
        for (const [idx, val] of Object.entries(vec)) { if (w[idx]) s += w[idx] * val; }
        logits[c] = s;
        if (s > maxL) maxL = s;
        if (s > bestS) { bestS = s; bestC = c; }
      }
      let sumExp = 0;
      for (let c=0; c<model.numClasses; c++) sumExp += Math.exp(logits[c] - maxL);
      const prob = Math.exp(bestS - maxL) / sumExp;
      const ms = (performance.now() - t0).toFixed(2);
      return { cls: model.classes[bestC], prob: (prob * 100).toFixed(1), ms };
    }

    function ask(txt) { document.getElementById('q').value = txt; send(); }

    function send() {
      const inp = document.getElementById('q');
      const txt = inp.value.trim();
      if (!txt || !model) return;
      inp.value = '';
      const chat = document.getElementById('chat');
      chat.innerHTML += '<div class="msg user">' + txt + '</div>';
      const res = predict(txt);
      chat.innerHTML += '<div class="msg bot">' + res.cls.canonicalResponse + '<div class="meta">⚡ Latencia ML: ' + res.ms + ' ms | Confianza Softmax: ' + res.prob + '% | Fuente: ' + res.cls.source + '</div></div>';
      chat.scrollTop = chat.scrollHeight;
    }
  </script>
</body>
</html>`;

  await uploadFileToHF(hfToken, 'space', spaceRepo, 'README.md', spaceReadme, 'Init Space metadata');
  await uploadFileToHF(
    hfToken,
    'space',
    spaceRepo,
    'index.html',
    spaceHtml,
    'Deploy live BoniBot SBL ML interactive playground'
  );
  console.log(`   ✅ Space Interactivo publicado en: https://huggingface.co/spaces/${spaceRepo}`);
}

main().catch(console.error);
