# 🦊 BoniBot — Bot de WhatsApp con Multi-LLM y RAG Institucional

Asistente virtual inteligente para WhatsApp diseñado para la comunidad educativa de la **Corporación Colegio San Bonifacio de las Lanzas Bilingüe (SBL - Ibagué, Tolima)**.

Construido para operar **24/7 en la nube con costo $0.00** usando arquitectura Serverless (Vercel Functions), Meta WhatsApp Cloud API Oficial y un motor RAG Híbrido sobre documentos institucionales.

---

## 🌟 Características Principales

- **Costo Operativo $0:** Utiliza la ventana de servicio de 24h gratuita e ilimitada de Meta WhatsApp Cloud API y tiers gratuitos de inferencia y hosting.
- **RAG Híbrido Institucional:**
  - Indexación de 285 fragmentos estructurados por artículos.
  - Documentos base: *Pacto de Convivencia 2026*, *SIEE (Sistema Institucional de Evaluación)*, *Póliza de Seguro Estudiantil Seguros Mundial (2000694412)* y *Boletín Carlo Acutis*.
  - Búsqueda léxica (BM25 + sinónimos escolares) + similitud vectorial con `pgvector` / embeddings de Gemini.
- **Enrutador Multi-LLM con Fallback Automático:**
  - Prioridad: **NVIDIA NIM** (`meta/llama-3.2-11b-vision-instruct` o `minimaxai/minimax-m3.1-flash`) ➔ **Google Gemini** (`gemini-3.8-flash`) ➔ **Groq Cloud** (`llama-3.3-70b-versatile`) ➔ **OpenRouter**.
  - Si un proveedor alcanza límite de cuota (`429`) o falla, conmuta automáticamente al siguiente.
- **Memoria Conversacional por Teléfono:** Recuerda el contexto reciente de cada usuario en WhatsApp.
- **Doble Check Azul Automático:** Marca los mensajes entrantes como leídos (`read`) de inmediato.

---

## 📂 Estructura del Repositorio

```text
├── api/
│   └── webhook.ts              # Endpoint Serverless para Meta WhatsApp (GET y POST)
├── src/
│   ├── bot/
│   │   └── engine.ts           # Orquestador de BoniBot (Comandos, RAG, Memoria, LLM)
│   ├── config/
│   │   └── env.ts              # Variables de entorno y proveedores activos
│   ├── llm/
│   │   ├── router.ts           # MultiLLMRouter con fallback y control de timeout
│   │   └── embeddings.ts       # Generación de embeddings con Google Gemini
│   ├── memory/
│   │   └── session.ts          # Gestión de historial por número de teléfono
│   ├── rag/
│   │   ├── chunker.ts          # Extractor de PDFs, Markdown y CSVs por Artículos
│   │   ├── prompt.ts           # System Prompt oficial de BoniBot
│   │   └── retriever.ts        # Motor de Búsqueda Híbrida (Supabase / Local)
│   └── whatsapp/
│       └── metaClient.ts       # Cliente oficial de Meta Graph API v21.0
├── data/
│   ├── markdown/               # Póliza de seguro y Boletín Carlo Acutis
│   ├── sheets/                 # Directorio docente y Horarios Actívate / Menú
│   └── knowledge_base.json     # Índice de conocimiento preprocesado
├── scripts/
│   ├── build_knowledge_base.ts # Reconstruye knowledge_base.json
│   ├── test_rag.ts             # Test suite de precisión del RAG
│   ├── chat_cli.ts             # Simulador de WhatsApp interactivo en consola
│   ├── ingest_supabase.ts      # Carga vectores a Supabase pgvector
│   └── setup_supabase.sql      # Schema SQL para Supabase
├── vercel.json                 # Configuración de despliegue serverless
└── package.json
```

---

## 🚀 Inicio Rápido (Local)

1. **Clonar e instalar dependencias:**
   ```bash
   git clone https://github.com/JuanDavid23412jjjjaja/bonibot-whatsapp-sbl.git
   cd bonibot-whatsapp-sbl
   npm install
   ```

2. **Configurar variables de entorno:**
   Copia el archivo `.env.example` a `.env` y coloca al menos una API Key gratuita:
   ```env
   NVIDIA_API_KEY=tu_api_key_nvidia
   GEMINI_API_KEY=tu_api_key_gemini
   ```

3. **Ejecutar el simulador interactivo en terminal:**
   ```bash
   npm run chat
   ```

4. **Probar el buscador RAG:**
   ```bash
   npm run test:rag
   ```

---

## ☁️ Despliegue en Vercel (Producción Serverless)

1. Conecta este repositorio en tu cuenta de [Vercel](https://vercel.com).
2. Agrega las variables de entorno (`NVIDIA_API_KEY`, `GEMINI_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`).
3. El webhook quedará publicado en:
   ```
   https://tu-proyecto.vercel.app/api/webhook
   ```
4. Configura esa URL en el portal de [Meta for Developers](https://developers.facebook.com/) en el producto **WhatsApp ➔ Configuración ➔ Webhook**.

---

## 📄 Licencia
MIT
