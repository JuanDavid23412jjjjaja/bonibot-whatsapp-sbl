import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TrainedClassInfo {
  classId: number;
  labelKey: string;
  category: string;
  source: string;
  canonicalResponse: string;
  sampleQuestions: string[];
}

interface TrainedMLModelData {
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
  classWeights: Array<Record<number, number>>;
  classBiases: number[];
}

export interface MLPrediction {
  classInfo: TrainedClassInfo;
  probability: number;
  logit: number;
  modelName: string;
  hfRepoId: string;
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

function extractQueryFeatures(rawText: string): string[] {
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

  for (const w of words) {
    features.push(`w:${w}`);
    if (w.length >= 5) {
      features.push(`p:${w.slice(0, 5)}`);
    }
  }

  for (let i = 0; i < words.length - 1; i++) {
    features.push(`b:${words[i]}_${words[i + 1]}`);
  }

  const compact = words.join('_');
  if (compact.length >= 4) {
    for (let i = 0; i <= Math.min(compact.length - 4, 48); i += 2) {
      features.push(`c:${compact.slice(i, i + 4)}`);
    }
  }

  return features;
}

/**
 * Ejecuta en <5ms el modelo supervisado BoniBot-SBL-Neural-Softmax-v1
 * sincronizado con Hugging Face (JuanDavid889/bonibot-sbl-ml-model).
 */
export class SBLTrainedClassifier {
  private model: TrainedMLModelData | null = null;

  constructor() {
    this.loadModel();
  }

  private loadModel(): void {
    try {
      const modelPath = path.resolve(process.cwd(), 'data', 'sbl_trained_ml_model.json');
      if (fs.existsSync(modelPath)) {
        const raw = fs.readFileSync(modelPath, 'utf8');
        this.model = JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Advertencia cargando sbl_trained_ml_model.json:', err);
    }
  }

  public predict(userQuery: string, minProbability = 0.35): MLPrediction | null {
    if (!this.model) return null;

    const features = extractQueryFeatures(userQuery);
    if (features.length === 0) return null;

    // 1. Vectorizar consulta con vocabulario e IDF entrenados
    const tf = new Map<number, number>();
    for (const f of features) {
      const idx = this.model.vocab[f];
      if (idx !== undefined) {
        tf.set(idx, (tf.get(idx) || 0) + 1);
      }
    }

    if (tf.size === 0) return null;

    const vec = new Map<number, number>();
    let normSq = 0;
    for (const [idx, count] of tf.entries()) {
      const val = (1 + Math.log(count)) * this.model.idf[idx];
      vec.set(idx, val);
      normSq += val * val;
    }

    const norm = Math.sqrt(normSq) || 1;
    for (const [idx, val] of vec.entries()) {
      vec.set(idx, val / norm);
    }

    // 2. Forward Pass (z = W * x + b)
    const numClasses = this.model.numClasses;
    const logits = new Float64Array(numClasses);
    let maxLogit = -Infinity;
    let bestClass = 0;
    let bestLogit = -Infinity;

    for (let c = 0; c < numClasses; c++) {
      let sum = this.model.classBiases[c] || 0;
      const w = this.model.classWeights[c];
      for (const [idx, val] of vec.entries()) {
        const weight = w[idx];
        if (weight !== undefined) {
          sum += weight * val;
        }
      }
      logits[c] = sum;
      if (sum > maxLogit) maxLogit = sum;
      if (sum > bestLogit) {
        bestLogit = sum;
        bestClass = c;
      }
    }

    // 3. Calibrated Cosine Softmax Probability (Temperature tau = 0.35 for 194 classes)
    const tau = 0.35;
    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) {
      sumExp += Math.exp((logits[c] - maxLogit) / tau);
    }

    const probability = Math.exp((bestLogit - maxLogit) / tau) / sumExp;

    // Requiere logit positivo significativo y superar el umbral de probabilidad Softmax
    if (bestLogit < 1.5 || probability < minProbability) {
      return null;
    }

    return {
      classInfo: this.model.classes[bestClass],
      probability: Number(probability.toFixed(3)),
      logit: Number(bestLogit.toFixed(3)),
      modelName: this.model.modelName,
      hfRepoId: this.model.hfRepoId,
    };
  }

  public getModelSummary(): string {
    if (!this.model) return 'No cargado';
    return `${this.model.hfRepoId} (${this.model.numClasses} clases, ${this.model.metrics.top1Accuracy}% Acc)`;
  }
}
