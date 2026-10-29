import { env } from '../src/config/env.js';

async function testGeneration() {
  console.log('Testing Gemini with gemini-3.8-flash:');
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${env.gemini.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Di "Hola desde Gemini" en una línea' }] }],
        }),
      }
    );
    const d = (await res.json()) as any;
    console.log('Gemini reply:', d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || d);
  } catch (e: any) {
    console.error('Gemini error:', e.message);
  }

  console.log('\nTesting NVIDIA with nvidia/llama-3.1-nemotron-70b-instruct:');
  try {
    const res2 = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.nvidia.apiKey}`,
      },
      body: JSON.stringify({
        model: 'nvidia/llama-3.1-nemotron-70b-instruct',
        messages: [{ role: 'user', content: 'Di "Hola desde NVIDIA" en una línea' }],
        max_tokens: 50,
      }),
    });
    const d2 = (await res2.json()) as any;
    console.log('NVIDIA reply:', d2.choices?.[0]?.message?.content?.trim() || d2);
  } catch (e: any) {
    console.error('NVIDIA error:', e.message);
  }
}

testGeneration().catch(console.error);
