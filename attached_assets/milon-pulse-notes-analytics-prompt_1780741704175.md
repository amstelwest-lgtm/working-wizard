# Replit Implementation Prompt — Industry Pulse + Contextual Notes + Activity Tracking

Paste this entire prompt into Replit AI or your working-wizard codebase chat.

---

## Context

MILŌN is a mobile-first React financial dashboard for SME owners and accountants. Dark theme (deep navy, gold accents). Existing tabs: Overview / Ratios / Cash / Moves / Tasks. Existing features: Simplified/Complex toggle, shared FinancialInputsContext, WeeklyInputTable, ProfitabilityWaterfall.

---

## PART 1 — Industry Pulse AI News Feed

### What it does
Calls the Anthropic API with web_search enabled. Passes in the SME's stored industry (e.g. "retail", "construction", "hospitality") and asks Claude to surface the 3 most relevant SA business news items for that industry this week. Each item returns a headline, 1-sentence summary, and a relevance tag.

Auto-refreshes once daily. Manual refresh button available. Simplified view shows 1 card; Complex view shows all 3.

---

### 1a. Industry setting

Store the SME's industry in your existing user/business profile context:

```js
// In your business profile context or settings
const [businessProfile, setBusinessProfile] = useState({
  industry: 'retail', // e.g. 'retail' | 'construction' | 'hospitality' | 'manufacturing' | 'logistics'
  businessName: 'My Business',
});
```

Add an industry selector in Settings so the owner can set this once.

---

### 1b. News fetching utility

```js
// utils/fetchIndustryNews.js

export async function fetchIndustryNews(industry) {
  const today = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = `You are a South African business intelligence assistant. Today is ${today}.

Search for the 3 most relevant and recent news items for a South African SME operating in the ${industry} industry. Focus on:
- Regulatory changes affecting ${industry} businesses in SA
- Economic conditions (interest rates, rand, fuel costs) that affect ${industry} margins
- Industry-specific trends, competitor moves, or supply chain news

Respond ONLY with a JSON array. No preamble, no markdown, no backticks. Format:
[
  {
    "headline": "Short punchy headline",
    "summary": "One sentence summary of what happened and why it matters to an SME owner.",
    "tag": "Short relevance label e.g. 'Affects margins' or 'Regulatory' or 'Watch this' or 'Opportunity'",
    "tagColor": "green | amber | red | blue"
  }
]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();

  // Extract text blocks only
  const text = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return [];
  }
}
```

---

### 1c. IndustryPulse component

```jsx
// components/IndustryPulse.jsx

import { useState, useEffect } from 'react';
import { fetchIndustryNews } from '../utils/fetchIndustryNews';
import { useViewMode } from '../context/ViewModeContext';

const TAG_COLORS = {
  green: { bg: 'rgba(76,175,130,0.15)', color: '#4CAF82' },
  amber: { bg: 'rgba(201,168,76,0.15)',  color: '#C9A84C' },
  red:   { bg: 'rgba(224,92,92,0.15)',   color: '#e05c5c' },
  blue:  { bg: 'rgba(100,160,220,0.15)', color: '#64a0dc' },
};

const CACHE_KEY = 'milon_industry_news';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { timestamp, data } = JSON.parse(raw);
    if (Date.now() - timestamp < CACHE_TTL) return data;
    return null;
  } catch { return null; }
}

function saveCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {}
}

export default function IndustryPulse({ industry = 'retail' }) {
  const { viewMode } = useViewMode();
  const [news, setNews]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  async function load(force = false) {
    if (!force) {
      const cached = loadCache();
      if (cached) { setNews(cached); return; }
    }
    setLoading(true);
    const items = await fetchIndustryNews(industry);
    saveCache(items);
    setNews(items);
    setLastRefresh(new Date());
    setLoading(false);
  }

  useEffect(() => { load(); }, [industry]);

  const displayNews = viewMode === 'simplified' ? news.slice(0, 1) : news;

  return (
    <div className="industry-pulse-section">
      <div className="pulse-header">
        <div className="pulse-title-row">
          <span className="pulse-live-dot" />
          <span className="pulse-title">Industry Pulse</span>
          <span className="pulse-meta">AI · {lastRefresh ? lastRefresh.toLocaleDateString('en-ZA') : 'Refreshed today'}</span>
        </div>
        <button className="pulse-refresh-btn" onClick={() => load(true)} disabled={loading}>
          {loading ? '...' : '↻ Refresh'}
        </button>
      </div>

      {loading && (
        <div className="pulse-loading">
          <div className="pulse-skeleton" />
          <div className="pulse-skeleton short" />
        </div>
      )}

      {!loading && displayNews.length === 0 && (
        <div className="pulse-empty">No news loaded yet. Tap Refresh.</div>
      )}

      <div className="pulse-cards-scroll">
        {displayNews.map((item, i) => {
          const tc = TAG_COLORS[item.tagColor] || TAG_COLORS.amber;
          return (
            <div key={i} className="pulse-card">
              <span className="pulse-tag" style={{ background: tc.bg, color: tc.color }}>
                {item.tag}
              </span>
              <div className="pulse-headline">{item.headline}</div>
              <div className="pulse-summary">{item.summary}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

```css
/* Industry Pulse styles */
.industry-pulse-section {
  margin: 0 16px 24px 16px;
}

.pulse-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.pulse-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pulse-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4CAF82;
  box-shadow: 0 0 6px #4CAF82;
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.pulse-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #ffffff;
}

.pulse-meta {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  letter-spacing: 0.05em;
}

.pulse-refresh-btn {
  font-size: 11px;
  font-weight: 600;
  color: #C9A84C;
  background: transparent;
  border: 1px solid rgba(201,168,76,0.3);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}

.pulse-cards-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}

.pulse-cards-scroll::-webkit-scrollbar { display: none; }

.pulse-card {
  min-width: 240px;
  max-width: 260px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 14px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pulse-tag {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 4px;
  width: fit-content;
}

.pulse-headline {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.35;
}

.pulse-summary {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  line-height: 1.5;
}

.pulse-loading { padding: 16px 0; }
.pulse-skeleton {
  height: 14px;
  background: rgba(255,255,255,0.07);
  border-radius: 6px;
  margin-bottom: 8px;
  animation: shimmer 1.4s ease infinite;
}
.pulse-skeleton.short { width: 60%; }

@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.pulse-empty {
  font-size: 12px;
  color: rgba(255,255,255,0.3);
  padding: 16px 0;
  text-align: center;
}
```

### Add to Overview tab (bottom, below Key Diagnostic Ratios):

```jsx
// OverviewTab.jsx
import IndustryPulse from '../components/IndustryPulse';

// At the bottom of the tab content:
<IndustryPulse industry={businessProfile.industry} />
```

---

## PART 2 — Contextual Notes System (Google Comments style)

### How it works
- A floating dim note button follows the user as they scroll (bottom-right, above the nav bar)
- User taps it → enters "pin mode" → taps anywhere on screen to drop a note pin
- A small icon appears at that position on that page/tab
- Clicking the icon opens a small popover showing the note + author + time
- Notes are visible to everyone in the same business account
- The tagged/mentioned person receives an email notification

---

### 2a. Notes context

```js
// context/NotesContext.js

import { createContext, useContext, useState } from 'react';

const NotesContext = createContext();

export function NotesProvider({ children }) {
  const [notes, setNotes] = useState([]);
  // note shape: { id, tab, x, y, text, author, authorEmail, taggedEmail, timestamp }

  const [pinMode, setPinMode] = useState(false);

  function addNote(note) {
    const newNote = { ...note, id: Date.now().toString(), timestamp: new Date().toISOString() };
    setNotes(prev => [...prev, newNote]);
    // Trigger email notification
    if (note.taggedEmail) sendNoteEmail(newNote);
    return newNote;
  }

  function getNotesForTab(tab) {
    return notes.filter(n => n.tab === tab);
  }

  return (
    <NotesContext.Provider value={{ notes, addNote, getNotesForTab, pinMode, setPinMode }}>
      {children}
    </NotesContext.Provider>
  );
}

export const useNotes = () => useContext(NotesContext);
```

---

### 2b. Email notification utility

Use Resend (recommended — free tier, no server needed, works in Replit):

```bash
npm install resend
```

```js
// utils/sendNoteEmail.js
// Uses Resend API — sign up at resend.com, get free API key, store in Replit Secrets as RESEND_API_KEY

export async function sendNoteEmail(note) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'MILŌN Notes <notes@yourdomain.com>',
        to: note.taggedEmail,
        subject: `${note.author} left you a note in MILŌN`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#0a1628;margin-bottom:4px">New note in MILŌN</h2>
            <p style="color:#888;font-size:13px;margin-bottom:20px">
              ${note.author} pinned a note on the <strong>${note.tab}</strong> tab
            </p>
            <div style="background:#f7f7f7;border-left:3px solid #C9A84C;padding:14px 16px;border-radius:6px;font-size:14px;color:#222">
              "${note.text}"
            </div>
            <p style="color:#aaa;font-size:11px;margin-top:16px">
              ${new Date(note.timestamp).toLocaleString('en-ZA')} · MILŌN
            </p>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Note email failed:', err);
  }
}
```

Store your key in Replit Secrets: `VITE_RESEND_API_KEY = re_xxxxxxxxxxxx`

---

### 2c. Floating Note Button

```jsx
// components/FloatingNoteButton.jsx

import { useNotes } from '../context/NotesContext';

export default function FloatingNoteButton() {
  const { pinMode, setPinMode } = useNotes();

  return (
    <button
      className={`floating-note-btn ${pinMode ? 'active' : ''}`}
      onClick={() => setPinMode(!pinMode)}
      title={pinMode ? 'Cancel pin' : 'Pin a note'}
    >
      {pinMode ? '✕' : '✎'}
    </button>
  );
}
```

```css
.floating-note-btn {
  position: fixed;
  bottom: 80px; /* above mobile nav bar */
  right: 18px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(201, 168, 76, 0.12);
  border: 1px solid rgba(201, 168, 76, 0.25);
  color: rgba(201, 168, 76, 0.6);
  font-size: 18px;
  cursor: pointer;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
}

.floating-note-btn:hover,
.floating-note-btn.active {
  background: rgba(201, 168, 76, 0.25);
  color: #C9A84C;
  border-color: #C9A84C;
  box-shadow: 0 0 12px rgba(201,168,76,0.3);
}
```

---

### 2d. Pin overlay + Note pins

```jsx
// components/NoteLayer.jsx

import { useState } from 'react';
import { useNotes } from '../context/NotesContext';

export default function NoteLayer({ tab, currentUser }) {
  const { pinMode, setPinMode, addNote, getNotesForTab } = useNotes();
  const [composing, setComposing] = useState(null); // { x, y }
  const [noteText, setNoteText]   = useState('');
  const [tagEmail, setTagEmail]   = useState('');
  const [openNote, setOpenNote]   = useState(null);

  const tabNotes = getNotesForTab(tab);

  function handleOverlayClick(e) {
    if (!pinMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top)  / rect.height) * 100;
    setComposing({ x, y });
    setPinMode(false);
  }

  function submitNote() {
    if (!noteText.trim()) return;
    addNote({
      tab,
      x: composing.x,
      y: composing.y,
      text: noteText.trim(),
      author: currentUser.name,
      authorEmail: currentUser.email,
      taggedEmail: tagEmail.trim() || null,
    });
    setNoteText('');
    setTagEmail('');
    setComposing(null);
  }

  return (
    <div
      className={`note-layer ${pinMode ? 'pin-mode' : ''}`}
      onClick={handleOverlayClick}
    >
      {/* Existing note pins */}
      {tabNotes.map(note => (
        <div
          key={note.id}
          className="note-pin"
          style={{ left: `${note.x}%`, top: `${note.y}%` }}
          onClick={e => { e.stopPropagation(); setOpenNote(openNote?.id === note.id ? null : note); }}
        >
          ✎
          {openNote?.id === note.id && (
            <div className="note-popover">
              <div className="note-popover-author">{note.author}</div>
              <div className="note-popover-time">
                {new Date(note.timestamp).toLocaleString('en-ZA')}
              </div>
              <div className="note-popover-text">{note.text}</div>
            </div>
          )}
        </div>
      ))}

      {/* Compose new note */}
      {composing && (
        <div
          className="note-compose"
          style={{ left: `${composing.x}%`, top: `${composing.y}%` }}
          onClick={e => e.stopPropagation()}
        >
          <textarea
            className="note-textarea"
            placeholder="Write a note..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            autoFocus
            rows={3}
          />
          <input
            className="note-tag-input"
            placeholder="Notify email (optional)"
            value={tagEmail}
            onChange={e => setTagEmail(e.target.value)}
          />
          <div className="note-compose-actions">
            <button className="note-cancel-btn" onClick={() => setComposing(null)}>Cancel</button>
            <button className="note-submit-btn" onClick={submitNote}>Pin note</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

```css
.note-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}

.note-layer.pin-mode {
  pointer-events: all;
  cursor: crosshair;
}

.note-pin {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(201,168,76,0.2);
  border: 1.5px solid rgba(201,168,76,0.6);
  color: #C9A84C;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: all;
  transform: translate(-50%, -50%);
  transition: background 0.2s;
  z-index: 51;
}

.note-pin:hover { background: rgba(201,168,76,0.35); }

.note-popover {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a2540;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  padding: 12px 14px;
  min-width: 200px;
  max-width: 240px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 52;
}

.note-popover-author {
  font-size: 11px;
  font-weight: 700;
  color: #C9A84C;
  margin-bottom: 2px;
}

.note-popover-time {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  margin-bottom: 8px;
}

.note-popover-text {
  font-size: 13px;
  color: #ffffff;
  line-height: 1.5;
}

.note-compose {
  position: absolute;
  transform: translate(-50%, -50%);
  background: #1a2540;
  border: 1px solid rgba(201,168,76,0.4);
  border-radius: 12px;
  padding: 12px;
  min-width: 220px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  pointer-events: all;
  z-index: 53;
}

.note-textarea {
  width: 100%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: #ffffff;
  font-size: 13px;
  padding: 8px;
  resize: none;
  outline: none;
  margin-bottom: 8px;
}

.note-tag-input {
  width: 100%;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  color: rgba(255,255,255,0.6);
  font-size: 11px;
  padding: 6px 8px;
  outline: none;
  margin-bottom: 10px;
}

.note-compose-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.note-cancel-btn {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
}

.note-submit-btn {
  font-size: 11px;
  font-weight: 700;
  background: #C9A84C;
  color: #0a1628;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
}
```

### Wire NoteLayer into each tab:

```jsx
// Each tab component (OverviewTab, RatiosTab, etc.)
import NoteLayer from '../components/NoteLayer';

// Wrap tab content in a relative-positioned div:
<div style={{ position: 'relative' }}>
  {/* ... existing tab content ... */}
  <NoteLayer tab="overview" currentUser={currentUser} />
</div>
```

Add `<FloatingNoteButton />` once in your app layout (outside tabs, fixed position).

Wrap app root in `<NotesProvider>`.

---

## PART 3 — Activity Tracking + Admin Dashboard

### How it works
Every user action (tab view, button click, feature used, note added, refresh triggered) is logged to a lightweight in-app store. An Admin Dashboard tab (visible only to admin users) shows usage stats per feature.

---

### 3a. Analytics context

```js
// context/AnalyticsContext.js

import { createContext, useContext, useState } from 'react';

const AnalyticsContext = createContext();

export function AnalyticsProvider({ children }) {
  const [events, setEvents] = useState([]);

  function track(eventName, properties = {}) {
    const event = {
      id: Date.now().toString(),
      event: eventName,
      properties,
      timestamp: new Date().toISOString(),
      userId: properties.userId || 'anonymous',
    };
    setEvents(prev => [...prev, event]);
    // Also log to console in dev
    if (import.meta.env.DEV) console.log('[MILŌN track]', event);
  }

  return (
    <AnalyticsContext.Provider value={{ events, track }}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export const useAnalytics = () => useContext(AnalyticsContext);
```

---

### 3b. Track hook — call this anywhere in the app

```js
// hooks/useTrack.js
import { useAnalytics } from '../context/AnalyticsContext';

export function useTrack() {
  const { track } = useAnalytics();
  return track;
}
```

Usage examples — add these calls throughout the app:

```js
const track = useTrack();

// Tab viewed
track('tab_viewed', { tab: 'ratios', userId, viewMode });

// Toggle switched
track('view_mode_toggled', { from: 'simplified', to: 'complex', userId });

// Waterfall exported
track('waterfall_pdf_exported', { userId });

// News refreshed
track('industry_pulse_refreshed', { industry, userId });

// Note pinned
track('note_pinned', { tab, hasTaggedUser: !!taggedEmail, userId });

// Weekly input updated
track('weekly_input_updated', { field, week, userId });

// Strategic move marked done
track('strategic_move_completed', { moveTitle, userId });
```

---

### 3c. Admin Dashboard component

Visible only when `currentUser.role === 'admin'`. Add as a route or modal triggered from settings.

```jsx
// components/AdminDashboard.jsx

import { useAnalytics } from '../context/AnalyticsContext';

function countEvents(events, name) {
  return events.filter(e => e.event === name).length;
}

function uniqueUsers(events) {
  return new Set(events.map(e => e.userId)).size;
}

function topFeatures(events) {
  const counts = {};
  events.forEach(e => {
    counts[e.event] = (counts[e.event] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

function tabUsage(events) {
  return events
    .filter(e => e.event === 'tab_viewed')
    .reduce((acc, e) => {
      const tab = e.properties.tab || 'unknown';
      acc[tab] = (acc[tab] || 0) + 1;
      return acc;
    }, {});
}

export default function AdminDashboard() {
  const { events } = useAnalytics();
  const features = topFeatures(events);
  const tabs = tabUsage(events);
  const maxFeatureCount = features[0]?.[1] || 1;

  function exportCSV() {
    const header = 'timestamp,event,userId,properties\n';
    const rows = events.map(e =>
      `${e.timestamp},${e.event},${e.userId},"${JSON.stringify(e.properties).replace(/"/g, '""')}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `milon-activity-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <div>
          <div className="admin-title">Activity Dashboard</div>
          <div className="admin-subtitle">All user actions since app load · {events.length} events · {uniqueUsers(events)} users</div>
        </div>
        <button className="admin-export-btn" onClick={exportCSV}>↓ Export CSV</button>
      </div>

      {/* Tab Usage */}
      <div className="admin-section">
        <div className="admin-section-title">Tab Views</div>
        <div className="admin-tab-grid">
          {Object.entries(tabs).map(([tab, count]) => (
            <div key={tab} className="admin-stat-card">
              <div className="admin-stat-label">{tab}</div>
              <div className="admin-stat-value">{count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Feature Usage */}
      <div className="admin-section">
        <div className="admin-section-title">Feature Usage (Top 10)</div>
        {features.map(([name, count]) => (
          <div key={name} className="admin-feature-row">
            <div className="admin-feature-name">{name.replace(/_/g, ' ')}</div>
            <div className="admin-feature-bar-track">
              <div
                className="admin-feature-bar-fill"
                style={{ width: `${(count / maxFeatureCount) * 100}%` }}
              />
            </div>
            <div className="admin-feature-count">{count}</div>
          </div>
        ))}
      </div>

      {/* Recent Events */}
      <div className="admin-section">
        <div className="admin-section-title">Recent Events</div>
        <div className="admin-events-list">
          {[...events].reverse().slice(0, 20).map(e => (
            <div key={e.id} className="admin-event-row">
              <span className="admin-event-time">
                {new Date(e.timestamp).toLocaleTimeString('en-ZA')}
              </span>
              <span className="admin-event-name">{e.event.replace(/_/g, ' ')}</span>
              <span className="admin-event-user">{e.userId}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

```css
/* Admin Dashboard styles */
.admin-dashboard {
  padding: 16px;
  color: #ffffff;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.admin-title {
  font-size: 18px;
  font-weight: 800;
  color: #ffffff;
}

.admin-subtitle {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  margin-top: 3px;
}

.admin-export-btn {
  font-size: 11px;
  font-weight: 600;
  color: #C9A84C;
  background: rgba(201,168,76,0.1);
  border: 1px solid rgba(201,168,76,0.3);
  border-radius: 8px;
  padding: 7px 14px;
  cursor: pointer;
}

.admin-section {
  margin-bottom: 28px;
}

.admin-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.4);
  margin-bottom: 12px;
}

.admin-tab-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.admin-stat-card {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}

.admin-stat-label {
  font-size: 10px;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}

.admin-stat-value {
  font-size: 22px;
  font-weight: 800;
  color: #C9A84C;
}

.admin-feature-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.admin-feature-name {
  width: 160px;
  font-size: 12px;
  color: rgba(255,255,255,0.7);
  flex-shrink: 0;
  text-transform: capitalize;
}

.admin-feature-bar-track {
  flex: 1;
  height: 8px;
  background: rgba(255,255,255,0.06);
  border-radius: 4px;
  overflow: hidden;
}

.admin-feature-bar-fill {
  height: 100%;
  background: #C9A84C;
  border-radius: 4px;
  transition: width 0.5s ease;
}

.admin-feature-count {
  width: 32px;
  text-align: right;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255,255,255,0.5);
}

.admin-events-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.admin-event-row {
  display: flex;
  gap: 10px;
  font-size: 11px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.admin-event-time { color: rgba(255,255,255,0.3); width: 70px; flex-shrink: 0; }
.admin-event-name { color: #ffffff; flex: 1; text-transform: capitalize; }
.admin-event-user { color: #C9A84C; font-weight: 600; }
```

---

## Files to create / modify

| Action | File |
|--------|------|
| Create | `utils/fetchIndustryNews.js` |
| Create | `utils/sendNoteEmail.js` |
| Create | `components/IndustryPulse.jsx` |
| Create | `components/FloatingNoteButton.jsx` |
| Create | `components/NoteLayer.jsx` |
| Create | `components/AdminDashboard.jsx` |
| Create | `context/NotesContext.js` |
| Create | `context/AnalyticsContext.js` |
| Create | `hooks/useTrack.js` |
| Modify | `App.jsx` — add `NotesProvider`, `AnalyticsProvider` wrappers + `<FloatingNoteButton />` |
| Modify | `OverviewTab.jsx` — add `<IndustryPulse />` at bottom + `<NoteLayer tab="overview" />` |
| Modify | `RatiosTab.jsx` — add `<NoteLayer tab="ratios" />` |
| Modify | `CashTab.jsx` — add `<NoteLayer tab="cash" />` |
| Modify | `MovesTab.jsx` — add `<NoteLayer tab="moves" />` |
| Modify | `TasksTab.jsx` — add `<NoteLayer tab="tasks" />` |
| Modify | Each tab — add `track('tab_viewed', ...)` on mount |

---

## Replit Secrets to add

| Key | Value |
|-----|-------|
| `VITE_RESEND_API_KEY` | Your Resend API key from resend.com (free tier covers 3 000 emails/month) |

---

## Full context provider wrap order in App.jsx

```jsx
<AnalyticsProvider>
  <ViewModeProvider>
    <FinancialInputsProvider>
      <NotesProvider>
        <YourApp />
        <FloatingNoteButton />
      </NotesProvider>
    </FinancialInputsProvider>
  </ViewModeProvider>
</AnalyticsProvider>
```
