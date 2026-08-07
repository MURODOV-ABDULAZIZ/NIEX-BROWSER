/**
 * SafeNet AI Engine - Lovable/Supabase Yangi Nashri
 * Manzil: https://czxxfudupcikdomidbjl.supabase.co
 */
'use strict';

const fetch = require('node-fetch');

// 1. Yangi Supabase manzilingiz
const API_BASE = "https://czxxfudupcikdomidbjl.supabase.co/functions/v1";

// 2. DIQQAT: Bu yerga yangi Supabase loyihangizdan olingan ANON KEY ni qo'ying!
// Uni app.supabase.com -> Project Settings -> API bo'limidan olasiz.
const ANON_KEY = "=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6eHhmdWR1cGNpa2RvbWlkYmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNzY2MDMsImV4cCI6MjA5NTY1MjYwM30.gWbO-U6srz-WC1DLUGkGGOpe2iB8kSCgpPgXJ3lrveo"; 

async function analyzeText(text) {
  try {
    const res = await fetch(`${API_BASE}/analyze-text`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY 
      },
      body: JSON.stringify({ text: text.slice(0, 5000), language: "uz" })
    });
    if (!res.ok) return { should_block: false };
    return await res.json();
  } catch (e) {
    console.error("AI Text Error:", e.message);
    return { should_block: false };
  }
}

async function analyzeImageBase64(base64) {
  try {
    // data:image/... qismini olib tashlash
    const b64 = String(base64 || '').replace(/^data:image\/\w+;base64,/, '');
    const res = await fetch(`${API_BASE}/analyze-image`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY 
      },
      body: JSON.stringify({ image_base64: b64, language: "uz" })
    });
    if (!res.ok) return { should_block: false };
    return await res.json();
  } catch (e) {
    console.error("AI Image Error:", e.message);
    return { should_block: false };
  }
}

async function analyzeImageUrl(imageUrl) {
  try {
    const res = await fetch(`${API_BASE}/analyze-image`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY 
      },
      body: JSON.stringify({ image_url: imageUrl, language: "uz" })
    });
    if (!res.ok) return { should_block: false };
    return await res.json();
  } catch (e) {
    return { should_block: false };
  }
}

async function analyzeVideoBase64(base64, mimeType) {
  try {
    const b64 = String(base64 || '').replace(/^data:\w+\/\w+;base64,/, '');
    const res = await fetch(`${API_BASE}/analyze-video`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY 
      },
      body: JSON.stringify({ 
        video_base64: b64, 
        mime_type: mimeType || 'video/mp4',
        language: "uz" 
      })
    });
    if (!res.ok) return { should_block: false };
    return await res.json();
  } catch (e) {
    return { should_block: false };
  }
}

function useDirectAi() {
  // Har doim AI ni yoqib qo'yish
  return true;
}

module.exports = {
  useDirectAi,
  analyzeText,
  analyzeImageBase64,
  analyzeImageUrl,
  analyzeVideoBase64,
};