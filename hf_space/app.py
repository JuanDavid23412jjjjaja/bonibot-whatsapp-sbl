import os
import time
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from huggingface_hub import hf_hub_download
from llama_cpp import Llama

app = FastAPI(
    title="BoniBot SBL - Hugging Face Inference Server",
    description="Servidor de inferencia ultraligero (GGUF + llama.cpp) para el Colegio San Bonifacio de las Lanzas Bilingüe (SBL).",
    version="1.0.0",
)

# Configuración del modelo GGUF en Hugging Face Hub
# Por defecto usa tu modelo fine-tuneado o Qwen2.5-1.5B-Instruct-GGUF como base inmediata
MODEL_REPO = os.getenv("HF_MODEL_REPO", "Qwen/Qwen2.5-1.5B-Instruct-GGUF")
MODEL_FILE = os.getenv("HF_MODEL_FILE", "qwen2.5-1.5b-instruct-q4_k_m.gguf")
API_SECRET = os.getenv("SPACE_API_KEY", "")

print(f"🦊 Descargando modelo GGUF desde {MODEL_REPO}/{MODEL_FILE}...")
model_path = hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE)

print("🚀 Inicializando motor llama.cpp en memoria RAM...")
llm = Llama(
    model_path=model_path,
    n_ctx=2048,
    n_threads=int(os.getenv("OMP_NUM_THREADS", "2")),
    n_batch=512,
    verbose=False,
)
print("✅ Modelo BoniBot SBL cargado y listo para responder.")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: Optional[str] = "bonibot-sbl-1.5b"
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.2
    max_tokens: Optional[int] = 450


@app.get("/")
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "BoniBot SBL ML Inference Space",
        "model_repo": MODEL_REPO,
        "model_file": MODEL_FILE,
    }


@app.post("/v1/chat/completions")
def chat_completions(
    request: ChatCompletionRequest,
    authorization: Optional[str] = Header(default=None),
):
    if API_SECRET:
        expected = f"Bearer {API_SECRET}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="Unauthorized Space API Key")

    start_t = time.time()
    formatted_messages = [{"role": m.role, "content": m.content} for m in request.messages]

    response = llm.create_chat_completion(
        messages=formatted_messages,
        temperature=request.temperature or 0.2,
        max_tokens=request.max_tokens or 450,
    )

    elapsed_ms = int((time.time() - start_t) * 1000)
    response["bonibot_latency_ms"] = elapsed_ms
    return response
