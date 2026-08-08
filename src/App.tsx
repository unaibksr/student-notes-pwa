import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Moon, Search, SunMedium, Plus, Bold, Italic, Underline, ArrowLeft, Edit2, Trash2, ChevronRight, Palette } from 'lucide-react';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

type Note = {
  id: string;
  student: string;
  title: string;
  content: string;
  language: 'en' | 'ur';
  updated_at: string;
};

type ThemeMode = 'light' | 'dark';
type AppView = 'students' | 'studentNotes' | 'reading' | 'editing';
type ViewState = { appView: AppView; activeStudent: string | null; activeId: string | null; editFromStudent: boolean };

const STORAGE_KEY = 'teacher-notes-pwa';
const SAMPLE_NOTES: Note[] = [
  { id: crypto.randomUUID(), student: 'Ayesha', title: 'Reading progress', content: 'Ayesha is improving her reading confidence and needs encouragement with longer passages.', language: 'en', updated_at: new Date().toISOString() },
  { id: crypto.randomUUID(), student: 'Bilal', title: 'MUQADDIMA', content: 'بلاگ کے ساتھ مشق کرانے کی ضرورت ہے۔ نظم میں گونج اور سنیریت کو یقینی بنائیں۔', language: 'ur', updated_at: new Date().toISOString() },
];

const detectLanguage = (text: string): 'en' | 'ur' => {
  const urduPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  return urduPattern.test(text) ? 'ur' : 'en';
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '');

const AVATAR_COLORS = [
  { name: 'Green', value: '#22c55e' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' },
];
const COLOR_KEY = 'teacher-notes-colors';
const getStudentColor = (student: string, map: Record<string, string>) =>
  map[student] || AVATAR_COLORS[0].value;

let supabaseSeeded = false;

const syncUpsert = (note: Note) => {
  if (!supabase) return;
  (async () => {
    try { await supabase.from('notes').upsert({
      id: note.id, student: note.student, title: note.title,
      content: note.content, language: note.language, updated_at: note.updated_at,
    }); } catch { /* offline or error: keep local state */ }
  })();
};
const syncDelete = (id: string) => {
  if (!supabase) return;
  (async () => {
    try { await supabase.from('notes').delete().eq('id', id); } catch { /* ignore */ }
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

function App() {
  const [notes, setNotes] = useState<Note[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : SAMPLE_NOTES;
  });
  const [search, setSearch] = useState('');
  const [activeStudent, setActiveStudent] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editFromStudent, setEditFromStudent] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [appView, setAppView] = useState<AppView>('students');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
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
    window.history.pushState({}, '');
  }, []);

  const goBack = useCallback(() => { window.history.back(); }, []);

  useEffect(() => {
    const onPop = () => {
      if (historyRef.current.length > 1) {
        historyRef.current.pop();
        const s = historyRef.current[historyRef.current.length - 1];
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
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem(COLOR_KEY, JSON.stringify(avatarColors));
  }, [avatarColors]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
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
    (async () => {
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
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredStudents = useMemo(() => students, [students]);

  const filteredNotesForStudent = useMemo(() => {
    const term = debouncedSearch.toLowerCase();
    return studentNotes.filter(note => {
      const haystack = `${note.title} ${stripHtml(note.content)}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [studentNotes, debouncedSearch]);

  useEffect(() => {
    if (editorRef.current && activeNote) {
      editorRef.current.innerHTML = activeNote.content;
    }
  }, [activeNote?.id, appView]);

  const updateNote = useCallback((field: keyof Note, value: string) => {
    if (!activeNote) return;
    const updated: Note = { ...activeNote, [field]: value, updated_at: new Date().toISOString() };
    if (field === 'content' || field === 'title') {
      updated.language = detectLanguage(`${updated.title} ${stripHtml(updated.content)}`);
    }
    setNotes(prev => prev.map(note => (note.id === updated.id ? updated : note)));
    syncUpsert(updated);
  }, [activeNote]);

  const createNote = useCallback((student: string) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      student,
      title: 'Untitled note',
      content: '<p>Write your reflection here…</p>',
      language: 'en',
      updated_at: new Date().toISOString()
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
    if (!window.confirm('Are you sure you want to delete this note?')) return;
    setNotes(prev => prev.filter(note => note.id !== id));
    syncDelete(id);
    if (activeId === id) {
      navigate({ appView: 'studentNotes', activeId: null, editFromStudent: false });
    }
    showToast('Note deleted');
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
        title: 'New note',
        content: '<p></p>',
        language: 'en',
        updated_at: new Date().toISOString()
      };
      setNotes(prev => prev.some(n => n.student === trimmed) ? prev : [placeholder, ...prev]);
      syncUpsert(placeholder);
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
      showToast('Student renamed');
    }
    setModal(null);
  }, [modal, modalValue, activeStudent, notes]);

  const setStudentColor = useCallback((student: string, color: string) => {
    setAvatarColors(prev => ({ ...prev, [student]: color }));
  }, []);

  const deleteStudent = useCallback((name: string) => {
    const count = notes.filter(n => n.student === name).length;
    if (!window.confirm(`Delete ${name} and their ${count} note(s)?`)) return;
    setNotes(prev => prev.filter(n => n.student !== name));
    setAvatarColors(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    syncDeleteStudent(name);
    if (activeStudent === name) { navigate({ appView: 'students', activeStudent: null, activeId: null, editFromStudent: false }); }
    showToast('Student removed');
  }, [notes, activeStudent, navigate]);

  const formatText = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) updateNote('content', editorRef.current.innerHTML);
  }, [updateNote]);

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
          <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle theme">
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
                    <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); setColorPickerFor(student); }} title="Change color"><Palette size={14} /></button>
                    <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); renameStudent(student); }} title="Rename"><Edit2 size={14} /></button>
                    <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); deleteStudent(student); }} title="Remove"><Trash2 size={14} /></button>
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
          <button className="icon-btn" onClick={handleBackToStudents} title="Back">
            <ArrowLeft size={20} />
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
                </div>
                <p>{stripHtml(note.content)}</p>
              </div>
            ))}
            {filteredNotesForStudent.length === 0 && (
              <div className="empty-state">
                <BookOpen size={48} strokeWidth={1} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <p>No notes yet</p>
                {activeStudent && (
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
    return (
      <div className="reading-view-full">
        <header className="reading-topbar">
          <button className="icon-btn" onClick={handleBackToNotes} title="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="reading-title">
            <p className="eyebrow">{activeNote.student}{dateLabel ? ` · ${dateLabel}` : ''}</p>
            <h1>{activeNote.title}</h1>
          </div>
          <div className="reading-actions">
            <button className="icon-btn" onClick={handleEditFromReading} title="Edit">
              <Edit2 size={18} />
            </button>
            <button className="icon-btn" onClick={() => deleteNote(activeNote.id)} title="Delete">
              <Trash2 size={18} />
            </button>
          </div>
        </header>
        <main className={`reading-content ${activeNote.language === 'ur' ? 'ur' : 'en'}`}>
          <div dangerouslySetInnerHTML={{ __html: activeNote.content }} />
        </main>
      </div>
    );
  };

  const renderEditingView = () => {
    if (!activeNote) return renderStudentsView();
    return (
      <div className="editing-view">
        <header className="editing-topbar">
          <button className="icon-btn" onClick={handleBackToNotes} title="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="editing-title">
            <p className="eyebrow">Editing</p>
            <h1>{activeNote.title || 'Untitled note'}</h1>
          </div>
          <div className="editing-actions">
            <button className="icon-btn" onClick={() => deleteNote(activeNote.id)} title="Delete">
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
            value={activeNote.title}
            onChange={e => updateNote('title', e.target.value)}
            placeholder="Title"
          />
          <div className="rich-toolbar">
            <button type="button" className="toolbar-btn" onClick={() => formatText('bold')} title="Bold"><Bold size={18} /></button>
            <button type="button" className="toolbar-btn" onClick={() => formatText('italic')} title="Italic"><Italic size={18} /></button>
            <button type="button" className="toolbar-btn" onClick={() => formatText('underline')} title="Underline"><Underline size={18} /></button>
          </div>
          <div
            ref={editorRef}
            className="rich-editor"
            contentEditable
            suppressContentEditableWarning
            onInput={e => updateNote('content', e.currentTarget.innerHTML)}
            data-placeholder="Write your note…"
          />
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
                  onClick={() => { setStudentColor(colorPickerFor, c.value); setColorPickerFor(null); }}
                  title={c.name}
                  aria-label={c.name}
                />
              ))}
            </div>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setColorPickerFor(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;