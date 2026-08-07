import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from './database';
import { sendVerificationCode, verifyCode } from './services/verification';
import { createNotification, getNotificationsForParent, logBlockedEvent } from './services/notifications';
import { analyzeChildSearch, logSearchEvent, getChildSearchHistory } from './services/searchAnalysis';
import { Parent, Child, Relationship } from './types';

export const router = express.Router();

// Create parent account
router.post('/parents', (req, res) => {
  const { firstName, lastName, email } = req.body;
  const id = uuidv4();
  const parent: Parent = { id, role: 'parent', firstName, lastName, email, linkedChildren: [] };
  db.pullAndWrite((cur) => {
    cur.parents.push(parent);
    return cur;
  });
  res.json(parent);
});

// Add child (starts PENDING relationship and sends verification email)
router.post('/parents/:parentId/children', (req, res) => {
  const { parentId } = req.params;
  const { email } = req.body;
  const existingChild = db.read().children.find((c) => c.email === email);
  let childId = existingChild ? existingChild.id : uuidv4();
  if (!existingChild) {
    const child: Child = { id: childId, email, relationshipStatus: 'PENDING', parentIds: [parentId], monitoringPaused: false } as Child;
    db.pullAndWrite((cur) => {
      cur.children.push(child);
      cur.relationships.push({ parentId, childId, status: 'PENDING', verifiedAt: null });
      const parent = cur.parents.find((p) => p.id === parentId);
      if (parent) parent.linkedChildren.push(childId);
      return cur;
    });
  } else {
    // add relationship
    db.pullAndWrite((cur) => {
      if (!cur.relationships.find((r) => r.parentId === parentId && r.childId === childId)) {
        cur.relationships.push({ parentId, childId, status: 'PENDING', verifiedAt: null });
      }
      const parent = cur.parents.find((p) => p.id === parentId);
      if (parent && !parent.linkedChildren.includes(childId)) parent.linkedChildren.push(childId);
      if (!existingChild.parentIds.includes(parentId)) existingChild.parentIds.push(parentId);
      return cur;
    });
  }
  const sent = sendVerificationCode(email);
  res.json({ childId, sentCodeForDemo: sent.code });
});

// Verify code
router.post('/verify', (req, res) => {
  const { parentId, email, code, accept } = req.body;
  const ok = verifyCode(email, code);
  if (!ok.success) return res.status(400).json(ok);
  // find child, relationship and mark verified
  db.pullAndWrite((cur) => {
    const child = cur.children.find((c) => c.email === email);
    if (!child) return cur;
    child.relationshipStatus = accept ? 'VERIFIED' : 'REJECTED';
    const rel = cur.relationships.find((r) => r.childId === child.id && r.parentId === parentId);
    if (rel) {
      rel.status = child.relationshipStatus;
      rel.verifiedAt = accept ? new Date().toISOString() : null;
    }
    return cur;
  });
  res.json({ success: true });
});

// Remove child from parent
router.delete('/parents/:parentId/children/:childId', (req, res) => {
  const { parentId, childId } = req.params;
  db.pullAndWrite((cur) => {
    cur.parents.forEach((p) => {
      if (p.id === parentId) p.linkedChildren = p.linkedChildren.filter((id) => id !== childId);
    });
    cur.relationships = cur.relationships.filter((r) => !(r.parentId === parentId && r.childId === childId));
    return cur;
  });
  res.json({ success: true });
});

// Pause/resume monitoring
router.post('/children/:childId/monitor', (req, res) => {
  const { childId } = req.params;
  const { pause } = req.body;
  db.pullAndWrite((cur) => {
    const child = cur.children.find((c) => c.id === childId);
    if (child) child.monitoringPaused = !!pause;
    return cur;
  });
  res.json({ success: true });
});

// Log blocked event
router.post('/events', (req, res) => {
  const { childId, category, domain, blocked } = req.body;
  const ev = logBlockedEvent({ childId, category, domain, blocked });
  res.json(ev);
});

// Fetch dashboard data for parent
router.get('/parents/:parentId/dashboard', (req, res) => {
  const { parentId } = req.params;
  const cur = db.read();
  const parent = cur.parents.find((p) => p.id === parentId);
  if (!parent) return res.status(404).json({ error: 'Parent not found' });
  const children = parent.linkedChildren.map((cid) => cur.children.find((c) => c.id === cid));
  const notifications = getNotificationsForParent(parentId);
  res.json({ parent, children, notifications });
});

// Fetch notifications
router.get('/parents/:parentId/notifications', (req, res) => {
  const { parentId } = req.params;
  res.json(getNotificationsForParent(parentId));
});

// Search Analysis Endpoints
// Analyze a child's search query before results are shown
router.post('/children/:childId/search/analyze', (req, res) => {
  const { childId } = req.params;
  const { query } = req.body;
  
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  const result = analyzeChildSearch(childId, query.trim());
  res.json(result);
});

// Log a completed search event (after results are shown)
router.post('/children/:childId/search/log', (req, res) => {
  const { childId } = req.params;
  const { query, category, resultsCount, clickedResult } = req.body;
  
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required' });
  }
  
  const event = logSearchEvent({
    childId,
    query: query.trim(),
    category: category || 'unknown',
    resultsCount: resultsCount || 0,
    clickedResult: clickedResult || null
  });
  
  res.json(event);
});

// Get child's search history
router.get('/children/:childId/search/history', (req, res) => {
  const { childId } = req.params;
  const { limit } = req.query;
  
  const history = getChildSearchHistory(childId, limit ? parseInt(limit as string) : 50);
  res.json(history);
});

export const router = express.Router();
