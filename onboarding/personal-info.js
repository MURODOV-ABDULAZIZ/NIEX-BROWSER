/**
 * Personal Information Form Handler
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('personalInfoForm');
  const closeBtn = document.getElementById('closeBtn');
  const backBtn = document.getElementById('backBtn');
  const errorMessage = document.getElementById('errorMessage');

  const savedInfo = profileService.getProfile() || profileService.getPersonalInfo() || {};
  if (savedInfo) {
    document.getElementById('role').value = savedInfo.role || '';
    document.getElementById('firstName').value = savedInfo.firstName || '';
    document.getElementById('lastName').value = savedInfo.lastName || '';
    document.getElementById('age').value = savedInfo.age ?? '';
    document.getElementById('phone').value = savedInfo.phone || '';
  }

  closeBtn.addEventListener('click', () => {
    window.close();
  });

  backBtn.addEventListener('click', () => {
    window.close();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const role = document.getElementById('role').value.trim();
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const ageValue = document.getElementById('age').value.trim();
    const phone = document.getElementById('phone').value.trim();

    if (!role) {
      showError('Role is required');
      return;
    }
    if (!firstName) {
      showError('First name is required');
      return;
    }
    if (!lastName) {
      showError('Last name is required');
      return;
    }
    if (!ageValue) {
      showError('Age is required');
      return;
    }
    const age = Number(ageValue);
    if (!Number.isInteger(age) || age <= 0 || age > 120) {
      showError('Age must be a valid number');
      return;
    }
    if (!phone) {
      showError('Phone number is required');
      return;
    }

    clearError();

    const currentProfile = profileService.getProfile() || {};
    const personalInfo = {
      role,
      firstName,
      lastName,
      age,
      phone
    };

    const profile = profileService.savePersonalInfo(personalInfo) || {
      ...currentProfile,
      ...personalInfo,
      profileCompleted: false,
      updatedAt: new Date().toISOString()
    };

    if (window.opener) {
      window.opener.postMessage({
        type: 'PERSONAL_INFO_COMPLETE',
        data: profile
      }, '*');
    }

    window.close();
  });

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.add('show');
  }

  function clearError() {
    errorMessage.textContent = '';
    errorMessage.classList.remove('show');
  }
});
