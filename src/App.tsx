import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Moon, Search, SunMedium, Plus, Bold, Underline, ArrowLeft, Edit2, Trash2, ChevronRight, Palette, Copy, Check, Highlighter } from 'lucide-react';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

type Note = {
  id: string;
  student: string;
  title: string;
  content: string;
  language: 'en' | 'ur';
  updated_at: string;
  tags: string[];
  archived?: boolean;
};

type ThemeMode = 'light' | 'dark';
type AppView = 'students' | 'studentNotes' | 'reading' | 'editing';
type ViewState = { appView: AppView; activeStudent: string | null; activeId: string | null; editFromStudent: boolean };

const STORAGE_KEY = 'teacher-notes-pwa';
const SYNC_QUEUE_KEY = 'teacher-notes-sync-queue';
const SAMPLE_NOTES: Note[] = [
  { id: crypto.randomUUID(), student: 'Ayesha', title: 'Reading progress', content: 'Ayesha is improving her reading confidence and needs encouragement with longer passages.', language: 'en', updated_at: new Date().toISOString(), tags: [] },
  { id: crypto.randomUUID(), student: 'Bilal', title: 'MUQADDIMA', content: 'بلاگ کے ساتھ مشق کرانے کی ضرورت ہے۔ نظم میں گونج اور سنیریت کو یقینی بنائیں۔', language: 'ur', updated_at: new Date().toISOString(), tags: [] },
];

const detectLanguage = (text: string): 'en' | 'ur' => {
  const urduPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return urduPattern.test(text) ? 'ur' : 'en';
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '');

const FONT_LEVELS = [12, 14, 16, 20, 26];

const FONTS = [
  { name: 'Default', value: '' },
  { name: 'Serif · Georgia', value: 'Georgia, serif' },
  { name: 'Sans · Verdana', value: 'Verdana, sans-serif' },
  { name: 'Monospace', value: '"Courier New", monospace' },
  { name: 'Nastaliq · Urdu', value: '"Noto Nastaliq Urdu", serif' },
  { name: 'Comic Sans', value: '"Comic Sans MS", cursive' },
  { name: 'Times New Roman', value: '"Times New Roman", serif' },
];

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inlineMarkdown = (text: string): string => {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t;
};

const markdownToHtml = (md: string): string => {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let inUl = false;
  let inOl = false;
  let ulItems: string[] = [];
  let olItems: string[] = [];

  const closeLists = () => {
    if (inUl) { out.push('<ul>' + ulItems.map(i => `<li>${i}</li>`).join('') + '</ul>'); ulItems = []; inUl = false; }
    if (inOl) { out.push('<ol>' + olItems.map(i => `<li>${i}</li>`).join('') + '</ol>'); olItems = []; inOl = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().startsWith('```')) {
      if (!inCode) { closeLists(); inCode = true; codeBuf = []; }
      else { inCode = false; out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>'); codeBuf = []; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const t = line.trim();
    if (!t) { closeLists(); continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { closeLists(); out.push('<hr />'); continue; }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); out.push(`<h${h[1].length}>${inlineMarkdown(h[2])}</h${h[1].length}>`); continue; }
    if (t.startsWith('> ')) { closeLists(); out.push(`<blockquote>${inlineMarkdown(t.slice(2))}</blockquote>`); continue; }
    const ul = t.match(/^[-*+]\s+(.*)$/);
    if (ul) { if (inOl) closeLists(); inUl = true; ulItems.push(inlineMarkdown(ul[1])); continue; }
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ol) { if (inUl) closeLists(); inOl = true; olItems.push(inlineMarkdown(ol[1])); continue; }
    closeLists();
    out.push(`<p>${inlineMarkdown(t)}</p>`);
  }
  closeLists();
  if (inCode) out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
  return out.join('');
};

const detectMarkdown = (text: string): boolean => {
  if (!text) return false;
  return text.split('\n').some(line => {
    const t = line.trim();
    return /^#{1,6}\s/.test(t) || /^[-*+]\s/.test(t) || /^\d+[.)]\s/.test(t) ||
      /^>\s/.test(t) || /^```/.test(t) || /^(-{3,}|\*{3,}|_{3,})$/.test(t) ||
      /\*\*[^*]+\*\*/.test(t) || /`[^`]+`/.test(t) || /\[[^\]]+\]\([^)]+\)/.test(t);
  });
};

const AVATAR_COLORS = [
  { name: 'Green', value: '#22c55e' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' },
];
const COLOR_KEY = 'teacher-notes-colors';
const THEME_KEY = 'teacher-notes-theme';
const getStudentColor = (student: string, map: Record<string, string>) =>
  map[student] || AVATAR_COLORS[0].value;

const timeAgo = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

let supabaseSeeded = false;

type SyncOperation = {
  type: 'upsert' | 'delete';
  note?: Note;
  id?: string;
  timestamp: number;
};

const getSyncQueue = (): SyncOperation[] => {
  try {
    const saved = localStorage.getItem(SYNC_QUEUE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const addToSyncQueue = (operation: SyncOperation) => {
  const queue = getSyncQueue();
  queue.push(operation);
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  processSyncQueue();
};

const removeFromQueue = (index: number) => {
  const queue = getSyncQueue();
  queue.splice(index, 1);
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
};

const processSyncQueue = async () => {
  if (!supabase || !navigator.onLine) return;
  
  const queue = getSyncQueue();
  if (queue.length === 0) return;

  for (let i = 0; i < queue.length; i++) {
    const operation = queue[i];
    try {
      if (operation.type === 'upsert' && operation.note) {
        await supabase.from('notes').upsert({
          id: operation.note.id,
          student: operation.note.student,
          title: operation.note.title,
          content: operation.note.content,
          language: operation.note.language,
          updated_at: operation.note.updated_at,
        });
        removeFromQueue(i);
        i--;
      } else if (operation.type === 'delete' && operation.id) {
        await supabase.from('notes').delete().eq('id', operation.id);
        removeFromQueue(i);
        i--;
      }
    } catch (error) {
      console.error('Sync failed for operation:', error);
      break;
    }
  }
};

const syncUpsert = (note: Note) => {
  if (!supabase) return;
  if (!navigator.onLine) {
    addToSyncQueue({ type: 'upsert', note, timestamp: Date.now() });
    return;
  }
  (async () => {
    try { 
      await supabase.from('notes').upsert({
        id: note.id, 
        student: note.student, 
        title: note.title,
        content: note.content, 
        language: note.language, 
        updated_at: note.updated_at,
      }); 
    } catch { 
      addToSyncQueue({ type: 'upsert', note, timestamp: Date.now() });
    }
  })();
};

const syncDelete = (id: string) => {
  if (!supabase) return;
  if (!navigator.onLine) {
    addToSyncQueue({ type: 'delete', id, timestamp: Date.now() });
    return;
  }
  (async () => {
    try { 
      await supabase.from('notes').delete().eq('id', id); 
    } catch { 
      addToSyncQueue({ type: 'delete', id, timestamp: Date.now() });
    }
  })();
};
const syncRenameStudent = (from: string, to: string) => {
  if (!supabase) return;
  (async () => {
    try { await supabase.from('notes').update({ student: to }).eq('student', from); } catch { /* ignore */ }
  })();
};
const syncDeleteStudent = (name: string) => {
  if (!supabase) return;
  (async () => {
    try { await supabase.from('notes').delete().eq('student', name); } catch { /* ignore */ }
  })();
};

const syncDebounce: Record<string, ReturnType<typeof setTimeout>> = {};
const syncUpsertDebounced = (note: Note, delay = 600) => {
  if (!supabase) return;
  if (syncDebounce[note.id]) clearTimeout(syncDebounce[note.id]);
  syncDebounce[note.id] = setTimeout(() => {
    delete syncDebounce[note.id];
    syncUpsert(note);
  }, delay);
};
const syncCancelPending = (id: string) => {
  if (syncDebounce[id]) { clearTimeout(syncDebounce[id]); delete syncDebounce[id]; }
};

function App() {
  const [notes, setNotes] = useState<Note[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : SAMPLE_NOTES;
  });
  const [search, setSearch] = useState('');
  const [activeStudent, setActiveStudent] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editFromStudent, setEditFromStudent] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [appView, setAppView] = useState<AppView>('students');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [fmtState, setFmtState] = useState({ bold: false, underline: false, highlight: false });
  const [selSize, setSelSize] = useState(16);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [modal, setModal] = useState<{ mode: 'addStudent' | 'renameStudent'; oldName?: string } | null>(null);
  const [modalValue, setModalValue] = useState('');
  const [avatarColors, setAvatarColors] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem(COLOR_KEY);
    return saved ? JSON.parse(saved) : {};
  });
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handler);
  }, [search]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const historyRef = useRef<ViewState[]>([{ appView: 'students', activeStudent: null, activeId: null, editFromStudent: false }]);

  const navigate = useCallback((next: Partial<ViewState>) => {
    const current = historyRef.current[historyRef.current.length - 1];
    const newState: ViewState = { ...current, ...next };
    historyRef.current.push(newState);
    setAppView(newState.appView);
    setActiveStudent(newState.activeStudent);
    setActiveId(newState.activeId);
    setEditFromStudent(newState.editFromStudent);
    setSearch('');
    window.history.pushState({ ...newState }, '');
  }, []);

  const goBack = useCallback(() => { window.history.back(); }, []);

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (historyRef.current.length > 1) {
        historyRef.current.pop();
        const s = e.state || historyRef.current[historyRef.current.length - 1];
        setAppView(s.appView);
        setActiveStudent(s.activeStudent);
        setActiveId(s.activeId);
        setEditFromStudent(s.editFromStudent);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const activeNote = useMemo(() => activeId ? notes.find(n => n.id === activeId) || null : null, [notes, activeId]);
  const students = useMemo(() => Array.from(new Set(notes.map(n => n.student))).sort(), [notes]);

  const studentNotes = useMemo(() => {
    if (!activeStudent) return [];
    return notes.filter(n => n.student === activeStudent);
  }, [notes, activeStudent]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [copied]);

  useEffect(() => {
    if (saveState === 'saving') {
      const t = setTimeout(() => setSaveState('saved'), 900);
      return () => clearTimeout(t);
    }
  }, [saveState]);

  const saveSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (anchor && editor.contains(anchor)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const r = savedRangeRef.current;
    if (r && r.startContainer.isConnected && r.endContainer.isConnected) {
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(r.cloneRange());
    }
  }, []);

  useEffect(() => {
    if (appView !== 'editing') return;
    setSaveState('saved');
    const update = () => {
      saveSelection();
      setFmtState({
        bold: document.queryCommandState('bold'),
        underline: document.queryCommandState('underline'),
        highlight: checkHighlightActive(),
      });
      setSelSize(getSelectionSize());
    };
    document.addEventListener('selectionchange', update);
    document.addEventListener('input', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('input', update);
    };
  }, [appView, saveSelection]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem(COLOR_KEY, JSON.stringify(avatarColors));
  }, [avatarColors]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      processSyncQueue();
      fetchLatestNotes();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const fetchLatestNotes = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase.from('notes').select('*').order('updated_at', { ascending: false });
      if (data && data.length > 0) {
        setNotes(data as Note[]);
      }
    } catch (error) {
      console.error('Failed to fetch latest notes:', error);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel('teacher-notes-sync');
    channelRef.current = channel;
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, (payload) => {
      if (payload.eventType === 'INSERT' && payload.new) {
        const newNote = payload.new as Note;
        setNotes(prev => prev.some(item => item.id === newNote.id) ? prev : [newNote, ...prev]);
      }
      if (payload.eventType === 'UPDATE' && payload.new) {
        const updatedNote = payload.new as Note;
        setNotes(prev => prev.map(item => item.id === updatedNote.id ? updatedNote : item));
      }
      if (payload.eventType === 'DELETE' && payload.old) {
        const removed = payload.old as Note;
        setNotes(prev => prev.filter(item => item.id !== removed.id));
      }
    }).subscribe();
    return () => { channel.unsubscribe(); channelRef.current = null; };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    
    const fetchAndSeed = async () => {
      try {
        const { data } = await supabase.from('notes').select('*').order('updated_at', { ascending: false });
        if (cancelled) return;
        
        if (data && data.length > 0) {
          setNotes(data as Note[]);
        } else if (!supabaseSeeded) {
          supabaseSeeded = true;
          const { data: existing } = await supabase.from('notes').select('student');
          const existingStudents = new Set((existing || []).map((n: { student: string }) => n.student));
          let raw = localStorage.getItem(STORAGE_KEY);
          let local: Note[] = [];
          try { local = raw ? JSON.parse(raw) : []; } catch { local = []; }
          if (!Array.isArray(local)) local = [];
          for (const n of local) {
            if (!existingStudents.has(n.student)) {
              existingStudents.add(n.student);
              await supabase.from('notes').upsert(n);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch notes from Supabase:', error);
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const localNotes = JSON.parse(saved);
            setNotes(localNotes);
          } catch {}
        }
      }
    };
    
    fetchAndSeed();
    return () => { cancelled = true; };
  }, []);

  const filteredStudents = useMemo(() => students, [students]);

  const filteredNotesForStudent = useMemo(() => {
    const term = debouncedSearch.toLowerCase();
    return studentNotes
      .filter(note => {
        const haystack = `${note.title} ${stripHtml(note.content)}`.toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [studentNotes, debouncedSearch]);

  useEffect(() => {
    if (editorRef.current && activeNote) {
      const editor = editorRef.current;
      let content = activeNote.content;
      
      // Auto-wrap Urdu content in Noto Nastaliq span if not already wrapped
      if (activeNote.language === 'ur' && !content.includes("font-family: 'Noto Nastaliq Urdu'")) {
        content = `<span style="font-family: 'Noto Nastaliq Urdu', serif;">${content}</span>`;
      }
      
      editor.innerHTML = content;
    }
  }, [activeNote?.id, appView]);

  const updateNote = useCallback((field: keyof Note, value: string) => {
    if (!activeNote) return;
    const updated: Note = { ...activeNote, [field]: value, updated_at: new Date().toISOString() };
    if (field === 'content' || field === 'title') {
      updated.language = detectLanguage(`${updated.title} ${stripHtml(updated.content)}`);
    }
    setNotes(prev => prev.map(note => (note.id === updated.id ? updated : note)));
    setSaveState('saving');
    syncUpsertDebounced(updated);
  }, [activeNote]);

  const handleCopy = useCallback(async () => {
    if (!activeNote) return;
    try {
      await navigator.clipboard.writeText(stripHtml(activeNote.content) || activeNote.title);
      setCopied(true);
    } catch { /* clipboard unavailable */ }
  }, [activeNote]);

  const createNote = useCallback((student: string) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      student,
      title: '',
      content: '',
      language: 'en',
      updated_at: new Date().toISOString(),
      tags: []
    };
    setNotes(prev => [newNote, ...prev]);
    syncUpsert(newNote);
    navigate({ appView: 'editing', activeStudent: student, activeId: newNote.id, editFromStudent: true });
    showToast('Note created');
  }, [navigate]);

  const addStudent = useCallback(() => {
    setModalValue('');
    setModal({ mode: 'addStudent' });
  }, []);

  const deleteNote = useCallback((id: string) => {
    setConfirm({
      title: 'Delete note?',
      message: 'This note will be permanently deleted and removed from all devices.',
      onConfirm: () => {
        syncCancelPending(id);
        setNotes(prev => prev.filter(note => note.id !== id));
        syncDelete(id);
        if (activeId === id) {
          navigate({ appView: 'studentNotes', activeId: null, editFromStudent: false });
        }
        showToast('Note deleted');
      },
    });
  }, [activeId, navigate]);

  const renameStudent = useCallback((oldName: string) => {
    setModalValue(oldName);
    setModal({ mode: 'renameStudent', oldName });
  }, []);

  const submitModal = useCallback(() => {
    if (!modal) return;
    const trimmed = modalValue.trim();
    if (!trimmed) { setModal(null); return; }
    if (modal.mode === 'addStudent') {
      if (notes.some(n => n.student === trimmed)) { setModal(null); return; }
      const placeholder: Note = {
        id: crypto.randomUUID(),
        student: trimmed,
        title: '',
        content: '',
        language: 'en',
        updated_at: new Date().toISOString(),
        tags: []
      };
      setNotes(prev => prev.some(n => n.student === trimmed) ? prev : [placeholder, ...prev]);
      syncUpsert(placeholder);
      setModal(null);
      navigate({ appView: 'editing', activeStudent: trimmed, activeId: placeholder.id, editFromStudent: true });
      showToast(`Added ${trimmed}`);
    } else if (modal.mode === 'renameStudent' && modal.oldName) {
      const oldName = modal.oldName;
      setNotes(prev => prev.map(n => n.student === oldName ? { ...n, student: trimmed } : n));
      setAvatarColors(prev => {
        const next = { ...prev };
        if (next[oldName]) { next[trimmed] = next[oldName]; delete next[oldName]; }
        return next;
      });
      if (activeStudent === oldName) setActiveStudent(trimmed);
      syncRenameStudent(oldName, trimmed);
      setModal(null);
      showToast('Student renamed');
    }
  }, [modal, modalValue, activeStudent, notes, navigate]);

  const setStudentColor = useCallback((student: string, color: string) => {
    setAvatarColors(prev => ({ ...prev, [student]: color }));
  }, []);

  const deleteStudent = useCallback((name: string) => {
    const count = notes.filter(n => n.student === name).length;
    setConfirm({
      title: `Delete ${name}?`,
      message: `This will remove ${name} and their ${count} note(s) from all devices.`,
      onConfirm: () => {
        setNotes(prev => prev.filter(n => n.student !== name));
        setAvatarColors(prev => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
        syncDeleteStudent(name);
        if (activeStudent === name) { navigate({ appView: 'students', activeStudent: null, activeId: null, editFromStudent: false }); }
        showToast('Student removed');
      },
    });
  }, [notes, activeStudent, navigate]);

  const checkHighlightActive = (): boolean => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    let node: Node | null = sel.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node && node !== editorRef.current?.parentElement) {
      if (node instanceof HTMLElement) {
        const bg = node.style.backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== '') return true;
      }
      node = node.parentNode;
    }
    return false;
  };

  const formatText = useCallback((command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    
    if (command === 'highlight') {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { editor.focus(); return; }
      const range = sel.getRangeAt(0);
      
      // Check if selection is within a highlighted span
      let node: Node | null = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      
      // Traverse up to find if we're inside a highlight span
      let highlightSpan: HTMLElement | null = null;
      let tempNode: Node | null = node;
      while (tempNode && tempNode !== editor) {
        if (tempNode instanceof HTMLElement && tempNode.style.backgroundColor && 
            tempNode.style.backgroundColor !== 'transparent' && tempNode.style.backgroundColor !== 'rgba(0, 0, 0, 0)' && tempNode.style.backgroundColor !== '' &&
            tempNode.style.backgroundColor === 'rgb(254, 215, 170)') {
          highlightSpan = tempNode;
          break;
        }
        tempNode = tempNode.parentNode;
      }
      
      if (highlightSpan) {
        // Remove highlight by unwrapping the span
        const parent = highlightSpan.parentNode;
        while (highlightSpan.firstChild) {
          parent?.insertBefore(highlightSpan.firstChild, highlightSpan);
        }
        highlightSpan.remove();
        // Merge adjacent text nodes
        if (parent && parent.normalize) {
          parent.normalize();
        }
        updateNote('content', editor.innerHTML);
        saveSelection();
        return;
      }
      
      // Apply highlight
      const span = document.createElement('span');
      span.style.backgroundColor = '#fed7aa';
      span.style.color = '#2563eb';
      try {
        range.surroundContents(span);
      } catch {
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
      }
      updateNote('content', editor.innerHTML);
      saveSelection();
      return;
    }

    const before = editor.innerHTML;
    const ok = document.execCommand(command, false, value);
    if (ok && editor.innerHTML !== before) {
      updateNote('content', editor.innerHTML);
      saveSelection();
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { editor.focus(); return; }
    const range = sel.getRangeAt(0);
    const styles: Record<string, [string, string]> = {
      bold: ['fontWeight', 'bold'],
      underline: ['textDecorationLine', 'underline'],
    };
    const st = styles[command];
    if (!st) { editor.focus(); return; }
    const [prop, val] = st;
    const span = document.createElement('span');
    span.style.setProperty(prop, val);
    try {
      range.surroundContents(span);
    } catch {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand(command, false, undefined);
    }
    updateNote('content', editor.innerHTML);
    saveSelection();
  }, [updateNote, restoreSelection, saveSelection]);

  const applyFontSize = useCallback((size: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      editor.focus();
      return;
    }
    const range = sel.getRangeAt(0);
    let spans: HTMLElement[] = [];
    try {
      const span = document.createElement('span');
      span.style.fontSize = `${size}px`;
      range.surroundContents(span);
      spans = [span];
    } catch {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('fontSize', false, '7');
      const markers = Array.from(editor.querySelectorAll('font[size="7"]'));
      spans = markers.filter((m): m is HTMLElement => m instanceof HTMLElement);
      spans.forEach(m => { m.removeAttribute('size'); m.style.fontSize = `${size}px`; });
    }
    updateNote('content', editor.innerHTML);
    if (spans.length > 0) {
      const r = document.createRange();
      r.setStart(spans[0], 0);
      r.setEnd(spans[spans.length - 1], spans[spans.length - 1].childNodes.length);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    editor.focus();
    saveSelection();
  }, [updateNote, restoreSelection, saveSelection]);

  const getSelectionSize = (): number => {
    const sel = window.getSelection();
    let node: Node | null = sel && sel.rangeCount > 0 ? sel.anchorNode : null;
    if (node && node.nodeType === Node.TEXT_NODE && node.parentElement) node = node.parentElement;
    if (node instanceof Element) {
      const s = parseFloat(window.getComputedStyle(node).fontSize);
      if (!isNaN(s)) return s;
    }
    return 16;
  };

  const changeFontSize = useCallback((delta: number) => {
    const current = getSelectionSize();
    const next = Math.round(Math.min(48, Math.max(10, current + delta)));
    applyFontSize(next);
  }, [applyFontSize]);

  const setFontSize = useCallback((level: number) => {
    const size = FONT_LEVELS[level - 1] ?? 16;
    applyFontSize(size);
  }, [applyFontSize]);

  const applyFontFamily = useCallback((family: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      editor.focus();
      return;
    }
    const range = sel.getRangeAt(0);
    
    // If family is empty (Default option), remove all font-family spans
    if (!family) {
      // Find all spans with fontFamily set and remove them
      const allSpans = editor.querySelectorAll('span');
      const spansToRemove: HTMLElement[] = [];
      allSpans.forEach(span => {
        if (span.style.fontFamily) {
          // Check if this span intersects with our selection
          const spanRange = document.createRange();
          spanRange.selectNodeContents(span);
          if (range.compareBoundaryPoints(Range.START_TO_END, spanRange) > 0 &&
              range.compareBoundaryPoints(Range.END_TO_START, spanRange) < 0) {
            spansToRemove.push(span);
          }
        }
      });
      
      // Unwrap the spans
      spansToRemove.forEach(span => {
        const parent = span.parentNode;
        while (span.firstChild) {
          parent?.insertBefore(span.firstChild, span);
        }
        span.remove();
        if (parent && parent.normalize) {
          parent.normalize();
        }
      });
      
      updateNote('content', editor.innerHTML);
      saveSelection();
      return;
    }
    
    let spans: HTMLElement[] = [];
    try {
      const span = document.createElement('span');
      span.style.fontFamily = family;
      range.surroundContents(span);
      spans = [span];
    } catch {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('fontName', false, family);
      const markers = Array.from(editor.querySelectorAll('font[face]'));
      spans = markers.map(m => {
        const face = m.getAttribute('face') || '';
        const el = document.createElement('span');
        if (face) el.style.fontFamily = face;
        while (m.firstChild) el.appendChild(m.firstChild);
        m.replaceWith(el);
        return el;
      });
    }
    updateNote('content', editor.innerHTML);
    if (spans.length > 0) {
      const r = document.createRange();
      r.setStart(spans[0], 0);
      r.setEnd(spans[spans.length - 1], spans[spans.length - 1].childNodes.length);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    editor.focus();
    saveSelection();
  }, [updateNote, restoreSelection, saveSelection]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    
    e.preventDefault();
    restoreSelection();
    
    let html: string;
    if (detectMarkdown(text)) {
      html = markdownToHtml(text);
    } else {
      html = escapeHtml(text).replace(/\n/g, '<br />');
    }
    
    // Wrap in Noto Nastaliq span if Urdu text detected
    if (detectLanguage(text) === 'ur') {
      html = `<span style="font-family: 'Noto Nastaliq Urdu', serif;">${html}</span>`;
    }
    
    document.execCommand('insertHTML', false, html);
    updateNote('content', editor.innerHTML);
    saveSelection();
  }, [updateNote, restoreSelection, saveSelection]);

  const handleStudentClick = useCallback((student: string) => { navigate({ activeStudent: student, appView: 'studentNotes' }); }, [navigate]);
  const handleNoteClick = useCallback((id: string) => { navigate({ activeId: id, appView: 'reading' }); }, [navigate]);
  const handleBackToStudents = goBack;
  const handleBackToNotes = goBack;
  const handleEditFromReading = useCallback(() => { navigate({ appView: 'editing', editFromStudent: true }); }, [navigate]);

  const renderStudentsView = () => (
    <div className="list-view">
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">Teacher workspace</p>
          <h1>Students</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle theme" aria-label="Toggle theme">
            {theme === 'dark' ? <SunMedium size={20} /> : <Moon size={20} />}
          </button>
          <span className={`sync-status ${isOnline ? 'online' : 'offline'}`} title={isOnline ? 'Online' : 'Offline'} />
        </div>
      </header>

      <div className="students-layout">
        <div className="sidebar-full">
          <div className="note-list">
            {filteredStudents.map(student => {
              const count = notes.filter(n => n.student === student).length;
              const color = getStudentColor(student, avatarColors);
              return (
                <div key={student} className="student-card" onClick={() => handleStudentClick(student)}>
                  <div className="student-avatar" style={{ background: color }}>{student.charAt(0).toUpperCase()}</div>
                  <div className="student-info">
                    <strong>{student}</strong>
                    <span>{count} {count === 1 ? 'note' : 'notes'}</span>
                  </div>
                  <div className="student-actions">
                    <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); setColorPickerFor(student); }} title="Change color" aria-label={`Change color for ${student}`}><Palette size={14} /></button>
                    <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); renameStudent(student); }} title="Rename" aria-label={`Rename ${student}`}><Edit2 size={14} /></button>
                    <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); deleteStudent(student); }} title="Remove" aria-label={`Remove ${student}`}><Trash2 size={14} /></button>
                    <ChevronRight size={18} className="student-chevron" />
                  </div>
                </div>
              );
            })}
            {filteredStudents.length === 0 && (
              <div className="empty-state">
                <BookOpen size={48} strokeWidth={1} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <p>No students found</p>
              </div>
            )}
          </div>
          <button className="fab" onClick={addStudent} title="Add student" aria-label="Add student">
            <Plus size={24} />
          </button>
        </div>
        <aside className="students-hero">
          <div className="hero-card">
            <div className="hero-icon"><BookOpen size={32} strokeWidth={1.5} /></div>
            <h2>Your students</h2>
            <p>Tap a student to view and manage their notes. Use the palette on each card to assign a color, then add notes as needed.</p>
            <div className="hero-stats">
              <div><strong>{students.length}</strong><span>Students</span></div>
              <div><strong>{notes.length}</strong><span>Notes</span></div>
            </div>
          </div>
        </aside>
      </div>
      </div>
    );

  const renderStudentNotesView = () => {
    if (!activeStudent) return renderStudentsView();
    return (
      <div className="list-view">
        <header className="reading-topbar">
          <button className="icon-btn" onClick={handleBackToStudents} title="Back" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <button
            className="student-avatar inline"
            style={{ background: getStudentColor(activeStudent, avatarColors) }}
            onClick={() => setColorPickerFor(activeStudent)}
            title="Change avatar color"
            aria-label={`Change avatar color for ${activeStudent}`}
          >
            {activeStudent.charAt(0).toUpperCase()}
          </button>
          <div className="reading-title">
            <p className="eyebrow">Notes</p>
            <h1>{activeStudent}</h1>
          </div>
          <div className="reading-actions" />
        </header>

        <section className="search-row">
          <div className="search-box">
            <Search size={18} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes" />
          </div>
        </section>

        <div className="students-layout notes-view">
        <div className="sidebar-full">
          <div className="note-list">
            {filteredNotesForStudent.map(note => (
              <div key={note.id} className="note-card" onClick={() => handleNoteClick(note.id)}>
                <div className="note-meta">
                  <strong>{note.title}</strong>
                  <span>{timeAgo(note.updated_at)}</span>
                </div>
                <p>{stripHtml(note.content)}</p>
              </div>
            ))}
            {filteredNotesForStudent.length === 0 && (
              <div className="empty-state">
                <BookOpen size={48} strokeWidth={1} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <p>{search ? 'No matching notes' : 'No notes yet'}</p>
                {!search && activeStudent && (
                  <button className="primary-btn" onClick={() => createNote(activeStudent)} style={{ marginTop: '1rem' }}>
                    <Plus size={16} /> <span>Add note</span>
                  </button>
                )}
              </div>
            )}
            </div>
          </div>
        {activeStudent && (
          <button className="fab" onClick={() => createNote(activeStudent)} title="Add note" aria-label="Add note">
            <Plus size={24} />
          </button>
        )}
        </div>
      </div>
    );
  };

  const renderReadingView = () => {
    if (!activeNote) return renderStudentsView();
    const date = new Date(activeNote.updated_at);
    const dateLabel = isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const wordCount = stripHtml(activeNote.content).trim().split(/\s+/).filter(Boolean).length;
    return (
      <div className="reading-view-full">
        <header className="reading-topbar">
          <button className="icon-btn" onClick={handleBackToNotes} title="Back" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="reading-title">
            <p className="eyebrow">{activeNote.student}{dateLabel ? ` · ${dateLabel}` : ''}</p>
            <h1>{activeNote.title}</h1>
          </div>
          <div className="reading-actions">
            <button className="icon-btn" onClick={handleCopy} title="Copy note" aria-label="Copy note">
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
            <button className="icon-btn" onClick={handleEditFromReading} title="Edit" aria-label="Edit">
              <Edit2 size={18} />
            </button>
            <button className="icon-btn" onClick={() => deleteNote(activeNote.id)} title="Delete" aria-label="Delete">
              <Trash2 size={18} />
            </button>
          </div>
        </header>
        <main className={`reading-content ${activeNote.language === 'ur' ? 'ur' : 'en'}`}>
          <div dangerouslySetInnerHTML={{ __html: activeNote.content }} />
        </main>
        <footer className="reading-footer">
          <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
          {timeAgo(activeNote.updated_at) && <span>· Updated {timeAgo(activeNote.updated_at)}</span>}
        </footer>
      </div>
    );
  };

  const renderEditingView = () => {
    if (!activeNote) return renderStudentsView();
    return (
      <div className="editing-view">
        <header className="editing-topbar">
          <button className="icon-btn" onClick={handleBackToNotes} title="Back" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <button
            className="student-avatar inline"
            style={{ background: getStudentColor(activeNote.student, avatarColors) }}
            onClick={() => setColorPickerFor(activeNote.student)}
            title="Change avatar color"
            aria-label={`Change avatar color for ${activeNote.student}`}
          >
            {activeNote.student.charAt(0).toUpperCase()}
          </button>
          <div className="editing-title">
            <p className="eyebrow">Editing</p>
            <h1>{activeNote.title || 'Untitled note'}</h1>
          </div>
          <div className="editing-actions">
            <span className={`save-indicator ${saveState === 'saving' ? 'saving' : ''}`}>
              {saveState === 'saving' ? 'Saving…' : 'Saved'}
            </span>
            <button className="icon-btn" onClick={() => deleteNote(activeNote.id)} title="Delete" aria-label="Delete">
              <Trash2 size={18} />
            </button>
          </div>
        </header>
        <main className="editor-form-full">
          {!editFromStudent && (
            <input
              value={activeNote.student}
              onChange={e => updateNote('student', e.target.value)}
              placeholder="Student name"
            />
          )}
          <input
            className="title-input"
            value={activeNote.title}
            onChange={e => updateNote('title', e.target.value)}
            placeholder="Title"
          />
          <div
            className="rich-toolbar"
            onMouseDown={e => {
              const t = e.target as HTMLElement;
              if (t.closest('select')) return;
              e.preventDefault();
            }}
          >
            <button type="button" className={`toolbar-btn ${fmtState.bold ? 'active' : ''}`} onClick={() => formatText('bold')} title="Bold"><Bold size={20} /></button>
            <button type="button" className={`toolbar-btn ${fmtState.underline ? 'active' : ''}`} onClick={() => formatText('underline')} title="Underline"><Underline size={20} /></button>
            <button type="button" className={`toolbar-btn ${fmtState.highlight ? 'active' : ''}`} onClick={() => formatText('highlight')} title="Highlight"><Highlighter size={20} /></button>
            <span className="toolbar-divider" />
            <button type="button" className="toolbar-btn" onClick={() => changeFontSize(-1)} title="Decrease font size"><span className="fs-symbol fs-down">A−</span></button>
            <button type="button" className="toolbar-btn" onClick={() => changeFontSize(1)} title="Increase font size"><span className="fs-symbol fs-up">A+</span></button>
            <span className="size-indicator" title="Selected text size">{selSize}px</span>
            <span className="toolbar-divider" />
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" className="toolbar-btn fs-level" onClick={() => setFontSize(n)} title={`Font size ${n}`}>{n}</button>
            ))}
            <span className="toolbar-divider" />
            <select
              className="font-select"
              defaultValue=""
              title="Apply font to selection"
              aria-label="Apply font to selection"
              onChange={e => {
                applyFontFamily(e.target.value);
                e.target.value = '';
              }}
            >
              <option value="" disabled>Font</option>
              {FONTS.map(f => (
                <option key={f.name} value={f.value}>{f.name}</option>
              ))}
            </select>
          </div>
          <div
            ref={editorRef}
            className="rich-editor"
            contentEditable
            suppressContentEditableWarning
            onInput={e => updateNote('content', e.currentTarget.innerHTML)}
            onPaste={handlePaste}
            data-placeholder="Write your note…"
          />
          <footer className="editor-footer">
            <span>{stripHtml(activeNote.content).trim().split(/\s+/).filter(Boolean).length} words</span>
            {timeAgo(activeNote.updated_at) && <span>Updated {timeAgo(activeNote.updated_at)}</span>}
          </footer>
        </main>
      </div>
    );
  };

  return (
    <div className="app-shell">
      {appView === 'students' && renderStudentsView()}
      {appView === 'studentNotes' && renderStudentNotesView()}
      {appView === 'reading' && renderReadingView()}
      {appView === 'editing' && renderEditingView()}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{modal.mode === 'addStudent' ? 'Add student' : 'Rename student'}</h3>
            <input
              autoFocus
              value={modalValue}
              onChange={e => setModalValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitModal(); if (e.key === 'Escape') setModal(null); }}
              placeholder="Student name"
            />
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setModal(null)}>Cancel</button>
              <button className="modal-btn primary" onClick={submitModal}>
                {modal.mode === 'addStudent' ? 'Add' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {colorPickerFor && (
        <div className="modal-overlay" onClick={() => setColorPickerFor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{colorPickerFor} — Avatar color</h3>
            <div className="color-options">
              {AVATAR_COLORS.map(c => (
                <button
                  key={c.value}
                  className={`color-swatch ${getStudentColor(colorPickerFor, avatarColors) === c.value ? 'selected' : ''}`}
                  style={{ background: c.value }}
                  onClick={() => { setStudentColor(colorPickerFor, c.value); }}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
            <div className="color-wheel">
              <label htmlFor="avatar-color-wheel">Custom color</label>
              <input
                id="avatar-color-wheel"
                type="color"
                value={getStudentColor(colorPickerFor, avatarColors)}
                onChange={e => setStudentColor(colorPickerFor, e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setColorPickerFor(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{confirm.title}</h3>
            <p className="modal-message">{confirm.message}</p>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className="modal-btn danger"
                onClick={() => { setConfirm(null); confirm.onConfirm(); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
