export type Role = 'parent' | 'student' | 'teacher' | 'professional' | 'other';

export interface Parent {
  id: string;
  role: 'parent';
  firstName?: string;
  lastName?: string;
  email: string;
  linkedChildren: string[]; // child ids
}

export type RelationshipStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface Child {
  id: string;
  email: string;
  relationshipStatus: RelationshipStatus;
  parentIds: string[];
  monitoringPaused?: boolean;
}

export interface Relationship {
  parentId: string;
  childId: string;
  verifiedAt?: string | null;
  status: RelationshipStatus;
}

export interface BlockedEvent {
  id: string;
  childId: string;
  timestamp: string;
  category: string;
  domain: string;
  blocked: boolean;
}

export interface NotificationItem {
  id: string;
  parentId: string;
  childId: string;
  timestamp: string;
  message: string;
  category: string;
  domain: string;
  blocked: boolean;
  read?: boolean;
}
