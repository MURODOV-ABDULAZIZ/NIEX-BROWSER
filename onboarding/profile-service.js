/**
 * User Profile Service - Browser Storage
 * Manages user profile data, onboarding state, and persistence
 */

const ROLES = ['student', 'parent', 'child', 'user'];

const INTERESTS_CATEGORIES = {
  technology: [
    { id: 'programming', label: 'Programming' },
    { id: 'cybersecurity', label: 'Cybersecurity' },
    { id: 'technology', label: 'Technology' },
    { id: 'startup', label: 'Startup' }
  ],
  education: [
    { id: 'ielts', label: 'IELTS' },
    { id: 'sat', label: 'SAT' },
    { id: 'mathematics', label: 'Mathematics' },
    { id: 'english', label: 'English' },
    { id: 'science', label: 'Science' }
  ],
  business: [
    { id: 'business', label: 'Business' },
    { id: 'finance', label: 'Finance' },
    { id: 'entrepreneurship', label: 'Entrepreneurship' }
  ],
  wellness: [
    { id: 'sport', label: 'Sport' },
    { id: 'fitness', label: 'Fitness' }
  ]
};

class ProfileService {
  constructor() {
    this.storageKey = 'sn_user_profile';
    this.profilesKey = 'sn_user_profiles';
    this.personalInfoKey = 'sn_personal_info';
    this.interestsKey = 'sn_interests';
    this.currentUidKey = 'sn_current_uid';
  }

  getAuthenticatedUser() {
    try {
      return JSON.parse(localStorage.getItem('sn_user') || 'null');
    } catch (e) {
      return null;
    }
  }

  getActiveUid() {
    const authUser = this.getAuthenticatedUser();
    return authUser?.uid || authUser?.email || localStorage.getItem(this.currentUidKey) || null;
  }

  setActiveUid(uid) {
    if (uid) {
      localStorage.setItem(this.currentUidKey, uid);
    }
  }

  getProfiles() {
    try {
      const data = localStorage.getItem(this.profilesKey);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  getProfileByUid(uid) {
    if (!uid) return null;
    const profiles = this.getProfiles();
    return profiles[uid] || null;
  }

  getFirestore() {
    try {
      if (typeof firebase !== 'undefined' && firebase && typeof firebase.firestore === 'function') {
        return firebase.firestore();
      }
    } catch (e) {
      console.warn('Firestore unavailable', e);
    }
    return null;
  }

  async getProfileFromStore(uid = this.getActiveUid()) {
    if (!uid) return this.getProfile();

    const db = this.getFirestore();
    if (!db) return this.getProfile();

    try {
      const snapshot = await db.collection('users').doc(uid).get();
      if (!snapshot.exists) return this.getProfile();
      const remoteProfile = this.normalizeProfile(snapshot.data() || {});
      if (remoteProfile.uid) {
        this.saveProfile(remoteProfile);
      }
      return remoteProfile;
    } catch (e) {
      console.warn('Failed to load profile from Firestore', e);
      return this.getProfile();
    }
  }

  getProfile() {
    const uid = this.getActiveUid();
    if (uid) {
      const profile = this.getProfileByUid(uid);
      if (profile) return profile;
    }

    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Failed to load profile', e);
      return null;
    }
  }

  normalizeProfile(profile = {}) {
    const authUser = this.getAuthenticatedUser();
    const uid = profile.uid || authUser?.uid || authUser?.email || this.getActiveUid() || '';
    const email = profile.email || authUser?.email || '';
    const now = new Date().toISOString();

    return {
      uid,
      email,
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      age: profile.age ?? '',
      phone: profile.phone || '',
      role: profile.role || '',
      interests: Array.isArray(profile.interests) ? profile.interests : [],
      profileCompleted: profile.profileCompleted === true,
      createdAt: profile.createdAt || now,
      updatedAt: now,
      ...profile,
      uid,
      email,
      profileCompleted: profile.profileCompleted === true,
      interests: Array.isArray(profile.interests) ? profile.interests : [],
      updatedAt: now
    };
  }

  saveProfile(profile) {
    try {
      const fullProfile = this.normalizeProfile(profile);
      if (!fullProfile.uid) {
        throw new Error('User uid is required to save a profile');
      }

      const profiles = this.getProfiles();
      profiles[fullProfile.uid] = fullProfile;
      localStorage.setItem(this.profilesKey, JSON.stringify(profiles));
      localStorage.setItem(this.storageKey, JSON.stringify(fullProfile));
      this.setActiveUid(fullProfile.uid);

      try {
        const db = this.getFirestore();
        if (db && fullProfile.uid) {
          db.collection('users').doc(fullProfile.uid).set(fullProfile, { merge: true });
        }
      } catch (e) {
        console.warn('Failed to sync profile to Firestore', e);
      }

      return fullProfile;
    } catch (e) {
      console.error('Failed to save profile', e);
      throw e;
    }
  }

  savePersonalInfo(personalInfo) {
    try {
      const currentProfile = this.getProfile() || {};
      const updatedProfile = this.saveProfile({
        ...currentProfile,
        ...personalInfo,
        firstName: personalInfo.firstName || currentProfile.firstName || '',
        lastName: personalInfo.lastName || currentProfile.lastName || '',
        age: personalInfo.age ?? currentProfile.age ?? '',
        phone: personalInfo.phone ?? currentProfile.phone ?? '',
        role: personalInfo.role || currentProfile.role || '',
        profileCompleted: currentProfile.profileCompleted === true,
        updatedAt: new Date().toISOString()
      });
      localStorage.setItem(this.personalInfoKey, JSON.stringify(personalInfo));
      return updatedProfile;
    } catch (e) {
      console.error('Failed to save personal info', e);
      return null;
    }
  }

  saveInterests(interests) {
    try {
      const currentProfile = this.getProfile() || {};
      const updatedProfile = this.saveProfile({
        ...currentProfile,
        interests: Array.isArray(interests) ? interests : [],
        updatedAt: new Date().toISOString()
      });
      localStorage.setItem(this.interestsKey, JSON.stringify(interests));
      return updatedProfile;
    } catch (e) {
      console.error('Failed to save interests', e);
      return null;
    }
  }

  getPersonalInfo() {
    try {
      const data = localStorage.getItem(this.personalInfoKey);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  getInterests() {
    try {
      const data = localStorage.getItem(this.interestsKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  isProfileComplete(profile = this.getProfile()) {
    return !!profile && profile.profileCompleted === true && !!profile.firstName && !!profile.lastName && profile.age !== '' && profile.age !== null && profile.age !== undefined && !!profile.phone && !!profile.role && Array.isArray(profile.interests) && profile.interests.length > 0;
  }

  isOnboardingComplete() {
    return this.isProfileComplete(this.getProfile());
  }

  clearProfile() {
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.profilesKey);
    localStorage.removeItem(this.personalInfoKey);
    localStorage.removeItem(this.interestsKey);
    localStorage.removeItem(this.currentUidKey);
  }
}

const profileService = new ProfileService();
window.ProfileService = ProfileService;
window.profileService = profileService;
window.INTERESTS_CATEGORIES = INTERESTS_CATEGORIES;
window.ROLES = ROLES;
