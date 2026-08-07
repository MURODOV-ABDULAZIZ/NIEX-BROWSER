// Bu skript focus-fullscreen.html ichida "sync to backend" qismini
// haqiqiy IPC bridge bilan bog'lash uchun ishlatiladi.
// Eslatma: focus-fullscreen.html allaqachon localStorage'dan ishlaydi.
// Bu qo'shimcha sinxronizatsiya qatlami — brauzerni qayta ishga tushirganda
// yoki boshqa qurilmaga o'tganda so'nggi holat saqlanib qoladi.
//
// Qo'llash: focus-fullscreen.html dagi `syncBlocksToBackend()` funksiyasi
// o'rniga quyidagini ko'chirib qo'ying.

// syncBlocksToBackend — endi bloklangan saytlarni ham sinxronlashtiradi
async function syncBlocksToBackend() {
  try {
    if (window.safenet_focus_extras) {
      // Kelajakda: keyword/whitelist/schedules ni birlashtirilgan 'getAll' dan olish.
      // Hozir esa block ro'yxatini custom-domain sifatida saqlaymiz (focus-blocks-add-domain/remove-domain).
      const existing = await window.safenet_focus_extras.getAll();
      const prev = (existing && existing.customDomains) || [];
      // Qo'shish kerak bo'lganlar
      for (const d of state.blocks) {
        if (!prev.includes(d)) {
          try { await ipcInvoke('focus-blocks-add-domain', d); } catch (e) {}
        }
      }
      // O'chirish kerak bo'lganlar
      for (const d of prev) {
        if (!state.blocks.includes(d)) {
          try { await ipcInvoke('focus-blocks-remove-domain', d); } catch (e) {}
        }
      }
    }
  } catch (e) {}
}

// Yangi helper — keywords/whitelist/schedules ni sinxronlaydi
async function syncExtrasToBackend() {
  if (!window.safenet_focus_extras) return;
  try { await window.safenet_focus_extras.setKeywords(state.keywords); } catch (e) {}
  try { await window.safenet_focus_extras.setWhitelist(state.whitelist); } catch (e) {}
  try { await window.safenet_focus_extras.setSchedules(state.schedules); } catch (e) {}
}

// Yo'l-yo'riq: focus-fullscreen.html da addKeyword/removeKeyword/addWhitelistItem/removeWhitelistItem/
// confirmAddSchedule/removeSchedule/toggleSchedule funksiyalaridan keyin syncExtrasToBackend() chaqiring.
// (Quyidagi HTML o'zgartirish faylini ko'rib chiqing)
