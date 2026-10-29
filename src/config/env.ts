import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface EnvConfig {
  gemini: {
    apiKey: string;
    model: string;
  };
  groq: {
    apiKey: string;
    model: string;
  };
  openrouter: {
    apiKey: string;
    model: string;
  };
  nvidia: {
    apiKey: string;
    model: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  whatsapp: {
    verifyToken: string;
    accessToken: string;
    phoneNumberId: string;
  };
  googleSheetsCsvUrl: string;
}

export const env: EnvConfig = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY?.trim() || '',
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY?.trim() || '',
    model: process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || '',
    model: process.env.OPENROUTER_MODEL?.trim() || 'meta-llama/llama-3.3-70b-instruct:free',
  },
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY?.trim() || '',
    model: process.env.NVIDIA_MODEL?.trim() || 'meta/llama-3.2-11b-vision-instruct',
  },
  supabase: {
    url: process.env.SUPABASE_URL?.trim() || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '',
  },
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() || 'bonibot_sbl_2026_secreto',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '',
  },
  googleSheetsCsvUrl: process.env.GOOGLE_SHEETS_CSV_URL?.trim() || '',
};

export function getConfiguredLLMProviders(): string[] {
  const providers: string[] = [];
  if (env.gemini.apiKey) providers.push(`Gemini (${env.gemini.model})`);
  if (env.groq.apiKey) providers.push(`Groq (${env.groq.model})`);
  if (env.openrouter.apiKey) providers.push(`OpenRouter (${env.openrouter.model})`);
  if (env.nvidia.apiKey) providers.push(`NVIDIA (${env.nvidia.model})`);
  return providers;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabase.url && env.supabase.serviceRoleKey);
}
