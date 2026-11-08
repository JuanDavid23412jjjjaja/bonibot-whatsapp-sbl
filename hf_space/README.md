---
title: BoniBot SBL Inference Server
emoji: 🦊
colorFrom: red
colorTo: blue
sdk: docker
pinned: false
app_port: 7860
---

# 🦊 BoniBot SBL — Servidor de Inferencia ML (Hugging Face Space)

Servidor de inferencia OpenAI-compatible (`/v1/chat/completions`) diseñado para ejecutar el modelo cuantizado GGUF del **Colegio San Bonifacio de las Lanzas Bilingüe (SBL)** sobre la capa gratuita de CPU de Hugging Face Spaces (16 GB RAM, 2 vCPU).

## Variables de Entorno Opcionales (Settings ➔ Variables and secrets)
- `HF_MODEL_REPO`: Repositorio GGUF en Hugging Face (ej. `JuanDavidSBL/bonibot-sbl-1.5b-gguf` o por defecto `Qwen/Qwen2.5-1.5B-Instruct-GGUF`).
- `HF_MODEL_FILE`: Nombre del archivo `.gguf` (ej. `unsloth.Q4_K_M.gguf` o `qwen2.5-1.5b-instruct-q4_k_m.gguf`).
- `SPACE_API_KEY`: Clave opcional para proteger el endpoint `/v1/chat/completions`.
