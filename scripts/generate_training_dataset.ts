import * as fs from 'node:fs';
import * as path from 'node:path';

interface KBChunk {
  id: string;
  source: string;
  section: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface ChatMLMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface TrainingExample {
  messages: ChatMLMessage[];
  metadata?: {
    source: string;
    category: string;
  };
}

export interface FastCacheEntry {
  id: string;
  category: string;
  canonicalQuestion: string;
  triggerPatterns: string[];
  requiredKeywords: string[];
  answer: string;
  sourceCitation: string;
}

const SYSTEM_PROMPT_COMPACT =
  'Eres BoniBot 🦊, el asistente virtual oficial de la Corporación Colegio San Bonifacio de las Lanzas Bilingüe (SBL) en Ibagué, Tolima. Responde siempre en español con tono amable, institucional y preciso, citando el Pacto de Convivencia 2026, el SIEE, la Póliza Estudiantil (2000694412) o los directorios oficiales del colegio.';

const CURATED_FAQ_ENTRIES: FastCacheEntry[] = [
  {
    id: 'faq-saludo',
    category: 'General',
    canonicalQuestion: 'Hola, ¿quién eres y en qué me puedes ayudar?',
    triggerPatterns: [
      'hola',
      'buenos dias',
      'buenas tardes',
      'buenas noches',
      'hola bonibot',
      'quien eres',
      'que haces',
      'ayuda',
      'menu principal',
    ],
    requiredKeywords: [],
    answer:
      '¡Hola! 🦊 Soy *BoniBot*, el asistente virtual oficial de la *Corporación Colegio San Bonifacio de las Lanzas Bilingüe (SBL)*. Estoy entrenado con nuestros documentos oficiales 2026:\n\n📘 *Pacto de Convivencia 2026*\n📊 *SIEE (Sistema Institucional de Evaluación)*\n🏥 *Póliza de Seguro Estudiantil (Seguros Mundial #2000694412)*\n👩‍🏫 *Directorio Docente y Horarios de Atención a Padres*\n⚽ *Talleres Actívate y Menú Escolar*\n❤️ *Proyecto Social Carlo Acutis*\n\n¿En qué te puedo colaborar hoy?',
    sourceCitation: 'Sistema Oficial BoniBot SBL 2026',
  },
  {
    id: 'faq-info-colegio',
    category: 'General',
    canonicalQuestion: '¿Qué tal es el colegio San Bonifacio de las Lanzas y cuál es su propuesta educativa?',
    triggerPatterns: [
      'que tal el colegio',
      'que tal es el colegio',
      'como es el colegio',
      'informacion del colegio',
      'sobre el colegio',
      'ciclos del colegio',
      'propuesta educativa',
      'mision y vision',
    ],
    requiredKeywords: [],
    answer:
      '🦊 ¡El **Colegio San Bonifacio de las Lanzas Bilingüe (SBL)** es una de las instituciones educativas líderes de Ibagué y el Tolima!\n\n🌟 *Nuestra propuesta formativa se organiza por Ciclos:*\n• **Ciclo Exploratorio:** Transición, Kínder 6, 1° y 2°\n• **Ciclo Conceptual:** 3°, 4°, 5° y 6°\n• **Ciclo Contextual:** 7°, 8° y 9°\n• **Ciclo Proyectivo:** 10° y 11° (Certificación internacional bilingüe *IELTS Nivel B2* y proyecto social)\n\n🔬 Contamos con formación en **TechnoScience y Robótica STEM**, **Talleres Extracurriculares Actívate** (deportes, natación, robótica, artes, debate ONU) y nuestro **Proyecto Social Carlo Acutis**.\n\n¿Sobre qué tema específico te gustaría conocer más?',
    sourceCitation: 'Pacto de Convivencia 2026 - Horizonte Institucional SBL',
  },
  {
    id: 'faq-juan-david',
    category: 'Directorio Docente',
    canonicalQuestion: '¿A qué hora atiende a padres el profesor Juan David de TechnoScience?',
    triggerPatterns: [
      'juan david',
      'profesor juan david',
      'profe juan david',
      'docente technoscience',
      'profesor de technoscience',
      'lider stem',
      'correo juan david',
      'atencion juan david',
    ],
    requiredKeywords: ['juan', 'technoscience', 'stem', 'robotica'],
    answer:
      '🦊 De acuerdo con el *Directorio Docente y Horarios de Atención SBL*, los datos oficiales del profesor **Juan David** son:\n\n👨‍🔬 *Cargo:* Docente de TechnoScience y Líder STEM\n📚 *Ciclos:* Contextual y Proyectivo (7° a 11°)\n⏰ *Horario de atención a padres:* **Martes y Jueves de 10:30 a.m. a 12:00 m.** (con cita previa por plataforma)\n📍 *Ubicación:* Laboratorio de TechnoScience y Robótica\n📧 *Correo:* `juandavid.technoscience@sanboni.edu.co`\n\nAdemás, lidera el *Taller Actívate de Robótica STEM y Prototipado* los martes y jueves de 2:45 p.m. a 4:50 p.m.',
    sourceCitation: 'Directorio Docente y Horarios de Atención SBL 2026',
  },
  {
    id: 'faq-rectora',
    category: 'Directorio Docente',
    canonicalQuestion: '¿Quién es la rectora del colegio y cómo agendo cita en rectoría?',
    triggerPatterns: [
      'quien es la rectora',
      'nombre de la rectora',
      'cita con la rectora',
      'rectoria',
      'maria paula valencia',
      'correo rectoria',
    ],
    requiredKeywords: ['rector', 'rectora', 'rectoria', 'valencia'],
    answer:
      '🦊 Nuestra Rectora es **María Paula Valencia Sierra**.\n\n📍 *Ubicación:* Edificio Administrativo, Piso 2\n⏰ *Horario de atención:* Lunes a Viernes de 8:00 a.m. a 12:00 m. (con cita previa gestionada vía Secretaría General)\n📧 *Correo oficial:* `rectoria@sanboni.edu.co`',
    sourceCitation: 'Directorio Docente y Horarios de Atención SBL 2026',
  },
  {
    id: 'faq-poliza-clinicas',
    category: 'Póliza Estudiantil',
    canonicalQuestion: '¿Cuál es el número de la póliza estudiantil y en qué clínicas de Ibagué atienden?',
    triggerPatterns: [
      'numero de poliza',
      'poliza estudiantil',
      'seguro estudiantil',
      'seguro escolar',
      'accidente escolar',
      'a que clinica llevo a mi hijo',
      'clinicas autorizadas',
      'seguros mundial',
    ],
    requiredKeywords: ['poliza', 'seguro', 'clinica', 'accidente', 'mundial'],
    answer:
      '🏥 *Póliza de Seguro Estudiantil 2026 — SBL*\n\n• *Aseguradora:* Seguros Mundial\n• *Número de Póliza:* **`2000694412`** *(aplica para todos los estudiantes presentando su documento de identidad)*\n• *Referencia:* Pacto de Convivencia, Art. 92 lit. c.\n\n🚑 *Red de Clínicas Autorizadas en Ibagué:*\n1. **Clínica Asotrauma S.A.S** (Tel: `515300`) — Urgencias por trauma y accidentes\n2. **Clínica Ibagué S.A.S** (Tel: `6082619773`) — Urgencias médicas\n3. **Clínica Keralty** (Tel: `4484121`)\n4. **Clínica Avidanti** (Tel: `88842707`)\n5. **Hospital Federico Lleras Acosta** (Tel: `2739805`)\n6. **Dento-Man S.A.S** (Tel: `515082`) — Urgencias odontológicas por accidente\n7. **Clínica de Ojos del Tolima** (Tel: `3107685171`) — Oftalmología\n8. **IDIME** (Tel: `2653642`) — Imágenes diagnósticas (sin urgencias)\n\n💰 *Cobertura principal:* Hasta **$18.000.000** en gastos médicos por accidente, muerte o incapacidad, y **$1.000.000** para traslado en ambulancia terrestre.',
    sourceCitation: 'Póliza Seguro Estudiantil Seguros Mundial (2000694412)',
  },
  {
    id: 'faq-horario-escolar',
    category: 'Pacto de Convivencia',
    canonicalQuestion: '¿Cuál es el horario de entrada y salida de los estudiantes de lunes a viernes?',
    triggerPatterns: [
      'horario de entrada',
      'horario de salida',
      'a que hora entran',
      'a que hora salen',
      'horario escolar',
      'hora de salida los viernes',
      'jornada escolar',
    ],
    requiredKeywords: ['horario', 'hora', 'entran', 'salen', 'ingreso', 'salida', 'viernes'],
    answer:
      '⏰ *Horario Escolar Oficial 2026 (Pacto de Convivencia, Art. 131):*\n\n👧🧒 **Ciclo Exploratorio (Transición, Kínder 6, 1° y 2°):**\n• *Ingreso:* 7:50 a.m.\n• *Salida Lunes a Jueves:* 2:25 p.m.\n• *Salida Viernes:* 1:00 p.m.\n\n📘 **Ciclo Conceptual (3° a 6°), Contextual (7° a 9°) y Proyectivo (10° y 11°):**\n• *Ingreso:* 6:50 a.m.\n• *Salida Lunes y Miércoles:* 2:45 p.m.\n• *Salida Martes y Jueves:* 3:30 p.m.\n• *Salida Viernes:* 12:30 p.m.\n\n⚽ *Talleres Actívate:* 2:45 p.m. a 4:50 p.m. (Salida máxima del campus: 5:05 p.m.).',
    sourceCitation: 'Pacto de Convivencia 2026 - Artículo 131',
  },
  {
    id: 'faq-costos-pension-matricula',
    category: 'Costos Educativos',
    canonicalQuestion: '¿Cuánto cuesta la matrícula y la pensión en 2026 y cuándo se paga?',
    triggerPatterns: [
      'valor de la matricula',
      'valor de la pension',
      'cuanto cuesta la pension',
      'cuanto vale la matricula',
      'costos educativos',
      'fecha limite de pago',
      'recargo por mora',
      'tarifas 2026',
    ],
    requiredKeywords: ['matricula', 'pension', 'costo', 'valor', 'pago', 'mensualidad', 'tarifa'],
    answer:
      '💳 *Costos Educativos y Pensiones 2026 (Pacto de Convivencia, Art. 119 - 126):*\n\n📅 *Oportunidad de pago (Art. 125):* La pensión se paga dentro de los **primeros diez (10) días calendario de cada mes**.\n⚠️ *Pago extemporáneo:* A partir del **día 11** del mes se pierde el descuento por pronto pago y se aplica el valor pleno con los intereses de mora de ley.\n\n📞 *Tesorería y Cartera:*\n• *Responsable:* Roberto Carlos Barrios\n• *Correo:* `cartera@sanboni.edu.co`\n• *Horario:* Lunes a Viernes de 7:00 a.m. a 3:00 p.m. (Edificio Administrativo, Piso 1).',
    sourceCitation: 'Pacto de Convivencia 2026 - Artículos 119, 125 y 126',
  },
  {
    id: 'faq-requisitos-grado-once',
    category: 'SIEE y Graduación',
    canonicalQuestion: '¿Cuáles son los requisitos para graduarse de grado once (IELTS y servicio social)?',
    triggerPatterns: [
      'requisitos de grado once',
      'requisitos para graduarse',
      'bachiller bilingue',
      'examen ielts',
      'nivel de ingles para graduarse',
      'servicio social obligatorio',
      'horas de servicio social',
    ],
    requiredKeywords: ['graduarse', 'grado', 'once', '11', 'ielts', 'servicio social', 'b2'],
    answer:
      '🎓 *Requisitos Especiales de Graduación — Grado 11° (SIEE Art. 2 y Pacto Art. 74):*\n\n1. **Aprobación académica:** Aprobar todas las áreas y asignaturas del plan de estudios del Ciclo Proyectivo.\n2. **Certificación Bilingüe (IELTS):** Presentar la prueba internacional *IELTS* y acreditar mínimo el **Nivel B2** del Marco Común Europeo de Referencia (MCER) para recibir el título de *Bachiller Académico Bilingüe*.\n3. **Servicio Social Obligatorio (Art. 74):** Cumplir satisfactoriamente las **80 horas** de servicio social en el *Proyecto Social Carlo Acutis* (sábados de 7:00 a.m. a 12:00 m. durante grados 10° y 11°).\n4. **Paz y Salvo:** Estar a paz y salvo por todo concepto con la institución.',
    sourceCitation: 'SIEE V(01) Art. 2 y Pacto de Convivencia 2026 Art. 74',
  },
  {
    id: 'faq-llegadas-tarde',
    category: 'Convivencia Escolar',
    canonicalQuestion: '¿Qué pasa si un estudiante llega tarde al colegio?',
    triggerPatterns: [
      'llegadas tarde',
      'llega tarde',
      'retardo',
      'impuntualidad',
      'acumula llegadas tarde',
      'articulo 22',
    ],
    requiredKeywords: ['tarde', 'llegada', 'llegadas', 'retardo', 'puntualidad'],
    answer:
      '⏱️ *Procedimiento por Llegadas Tarde (Pacto de Convivencia, Art. 22):*\n\n• **1ª y 2ª llegada tarde:** Registro en el observador del estudiante y diálogo formativo con el director de grupo.\n• **3ª llegada tarde en el periodo:** Citación a los padres de familia o acudientes por parte de Coordinación de Convivencia y firma de compromiso pedagógico.\n• **Reincidencia (4 o más llegadas tarde):** Se tipifica como falta al deber de puntualidad, afectando la valoración de convivencia del periodo y aplicando las acciones pedagógicas reparadoras establecidas en el Pacto.',
    sourceCitation: 'Pacto de Convivencia 2026 - Artículo 22',
  },
  {
    id: 'faq-talleres-activate',
    category: 'Vida Escolar',
    canonicalQuestion: '¿Qué talleres Actívate hay disponibles y en qué horarios?',
    triggerPatterns: [
      'talleres activate',
      'actividades extracurriculares',
      'clases por la tarde',
      'taller de robotica',
      'taller de futbol',
      'taller de natacion',
      'deportes por la tarde',
    ],
    requiredKeywords: ['activate', 'taller', 'talleres', 'extracurricular', 'extracurriculares'],
    answer:
      '⚽ *Talleres Extracurriculares Actívate 2026 (2:45 p.m. - 4:50 p.m. | Salida máx. 5:05 p.m.):*\n\n1. 🤖 **Robótica STEM y Prototipado TechnoScience** (3° a 11°): Martes y Jueves — *Laboratorio de TechnoScience* (Prof. Juan David).\n2. ⚽ **Fútbol Formativo y Competitivo** (Transición a 11°): Lunes y Miércoles — *Cancha Sintética Principal*.\n3. 🏊 **Natación y Habilidades Acuáticas** (Transición a 11°): Martes y Jueves — *Piscina Institucional SBL* (traje de baño y gorro rojo obligatorio, Art. 4 lit. d).\n4. 🏐 **Voleibol y Baloncesto** (3° a 11°): Lunes y Miércoles — *Coliseo Cubierto*.\n5. 🤸‍♀️ **Gimnasia, Ballet y Porras** (Transición a 9°): Martes y Jueves — *Salón de Expresión Corporal*.\n6. 🗣️ **English Club & Debate (SBLMUN / IELTS Prep)** (6° a 11°): Miércoles de 2:15 p.m. a 4:30 p.m. — *CRAI*.',
    sourceCitation: 'Horarios Talleres Actívate y Menú Escolar SBL 2026',
  },
  {
    id: 'faq-menu-restaurante',
    category: 'Vida Escolar',
    canonicalQuestion: '¿Cuál es el menú del almuerzo escolar de la semana?',
    triggerPatterns: [
      'menu del almuerzo',
      'menu escolar',
      'que hay de almuerzo',
      'restaurante escolar',
      'comida del colegio',
      'almuerzo de la semana',
    ],
    requiredKeywords: ['menu', 'almuerzo', 'restaurante', 'comida'],
    answer:
      '🍽️ *Menú Balanceado del Restaurante Escolar SBL:*\n\n• **Lunes:** Pechuga a la plancha en salsa de finas hierbas, arroz con vegetales, ensalada de aguacate, crema de ahuyama y jugo de mora.\n• **Martes:** Carne asada magra, pasta penne al pesto suave, ensalada César, lentejas caseras, jugo de mango y postre lácteo.\n• **Miércoles:** Filete de pescado al horno (o pollo para alérgicos), arroz con coco suave, patacón horneado, ensalada tropical y limonada.\n• **Jueves:** Pollo horneado en miel mostaza, puré de papa criolla, verduras salteadas, frijoles, jugo de lulo y sandía.\n• **Viernes:** *Jornada continua sin almuerzo regular* (Salida 12:30 p.m. / 1:00 p.m. y Mini Bazar Solidario Carlo Acutis).\n\n📍 *Lugar:* Coliseo del Ciclo Conceptual.',
    sourceCitation: 'Horarios Talleres Actívate y Menú Escolar SBL 2026',
  },
  {
    id: 'faq-carlo-acutis',
    category: 'Proyecto Social',
    canonicalQuestion: '¿Qué es el Proyecto Social Carlo Acutis y cómo me uno al Plan Padrino?',
    triggerPatterns: [
      'carlo acutis',
      'proyecto social',
      'plan padrino',
      'mini bazar',
      'apoyar proyecto social',
      'telefono plan padrino',
    ],
    requiredKeywords: ['carlo', 'acutis', 'padrino', 'bazar'],
    answer:
      '❤️ *Proyecto Social Carlo Acutis — SBL (Pacto Art. 73):*\n\nEs la obra social institucional del Colegio San Bonifacio de las Lanzas que atiende a **100 niños beneficiarios de la Comuna 6 de Ibagué** los días sábados (7:00 a.m. a 12:00 m.) con formación artística, socioemocional, espiritual (Primera Comunión), kits escolares, entrega de calzado y robótica.\n\n🤝 *¿Cómo apoyar o unirse al Plan Padrino?*\n• **Teléfono / WhatsApp Plan Padrino:** **`312 453 4990`**\n• **Correo:** `carlo.acutis@sanboni.edu.co`\n• También puedes colaborar en el **Mini Bazar Solidario** todos los viernes en el colegio.',
    sourceCitation: 'Boletín Proyecto Social Carlo Acutis (Semestre A-2026)',
  },
  {
    id: 'faq-coordinadores-directorio',
    category: 'Directorio Docente',
    canonicalQuestion: '¿Cuáles son los correos y horarios de los coordinadores académicos y de convivencia?',
    triggerPatterns: [
      'coordinadores academicos',
      'coordinador de convivencia',
      'correo coordinador',
      'directorio de coordinadores',
      'camilo ospina',
      'laura marcela gomez',
      'carlos andres mejia',
      'diana patricia rojas',
      'jorge eliecer lozada',
    ],
    requiredKeywords: ['coordinador', 'coordinadora', 'coordinacion', 'coordinadores'],
    answer:
      '📋 *Directorio de Coordinadores SBL 2026:*\n\n• **Ciclo Exploratorio (Transición a 2°):** Laura Marcela Gómez — `coord.exploratorio@sanboni.edu.co` (Lunes a Viernes 8:00 - 10:00 a.m.)\n• **Ciclo Conceptual (3° a 6°):** Carlos Andrés Mejía — `coord.conceptual@sanboni.edu.co` (Lunes, Miércoles y Viernes 7:30 - 9:30 a.m.)\n• **Ciclo Contextual (7° a 9°):** Diana Patricia Rojas — `coord.contextual@sanboni.edu.co` (Martes y Jueves 7:30 - 10:00 a.m.)\n• **Ciclo Proyectivo (10° y 11°):** Jorge Eliécer Lozada — `coord.proyectivo@sanboni.edu.co` (Lunes a Jueves 8:00 - 10:30 a.m.)\n• **Coordinación de Convivencia:** Camilo Ernesto Ospina — `convivencia.escolar@sanboni.edu.co` (Lunes a Viernes 7:00 a.m. - 1:30 p.m.)',
    sourceCitation: 'Directorio Docente y Horarios de Atención SBL 2026',
  },
  {
    id: 'faq-escala-evaluacion-siee',
    category: 'SIEE y Evaluación',
    canonicalQuestion: '¿Cuál es la escala de calificación y con cuánto se aprueba una materia en el SIEE?',
    triggerPatterns: [
      'escala de valoracion',
      'escala de calificacion',
      'con cuanto se pasa',
      'nota minima para aprobar',
      'desempeno basico',
      'desempeno superior',
      'como califican en el colegio',
    ],
    requiredKeywords: ['escala', 'calificacion', 'nota', 'desempeno', 'aprobar', 'siee'],
    answer:
      '📊 *Escala Institucional de Valoración Académica (SIEE V01):*\n\nEl Colegio San Bonifacio de las Lanzas valora el desempeño de los estudiantes mediante niveles cualitativos y cuantitativos:\n\n• 🌟 **Desempeño Superior (DS):** Dominio sobresaliente de los aprendizajes y competencias.\n• 📈 **Desempeño Alto (DA):** Alcance satisfactorio y destacado de los logros propuestos.\n• ✅ **Desempeño Básico (DB):** Superación de los desempeños necesarios en relación con las áreas obligatorias (nivel mínimo de aprobación).\n• ⚠️ **Desempeño Bajo (DBJ):** No superación de los desempeños mínimos requeridos; requiere actividades de refuerzo y plan de mejoramiento académico.',
    sourceCitation: 'SIEE V(01) - Sistema Institucional de Evaluación',
  },
  {
    id: 'faq-uniforme-escolar',
    category: 'Pacto de Convivencia',
    canonicalQuestion: '¿Cuáles son las normas sobre el porte del uniforme escolar y de educación física?',
    triggerPatterns: [
      'porte del uniforme',
      'como es el uniforme',
      'uniforme de diario',
      'uniforme de educacion fisica',
      'uniforme de natacion',
      'articulo 25',
    ],
    requiredKeywords: ['uniforme', 'porte', 'sudadera', 'tenis', 'presentacion personal'],
    answer:
      '👔 *Normas sobre el Porte del Uniforme (Pacto de Convivencia, Art. 4, 5 y 25):*\n\n• Los estudiantes deben portar el **uniforme de diario o de educación física** completo, limpio y según el horario correspondiente, sin combinar prendas de ambos.\n• **Tenis del uniforme deportivo:** Deben ser **totalmente blancos** (sin líneas ni apliques de colores).\n• **Natación (Art. 4 lit. d):** Mujeres con vestido de baño deportivo enterizo unicolor rojo; hombres con pantaloneta unicolor roja; **gorro de baño rojo obligatorio**.\n• **Accesorios y presentación (Art. 25):** No está permitido el uso de maquillaje, uñas pintadas de colores fuertes, piercings ni prendas ajenas al modelo oficial SBL.',
    sourceCitation: 'Pacto de Convivencia 2026 - Artículos 4, 5 y 25',
  },
  {
    id: 'faq-uso-celular',
    category: 'Convivencia Escolar',
    canonicalQuestion: '¿Cuáles son las normas sobre el uso del celular y dispositivos electrónicos en el colegio?',
    triggerPatterns: [
      'uso del celular',
      'llevar celular',
      'dispositivos electronicos',
      'audifonos en clase',
      'decomiso de celular',
      'celulares en el colegio',
    ],
    requiredKeywords: ['celular', 'celulares', 'telefono', 'audifonos', 'dispositivos'],
    answer:
      '📵 *Uso de Celulares y Dispositivos Electrónicos (Pacto de Convivencia 2026):*\n\n• El uso de celulares, relojes inteligentes y audífonos **no está permitido durante las horas de clase ni en actos comunitarios**, salvo autorización expresa del docente con fines estrictamente pedagógicos.\n• En caso de uso inadecuado en clase, el docente solicitará guardarlo o lo entregará a **Coordinación de Convivencia** para ser devuelto directamente a los padres de familia o acudientes, dejando el registro formativo correspondiente.',
    sourceCitation: 'Pacto de Convivencia 2026 - Régimen de Convivencia',
  },
  {
    id: 'faq-faltas-gravisimas',
    category: 'Convivencia Escolar',
    canonicalQuestion: '¿Cuáles son las faltas graves y gravísimas o situaciones Tipo II y III según el Pacto de Convivencia?',
    triggerPatterns: [
      'faltas gravisimas',
      'faltas graves',
      'situaciones tipo iii',
      'situaciones tipo ii',
      'situaciones tipo 3',
      'bullying o acoso escolar',
      'sanciones disciplinarias',
    ],
    requiredKeywords: ['faltas', 'falta', 'gravisimas', 'graves', 'tipo', 'bullying', 'acoso'],
    answer:
      '⚖️ *Clasificación de Faltas y Situaciones de Convivencia (Pacto de Convivencia 2026 y Ley 1620):*\n\n1. **Faltas Leves / Situaciones Tipo I:** Conflictos manejados inadecuadamente, impuntualidad o porte incompleto del uniforme sin reincidencia.\n2. **Faltas Graves / Situaciones Tipo II:** Reincidencia en faltas leves, fraude académico, irrespeto a miembros de la comunidad, agresión escolar o *ciberacoso (bullying)* que no revista delito.\n3. **Faltas Gravísimas / Situaciones Tipo III:** Conductas que atentan gravemente contra la integridad física o moral, porte o consumo de sustancias psicoactivas, armas o actos tipificados como presuntos delitos en la ley colombiana.\n\n📋 *Consecuencias:* Desde matrícula en observación y suspensión pedagógica hasta la cancelación de matrícula o no renovación de cupo por decisión del Consejo Directivo, garantizando siempre el debido proceso.',
    sourceCitation: 'Pacto de Convivencia 2026 - Debido Proceso y Ruta de Atención Integral',
  },
  {
    id: 'faq-enfermeria-psicorientacion',
    category: 'Directorio Docente',
    canonicalQuestion: '¿Cuál es el horario y contacto de Enfermería, Psicorientación y Secretaría Académica?',
    triggerPatterns: [
      'enfermeria',
      'medicamentos en el colegio',
      'psicorientacion',
      'psicologa del colegio',
      'secretaria academica',
      'certificados de estudio',
      'constancias de estudio',
    ],
    requiredKeywords: [
      'enfermeria',
      'psicorientacion',
      'psicologia',
      'secretaria',
      'certificados',
      'constancia',
    ],
    answer:
      '🏥 *Servicios de Bienestar y Secretaría Académica SBL:*\n\n• **Enfermería (Paola Andrea Varón):** Lunes a Viernes 6:45 a.m. - 5:00 p.m. | `enfermeria@sanboni.edu.co` *(Para suministro de medicamentos se debe enviar fórmula médica vigente)*.\n• **Psicorientación Exploratorio y Conceptual (Natalia Andrea Barrios):** Lunes a Viernes 7:30 a.m. - 1:00 p.m. | `psicorientacion.primaria@sanboni.edu.co`\n• **Psicorientación Contextual y Proyectivo (Santiago Guzmán):** Lunes a Viernes 7:00 a.m. - 1:30 p.m. | `psicorientacion.bachillerato@sanboni.edu.co`\n• **Secretaría Académica (Claudia Milena Parga — Certificados y Matrículas):** Lunes a Viernes 7:00 a.m. - 3:00 p.m. | `secretaria.academica@sanboni.edu.co`',
    sourceCitation: 'Directorio Docente y Horarios de Atención SBL 2026',
  },
];

function cleanChunkContent(raw: string): string {
  return raw
    .replace(/^\[Fuente:[^\]]+\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateQuestionVariantsForChunk(chunk: KBChunk): string[] {
  const section = chunk.section.trim();
  const questions: string[] = [];

  const artMatch = section.match(/Art[íi]culo\s+(\d+)\.?\s*([^\n(]*)/i);
  if (artMatch) {
    const artNum = artMatch[1];
    const artTitle = artMatch[2].replace(/\(Parte\s+\d+\/\d+\)/i, '').trim();
    questions.push(`¿Qué establece el Artículo ${artNum} de ${chunk.source}?`);
    if (artTitle.length > 3) {
      questions.push(`¿Qué dice la normativa del colegio sobre "${artTitle}" (Artículo ${artNum})?`);
      questions.push(`Explícame el Artículo ${artNum} (${artTitle}) del ${chunk.source}.`);
    }
  } else {
    const cleanSection = section.replace(/\(Parte\s+\d+\/\d+\)/i, '').trim();
    questions.push(`¿Qué información oficial hay sobre ${cleanSection} en ${chunk.source}?`);
    questions.push(`Según ${chunk.source}, ¿qué disposiciones aplican en ${cleanSection}?`);
  }

  return questions;
}

function buildDataset(): void {
  const kbPath = path.resolve(process.cwd(), 'data', 'knowledge_base.json');
  const rawKb = fs.readFileSync(kbPath, 'utf8');
  const chunks: KBChunk[] = JSON.parse(rawKb);

  const examples: TrainingExample[] = [];

  for (const faq of CURATED_FAQ_ENTRIES) {
    examples.push({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_COMPACT },
        { role: 'user', content: faq.canonicalQuestion },
        { role: 'assistant', content: faq.answer },
      ],
      metadata: {
        source: faq.sourceCitation,
        category: faq.category,
      },
    });

    for (const pattern of faq.triggerPatterns) {
      const userQuestion =
        pattern.length < 15
          ? `Hola BoniBot, quisiera saber sobre: ${pattern}`
          : `¿Me puedes dar información sobre ${pattern}?`;

      examples.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_COMPACT },
          { role: 'user', content: userQuestion },
          { role: 'assistant', content: faq.answer },
        ],
        metadata: {
          source: faq.sourceCitation,
          category: faq.category,
        },
      });
    }
  }

  for (const chunk of chunks) {
    const cleanedBody = cleanChunkContent(chunk.content);
    if (cleanedBody.length < 40) continue;

    const questions = generateQuestionVariantsForChunk(chunk);
    const formattedAnswer = `🦊 Según **${chunk.source}** (*${chunk.section}*):\n\n${cleanedBody}`;

    examples.push({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_COMPACT },
        { role: 'user', content: questions[0] },
        { role: 'assistant', content: formattedAnswer },
      ],
      metadata: {
        source: chunk.source,
        category: 'Conocimiento Directo Documento Oficial',
      },
    });

    if (questions[1]) {
      const ragSystemPrompt = `${SYSTEM_PROMPT_COMPACT}\n\nFRAGMENTO OFICIAL RECUPERADO:\n[${chunk.source} - ${chunk.section}]: ${cleanedBody}`;
      examples.push({
        messages: [
          { role: 'system', content: ragSystemPrompt },
          { role: 'user', content: questions[1] },
          {
            role: 'assistant',
            content: `🦊 De acuerdo con la normativa oficial del **Colegio San Bonifacio de las Lanzas** en **${chunk.source}** (*${chunk.section}*):\n\n${cleanedBody}\n\n¿Deseas que amplíe algún detalle adicional de este artículo?`,
          },
        ],
        metadata: {
          source: chunk.source,
          category: 'RAG Grounded Synthesis',
        },
      });
    }
  }

  const guardrailPairs = [
    {
      q: '¿Me puedes hacer la tarea de cálculo diferencial?',
      a: '🦊 ¡Hola! Soy *BoniBot*, el asistente institucional del *Colegio San Bonifacio de las Lanzas*. Mi función es orientarte sobre normativas, horarios, directorio docente, SIEE, póliza estudiantil y actividades del colegio, pero no resuelvo tareas escolares. ¡Te animo a repasar tus apuntes o consultar con nuestro líder de Matemáticas, el profesor Mauricio Calderón!',
    },
    {
      q: '¿Cuál es el precio de las entradas al cine hoy en Ibagué?',
      a: '🦊 Solo cuento con información oficial sobre el *Colegio San Bonifacio de las Lanzas Bilingüe (SBL)*. ¿Te puedo colaborar con alguna consulta sobre nuestro Pacto de Convivencia, horarios, talleres Actívate o directorio institucional?',
    },
  ];

  for (const gp of guardrailPairs) {
    examples.push({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_COMPACT },
        { role: 'user', content: gp.q },
        { role: 'assistant', content: gp.a },
      ],
      metadata: {
        source: 'Guardrail Anti-Alucinación SBL',
        category: 'Seguridad y Alcance',
      },
    });
  }

  const jsonlPath = path.resolve(process.cwd(), 'data', 'sbl_training_dataset.jsonl');
  const jsonlLines = examples.map((ex) => JSON.stringify(ex)).join('\n');
  fs.writeFileSync(jsonlPath, jsonlLines + '\n', 'utf8');

  const cachePath = path.resolve(process.cwd(), 'data', 'sbl_fast_cache.json');
  fs.writeFileSync(cachePath, JSON.stringify(CURATED_FAQ_ENTRIES, null, 2), 'utf8');

  console.log('==================================================================');
  console.log('✅ DATASET DE ENTRENAMIENTO ML Y CACHÉ RÁPIDA GENERADOS CON ÉXITO');
  console.log(`📄 Archivo Fine-Tuning JSONL: ${jsonlPath}`);
  console.log(`📊 Total de ejemplos ChatML:  ${examples.length} pares de entrenamiento`);
  console.log(`⚡ Archivo Fast-Cache SBL:    ${cachePath} (${CURATED_FAQ_ENTRIES.length} tópicos clave)`);
  console.log('==================================================================');
}

buildDataset();
