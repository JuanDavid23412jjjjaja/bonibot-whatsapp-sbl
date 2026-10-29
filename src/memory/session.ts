import fs from 'fs/promises';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env.js';
import { ChatTurn } from '../llm/router.js';

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

type LocalMemoryStore = Record<string, StoredMessage[]>;

export class SessionMemory {
  private supabase: SupabaseClient | null = null;
  private localPath: string;
  private maxHistoryMessages: number;

  constructor(maxHistoryMessages = 8) {
    this.maxHistoryMessages = maxHistoryMessages;
    this.localPath = path.resolve(process.cwd(), 'data', 'local_memory.json');
    if (isSupabaseConfigured()) {
      this.supabase = createClient(env.supabase.url, env.supabase.serviceRoleKey);
    }
  }

  public async getHistory(phoneNumber: string): Promise<ChatTurn[]> {
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('chat_memory')
          .select('role, content, created_at')
          .eq('phone_number', phoneNumber)
          .order('created_at', { ascending: false })
          .limit(this.maxHistoryMessages);

        if (!error && Array.isArray(data)) {
          return data
            .reverse()
            .map((row) => ({
              role: (row.role as 'user' | 'assistant') || 'user',
              content: String(row.content || ''),
            }));
        }
      } catch {
        // Fallback to local memory
      }
    }

    const store = await this.readLocalStore();
    const list = store[phoneNumber] || [];
    return list.slice(-this.maxHistoryMessages).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  public async appendTurn(
    phoneNumber: string,
    userMessage: string,
    assistantReply: string
  ): Promise<void> {
    if (this.supabase) {
      try {
        await this.supabase.from('chat_memory').insert([
          { phone_number: phoneNumber, role: 'user', content: userMessage },
          { phone_number: phoneNumber, role: 'assistant', content: assistantReply },
        ]);
        return;
      } catch {
        // Fallback to local file if table doesn't exist yet
      }
    }

    const store = await this.readLocalStore();
    const list = store[phoneNumber] || [];
    const now = new Date().toISOString();
    list.push(
      { role: 'user', content: userMessage, timestamp: now },
      { role: 'assistant', content: assistantReply, timestamp: now }
    );
    // Keep last 20 messages max per user locally
    store[phoneNumber] = list.slice(-20);
    await this.writeLocalStore(store);
  }

  public async clearHistory(phoneNumber: string): Promise<void> {
    if (this.supabase) {
      try {
        await this.supabase.from('chat_memory').delete().eq('phone_number', phoneNumber);
      } catch {
        // Ignore error
      }
    }
    const store = await this.readLocalStore();
    delete store[phoneNumber];
    await this.writeLocalStore(store);
  }

  private async readLocalStore(): Promise<LocalMemoryStore> {
    try {
      const raw = await fs.readFile(this.localPath, 'utf-8');
      return JSON.parse(raw) as LocalMemoryStore;
    } catch {
      return {};
    }
  }

  private async writeLocalStore(store: LocalMemoryStore): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.localPath), { recursive: true });
      await fs.writeFile(this.localPath, JSON.stringify(store, null, 2), 'utf-8');
    } catch {
      // Ignore write errors in read-only serverless fs
    }
  }
}
