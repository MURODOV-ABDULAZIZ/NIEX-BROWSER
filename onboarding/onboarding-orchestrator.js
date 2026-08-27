/**
 * Onboarding Orchestrator for Main SafeNet Window
 * Handles checking profile completion and launching onboarding flow
 */

const PROFILES_PATH = {
  personalInfo: './onboarding/personal-info.html',
  interests: './onboarding/interests.html',
  editProfile: './onboarding/edit-profile.html'
};

class OnboardingOrchestrator {
  constructor() {
    this.profileService = window.profileService;
    this.setupMessageListener();
  }

  setupMessageListener() {
    window.addEventListener('message', (event) => {
      console.log('Received message:', event.data);

      if (event.data.type === 'PERSONAL_INFO_COMPLETE') {
        console.log('Personal info complete, opening interests');
        this._closeOnboardingModal();
        setTimeout(() => this.openInterestsWindow(), 100);
      } else if (event.data.type === 'INTERESTS_COMPLETE') {
        console.log('Interests complete, saving profile');
        this._closeOnboardingModal();
        this.completeOnboarding();
      } else if (event.data.type === 'PROFILE_UPDATED') {
        console.log('Profile updated');
        this._closeOnboardingModal();
        this.updateProfileDisplay();
      } else if (event.data.type === 'ONBOARDING_BACK') {
        this._closeOnboardingModal();
      }
    });
  }

  checkAndStartOnboarding() {
    if (!this.profileService) {
      console.error('Profile service not available');
      return;
    }

    // Check if onboarding is complete
    const isComplete = this.profileService.isOnboardingComplete();
    console.log('Onboarding complete:', isComplete);

    if (!isComplete) {
      // Start personal info step
      setTimeout(() => this.openPersonalInfoWindow(), 500);
    } else {
      // Update display with existing profile
      this.updateProfileDisplay();
    }
  }

  // ============================================================
  // MODAL IFRAME — brauzer ichida ochiladi (alohida oyna emas!)
  // iframe.contentWindow.postMessage orqali onboarding-orchestrator bilan bog'lanadi.
  // ============================================================
  _openModalIframe(url, opts = {}) {
    // Mavjud modal'ni yopamiz
    const existing = document.getElementById('__onboarding_modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = '__onboarding_modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:99998;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';

    const container = document.createElement('div');
    container.style.cssText = `width:${opts.width||560}px;max-width:96vw;height:${opts.height||680}px;max-height:92vh;background:#0F1623;border:1px solid #1E2D45;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6);display:flex;flex-direction:column`;

    // Yopish tugmasi (agar allow bo'lsa)
    if (opts.closable !== false) {
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'position:absolute;top:22px;right:22px;background:rgba(255,255,255,0.08);border:none;color:#E8F0FE;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:14px;z-index:2';
      closeBtn.onclick = () => modal.remove();
      modal.appendChild(closeBtn);
    }

    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'flex:1;width:100%;border:none;background:transparent';
    iframe.name = opts.name || 'onboarding-iframe';
    container.appendChild(iframe);
    modal.appendChild(container);
    document.body.appendChild(modal);

    // window.opener uchun global bridge
    // iframe.contentWindow.opener = window emas — chunki iframe same-origin bo'lsa avtomatik
    // parent orqali murojaat qiladi. Buni ta'minlash uchun iframe load bo'lganda opener'ni o'rnatamiz.
    iframe.addEventListener('load', () => {
      try {
        // iframe ichidagi window.opener = safenethome window bo'ladi
        // (chunki iframe same-origin file://)
        Object.defineProperty(iframe.contentWindow, 'opener', {
          value: window,
          configurable: true,
        });
        // window.close() ni override qilamiz — modal.remove() qiladi
        iframe.contentWindow.close = () => modal.remove();
      } catch (e) {
        console.warn('Onboarding iframe bridge:', e);
      }
    });

    return { modal, iframe };
  }

  openPersonalInfoWindow() {
    console.log('Opening personal info modal');
    this._openModalIframe(PROFILES_PATH.personalInfo, {
      width: 560, height: 720, name: 'personal-info', closable: false,
    });
  }

  openInterestsWindow() {
    console.log('Opening interests modal');
    this._openModalIframe(PROFILES_PATH.interests, {
      width: 620, height: 760, name: 'interests', closable: false,
    });
  }

  openEditProfileWindow() {
    console.log('Opening edit profile modal');
    this._openModalIframe(PROFILES_PATH.editProfile, {
      width: 560, height: 720, name: 'edit-profile', closable: true,
    });
  }

  completeOnboarding() {
    // All data is already saved in localStorage
    // Now update the main UI to show profile info
    this.updateProfileDisplay();

    // Show toast message
    const personalInfo = this.profileService.getPersonalInfo();
    const interests = this.profileService.getInterests();

    if (personalInfo && interests && interests.length > 0) {
      this.showToast('✅ Profil va qiziqishlar saqlandi!');
    }
  }

  updateProfileDisplay() {
    const personalInfo = this.profileService.getPersonalInfo();
    const interests = this.profileService.getInterests();

    if (!personalInfo) {
      console.log('No personal info found');
      return;
    }

    // Update profile name and email in profile modal
    const pnm = document.getElementById('pnm');
    const pem = document.getElementById('pem');

    if (pnm) {
      pnm.textContent = `${personalInfo.firstName} ${personalInfo.lastName}`;
    }
    if (pem) {
      pem.textContent = personalInfo.role;
    }

    // Add profile information section if not exists
    this.renderProfileInfoSection(personalInfo, interests);

    // Setup edit profile button
    this.setupEditProfileButton();
  }

  renderProfileInfoSection(personalInfo, interests) {
    const pvIn = document.getElementById('pv-in');
    if (!pvIn) return;

    // Check if info section already exists
    let infoSection = document.getElementById('pv-info-section');
    if (!infoSection) {
      infoSection = document.createElement('div');
      infoSection.id = 'pv-info-section';
      infoSection.style.cssText = `
        margin-top: 14px;
        padding: 14px;
        background: #1A2235;
        border-radius: 10px;
        border: 1px solid #1E2D45;
      `;

      const title = document.createElement('div');
      title.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: #00E5A0;
        margin-bottom: 10px;
      `;
      title.textContent = '👤 USER INFORMATION';

      infoSection.appendChild(title);

      // Add info fields
      const fields = [
        { label: 'Role:', id: 'p-role' },
        { label: 'Age:', id: 'p-age' },
        { label: 'Phone:', id: 'p-phone' }
      ];

      fields.forEach((field) => {
        const div = document.createElement('div');
        div.style.cssText = `
          font-size: 12px;
          margin-bottom: 6px;
          display: flex;
          justify-content: space-between;
        `;

        const label = document.createElement('span');
        label.style.color = '#6B7A99';
        label.textContent = field.label;

        const value = document.createElement('span');
        value.id = field.id;
        value.style.color = '#E8F0FE';
        value.textContent = '-';

        div.appendChild(label);
        div.appendChild(value);
        infoSection.appendChild(div);
      });

      pvIn.appendChild(infoSection);
    }

    // Update values
    document.getElementById('p-role').textContent = personalInfo.role || '-';
    document.getElementById('p-age').textContent = personalInfo.age ?? '-';
    document.getElementById('p-phone').textContent = personalInfo.phone || '-';

    // Render interests section
    this.renderInterestsSection(interests);
  }

  renderInterestsSection(interests) {
    const pvIn = document.getElementById('pv-in');
    if (!pvIn) return;

    let interestsSection = document.getElementById('pv-interests-section');
    if (!interestsSection) {
      interestsSection = document.createElement('div');
      interestsSection.id = 'pv-interests-section';
      interestsSection.style.cssText = `
        margin-top: 14px;
        padding: 14px;
        background: #1A2235;
        border-radius: 10px;
        border: 1px solid #1E2D45;
      `;

      const title = document.createElement('div');
      title.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: #00E5A0;
        margin-bottom: 10px;
      `;
      title.textContent = '🎯 INTERESTS';

      const container = document.createElement('div');
      container.id = 'p-interests';
      container.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      `;

      interestsSection.appendChild(title);
      interestsSection.appendChild(container);
      pvIn.appendChild(interestsSection);
    }

    // Update interests display
    const container = document.getElementById('p-interests');
    container.innerHTML = '';

    if (interests && interests.length > 0) {
      interests.forEach((interestId) => {
        // Find label from INTERESTS_CATEGORIES
        let label = interestId;
        for (const category of Object.values(window.INTERESTS_CATEGORIES || {})) {
          const found = category.find(i => i.id === interestId);
          if (found) {
            label = found.label;
            break;
          }
        }

        const chip = document.createElement('div');
        chip.style.cssText = `
          padding: 4px 10px;
          background: #00E5A0;
          color: #000;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        `;
        chip.textContent = label;
        container.appendChild(chip);
      });
    } else {
      const empty = document.createElement('span');
      empty.style.color = '#6B7A99';
      empty.style.fontSize = '11px';
      empty.textContent = 'No interests selected';
      container.appendChild(empty);
    }
  }

  setupEditProfileButton() {
    let editBtn = document.getElementById('btn-edit-profile');
    if (!editBtn) {
      editBtn = document.createElement('button');
      editBtn.id = 'btn-edit-profile';
      editBtn.className = 'bs';
      editBtn.style.cssText = `
        margin-top: 14px;
        width: 100%;
      `;
      editBtn.textContent = '✏️ Edit Profile';

      const pvIn = document.getElementById('pv-in');
      if (pvIn) {
        pvIn.appendChild(editBtn);
      }
    }

    editBtn.addEventListener('click', () => {
      this.openEditProfileWindow();
    });
  }

  // openEditProfileWindow yuqorida modal iframe orqali qayta ta'riflangan
  _closeOnboardingModal() {
    const modal = document.getElementById('__onboarding_modal');
    if (modal) modal.remove();
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1A2235;
      border: 1px solid #1E2D45;
      color: #E8F0FE;
      padding: 10px 18px;
      border-radius: 11px;
      font-size: 13px;
      font-weight: 600;
      z-index: 9999;
      pointer-events: none;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing onboarding orchestrator');
    const orchestrator = new OnboardingOrchestrator();
    window.onboardingOrchestrator = orchestrator;
    orchestrator.checkAndStartOnboarding();
  });
} else {
  console.log('Initializing onboarding orchestrator (DOM already ready)');
  const orchestrator = new OnboardingOrchestrator();
  window.onboardingOrchestrator = orchestrator;
  orchestrator.checkAndStartOnboarding();
}
