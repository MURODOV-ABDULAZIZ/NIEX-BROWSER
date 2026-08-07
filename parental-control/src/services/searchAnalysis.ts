import { db } from '../database';
import { KEYWORD_DATABASE, KeywordEntry } from './keywordDatabase';
import { v4 as uuidv4 } from 'uuid';

// Search analysis result
export interface SearchAnalysisResult {
  allowed: boolean;
  matchedKeywords: MatchedKeyword[];
  highestSeverity: 'low' | 'medium' | 'high' | 'none';
  category: string;
  shouldNotifyParent: boolean;
  shouldBlockSearch: boolean;
  action: 'allow' | 'warn' | 'block';
  message?: string;
}

export interface MatchedKeyword {
  keyword: string;
  category: string;
  severity: 'low' | 'medium' | 'high';
  matchedText: string;
}

export interface SearchHistoryEvent {
  id: string;
  childId: string;
  timestamp: string;
  query: string;
  normalizedQuery: string;
  category: string;
  matchedKeywords: MatchedKeyword[];
  severity: 'low' | 'medium' | 'high' | 'none';
  shouldNotifyParent: boolean;
  shouldBlockSearch: boolean;
  resultsCount?: number;
  clickedResult?: string | null;
  notified: boolean;
  attemptCount: number;
}

// Normalize a query for matching
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    // Replace common symbol substitutions
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    // Remove extra spaces and punctuation
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if two normalized queries are similar (for spam detection)
function queriesAreSimilar(normalizedA: string, normalizedB: string): boolean {
  if (normalizedA === normalizedB) return true;
  
  // Check if one contains the other
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) return true;
  
  // Check word-level similarity
  const wordsA = normalizedA.split(' ');
  const wordsB = normalizedB.split(' ');
  
  // If most words match, consider similar
  const commonWords = wordsA.filter(w => wordsB.includes(w)).length;
  const totalWords = Math.max(wordsA.length, wordsB.length);
  
  return commonWords / totalWords >= 0.8;
}

// Check if a query matches any keyword
function checkKeywordMatch(normalizedQuery: string, entry: KeywordEntry): MatchedKeyword | null {
  const normalizedKeyword = normalizeQuery(entry.keyword);
  
  // Check if the normalized keyword appears in the normalized query
  if (normalizedQuery.includes(normalizedKeyword)) {
    return {
      keyword: entry.keyword,
      category: entry.category,
      severity: entry.severity,
      matchedText: entry.keyword
    };
  }
  
  return null;
}

// Analyze a child's search query
export function analyzeChildSearch(childId: string, query: string): SearchAnalysisResult {
  const normalizedQuery = normalizeQuery(query);
  
  let matchedKeywords: MatchedKeyword[] = [];
  let highestSeverity: 'low' | 'medium' | 'high' | 'none' = 'none';
  let shouldNotifyParent = false;
  let shouldBlockSearch = false;
  let matchedCategory = 'Safe';
  
  // Check against all keywords
  for (const entry of KEYWORD_DATABASE) {
    const match = checkKeywordMatch(normalizedQuery, entry);
    if (match) {
      matchedKeywords.push(match);
      matchedCategory = entry.category;
      
      // Update highest severity
      if (match.severity === 'high' && highestSeverity !== 'high') highestSeverity = 'high';
      else if (match.severity === 'medium' && highestSeverity === 'low') highestSeverity = 'medium';
      else if (match.severity === 'low' && highestSeverity === 'none') highestSeverity = 'low';
      
      if (entry.notifyParent) shouldNotifyParent = true;
      if (entry.blockSearch) shouldBlockSearch = true;
    }
  }
  
  const allowed = !shouldBlockSearch;
  let action: 'allow' | 'warn' | 'block' = 'allow';
  let message: string | undefined;
  
  if (shouldBlockSearch) {
    action = 'block';
    message = `Search blocked: Contains "${matchedKeywords[0]?.keyword}" (${matchedCategory})`;
  } else if (shouldNotifyParent) {
    action = 'warn';
    message = `Warning: Search contains "${matchedKeywords[0]?.keyword}" (${matchedCategory}) - Parent will be notified`;
  }
  
  return {
    allowed,
    matchedKeywords,
    highestSeverity,
    category: matchedCategory,
    shouldNotifyParent,
    shouldBlockSearch,
    action,
    message
  };
}

// Log a search event
export function logSearchEvent(event: {
  childId: string;
  query: string;
  category: string;
  resultsCount: number;
  clickedResult: string | null;
}): SearchHistoryEvent {
  const normalizedQuery = normalizeQuery(event.query);
  
  // Analyze the search
  const analysis = analyzeChildSearch(event.childId, event.query);
  
  // Check for spam (recent similar searches)
  const cur = db.read();
  const recentSearches = cur.searchHistory
    .filter(e => e.childId === event.childId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);
  
  let attemptCount = 1;
  let shouldNotify = analysis.shouldNotifyParent;
  
  // Check for repeated similar searches within 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  for (const recent of recentSearches) {
    if (recent.timestamp >= fiveMinutesAgo && queriesAreSimilar(normalizedQuery, recent.normalizedQuery)) {
      attemptCount = recent.attemptCount + 1;
      // Only notify on first attempt
      if (attemptCount > 1) {
        shouldNotify = false;
      }
      break;
    }
  }
  
  const searchEvent: SearchHistoryEvent = {
    id: uuidv4(),
    childId: event.childId,
    timestamp: new Date().toISOString(),
    query: event.query,
    normalizedQuery,
    category: analysis.category,
    matchedKeywords: analysis.matchedKeywords,
    severity: analysis.highestSeverity,
    shouldNotifyParent: shouldNotify,
    shouldBlockSearch: analysis.shouldBlockSearch,
    resultsCount: event.resultsCount,
    clickedResult: event.clickedResult,
    notified: false,
    attemptCount
  };
  
  // Save to database
  db.pullAndWrite((c) => {
    if (!c.searchHistory) c.searchHistory = [];
    c.searchHistory.unshift(searchEvent);
    return c;
  });
  
  // Create notification for parents if needed
  if (shouldNotify) {
    const rels = c.relationships.filter((r: any) => r.childId === event.childId && r.status === 'VERIFIED');
    rels.forEach((r: any) => {
      const notif = {
        id: uuidv4(),
        parentId: r.parentId,
        childId: event.childId,
        timestamp: searchEvent.timestamp,
        message: `Search Alert: "${event.query}" (${analysis.category}) - ${analysis.matchedKeywords[0]?.keyword}`,
        category: analysis.category,
        domain: 'search',
        blocked: analysis.shouldBlockSearch,
        read: false
      };
      c.notifications.unshift(notif);
    });
    
    // Mark as notified
    searchEvent.notified = true;
    // Update the search event in history
    const idx = c.searchHistory.findIndex((e: any) => e.id === searchEvent.id);
    if (idx >= 0) c.searchHistory[idx] = searchEvent;
  }
  
  return searchEvent;
}

// Get child's search history
export function getChildSearchHistory(childId: string, limit: number = 50): SearchHistoryEvent[] {
  const cur = db.read();
  return (cur.searchHistory || [])
    .filter(e => e.childId === childId)
    .slice(0, limit);
}