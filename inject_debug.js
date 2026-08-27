/**
 * AI Radar Inject Debug — v1.0
 * Bu fayl brauzerga inject bo'lgan zahoti console ga xabar chiqaradi
 * Inject ishlayotganini tekshirish uchun
 */
(function() {
  "use strict";
  if (typeof window === "undefined") return;
  
  console.log(
    "%c[AI Radar DEBUG] Inject muvaffaqiyatli! | URL: " + location.href + " | Time: " + new Date().toISOString(),
    "background:#10b981;color:#fff;font-size:14px;padding:4px 8px;border-radius:4px"
  );
  
  // chrome mavjudligini tekshir
  console.log("[AI Radar DEBUG] chrome defined:", typeof chrome !== "undefined");
  console.log("[AI Radar DEBUG] chrome.storage:", typeof chrome !== "undefined" ? !!chrome.storage : "N/A");
  console.log("[AI Radar DEBUG] window.__AI_RADAR_LOADED__:", window.__AI_RADAR_LOADED__);
  
  // Document ready state
  console.log("[AI Radar DEBUG] document.readyState:", document.readyState);
  
  // Test canvas API
  try {
    const c = document.createElement("canvas");
    c.width = 10; c.height = 10;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 10, 10);
    console.log("[AI Radar DEBUG] Canvas API: OK");
  } catch(e) {
    console.log("[AI Radar DEBUG] Canvas API ERROR:", e.message);
  }
  
  // Test fetch
  console.log("[AI Radar DEBUG] fetch available:", typeof fetch === "function");
  
  // Test WeakMap
  try {
    new WeakMap();
    console.log("[AI Radar DEBUG] WeakMap: OK");
  } catch(e) {
    console.log("[AI Radar DEBUG] WeakMap ERROR:", e.message);
  }
  
  // Test optional chaining
  try {
    const obj = null;
    const val = obj?.test?.value;
    console.log("[AI Radar DEBUG] Optional chaining: OK");
  } catch(e) {
    console.log("[AI Radar DEBUG] Optional chaining ERROR — Electron version too old!", e.message);
  }
  
  // Test numeric separator  
  // Already removed in our code, but check
  console.log("[AI Radar DEBUG] Environment check complete");
})();
